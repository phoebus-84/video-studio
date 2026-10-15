// ---------------------------------------------------------------------------
// Capability tools: fal, TTS, graphics, composition
// ---------------------------------------------------------------------------
// Provider-neutral capability tools that let Pi orchestrate media production.
// Each tool calls the underlying service directly — Pi is a trusted local process.
// ---------------------------------------------------------------------------

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, join } from "node:path";
import { resolveConfig, DEFAULT_TTS_WORKER_URL } from "./config.js";
import { guardEpisodePath } from "./trust-guards.js";
import { WORKSPACE_PARAMS, episodeOf, guardWorkspacePath, workspaceOf, type WorkspaceParams } from "./workspace-target.js";
import {
  loadVectorAnimationSpec,
  renderVectorAnimation,
} from "./vector-animation.js";
import {
  NONVERBAL_EMOTIONS,
  synthesizeNonverbalBuzz,
} from "./nonverbal-audio.js";
import { MAX_SECONDS, MUSIC_KEYS, SOUND_DESCRIPTIONS, SOUND_KINDS, synthesizeSound } from "./procedural-sound.js";
import {
  composeMultitrackVideo,
  loadSoundCueSheet,
} from "./multitrack-compose.js";
import { CodexImageClient } from "@av/codex-image";
import { createFalClient, getProfile, FalHttpError, FalValidationError } from "@av/fal-media";
import { paidCall, providerCost, type SpendCall } from "./spend.js";
import { SpendRefused, toMicros } from "@studio/contracts/src/budget.mjs";
import {
  CODEX_PROVIDER,
  DEFAULT_FAL_MODEL,
  resolveImageProvider,
} from "./image-provider.js";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import {
  assembleNarrationSegments,
  buildNarrationManifest,
  findFinalWav,
  silenceFromLegacyManifest,
  validateNarrationManifest,
  writeNarrationManifest,
  type NarrationSegmentInput,
  decideEditTimeline,
  EDIT_TIMELINE_PATH,
  alignTake,
  verifyTake,
  workerTranscriber,
  AlignError,
  registerTake,
  elevenLabsAlignmentUsd,
  compareVersions,
  initEpisodeSpec,
  upgradeEpisodeSpec,
  makeLayoutSheet,
  proposeReference,
  renderEpisode,
  writeEditTimeline,
  type Validation,
} from "@studio/episode";

// ── Inline fal client (avoids dynamic import complexity in Pi) ──────────────

const DEFAULT_MODEL = DEFAULT_FAL_MODEL;

/**
 * Generate through an OpenAI ChatGPT/Codex plan.
 *
 * The token lives in Pi's model registry — it is the login the user already
 * did, and it is the one thing @av/codex-image cannot fetch for itself, which
 * is precisely why this glue is here and not in the package.
 */
interface CodexReferenceImage {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

async function generateImageViaCodex(
  prompt: string,
  model: string,
  registry: { getApiKeyForProvider(provider: string): Promise<string | undefined> },
  referenceImages: CodexReferenceImage[] = [],
  signal?: AbortSignal,
): Promise<{ data: Buffer; model: string; provider: string; revisedPrompt?: string; extension: string }> {
  const token = await registry.getApiKeyForProvider(CODEX_PROVIDER);
  if (!token) {
    throw new Error(
      `No ${CODEX_PROVIDER} credential. Run /login in Pi and pick ChatGPT Plus/Pro ` +
        `(outside Pi, \`codex login\` or AVG_CODEX_TOKEN also work), ` +
        `or set this series' image.provider back to a fal model.`,
    );
  }

  const client = new CodexImageClient({ transport: { kind: "subscription", token } });
  const image = await client.generate({
    prompt,
    model,
    outputFormat: "png",
    ...(referenceImages.length > 0 ? { inputImages: referenceImages } : {}),
  }, signal);

  return {
    data: image.data,
    model: image.model,
    provider: image.provider,
    ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {}),
    extension: "png",
  };
}

function imageMimeType(filePath: string): CodexReferenceImage["mimeType"] {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    default:
      throw new Error(`Unsupported reference image type: ${extname(filePath) || "no extension"}`);
  }
}

function asDataUrl(filePath: string): string {
  const mimeType = imageMimeType(filePath);
  return `data:${mimeType};base64,${readFileSync(filePath).toString("base64")}`;
}

async function generateImage(
  prompt: string,
  model?: string,
  spend?: SpendCall,
): Promise<{ imageUrl: string; data: Buffer; seed: number; model: string }> {
  const apiKey = (await resolveConfig()).falKeyRef;
  if (!apiKey) throw new Error("FAL_KEY env var not set");

  const modelName = model || DEFAULT_MODEL;
  const isNanoBanana = modelName.includes("nano-banana");

  const body: any = {
    prompt,
    ...(isNanoBanana
      ? {
          aspect_ratio: "16:9",
          resolution: "2K",
          output_format: "png",
          num_images: 1,
        }
      : {
          image_size: "landscape_16_9",
          num_inference_steps: modelName.includes("schnell") ? 4 : 28,
        }
    ),
  };

  // From here a failure may have been billed (avg-91o): the ledger settles
  // it at the estimate unless the provider answers with a refusal below.
  spend?.sending();
  const res = await fetch(`https://fal.run/${modelName}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // A 4xx is fal declining the request — nothing generated, nothing billed.
    // A 5xx or 429 says nothing about whether work was done, so it settles.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) spend?.refused();
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`fal.ai error: ${res.status} ${err?.detail ?? res.statusText}`);
  }

  const result = await res.json() as { images: Array<{ url: string; content_type?: string }>; seed?: number };
  if (!result.images?.[0]) throw new Error("fal.ai returned no images");

  const imgUrl = result.images[0].url!;
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);

  const data = Buffer.from(await imgRes.arrayBuffer());
  return { imageUrl: imgUrl, data, seed: result.seed ?? 0, model: modelName };
}

// ── TTS synthesis ──────────────────────────────────────────────────────────

/** The Qwen3-TTS CustomVoice speakers the worker's model knows, and its aliases (avg-vzb). */
export const QWEN_SPEAKERS = ["aiden", "dylan", "eric", "ono_anna", "ryan", "serena", "sohee", "uncle_fu", "vivian"] as const;
export const QWEN_SPEAKER_ALIASES = ["default", "narrator", "girl", "grandmother", "wolf", "woodcutter"] as const;
/** The languages the worker's /synthesize accepts. */
export const QWEN_LANGUAGES = [
  "auto", "chinese", "english", "german", "italian", "portuguese", "spanish", "japanese", "korean", "french", "russian",
  "beijing_dialect", "sichuan_dialect",
] as const;

/** What the worker answered for one synthesis: kept beside the WAV as its receipt. */
interface WorkerSynthesis {
  job_id: string;
  wav_path: string;
  duration_sec: number;
  text_hash?: string;
  provider_mode?: string;
  actual_speaker?: string | null;
  model_path?: string | null;
  model_identity_sha256?: string | null;
  created_at?: string;
  completed_at?: string | null;
}

async function synthesizeSpeech(
  text: string, voice: string, speed: number, instruct?: string, language?: string,
): Promise<{ audioPath: string; durationSec: number; result: WorkerSynthesis }> {
  const ttsUrl = process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL;

  const reqBody: Record<string, unknown> = { text, voice, speed };
  if (instruct) reqBody.instruct = instruct;
  if (language) reqBody.language = language;

  const res = await fetch(`${ttsUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`TTS error: ${res.status} ${typeof err?.detail === "string" ? err.detail : JSON.stringify(err?.detail ?? res.statusText)}`);
  }

  const body = await res.json() as { ok: boolean; result?: WorkerSynthesis & { error?: string | null } };
  if (!body.ok || !body.result?.wav_path) {
    throw new Error(`TTS synthesis failed: ${body.result?.error ?? JSON.stringify(body)}`);
  }
  return { audioPath: body.result.wav_path, durationSec: body.result.duration_sec, result: body.result };
}

/** What an enrolled clone voice said: the worker's clone synthesis (POST /voices/{id}/synthesize). */
interface CloneSynthesis {
  synthesis_id: string;
  voice_id: string;
  voice_revision_sha256: string;
  provider_mode: string;
  model_size: string;
  model_profile: string;
  model_revision?: string | null;
  model_identity_sha256?: string | null;
  reference_audio_sha256: string;
  reference_text_sha256: string;
  seed?: number | null;
  wav_path: string;
  wav_sha256: string;
  duration_seconds: number;
  created_at?: string;
  warning?: string | null;
}

const CLONE_LANGUAGES: Record<string, string> = { auto: "auto", italian: "italian", english: "english", german: "german", french: "french", spanish: "spanish", portuguese: "portuguese", russian: "russian", japanese: "japanese", korean: "korean", chinese: "chinese" };

/** A clone voice speaks through the Base model, with the reference the operator enrolled with consent; never a fallback to a preset. */
async function synthesizeWithClone(voiceId: string, text: string, language: string | undefined, seed: number | undefined): Promise<CloneSynthesis> {
  const ttsUrl = process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL;
  const body = { text, language: CLONE_LANGUAGES[language ?? "auto"] ?? "auto", model_size: "1.7B", ...(seed !== undefined ? { seed } : {}) };
  const res = await fetch(`${ttsUrl}/voices/${encodeURIComponent(voiceId)}/synthesize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({})) as CloneSynthesis & { error?: string; detail?: unknown };
  if (!res.ok || !out.wav_path) {
    throw new Error(`clone voice ${voiceId}: ${res.status} ${out.error ?? (typeof out.detail === "string" ? out.detail : JSON.stringify(out.detail ?? res.statusText))}`);
  }
  return out;
}

// ── Narration ──────────────────────────────────────────────────────────────

export function canonicalNarrationPath(episodeDir: string): string | null {
  const manifestPath = join(episodeDir, "artifacts", "narration", "narration-manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as any;
  const finalWav = manifest.finalWav ?? manifest.final_wav;
  if (typeof finalWav?.path !== "string" || finalWav.path.length === 0) {
    throw new Error("Canonical narration manifest has no final WAV path");
  }
  const resolved = finalWav.path.startsWith("/") ? finalWav.path : join(episodeDir, finalWav.path);
  if (!existsSync(resolved)) throw new Error(`Canonical narration final WAV is missing: ${resolved}`);

  // Composition needs only the final WAV, so a manifest that names one is
  // usable here even when the rest of it is not canonical. Everything else
  // reading this episode needs `entries`, and skips a manifest without them
  // without saying so — which is how a manifest describing eleven complete
  // segments read, everywhere but here, as no narration at all.
  const problems = validateNarrationManifest(manifest);
  if (problems.length > 0) {
    console.warn(
      `narration-manifest.json is not canonical and will be ignored by the studio: ${problems.join("; ")}. `
      + "Run pva_write_narration_manifest to rewrite it.",
    );
  }
  return resolved;
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function registerCapabilityTools(pi: ExtensionAPI): void {
  const LIBRARY_ROOT = process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  // Layout 2 puts a series inside `series/` and an episode inside `episodes/`.
  // Joining the four names by hand was the pre-migration layout, so every tool
  // here wrote its images, narration and renders beside the episode rather than
  // into it — coherent only while workspace authoring made the same mistake.
  function episodeDir(channel: string, series: string, episode: string): string {
    return episodePath(LIBRARY_ROOT, channel, series, episode);
  }
  /** The episode or channel source a tool works in (avg-dcf.2). */
  const where = (params: WorkspaceParams) => workspaceOf(LIBRARY_ROOT, params);

  // --- Tool: pva_render_vector_animation ---------------------------------

  pi.registerTool({
    name: "pva_render_vector_animation",
    label: "Render Vector Animation",
    description: "Validate or render a deterministic rigged 2D SVG animation spec to H.264 MP4. Saves under episode assets/animation/.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      specPath: Type.Optional(Type.String({ default: "artifacts/vector-animation.json", description: "Animation spec path relative to the episode" })),
      outputName: Type.Optional(Type.String({ default: "visuals.mp4", description: "Output filename under assets/animation" })),
      renderScale: Type.Optional(Type.Number({ default: 1, minimum: 0.1, maximum: 1, description: "Preview scale; use 1 for delivery" })),
      keepFrames: Type.Optional(Type.Boolean({ default: false })),
      dryRun: Type.Optional(Type.Boolean({ default: false, description: "Validate the spec without rasterizing frames" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const relativeSpec = params.specPath ?? "artifacts/vector-animation.json";
      const outputName = params.outputName ?? "visuals.mp4";
      if (!outputName.match(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.mp4$/)) throw new Error("outputName must be a safe .mp4 filename");
      const guard = await guardEpisodePath(LIBRARY_ROOT, params.channel, params.series, params.episode, relativeSpec);
      if (!guard.allowed) throw new Error(guard.reason ?? "Animation spec path rejected");
      const outputGuard = await guardEpisodePath(LIBRARY_ROOT, params.channel, params.series, params.episode, join("assets", "animation", outputName));
      if (!outputGuard.allowed) throw new Error(outputGuard.reason ?? "Animation output path rejected");

      const dir = episodeDir(params.channel, params.series, params.episode);
      const spec = await loadVectorAnimationSpec(join(dir, relativeSpec));
      if (params.dryRun) {
        const summary = {
          valid: true,
          name: spec.name,
          dimensions: `${spec.width}x${spec.height}`,
          fps: spec.fps,
          frames: spec.durationInFrames,
          durationSeconds: spec.durationInFrames / spec.fps,
          nodes: spec.nodes.length,
          tracks: spec.tracks.length,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
          details: { validation: summary },
        };
      }

      let lastPercent = -1;
      const result = await renderVectorAnimation({
        spec,
        outputPath: join(dir, "assets", "animation", outputName),
        renderScale: params.renderScale ?? 1,
        keepFrames: params.keepFrames ?? false,
        signal,
        onProgress(completed, total) {
          const percent = Math.floor((completed / total) * 10) * 10;
          if (percent !== lastPercent) {
            lastPercent = percent;
            onUpdate?.({
              content: [{ type: "text" as const, text: `Rasterizing vector frames: ${percent}%` }],
              details: { completed, total, percent },
            });
          }
        },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: { render: result },
      };
    },
  });

  // --- Tool: pva_synthesize_nonverbal_audio -------------------------------

  pi.registerTool({
    name: "pva_synthesize_nonverbal_audio",
    label: "Synthesize Nonverbal Audio",
    description: "Generate a deterministic speech-free character buzz cue as mono PCM WAV.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      cueId: Type.String({ description: "Safe cue ID used as the WAV filename" }),
      emotion: StringEnum(NONVERBAL_EMOTIONS, { description: "Expressive buzz emotion" }),
      durationSeconds: Type.Number({ minimum: 0.1, maximum: 8 }),
      gain: Type.Optional(Type.Number({ default: 0.72, exclusiveMinimum: 0, maximum: 1 })),
    }),
    async execute(_toolCallId, params) {
      if (!params.cueId.match(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)) throw new Error("cueId must contain only letters, numbers, underscores, and hyphens");
      const relativeOutput = join("assets", "audio", `${params.cueId}.wav`);
      const guard = await guardWorkspacePath(LIBRARY_ROOT, where(params), relativeOutput);
      if (!guard.allowed) throw new Error(guard.reason ?? "Audio output path rejected");
      const dir = where(params).dir;
      const result = await synthesizeNonverbalBuzz({
        emotion: params.emotion,
        durationSeconds: params.durationSeconds,
        gain: params.gain,
        seed: `${where(params).label}/${params.cueId}`,
        outputPath: join(dir, relativeOutput),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: { audio: result },
      };
    },
  });

  // --- Tool: pva_synthesize_sound (avg-jur) ---------------------------------

  pi.registerTool({
    name: "pva_synthesize_sound",
    label: "Synthesize Sound",
    description:
      "Make a sound effect, ambience, applause or music bed locally at $0, deterministic from its id, as a 48 kHz mono WAV " +
      "in the episode's assets/sounds/<soundId>.wav, with a receipt beside it (<soundId>.sound.json). Kinds: " +
      SOUND_KINDS.map((k) => `${k} (${SOUND_DESCRIPTIONS[k]})`).join(", ") +
      ". They are synthesized stand-ins, not recordings: name one in the spec by its soundId.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      soundId: Type.String({ description: "The asset id the spec names; the WAV's file name" }),
      kind: StringEnum([...SOUND_KINDS], { description: "What the sound is" }),
      durationSeconds: Type.Number({ minimum: 0.2, maximum: MAX_SECONDS }),
      gain: Type.Optional(Type.Number({ default: 0.5, exclusiveMinimum: 0, maximum: 1, description: "Peak level" })),
      key: Type.Optional(StringEnum([...MUSIC_KEYS], { description: "music-bed: its key (default D)" })),
      mode: Type.Optional(StringEnum(["major", "minor"], { description: "music-bed: major or minor (default minor)" })),
    }),
    async execute(_toolCallId, params) {
      try {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(params.soundId)) {
          throw new Error("soundId must contain only letters, numbers, underscores, and hyphens");
        }
        const relative = `assets/sounds/${params.soundId}.wav`;
        const guard = await guardWorkspacePath(LIBRARY_ROOT, where(params), relative);
        if (!guard.allowed) throw new Error(guard.reason ?? "Sound output path rejected");
        const seed = `${where(params).label}/${params.soundId}`;
        const gain = params.gain ?? 0.5;
        const wav = synthesizeSound({
          kind: params.kind, durationSeconds: params.durationSeconds, seed, gain,
          ...(params.key ? { key: params.key } : {}), ...(params.mode ? { mode: params.mode as "major" | "minor" } : {}),
        });
        const dir = join(where(params).dir, "assets", "sounds");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${params.soundId}.wav`), wav);
        const receipt = {
          generator: "studio-procedural-sound@1",
          kind: params.kind,
          durationSeconds: params.durationSeconds,
          gain,
          ...(params.kind === "music-bed" ? { key: params.key ?? "D", mode: params.mode ?? "minor" } : {}),
          seed,
          wav: relative,
          wavSha256: createHash("sha256").update(wav).digest("hex"),
          createdAt: new Date().toISOString(),
        };
        writeFileSync(join(dir, `${params.soundId}.sound.json`), `${JSON.stringify(receipt, null, 2)}\n`);
        // Two files for one asset id stop the compile (ambiguous-asset): say which to remove.
        const twins = readdirSync(dir).filter((name) =>
          name !== `${params.soundId}.wav` && name.toLowerCase().startsWith(`${params.soundId.toLowerCase()}.`) &&
          /\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(name));
        const warning = twins.length > 0 ? ` ⚠️ also in assets/sounds: ${twins.join(", ")}; remove ${twins.length === 1 ? "it" : "them"}, or the compiler will find the id ambiguous` : "";
        return {
          content: [{ type: "text" as const, text: `✅ ${params.soundId}: ${params.kind}, ${params.durationSeconds}s → ${relative} (receipt ${params.soundId}.sound.json)${warning}` }],
          details: { path: relative, receipt } as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {} as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_generate_image (fal.ai or an OpenAI plan) -----------------

  pi.registerTool({
    name: "pva_generate_image",
    label: "Generate Image",
    description:
      "Generate an image with the provider this series configured — a fal.ai model, or gpt-image through an " +
      "OpenAI ChatGPT/Codex plan when pipeline.yaml sets image.provider to openai-codex. Saves directly to " +
      "episode assets/images/.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      sceneId: Type.String({ description: "Scene ID (e.g. s1, s2)" }),
      prompt: Type.String({ description: "Image generation prompt" }),
      outputWidth: Type.Optional(Type.Integer({ minimum: 64, maximum: 4096, description: "Optional normalized output width" })),
      outputHeight: Type.Optional(Type.Integer({ minimum: 64, maximum: 4096, description: "Optional normalized output height" })),
      referenceImagePaths: Type.Optional(Type.Array(Type.String(), {
        maxItems: 5,
        description: "Existing episode-relative images used as continuity references (Codex provider only)",
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        if (!params.sceneId.match(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)) {
          throw new Error("sceneId must contain only letters, numbers, underscores, and hyphens");
        }
        if ((params.outputWidth === undefined) !== (params.outputHeight === undefined)) {
          throw new Error("outputWidth and outputHeight must be supplied together");
        }
        const workspace = where(params);
        const dir = workspace.dir;
        const libraryRoot = process.env["AVG_LIBRARY_ROOT"] || join(process.cwd(), "library");
        const provider = resolveImageProvider(libraryRoot, params.channel, params.series);
        // A source has no budget: a paid provider is refused before anything is written.
        if (provider.kind === "fal" && workspace.kind === "source") {
          throw new Error(`image generation with fal is paid, and a source has no budget: set image.provider: openai-codex in the channel's pipeline.yaml, fetch an archive picture (pva_fetch_media), or generate it in an episode`);
        }
        const imgDir = join(dir, "assets", "images");
        mkdirSync(imgDir, { recursive: true });
        const referenceImages: CodexReferenceImage[] = [];
        for (const relativePath of params.referenceImagePaths ?? []) {
          const guard = await guardWorkspacePath(LIBRARY_ROOT, where(params), relativePath,
          );
          if (!guard.allowed) throw new Error(guard.reason ?? "Reference image path rejected");
          const fullPath = join(dir, relativePath);
          if (!existsSync(fullPath)) throw new Error(`Reference image not found: ${relativePath}`);
          referenceImages.push({
            data: readFileSync(fullPath),
            mimeType: imageMimeType(fullPath),
          });
        }
        if (provider.kind === "fal" && referenceImages.length > 0) {
          throw new Error("referenceImagePaths requires image.provider: openai-codex");
        }

        // The two providers return different encodings, so the extension comes
        // from the result rather than being assumed — the previous code wrote
        // every image as .jpg whatever the bytes actually were.
        const result =
          provider.kind === "codex"
            ? await generateImageViaCodex(params.prompt, provider.model, ctx.modelRegistry, referenceImages, signal)
            : await (async () => {
                // Through the episode's spend ledger (avg-91o): reserved
                // before the request, settled after, refused over budget.
                const fal = await paidCall(
                  { libraryRoot: LIBRARY_ROOT, ...episodeOf(where(params), "image generation with fal") },
                  { capability: "image.generate", provider: "fal", model: provider.model, purpose: `image ${params.sceneId}` },
                  async (spend) => ({ value: await generateImage(params.prompt, provider.model, spend) }),
                );
                return {
                  data: fal.data,
                  model: fal.model,
                  provider: "fal",
                  seed: fal.seed,
                  extension: "jpg",
                } as const;
              })();

        const fileName = `${params.sceneId}.${result.extension}`;
        const outPath = join(imgDir, fileName);
        if (params.outputWidth !== undefined && params.outputHeight !== undefined) {
          const sourceDir = join(imgDir, "source");
          mkdirSync(sourceDir, { recursive: true });
          const sourcePath = join(sourceDir, fileName);
          writeFileSync(sourcePath, result.data);
          const normalized = spawnSync("ffmpeg", [
            "-y",
            "-i", sourcePath,
            "-vf", `scale=${params.outputWidth}:${params.outputHeight}:force_original_aspect_ratio=increase,crop=${params.outputWidth}:${params.outputHeight}`,
            "-frames:v", "1",
            outPath,
          ], { encoding: "utf-8" });
          if (normalized.status !== 0 || !existsSync(outPath)) {
            throw new Error(`Image normalization failed: ${(normalized.stderr || normalized.stdout).trim().slice(-1000)}`);
          }
        } else {
          writeFileSync(outPath, result.data);
        }

        const outputSize = statSync(outPath).size;
        const seed = "seed" in result ? result.seed : undefined;
        const summary = [
          `✅ ${fileName} — ${(outputSize / 1024).toFixed(0)}KB`,
          `(${result.provider}/${result.model}${seed !== undefined ? `, seed: ${seed}` : ""})`,
        ].join(" ");

        return {
          content: [{ type: "text" as const, text: summary }],
          details: {
            path: outPath,
            size: outputSize,
            provider: result.provider,
            ...(params.outputWidth !== undefined && params.outputHeight !== undefined
              ? { dimensions: `${params.outputWidth}x${params.outputHeight}` }
              : {}),
            model: result.model,
            ...(seed !== undefined ? { seed } : {}),
            ...("revisedPrompt" in result && result.revisedPrompt
              ? { revisedPrompt: result.revisedPrompt }
              : {}),
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_generate_minimax_h3_video (via fal.ai) -------------------

  pi.registerTool({
    name: "pva_generate_minimax_h3_video",
    label: "Generate MiniMax H3 Video",
    description:
      "Animate one opening keyframe, optionally toward an exact closing keyframe, with MiniMax H3 through fal.ai. " +
      "Saves one clip and provenance sidecar under episode assets/video/.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      shotId: Type.String({ description: "Safe shot ID used as the MP4 filename" }),
      prompt: Type.String({ description: "MiniMax H3 production prompt" }),
      firstFramePath: Type.String({ description: "Episode-relative opening keyframe path" }),
      lastFramePath: Type.Optional(Type.String({ description: "Episode-relative closing keyframe path" })),
      durationSeconds: Type.Integer({ minimum: 4, maximum: 15, default: 5 }),
      resolution: Type.Optional(StringEnum(["480P", "768P", "2K", "4K"] as const, { default: "2K" })),
      seed: Type.Optional(Type.Integer()),
      enablePromptExpansion: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        if (!params.shotId.match(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)) {
          throw new Error("shotId must contain only letters, numbers, underscores, and hyphens");
        }

        const dir = episodeDir(params.channel, params.series, params.episode);
        const framePaths: string[] = [params.firstFramePath];
        if (params.lastFramePath) framePaths.push(params.lastFramePath);
        const resolvedFrames: string[] = [];
        for (const relativePath of framePaths) {
          const guard = await guardEpisodePath(
            LIBRARY_ROOT,
            params.channel,
            params.series,
            params.episode,
            relativePath,
          );
          if (!guard.allowed) throw new Error(guard.reason ?? "Keyframe path rejected");
          const fullPath = join(dir, relativePath);
          if (!existsSync(fullPath)) throw new Error(`Keyframe not found: ${relativePath}`);
          imageMimeType(fullPath);
          resolvedFrames.push(fullPath);
        }

        const config = await resolveConfig();
        if (!config.falKeyRef) throw new Error("FAL_KEY env var not set");
        const profile = getProfile("minimax/h3/image-to-video@v1");
        if (!profile) throw new Error("MiniMax H3 image-to-video profile is not installed");

        const parameters: Record<string, unknown> = {
          prompt: params.prompt,
          duration: params.durationSeconds,
          resolution: params.resolution ?? "2K",
          image_url: asDataUrl(resolvedFrames[0]!),
          enable_prompt_expansion: params.enablePromptExpansion ?? false,
          enable_safety_checker: true,
          ...(resolvedFrames[1] ? { last_image_url: asDataUrl(resolvedFrames[1]) } : {}),
          ...(params.seed === undefined ? {} : { seed: params.seed }),
        };
        const requestHash = createHash("sha256")
          .update(params.prompt)
          .update(readFileSync(resolvedFrames[0]!))
          .update(resolvedFrames[1] ? readFileSync(resolvedFrames[1]) : Buffer.alloc(0))
          .digest("hex")
          .slice(0, 20);

        onUpdate?.({
          content: [{ type: "text" as const, text: `Submitting ${params.shotId} to MiniMax H3…` }],
          details: { shotId: params.shotId, profileId: profile.profileId },
        });

        const client = createFalClient(config.falKeyRef);
        // Through the episode's spend ledger (avg-91o). A clip is the most
        // expensive call the studio makes; it is reserved at the profile's
        // price before submission and settled at what fal reports.
        const result = await paidCall(
          { libraryRoot: LIBRARY_ROOT, channel: params.channel, series: params.series, episode: params.episode },
          { capability: "video.generate", provider: "fal", model: profile.profileId, purpose: `clip ${params.shotId}` },
          async (spend) => {
            spend.sending();
            try {
              const generated = await client.submitAndWait({
                idempotencyKey: `${params.channel}-${params.series}-${params.episode}-${params.shotId}-${requestHash}`,
                binding: {
                  endpointId: profile.endpointId,
                  contractVersion: profile.contractVersion,
                  baseUrl: "",
                },
                parameters,
                timeoutMs: 900_000,
              }, signal, { maxWaitMs: 900_000 });
              return { value: generated, cost: providerCost(generated.cost), providerRequestId: generated.providerRequestId };
            } catch (e) {
              // Refused by validation before submit, or by fal with a 4xx:
              // nothing generated. Anything else may have been billed.
              if (e instanceof FalValidationError || (e instanceof FalHttpError && e.status >= 400 && e.status < 500 && e.status !== 429)) {
                spend.refused();
              }
              throw e;
            }
          },
        );

        const output = result.outputs.find((candidate) => candidate.contentType.startsWith("video/")) ?? result.outputs[0];
        if (!output) throw new Error("MiniMax H3 completed without a video output");
        const download = await fetch(output.url, { signal });
        if (!download.ok) throw new Error(`Failed to download MiniMax H3 output: ${download.status}`);
        const data = Buffer.from(await download.arrayBuffer());

        const videoDir = join(dir, "assets", "video");
        mkdirSync(videoDir, { recursive: true });
        const outputPath = join(videoDir, `${params.shotId}.mp4`);
        const provenancePath = join(videoDir, `${params.shotId}.provenance.json`);
        writeFileSync(outputPath, data);
        writeFileSync(provenancePath, JSON.stringify({
          version: 1,
          provider: "fal.ai",
          profileId: result.profileId,
          schemaFingerprint: result.schemaFingerprint,
          providerRequestId: result.providerRequestId,
          idempotencyKey: result.idempotencyKey,
          prompt: params.prompt,
          firstFramePath: params.firstFramePath,
          ...(params.lastFramePath ? { lastFramePath: params.lastFramePath } : {}),
          durationSeconds: params.durationSeconds,
          resolution: params.resolution ?? "2K",
          seed: params.seed ?? null,
          cost: result.cost,
          outputSha256: createHash("sha256").update(data).digest("hex"),
          completedAt: result.completedAt.toISOString(),
        }, null, 2));

        return {
          content: [{
            type: "text" as const,
            text: `✅ ${params.shotId}.mp4 — ${(data.length / 1024 / 1024).toFixed(1)}MB (${result.profileId})`,
          }],
          details: {
            outputPath,
            provenancePath,
            size: data.length,
            profileId: result.profileId,
            providerRequestId: result.providerRequestId,
            cost: result.cost,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_stitch_video_clips --------------------------------------

  pi.registerTool({
    name: "pva_stitch_video_clips",
    label: "Stitch Video Clips",
    description:
      "Concatenate generated episode clips in the supplied order, remove provider audio, and normalize to a 1080x1920 30 fps H.264 visual master.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      clipPaths: Type.Array(Type.String(), { minItems: 1, description: "Ordered episode-relative MP4 paths" }),
      outputName: Type.Optional(Type.String({ default: "visuals.mp4", description: "Output filename under assets/animation" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const outputName = params.outputName ?? "visuals.mp4";
        if (!outputName.match(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.mp4$/)) {
          throw new Error("outputName must be a safe .mp4 filename");
        }
        const dir = episodeDir(params.channel, params.series, params.episode);
        const resolvedClips: string[] = [];
        for (const relativePath of params.clipPaths) {
          const guard = await guardEpisodePath(
            LIBRARY_ROOT,
            params.channel,
            params.series,
            params.episode,
            relativePath,
          );
          if (!guard.allowed) throw new Error(guard.reason ?? "Clip path rejected");
          const fullPath = join(dir, relativePath);
          if (!existsSync(fullPath)) throw new Error(`Clip not found: ${relativePath}`);
          resolvedClips.push(fullPath);
        }

        const animationDir = join(dir, "assets", "animation");
        const artifactsDir = join(dir, "artifacts");
        mkdirSync(animationDir, { recursive: true });
        mkdirSync(artifactsDir, { recursive: true });
        const concatPath = join(artifactsDir, "minimax-concat.txt");
        const quoteForConcat = (value: string) => value.replace(/'/g, "'\\''");
        writeFileSync(concatPath, resolvedClips.map((clip) => `file '${quoteForConcat(clip)}'`).join("\n") + "\n");

        const outputPath = join(animationDir, outputName);
        const ffmpeg = spawnSync("ffmpeg", [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", concatPath,
          "-an",
          "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p",
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "18",
          "-movflags", "+faststart",
          outputPath,
        ], { encoding: "utf-8" });
        if (ffmpeg.status !== 0 || !existsSync(outputPath)) {
          throw new Error(`FFmpeg clip assembly failed: ${(ffmpeg.stderr || ffmpeg.stdout).trim().slice(-1000)}`);
        }

        return {
          content: [{
            type: "text" as const,
            text: `✅ ${resolvedClips.length} clips → assets/animation/${outputName} (${(statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB)`,
          }],
          details: { outputPath, clipCount: resolvedClips.length, fileSize: statSync(outputPath).size },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {} as { outputPath: string; clipCount: number; fileSize: number },
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_synthesize_speech (via TTS) ------------------------------

  pi.registerTool({
    name: "pva_synthesize_speech",
    label: "Synthesize Speech",
    description: "Synthesize speech audio via the local Qwen3-TTS worker. Saves to episode artifacts/narration/.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      sceneId: Type.String({ description: "Scene ID (e.g. n1, n2)" }),
      text: Type.String({ description: "Text to synthesize as speech" }),
      voice: Type.Optional(Type.String({
        default: "default",
        description: `Qwen CustomVoice speaker: ${QWEN_SPEAKERS.join(", ")}; or an alias: ${QWEN_SPEAKER_ALIASES.join(", ")}; ` +
          "or an enrolled clone voice as clone:<voice id> (see pva_voices; the channel's voices/registry names its characters' voices)",
      })),
      seed: Type.Optional(Type.Integer({ minimum: 0, description: "Clone voices: a seed, to make the same take again" })),
      language: Type.Optional(StringEnum([...QWEN_LANGUAGES], {
        description: "Language of the text. 'auto' lets the model guess; name it for anything not English (e.g. 'italian')",
      })),
      speed: Type.Optional(Type.Number({ default: 1.0, description: "Must be 1.0: Qwen does not change speed" })),
      instruct: Type.Optional(Type.String({ description: "Emotion/character instruction. Use for multi-character scenes: 'Speak with a sly, cunning voice like a wolf', 'Speak warmly like a grandmother', 'Speak with a young innocent girl voice'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(params.sceneId)) {
          throw new Error("sceneId must contain only letters, numbers, underscores, and hyphens");
        }
        // Where it goes first: a wrong episode or source fails before the synthesis, not after.
        const dir = where(params).dir;
        const voice = params.voice ?? "default";
        const narrationDir = join(dir, "artifacts", "narration");
        const destPath = join(narrationDir, `${params.sceneId}.wav`);
        const receiptPath = join(narrationDir, `${params.sceneId}.synthesis.json`);
        const { copyFileSync } = await import("node:fs");
        const clone = /^clone:([0-9a-f-]{36})$/i.exec(voice);
        if (voice.startsWith("clone:") && !clone) throw new Error(`"${voice}" is not clone:<voice id>; list the enrolled voices with pva_voices`);
        if (clone) {
          if (params.instruct) throw new Error("a clone voice takes no instruct: its manner is the reference's");
          const c = await synthesizeWithClone(clone[1]!, params.text, params.language, params.seed);
          mkdirSync(narrationDir, { recursive: true });
          copyFileSync(c.wav_path, destPath);
          const wavSha256 = createHash("sha256").update(readFileSync(destPath)).digest("hex");
          if (wavSha256 !== c.wav_sha256) throw new Error("the clone's WAV changed between the worker and the workspace");
          const receipt = {
            provider: "qwen-local",
            method: "voice-clone",
            synthesisId: c.synthesis_id,
            voice: { id: c.voice_id, revisionSha256: c.voice_revision_sha256, referenceAudioSha256: c.reference_audio_sha256, referenceTextSha256: c.reference_text_sha256 },
            model: { profile: c.model_profile, size: c.model_size, revision: c.model_revision ?? null, identitySha256: c.model_identity_sha256 ?? null },
            providerMode: c.provider_mode,
            requestedVoice: voice,
            language: params.language ?? "auto",
            ...(c.seed !== undefined && c.seed !== null ? { seed: c.seed } : {}),
            text: params.text,
            wav: `artifacts/narration/${params.sceneId}.wav`,
            wavSha256,
            durationSeconds: c.duration_seconds,
            createdAt: c.created_at ?? new Date().toISOString(),
            ...(c.warning ? { warning: c.warning } : {}),
          };
          writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
          return {
            content: [{ type: "text" as const, text: `✅ ${params.sceneId} — ${c.duration_seconds.toFixed(1)}s, clone voice ${c.voice_id} (${receipt.language}) → ${destPath}; receipt ${receiptPath}${c.warning ? ` ⚠️ ${c.warning}` : ""}` }],
            details: { audioPath: destPath, durationSec: c.duration_seconds, receiptPath, receipt },
          };
        }
        const result = await synthesizeSpeech(params.text, voice, params.speed ?? 1.0, params.instruct, params.language);

        // Copy audio to the workspace's artifacts/narration/
        mkdirSync(narrationDir, { recursive: true });
        copyFileSync(result.audioPath, destPath);
        // The receipt: which job, model and speaker made this WAV, beside it (avg-vzb).
        const r = result.result;
        const receipt = {
          provider: "qwen-local",
          jobId: r.job_id,
          model: r.model_path ? r.model_path.split("/").pop() : null,
          modelIdentitySha256: r.model_identity_sha256 ?? null,
          providerMode: r.provider_mode ?? null,
          requestedVoice: voice,
          speaker: r.actual_speaker ?? null,
          language: params.language ?? "auto",
          ...(params.instruct ? { instruct: params.instruct } : {}),
          text: params.text,
          textHash: r.text_hash ?? null,
          wav: `artifacts/narration/${params.sceneId}.wav`,
          wavSha256: createHash("sha256").update(readFileSync(destPath)).digest("hex"),
          durationSeconds: result.durationSec,
          createdAt: r.completed_at ?? r.created_at ?? new Date().toISOString(),
        };
        writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

        return {
          content: [{
            type: "text" as const,
            text: `✅ ${params.sceneId} — ${result.durationSec.toFixed(1)}s, ${receipt.speaker ?? voice} (${receipt.language}) → ${destPath}; receipt ${receiptPath}`,
          }],
          details: { audioPath: destPath, durationSec: result.durationSec, receiptPath, receipt },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_voices -------------------------------------------------------

  pi.registerTool({
    name: "pva_voices",
    label: "List Voices",
    description: "List the voice worker's voice profiles: presets, designed voices and enrolled clone voices (with their id, to use as voice: clone:<id> in pva_synthesize_speech). Enrolling a clone needs the operator's consent and is done by the operator, not here.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const ttsUrl = process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL;
        const res = await fetch(`${ttsUrl}/voices`);
        if (!res.ok) throw new Error(`the voice worker answered ${res.status} for /voices`);
        const voices = await res.json() as { id: string; name: string; mode: string; language: string }[];
        const text = voices.length === 0 ? "no voice profiles" : voices.map((v) => `- ${v.name}: ${v.mode === "clone" ? `clone:${v.id}` : `${v.mode} ${v.id}`} (${v.language})`).join("\n");
        return { content: [{ type: "text" as const, text }], details: { voices } as Record<string, unknown> };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `❌ ${err instanceof Error ? err.message : String(err)}` }], details: {}, isError: true as unknown as boolean };
      }
    },
  });

  // --- Tool: pva_write_narration_manifest ---------------------------------

  pi.registerTool({
    name: "pva_write_narration_manifest",
    label: "Write Narration Manifest",
    description:
      "Write the canonical artifacts/narration/narration-manifest.json for an episode, measuring each WAV. Call this after synthesizing narration: the studio, the scene spine, and the timing and caption stages all read the episode's narration through this file, and skip it silently if it is not canonical. Segments default to the WAVs already on disk, or to the segments of a manifest written in an older shape.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      segments: Type.Optional(Type.Array(
        Type.Object({
          segmentId: Type.String({ description: "Segment ID (e.g. s1, s4a)" }),
          wavPath: Type.String({ description: "Episode-relative path to the segment WAV" }),
          text: Type.Optional(Type.String({ description: "Spoken text; becomes the caption cue" })),
          pauseAfterMs: Type.Optional(Type.Integer({ minimum: 0, description: "Silence after this segment" })),
        }),
        { description: "Segments in playback order. Defaults to what the episode already has." },
      )),
      finalWavPath: Type.Optional(Type.String({ description: "Episode-relative path to the assembled narration WAV" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);

        // Every path in the document names a file inside the episode, so each
        // one is caller-supplied input that has to be checked before it is read.
        const explicit = params.segments as NarrationSegmentInput[] | undefined;
        for (const relative of [
          ...(explicit ?? []).map((s) => s.wavPath),
          ...(params.finalWavPath ? [params.finalWavPath] : []),
        ]) {
          const guard = await guardEpisodePath(
            LIBRARY_ROOT, params.channel, params.series, params.episode, relative,
          );
          if (!guard.allowed) throw new Error(guard.reason ?? `Path rejected: ${relative}`);
        }

        const segments = assembleNarrationSegments(dir, explicit);
        if (segments.length === 0) {
          throw new Error(
            "No narration segments found. Synthesize speech first, or pass segments explicitly.",
          );
        }

        // Silence at either end is part of the mastered WAV, and a manifest
        // that omits it disagrees with the audio it describes by exactly that
        // much. An existing manifest records it; so does the first segment's
        // start offset.
        let existing: unknown;
        try {
          existing = JSON.parse(readFileSync(
            join(dir, "artifacts", "narration", "narration-manifest.json"), "utf-8",
          ));
        } catch { /* no earlier manifest to learn from */ }

        const document = buildNarrationManifest(dir, {
          episodeId: `${params.channel}/${params.series}/${params.episode}`,
          segments,
          finalWavPath: findFinalWav(dir, params.finalWavPath),
          ...silenceFromLegacyManifest(existing),
        });
        const written = writeNarrationManifest(dir, document);

        const entries = document.entries as Array<{ wav: { durationSeconds: number } }>;
        const captions = (document.captions as unknown[] | undefined)?.length ?? 0;
        const spoken = entries.reduce((total, e) => total + e.wav.durationSeconds, 0);

        return {
          content: [{
            type: "text" as const,
            text: `✅ ${entries.length} segments (${spoken.toFixed(1)}s spoken, ${captions} captions) → ${written}`,
          }],
          details: {
            manifestPath: written,
            segmentCount: entries.length,
            captionCount: captions,
            spokenSeconds: spoken,
            finalWav: (document.finalWav as { path?: string } | undefined)?.path ?? null,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_compose_multitrack_video ---------------------------------

  pi.registerTool({
    name: "pva_compose_multitrack_video",
    label: "Compose Multitrack Video",
    description: "Compose an animated clip with frame-addressed local buzz, Foley, and music cues into an immutable canonical render.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      videoPath: Type.Optional(Type.String({ default: "assets/animation/visuals.mp4", description: "Visual MP4 relative to the episode" })),
      cueSheetPath: Type.Optional(Type.String({ default: "artifacts/sound-cues.json", description: "Sound cue JSON relative to the episode" })),
      label: Type.Optional(Type.String({ default: "wordless-short", description: "Lowercase kebab-case render label" })),
    }),
    async execute(_toolCallId, params, signal) {
      const relativeVideo = params.videoPath ?? "assets/animation/visuals.mp4";
      const relativeCues = params.cueSheetPath ?? "artifacts/sound-cues.json";
      for (const relative of [relativeVideo, relativeCues]) {
        const guard = await guardEpisodePath(LIBRARY_ROOT, params.channel, params.series, params.episode, relative);
        if (!guard.allowed) throw new Error(guard.reason ?? "Composition input path rejected");
      }
      const dir = episodeDir(params.channel, params.series, params.episode);
      const cueSheet = await loadSoundCueSheet(join(dir, relativeCues));
      const currentPath = join(dir, "output", "current.json");
      return withFileMutationQueue(currentPath, async () => {
        const result = await composeMultitrackVideo({
          episodeDir: dir,
          videoPath: join(dir, relativeVideo),
          cueSheet,
          label: params.label,
          signal,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: { render: result },
        };
      });
    },
  });

  // --- Tools: pva_build_timeline and pva_compose_video (ADR-0036) ---------
  // The episode is composed through its edit timeline: a reviewable document
  // in artifacts/, rendered by @av/remotion-composer. No FFmpeg runs here.

  /** A series rule's finding, one line: "⚠️ panel-long at artifacts/edit-timeline.json#…: …". */
  const findingLine = (f: Validation["findings"][number]) => `${f.severity === "error" ? "❌" : "⚠️"} ${f.code} at ${f.path}: ${f.message}`;
  const seriesWarnings = (validation: Validation | null) =>
    (validation?.findings ?? []).filter((f) => f.severity === "warning").map(findingLine);

  const profileParam = Type.Optional(Type.String({
    description: "Output profile id: youtube-1920x1080 (default) or vertical-1080x1920. An episode with episode-spec.json renders its template's profile.",
  }));

  pi.registerTool({
    name: "pva_init_spec",
    label: "Create Episode Spec",
    description: "Create the episode's episode-spec.json as a draft pinned to an exact release of its series' template (templates/<id>/<version>/): every value the editor must supply is __FILL__, and the reply lists them. Never replaces an existing spec. Fill it with the fill-episode-spec skill, then run pva_check_episode.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      template: Type.String({ description: "Template id, as in the series' templates/ folder" }),
      version: Type.String({ description: "Exact release version, x.y.z (no ranges, no latest)" }),
    }),
    async execute(_toolCallId, params) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
      const result = await withFileMutationQueue(join(dir, "episode-spec.json"), async () =>
        initEpisodeSpec(dir, { episodeRef, template: { id: params.template, version: params.version } }));
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: ["❌ No spec written", ...result.problems.map((p) => `  - ${p.code} at ${p.path}: ${p.message}`)].join("\n") }],
          details: { problems: result.problems } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
      const pin = result.spec.template;
      const lines = [
        `✅ ${result.path}: a draft pinned to ${pin.id}@${pin.version} (${pin.hash})`,
        `${result.placeholders.length} value(s) to fill:`,
        ...result.placeholders.map((p) => `  - ${p}`),
        "Read the release's FORMAT.md and fill them with the fill-episode-spec skill; then pva_check_episode.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "pva_upgrade_spec",
    label: "Upgrade Episode Spec",
    description: "Move the episode's episode-spec.json to a newer release of the same series template (a new look or a corrected standard): the pin becomes that exact release, the data stays and must hold under its schema, the revision goes up by one. Never an implicit latest. Then pva_build_timeline and a new layout sheet: the old review no longer holds.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      version: Type.String({ description: "Exact newer release version, x.y.z, as in the series' templates/<id>/ folder" }),
    }),
    async execute(_toolCallId, params) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
      const result = await withFileMutationQueue(join(dir, "episode-spec.json"), async () =>
        upgradeEpisodeSpec(dir, { episodeRef, version: params.version }));
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: ["❌ The spec was not moved", ...result.problems.map((p) => `  - ${p.code} at ${p.path}: ${p.message}`)].join("\n") }],
          details: { problems: result.problems } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
      const { from, spec } = result;
      const text = [
        `✅ ${result.path}: ${from.id}@${from.version} → ${spec.template.id}@${spec.template.version} (${spec.template.hash}), revision ${spec.revision}`,
        "Rebuild the timeline (pva_build_timeline), check it, and make a new layout sheet for review.",
      ].join("\n");
      return { content: [{ type: "text" as const, text }], details: result as unknown as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "pva_propose_reference",
    label: "Propose Series Reference",
    description: "Propose the episode's current render as one of its series' golden references: freezes its spec and timeline into reviews/references/<id>/ and writes the proposal. Only the operator can approve it (vpr reference approve); nothing here signs. Use it only when the person says this episode is exemplary of the series.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      referenceId: Type.String({ description: "Lowercase kebab-case id, new in the series, e.g. san-martino-v1" }),
    }),
    async execute(_toolCallId, params) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
      const result = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
        proposeReference(dir, { episodeRef, referenceId: params.referenceId }));
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: ["❌ Nothing proposed", ...result.problems.map((p) => `  - ${p.code} at ${p.path}: ${p.message}`)].join("\n") }],
          details: { problems: result.problems } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
      const { proposal } = result;
      const lines = [
        `✅ proposed ${proposal.id} for ${params.channel}/${params.series} (template ${proposal.template.id}@${proposal.template.version})`,
        ...result.paths.map((p) => `  - ${p}`),
        `render: ${proposal.render.path}`,
        "Only a person can make it a reference. Ask them to run:",
        `  vpr reference approve ${params.channel}/${params.series}/${params.episode} ${proposal.id} --library ${LIBRARY_ROOT}`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
    },
  });

  pi.registerTool({
    name: "pva_build_timeline",
    label: "Build Edit Timeline",
    description: `Build the episode's edit timeline (${EDIT_TIMELINE_PATH}): compiled from episode-spec.json by its series template's compiler when the episode has a spec, otherwise from its scene images, timing and narration. The reviewable account of what pva_compose_video will render.`,
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      profile: profileParam,
    }),
    async execute(_toolCallId, params) {
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);
        const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
        // Queued with pva_compose_video, which may rebuild the same file.
        const { timeline, warnings, backup, compiledBy, validation } = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
          writeEditTimeline(dir, { episodeRef, ...(params.profile ? { profile: params.profile } : {}) }));
        const count = (id: string) => timeline.tracks.find((t) => t.id === id)?.items.length ?? 0;
        // The picture track is the lowest visual one: "scenes" from the legacy builder, "panels" from a compiler.
        const picture = timeline.tracks.filter((t) => t.type === "visual").sort((a, b) => Number(a.z) - Number(b.z))[0];
        const lines = [
          `✅ ${EDIT_TIMELINE_PATH}: ${picture?.items.length ?? 0} ${picture?.id ?? "scenes"}, ${count("captions")} captions, `
            + `${(timeline.durationInFrames / timeline.fps).toFixed(1)}s, ${timeline.profile.id}`,
          ...(compiledBy
            ? [`compiled by ${compiledBy.compiler} from episode-spec.json revision ${compiledBy.revision} (template ${compiledBy.template.id}@${compiledBy.template.version})`]
            : []),
          ...(backup ? [`previous timeline kept as ${backup}`] : []),
          ...(validation?.validator ? [`series rules ${validation.validator}: no errors`] : []),
          ...seriesWarnings(validation),
          ...warnings.map((w) => `⚠️ ${w}`),
        ];
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { path: EDIT_TIMELINE_PATH, timeline, warnings, compiledBy, validation } as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {} as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  pi.registerTool({
    name: "pva_compose_video",
    label: "Compose Video",
    description: `Render the episode's edit timeline (${EDIT_TIMELINE_PATH}) with Remotion to output/<render-id>.mp4 and move output/current.json. Rebuilds the timeline first when it is missing, when the episode's material changed, or when another profile is asked for; otherwise renders it as it stands, hand edits included.`,
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      profile: profileParam,
      label: Type.Optional(Type.String({ default: "render", description: "Lowercase kebab-case render label" })),
    }),
    async execute(_toolCallId, params, signal) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
      try {
        return await withFileMutationQueue(join(dir, "output", "current.json"), async () => {
          if (signal?.aborted) throw new Error("cancelled");
          const render = await renderEpisode(dir, {
            episodeRef,
            ...(params.profile ? { profile: params.profile } : {}),
            ...(params.label ? { label: params.label } : {}),
          });
          const mb = (render.result.sizeBytes / 1024 / 1024).toFixed(1);
          const lines = [
            `✅ output/${render.renderId}.mp4 — ${render.result.durationSeconds.toFixed(1)}s, ${mb}MB, ${render.result.profile}`,
            ...(render.rebuilt ? [`timeline rebuilt: ${render.rebuilt}`] : [`rendered ${EDIT_TIMELINE_PATH} as it stands`]),
            ...(render.compiledBy
              ? [`compiled by ${render.compiledBy.compiler} from episode-spec.json revision ${render.compiledBy.revision}`
                + (render.compiledBy.editedByHand ? ", then edited by hand" : "")]
              : []),
            ...(render.backup ? [`previous timeline kept as ${render.backup}`] : []),
            ...seriesWarnings(render.validation),
            ...render.warnings.map((w) => `⚠️ ${w}`),
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }], details: render as unknown as Record<string, unknown> };
        });
      } catch (err) {
        const e = err as { message?: string; code?: string; problems?: Array<{ code: string; message: string; path?: string }> };
        const problems = (e.problems ?? []).map((p) => `  - ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
        return {
          content: [{ type: "text" as const, text: [`❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}`, ...problems].join("\n") }],
          details: { code: e.code ?? null, problems: e.problems ?? [] } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  pi.registerTool({
    name: "pva_check_episode",
    label: "Check Episode",
    description: `Check what pva_compose_video would render against the episode's series rules, without writing or rendering anything: which timeline (${EDIT_TIMELINE_PATH} as it stands, or a recompiled one and why) and every finding, errors first. An episode without a spec, or whose template names no validator, has no series rules.`,
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      profile: profileParam,
    }),
    async execute(_toolCallId, params) {
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);
        const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
        // Reads only: not queued with the tools that write current.json.
        const decision = decideEditTimeline(dir, { episodeRef, ...(params.profile ? { profile: params.profile } : {}) });
        const validation = decision.validation;
        const findings = [...(validation?.findings ?? [])].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
        const errors = findings.filter((f) => f.severity === "error").length;
        const lines = [
          decision.rebuilt === null
            ? `${EDIT_TIMELINE_PATH} would be rendered as it stands`
            : `the timeline would be recompiled: ${decision.rebuilt}`,
          !validation?.validator
            ? "no series rules for this episode"
            : errors > 0
              ? `❌ ${errors} error(s) against ${validation.validator}: pva_compose_video would refuse it`
              : `✅ ${validation.validator}: no errors`,
          ...findings.map((f) => `  ${findingLine(f)}`),
          ...decision.warnings.map((w) => `⚠️ ${w}`),
        ];
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { rebuilt: decision.rebuilt, validation } as Record<string, unknown>,
        };
      } catch (err) {
        const e = err as { message?: string; problems?: Array<{ code: string; message: string; path?: string }> };
        const problems = (e.problems ?? []).map((p) => `  - ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
        return {
          content: [{ type: "text" as const, text: [`❌ ${e.message ?? String(err)}`, ...problems].join("\n") }],
          details: { problems: e.problems ?? [] } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  pi.registerTool({
    name: "pva_layout_sheet",
    label: "Layout Sheet",
    description: `Render the episode's layout sheet: small stills of the timeline pva_compose_video would render without a profile argument, at the first and last frame, spread over its sections and at its series' declared instants, and one labelled grid of them (artifacts/layout-sheet/sheet.jpg). Open the grid and read it tile by tile with the review-layout-sheet skill before a render is spent. Refuses a timeline that breaks the series' rules.`,
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
    }),
    async execute(_toolCallId, params) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
      try {
        // Queued with pva_compose_video, which may rewrite the timeline this shows.
        const sheet = await withFileMutationQueue(join(dir, "output", "current.json"), async () => makeLayoutSheet(dir, { episodeRef }));
        const { report } = sheet;
        const lines = [
          `✅ layout sheet: ${report.frames.length} frames, ${report.sheet.columns}×${report.sheet.rows}, rules ${report.rules.source}`,
          `open it: ${sheet.sheetPath}`,
          `stills: ${join(dir, "artifacts", "layout-sheet", "frames")}`,
          `inputs ${report.inputsHash}`,
          ...(report.rebuilt ? [`it shows the timeline a render would recompile first: ${report.rebuilt}`] : []),
          ...report.warnings.map((w) => `⚠️ ${w}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: sheet as unknown as Record<string, unknown> };
      } catch (err) {
        const e = err as { message?: string; code?: string; problems?: Array<{ code: string; message: string; path?: string }> };
        const problems = (e.problems ?? []).map((p) => `  - ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
        return {
          content: [{ type: "text" as const, text: [`❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}`, ...problems].join("\n") }],
          details: { code: e.code ?? null, problems: e.problems ?? [] } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  pi.registerTool({
    name: "pva_compare_versions",
    label: "Compare Versions",
    description: "Prove a correction touched only what was asked (UP-54): compare two renders of the episode — or a golden reference of its series — at the same instants (the layout sheet's, about 24, aligned section by section; or the `times` given), and report every compared frame that differs and every section added, removed or resized. Name the sections the correction should change in `expect`; the verdict is ok when every difference found is inside them. Only the compared instants are seen: pass `times` inside the corrected part to look closer. Writes reviews/compare/<old>--<new>/ with changed.jpg (old | new | difference) to open.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      old: Type.String({ description: "The version delivered before the correction: a render id (output/<render-id>.mp4) or reference:<template-id>/<reference-id>" }),
      new: Type.Optional(Type.String({ description: "The corrected version; default the current render" })),
      expect: Type.Optional(Type.Array(Type.String(), { description: "Section ids the correction should change; a trailing * matches a prefix (block-*)" })),
      threshold: Type.Optional(Type.Number({ description: "Mean grey difference (0–255) above which a frame has changed; default 1. A frame also changes when enough of its pixels do" })),
      times: Type.Optional(Type.Array(Type.Number(), { description: "Compare at these seconds of the new version instead of the layout sheet's instants" })),
      shifts: Type.Optional(Type.Array(Type.Object({ from: Type.Number(), by: Type.Number() }), { description: "Only for renders without a timeline: from <from> seconds on, the old version is <by> seconds later" })),
    }),
    async execute(_toolCallId, params) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      try {
        const { report, changedPath } = await compareVersions(dir, {
          old: params.old,
          ...(params.new ? { new: params.new } : {}),
          ...(params.expect ? { expect: params.expect } : {}),
          ...(params.threshold !== undefined ? { threshold: params.threshold } : {}),
          ...(params.times ? { times: params.times } : {}),
          ...(params.shifts ? { shifts: params.shifts } : {}),
        });
        const verdict = report.verdict === "ok"
          ? `✅ ok: every difference found is inside ${report.expect!.join(", ")}`
          : report.verdict === "unexpected-changes"
            ? `❌ unexpected changes outside ${report.expect!.join(", ")}: ${report.unexpected.length} frame(s), ${report.unexpectedStructure.length} section(s)`
            : `${report.changed.length} of ${report.pairs.length} frames differ (no expectation given)`;
        const lines = [
          `${verdict} — ${report.old.ref} → ${report.new.ref}, ${report.pairs.length} instants compared, aligned by ${report.alignment}`,
          ...report.structure.map((c) =>
            `  ${report.unexpectedStructure.includes(c) ? "❌" : "·"} ${c.section ?? "the video"} ${c.change} (${c.oldFrames} → ${c.newFrames} frames)`),
          ...report.pairs.filter((p) => p.changed).map((p) =>
            `  ${report.unexpected.includes(p.index) ? "❌" : "·"} #${String(p.index).padStart(2, "0")} · ${p.seconds.toFixed(2)}s · ${p.section ?? "no section"} · `
            + (p.reason ?? `diff ${p.meanDiff} (${Math.round((p.changedShare ?? 0) * 100)}%)`)),
          ...(changedPath ? [`open: ${changedPath}`] : []),
          ...[...report.old.notes, ...report.new.notes, ...report.warnings].map((w) => `⚠️ ${w}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { report, changedPath } as Record<string, unknown> };
      } catch (err) {
        const e = err as { message?: string; code?: string };
        return {
          content: [{ type: "text" as const, text: `❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}` }],
          details: { code: e.code ?? null } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  pi.registerTool({
    name: "pva_align_take",
    label: "Align Take",
    description: "Measure a narration take's word timing (speech.align): when each word of its written text is said in its audio, by forced alignment, written beside the take and named in artifacts/narration/takes.json — what the series compiler reads. Local Qwen3-ForcedAligner in the voice worker by default (free); provider \"elevenlabs\" only when the person asks for it (paid, through the spend ledger). Never switches provider on its own.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      take: Type.String({ description: "The take's id in takes.json" }),
      provider: Type.Optional(Type.Union([Type.Literal("qwen-local"), Type.Literal("elevenlabs"), Type.Literal("derived")], { description: "Default qwen-local; derived: a take made by pva_edit_audio, its words carried from the takes it was cut from (no aligner)" })),
      language: Type.Optional(Type.String({ description: "ISO 639-1 code (it, en…) when the take does not give one" })),
    }),
    async execute(_toolCallId, params) {
      const provider = params.provider ?? "qwen-local";
      try {
        const dir = where(params).dir;
        const apiKey = process.env.ELEVENLABS_API_KEY;
        const result = await alignTake(dir, {
          take: params.take,
          provider,
          ...(params.language ? { language: params.language } : {}),
          workerUrl: process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL,
          ...(provider === "elevenlabs" && apiKey ? {
            elevenlabs: {
              apiKey,
              // Through the episode's spend ledger (avg-91o), at the profile's price per minute.
              pay: <T>(minutes: number, call: () => Promise<T>) => paidCall(
                { libraryRoot: LIBRARY_ROOT, ...episodeOf(where(params), "alignment with ElevenLabs") },
                {
                  capability: "speech.align", provider: "elevenlabs", model: "forced-alignment", purpose: `align ${params.take}`,
                  estimate: {
                    estimate: { currency: "USD", micros: toMicros(elevenLabsAlignmentUsd(minutes)) },
                    priced: true,
                    profile: "elevenlabs-forced-alignment",
                  },
                },
                async (spend) => {
                  spend.sending();
                  try {
                    return { value: await call() };
                  } catch (e) {
                    // Refused before any processing: nothing was billed.
                    if (e instanceof AlignError && ["auth", "quota", "rate-limited", "bad-request", "unreachable"].includes(e.code)) spend.refused();
                    throw e;
                  }
                },
              ),
            },
          } : {}),
        });
        const { timing } = result;
        const lines = [
          `✅ ${params.take}: ${timing.words.length} words, ${provider} (${(timing.alignment as { model: string }).model}) → ${result.path}`,
          ...(result.pauses.length > 0 ? [`pauses over 0.35 s inside the speech: ${result.pauses.map((p) => `${p.toFixed(2)}s`).join(", ")}`] : []),
          ...(result.unmapped.length > 0 ? [`⚠️ not placed by the aligner (given the gap around them): ${result.unmapped.join(" ")}`] : []),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
      } catch (err) {
        const e = err as { message?: string; code?: string; name?: string };
        const code = e instanceof SpendRefused ? "budget" : e.code;
        return {
          content: [{ type: "text" as const, text: `❌ ${code ? `${code}: ` : ""}${e.message ?? String(err)}` }],
          details: { code: code ?? null } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_verify_take (avg-8hs.3) ---------------------------------

  pi.registerTool({
    name: "pva_verify_take",
    label: "Verify Take",
    description: "Check that a narration take says its text, before it is used: a local transcription (Whisper, in the voice worker, $0) made without the text " +
      "is compared with it — words or whole lines missing, extra, heard differently — and the take's alignment shows runs of words given almost no time " +
      "(not said, or mistimed). Also measures every pause at a verse end, a stanza end and inside a line, and the take's edges. Writes " +
      "artifacts/takes/<take>.verification.json. Judging the pauses is the series' or channel's rule (its skill or validator), not this tool's.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      take: Type.String({ description: "The take's id in takes.json" }),
      language: Type.Optional(Type.String({ description: "ISO 639-1 code (it, en…) when the take does not give one" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const { path, report } = await verifyTake(where(params).dir, params.take, {
          transcribe: workerTranscriber(process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL),
          ...(params.language ? { language: params.language } : {}),
        });
        const p = report.pauses;
        const fmt = (s: { count: number; min: number | null; median: number | null; max: number | null }) => s.count ? `${s.count}: ${s.min}–${s.max} s, median ${s.median} s` : "none";
        const lines = [
          `${report.concerns.length === 0 ? "✅" : "⚠️"} ${params.take}: ${report.words.matched}/${report.words.expected} written words heard (${report.transcriber.model}) → ${path}`,
          ...(p ? [`pauses at verse ends ${fmt(p.verse)}; at stanza ends ${fmt(p.stanza)}; inside lines ≥ 0.2 s: ${p.line.length}`] : []),
          ...(report.edges ? [`starts after ${report.edges.leadSeconds} s, ends ${report.edges.tailSeconds} s after the last word${report.edges.endsLoud ? " (still loud)" : ""}`] : []),
          ...report.concerns.map((c) => `- ${c}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { path, report } as unknown as Record<string, unknown> };
      } catch (err) {
        const e = err as { message?: string; code?: string };
        return {
          content: [{ type: "text" as const, text: `❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}` }],
          details: { code: e.code ?? null } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_register_take (avg-dcf.6.6) ----------------------------

  pi.registerTool({
    name: "pva_register_take",
    label: "Register Take",
    description: "Make an audio file a narration take of artifacts/narration/takes.json (what pva_align_take and the series compilers read): copied to assets/takes/<take>.<hash8>.<ext>, hashed, measured, with its text and the voice that said it, and placed in a unit's sequence — e.g. a short's unit \"recital\": titolo, then recita with pauseBefore 1. Registering a take again replaces it in place; a timing that measured other audio or text is dropped (align it again).",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      take: Type.String({ description: "The take's id (letters, digits, . _ -), e.g. titolo, recita" }),
      audio: Type.String({ description: "The audio file a speech tool made, relative to the episode, e.g. artifacts/narration/titolo.wav" }),
      text: Type.String({ description: "The written text the take says, exactly as shown on screen" }),
      spokenText: Type.Optional(Type.String({ description: "What the speech tool was given, when it differs from text (pronunciation spellings)" })),
      language: Type.Optional(Type.String({ description: "ISO 639-1, e.g. it" })),
      role: Type.Optional(Type.String({ description: "Who says it, e.g. guida, recitante" })),
      provider: Type.String({ description: "What made it, e.g. qwen3-tts-local, elevenlabs" }),
      model: Type.Optional(Type.String()),
      voiceId: Type.Optional(Type.String({ description: "The preset, designed or cloned voice used" })),
      direction: Type.Optional(Type.String({ description: "The instruction sent with the text (Qwen's direction)" })),
      settings: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Provider parameters, as sent" })),
      unit: Type.Optional(Type.String({ description: "The unit the take plays in, e.g. recital" })),
      pauseBefore: Type.Optional(Type.Number({ minimum: 0, maximum: 10, description: "Seconds of silence before this take in its unit (0–10; ignored for the unit's first take)" })),
      position: Type.Optional(Type.Integer({ minimum: 0, description: "Where the take goes in its unit (0 = first); by default appended, or kept in place when already there" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const dir = where(params).dir;
        const result = await registerTake(dir, {
          take: params.take,
          audio: params.audio,
          text: params.text,
          ...(params.spokenText !== undefined ? { spokenText: params.spokenText } : {}),
          ...(params.language !== undefined ? { language: params.language } : {}),
          ...(params.role !== undefined ? { role: params.role } : {}),
          voice: {
            provider: params.provider,
            ...(params.model !== undefined ? { model: params.model } : {}),
            ...(params.voiceId !== undefined ? { voiceId: params.voiceId } : {}),
            ...(params.direction !== undefined ? { direction: params.direction } : {}),
            ...(params.settings !== undefined ? { settings: params.settings as Record<string, unknown> } : {}),
          },
          ...(params.unit !== undefined ? { unit: {
            id: params.unit,
            ...(params.pauseBefore !== undefined ? { pauseBefore: params.pauseBefore } : {}),
            ...(params.position !== undefined ? { position: params.position } : {}),
          } } : {}),
        });
        const audio = result.take.audio as { durationSeconds: number };
        const lines = [
          `✅ take ${params.take}: ${audio.durationSeconds.toFixed(2)}s → ${result.audioPath}`,
          ...(result.sequence ? [`unit ${params.unit}: ${result.sequence.map((e) => (e.pauseBefore !== undefined ? `+${e.pauseBefore}s ${e.take}` : e.take)).join(" → ")}`] : []),
          ...(result.timingDropped ? ["⚠️ its timing measured other audio or text and was dropped: run pva_align_take"] : []),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
      } catch (err) {
        const e = err as { message?: string; code?: string };
        return {
          content: [{ type: "text" as const, text: `❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}` }],
          details: { code: e.code ?? null } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_render_terminal (via VHS) -----------------------------

  pi.registerTool({
    name: "pva_render_terminal",
    label: "Render Terminal Recording",
    description: "Render a VHS terminal recording from a .tape file. Saves MP4 to episode assets/tapes/.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      sceneId: Type.String({ description: "Scene ID (e.g. s4a, s5)" }),
      tapeContent: Type.Optional(Type.String({ description: "Inline .tape file content (alternative to tapePath)" })),
      tapePath: Type.Optional(Type.String({ description: "Path to existing .tape file relative to episode" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Recording is done by @av/terminal-recorder. This used to shell out to
      // vhs here, with the tape handling, the Output directive, the move into
      // assets/ and the ffprobe all inlined — none of which is studio work.
      // What is left is studio work: where an episode keeps its tapes, and how
      // the result is reported to Pi.
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);

        let tape: { content: string } | { path: string };
        if (params.tapeContent) {
          tape = { content: params.tapeContent };
        } else if (params.tapePath) {
          tape = { path: join(dir, params.tapePath) };
        } else {
          throw new Error("Either tapeContent or tapePath is required");
        }

        const { record } = await import("@av/terminal-recorder");
        const recording = record({
          tape,
          outputPath: join(dir, "assets", "tapes", `${params.sceneId}.mp4`),
        });

        // Probing is the media.probe capability, provided by the composer.
        // Inlining ffprobe here again would be the same mistake in miniature.
        const { probeMedia } = await import("@av/video-composer");
        const probed = await probeMedia(recording.outputPath, recording.bytes);
        const durationSec = probed.durationSec ?? 0;

        return {
          content: [{
            type: "text" as const,
            text: `✅ ${params.sceneId} — ${durationSec.toFixed(1)}s, ` +
              `${(recording.bytes / 1024).toFixed(0)}KB → assets/tapes/${params.sceneId}.mp4`,
          }],
          details: {
            outputPath: recording.outputPath,
            tapePath: recording.tapePath,
            durationSec,
            fileSize: recording.bytes,
          },
        };
      } catch (err) {
        // The recorder's errors already say what to do about them — a missing
        // vhs names the install command — so they are passed through rather
        // than flattened into "failed".
        const detail = err && typeof err === "object" && "detail" in err
          ? String((err as { detail: unknown }).detail)
          : "";
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: `❌ Failed: ${message}${detail ? `\n${detail}` : ""}`,
          }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_render_graphics (via studio-graphics-renderer) -----------

  pi.registerTool({
    name: "pva_render_graphics",
    label: "Render Graphics",
    description: "Render graphics content: title cards, lower thirds, diagrams, overlays.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      contentKind: Type.Union([
        Type.Literal("title-card"),
        Type.Literal("overlay"),
        Type.Literal("lower-third"),
        Type.Literal("end-card"),
      ], { description: "Type of graphic to render" }),
      text: Type.String({ description: "Text content" }),
      width: Type.Optional(Type.Number({ default: 1920 })),
      height: Type.Optional(Type.Number({ default: 1080 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        // For MVP, generate simple PNG via ffmpeg drawtext
        const dir = where(params).dir;
        const gfxDir = join(dir, "artifacts", "graphics");
        mkdirSync(gfxDir, { recursive: true });
        const outPath = join(gfxDir, `${params.contentKind}.png`);

        const fontSize = params.contentKind === "title-card" ? 96 : 48;
        const { execSync } = await import("node:child_process");
        execSync(
          `ffmpeg -y -f lavfi -i "color=c=black:s=${params.width ?? 1920}x${params.height ?? 1080}:d=1" ` +
          `-vf "drawtext=text='${params.text.replace(/'/g, "\\'")}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" ` +
          `-frames:v 1 "${outPath}" 2>/dev/null`,
        );

        return {
          content: [{ type: "text" as const, text: `✅ ${params.contentKind} rendered: ${outPath}` }],
          details: { outputPath: outPath },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_probe_media ---------------------------------------------

  pi.registerTool({
    name: "pva_probe_media",
    label: "Probe Media",
    description: "Probe a media file for metadata: dimensions, duration, codec.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      assetPath: Type.String({ description: "Relative path within episode (e.g. assets/images/s1.jpg)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const dir = where(params).dir;
        const fullPath = join(dir, params.assetPath);
        const { execSync } = await import("node:child_process");

        const out = execSync(
          `ffprobe -v quiet -print_format json -show_format -show_streams "${fullPath}"`,
          { encoding: "utf-8" },
        ).toString();

        const meta = JSON.parse(out);
        const summary = {
          path: fullPath,
          exists: existsSync(fullPath),
          format: meta.format?.format_name,
          duration: meta.format?.duration,
          size: meta.format?.size,
          streams: (meta.streams || []).map((s: any) => ({
            codec: s.codec_name,
            type: s.codec_type,
            width: s.width,
            height: s.height,
            channels: s.channels,
          })),
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
          details: { probe: summary },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_capability_status ---------------------------------------

  pi.registerTool({
    name: "pva_capability_status",
    label: "Capability Status",
    description:
      "Check which media production capabilities are available and their status. Pass channel and series to " +
      "learn the image route that series resolves (fal.ai or openai-codex) and whether it is ready.",
    parameters: Type.Object({
      channel: Type.Optional(Type.String({ description: "Channel slug, with series: report that series' image route" })),
      series: Type.Optional(Type.String({ description: "Series slug, with channel" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const caps: Record<string, { available: boolean; detail: string }> = {};
      const { imageGenerationStatus, voiceWorkerStatus } = await import("./capability-status.js");

      // Generated media: the route the series resolves, each with its own readiness (avg-twq).
      // H3 video generation specifically requires fal.ai.
      let falConfigured = false;
      try {
        falConfigured = Boolean((await resolveConfig()).falKeyRef);
      } catch { /* generated-media clients unavailable: fal reads as not configured */ }
      const registry = (ctx as { modelRegistry?: { getApiKeyForProvider(p: string): Promise<string | undefined> } } | undefined)?.modelRegistry;
      caps["image-generation"] = await imageGenerationStatus({
        libraryRoot: LIBRARY_ROOT,
        ...(params.channel && params.series ? { series: { channel: params.channel, series: params.series } } : {}),
        falConfigured,
        codexLoggedIn: async () => Boolean(registry && await registry.getApiKeyForProvider(CODEX_PROVIDER)),
      }).catch((e: unknown) => ({ available: false, detail: e instanceof Error ? e.message : String(e) }));
      caps["video-generation"] = falConfigured
        ? { available: true, detail: "fal.ai MiniMax H3 configured" }
        : { available: false, detail: "FAL_KEY not set" };

      // The voice worker: speech only with a CustomVoice model installed, alignment only with /align (avg-twq, avg-07q).
      Object.assign(caps, await voiceWorkerStatus(process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL));
      caps["speech-align-elevenlabs"] = process.env.ELEVENLABS_API_KEY
        ? { available: true, detail: "ELEVENLABS_API_KEY set" }
        : { available: false, detail: "ELEVENLABS_API_KEY not set" };

      // FFmpeg
      try {
        const { execSync } = await import("node:child_process");
        const ver = execSync("ffmpeg -version 2>&1 | head -1", { encoding: "utf-8" }).toString().trim();
        caps["video-composition"] = { available: true, detail: ver || "ffmpeg available" };
      } catch {
        caps["video-composition"] = { available: false, detail: "ffmpeg not found" };
      }

      // VHS terminal recording
      try {
        // The recorder answers this itself, including what to install when it
        // is missing. Asking vhs directly meant the agent owned a second, and
        // slightly different, opinion about the same thing.
        const { probe } = await import("@av/terminal-recorder");
        caps["terminal-recording"] = probe();
      } catch (err) {
        caps["terminal-recording"] = {
          available: false,
          detail: err instanceof Error ? err.message : String(err),
        };
      }

      // Editable 3D scenes: use the same composition-aware status as the adapter.
      const { blenderCapabilityStatus } = await import("./blender-tools.js");
      Object.assign(caps, await blenderCapabilityStatus());

      // Graphics
      caps["graphics-rendering"] = { available: false, detail: "Not yet wired (sgr-3i9.4)" };

      // Deterministic rigged vector animation
      try {
        const { execSync } = await import("node:child_process");
        execSync("magick -version", { stdio: "ignore" });
        caps["vector-animation"] = { available: true, detail: "SVG rigs via ImageMagick + FFmpeg" };
      } catch {
        caps["vector-animation"] = { available: false, detail: "ImageMagick not found" };
      }

      // Local nonverbal synthesis has no external dependency.
      caps["nonverbal-audio"] = { available: true, detail: "Deterministic local PCM buzz synthesis" };
      // Sound effects, ambiences, applause and a music bed, synthesized here (avg-jur).
      caps["sound-effects"] = { available: true, detail: `pva_synthesize_sound, local and $0: ${SOUND_KINDS.join(", ")}` };
      // Archive and stock media with verifiable licences (avg-fe8.2): public APIs, no key, $0.
      caps["archive-media"] = { available: true, detail: "pva_search_media / pva_fetch_media: AIC, Met, Cleveland, Wikimedia Commons, NASA, Internet Archive, Openverse; licence and evidence kept" };

      const allAvailable = Object.values(caps).every(c => c.available);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(caps, null, 2) }],
        details: { capabilities: caps, allAvailable },
      };
    },
  });
}
