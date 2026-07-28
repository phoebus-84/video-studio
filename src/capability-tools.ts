// ---------------------------------------------------------------------------
// Capability tools: fal, TTS, graphics, composition
// ---------------------------------------------------------------------------
// Provider-neutral capability tools that let Pi orchestrate media production.
// Each tool calls the underlying service directly — Pi is a trusted local process.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Inline fal client (avoids dynamic import complexity in Pi) ──────────────

const DEFAULT_MODEL = "fal-ai/flux/dev";

async function resolveModel(channel: string, series: string): Promise<string> {
  // Try to read pipeline config from series or channel level
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { load } = await import("js-yaml");

  const LIBRARY = process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  // Check series level first, then channel level
  for (const yamlPath of [
    join(LIBRARY, channel, series, "pipeline.yaml"),
    join(LIBRARY, channel, "pipeline.yaml"),
  ]) {
    if (existsSync(yamlPath)) {
      try {
        const raw = readFileSync(yamlPath, "utf-8");
        const config = load(raw) as any;
        const model = config?.image?.provider || config?.providers?.imageGeneration;
        if (model && typeof model === "string") return model;
      } catch { /* skip malformed yaml */ }
    }
  }
  return DEFAULT_MODEL;
}

async function generateImage(
  prompt: string,
  model?: string,
): Promise<{ imageUrl: string; data: Buffer; seed: number; model: string }> {
  const apiKey = process.env.FAL_KEY;
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

  const res = await fetch(`https://fal.run/${modelName}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
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

async function synthesizeSpeech(text: string, voice: string, speed: number, instruct?: string): Promise<{ audioPath: string; durationSec: number }> {
  const ttsUrl = process.env.AVG_TTS_WORKER_URL || "http://127.0.0.1:5197";

  const reqBody: Record<string, unknown> = { text, voice, speed };
  if (instruct) reqBody.instruct = instruct;

  const res = await fetch(`${ttsUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`TTS error: ${res.status} ${err?.detail ?? res.statusText}`);
  }

  const body = await res.json() as { ok: boolean; result?: { wav_path: string; duration_sec: number; wav_size_bytes: number; job_id: string } };
  if (!body.ok || !body.result) throw new Error(`TTS synthesis failed: ${JSON.stringify(body)}`);
  return { audioPath: body.result.wav_path, durationSec: body.result.duration_sec };
}

// ── FFmpeg composition ─────────────────────────────────────────────────────

async function composeEpisodeVideo(
  episodeDir: string,
  outputPath: string,
): Promise<{ outputPath: string; durationSec: number; fileSize: number }> {
  const { execSync } = await import("node:child_process");
  const scenesDir = join(episodeDir, "assets", "images");
  const narrationFile = join(episodeDir, "artifacts", "narration", "narration-full.wav");

  // Use Python PIL for image preprocessing via a quick inline call
  const { execSync: es } = await import("node:child_process");

  // Simple approach: use ffmpeg directly with still images and audio
  const imgFiles = (await import("node:fs")).readdirSync(scenesDir)
    .filter(f => f.match(/^s\d+\.jpg$/))
    .sort();

  if (imgFiles.length === 0) throw new Error("No scene images found");

  // Concatenate scene narration files if present
  const narrationDir = join(episodeDir, "artifacts", "narration");
  if (existsSync(narrationDir) && !existsSync(narrationFile)) {
    const wavFiles = (await import("node:fs")).readdirSync(narrationDir)
      .filter(f => f.match(/^s\d+\.wav$/))
      .sort();
    if (wavFiles.length > 0) {
      const concatList = join(episodeDir, "artifacts", "narration", "concat.txt");
      const listContent = wavFiles.map(f => `file '${join(narrationDir, f)}'`).join("\n");
      (await import("node:fs")).writeFileSync(concatList, listContent);
      es(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${narrationFile}" 2>/dev/null`);
    }
  }

  // Build frame PNGs
  const frameDir = join(episodeDir, "artifacts", "frames");
  mkdirSync(frameDir, { recursive: true });

  // Convert jpgs to numbered png frames
  for (let i = 0; i < imgFiles.length; i++) {
    const src = join(scenesDir, imgFiles[i]!);
    const dst = join(frameDir, `frame${String(i + 1).padStart(3, "0")}.png`);
    if (!existsSync(dst)) {
      es(`ffmpeg -y -i "${src}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -frames:v 1 "${dst}" 2>/dev/null`);
    }
  }

  // Compose video with narration
  const args = [
    "-y",
    "-framerate", "1/10",
    "-i", `${frameDir}/frame%03d.png`,
  ];

  if (existsSync(narrationFile)) {
    args.push("-i", narrationFile);
  }

  args.push(
    "-vf", "fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  );

  if (existsSync(narrationFile)) {
    args.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  }

  args.push(outputPath);
  es(`ffmpeg ${args.join(" ")} 2>/dev/null`);

  // Probe duration
  const probeOut = es(
    `ffprobe -v quiet -show_entries format=duration,size -of default=noprint_wrappers=1 "${outputPath}"`,
    { encoding: "utf-8" },
  ).toString();
  const durMatch = probeOut.match(/duration=([\d.]+)/);
  const sizeMatch = probeOut.match(/size=(\d+)/);
  const fileSize = existsSync(outputPath) ? (await import("node:fs")).statSync(outputPath).size : 0;

  return {
    outputPath,
    durationSec: durMatch ? parseFloat(durMatch[1]!) : 0,
    fileSize,
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function registerCapabilityTools(pi: ExtensionAPI): void {
  const LIBRARY_ROOT = process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  function episodeDir(channel: string, series: string, episode: string): string {
    return join(LIBRARY_ROOT, channel, series, episode);
  }

  // --- Tool: pva_generate_image (via fal.ai) ------------------------------

  pi.registerTool({
    name: "pva_generate_image",
    label: "Generate Image",
    description: "Generate an image using fal.ai Flux/dev. Saves directly to episode assets/images/.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      sceneId: Type.String({ description: "Scene ID (e.g. s1, s2)" }),
      prompt: Type.String({ description: "Image generation prompt" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);
        const imgDir = join(dir, "assets", "images");
        mkdirSync(imgDir, { recursive: true });

        const model = await resolveModel(params.channel, params.series);
        const result = await generateImage(params.prompt, model);
        const outPath = join(imgDir, `${params.sceneId}.jpg`);
        writeFileSync(outPath, result.data);

        return {
          content: [{ type: "text" as const, text: `✅ ${params.sceneId}.jpg — ${(result.data.length / 1024).toFixed(0)}KB (seed: ${result.seed}, model: ${result.model})` }],
          details: { path: outPath, size: result.data.length, seed: result.seed, model: result.model },
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

  // --- Tool: pva_synthesize_speech (via TTS) ------------------------------

  pi.registerTool({
    name: "pva_synthesize_speech",
    label: "Synthesize Speech",
    description: "Synthesize speech audio via the local Qwen3-TTS worker. Saves to episode artifacts/narration/.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      sceneId: Type.String({ description: "Scene ID (e.g. n1, n2)" }),
      text: Type.String({ description: "Text to synthesize as speech" }),
      voice: Type.Optional(Type.String({ default: "default", description: "Voice name (e.g. 'default', 'af_heart')" })),
      speed: Type.Optional(Type.Number({ default: 1.0 })),
      instruct: Type.Optional(Type.String({ description: "Emotion/character instruction. Use for multi-character scenes: 'Speak with a sly, cunning voice like a wolf', 'Speak warmly like a grandmother', 'Speak with a young innocent girl voice'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await synthesizeSpeech(params.text, params.voice ?? "default", params.speed ?? 1.0, (params as any).instruct);

        // Copy audio to episode artifacts/narration/
        const dir = episodeDir(params.channel, params.series, params.episode);
        const narrationDir = join(dir, "artifacts", "narration");
        mkdirSync(narrationDir, { recursive: true });
        const destPath = join(narrationDir, `${params.sceneId}.wav`);
        const { copyFileSync } = await import("node:fs");
        copyFileSync(result.audioPath, destPath);

        return {
          content: [{ type: "text" as const, text: `✅ ${params.sceneId} — ${result.durationSec.toFixed(1)}s → ${destPath}` }],
          details: { audioPath: destPath, durationSec: result.durationSec },
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

  // --- Tool: pva_compose_video (via FFmpeg) -------------------------------

  pi.registerTool({
    name: "pva_compose_video",
    label: "Compose Video",
    description: "Compose the final MP4 from scene images and narration audio using FFmpeg.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      outputName: Type.Optional(Type.String({ default: "final.mp4", description: "Output filename" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);
        const outPath = join(dir, "artifacts", params.outputName ?? "final.mp4");
        mkdirSync(join(dir, "artifacts"), { recursive: true });

        const result = await composeEpisodeVideo(dir, outPath);

        const mb = (result.fileSize / 1024 / 1024).toFixed(1);
        return {
          content: [{ type: "text" as const, text: `✅ ${params.outputName ?? "final.mp4"} — ${result.durationSec.toFixed(1)}s, ${mb}MB` }],
          details: result,
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

  // --- Tool: pva_render_graphics (via studio-graphics-renderer) -----------

  pi.registerTool({
    name: "pva_render_graphics",
    label: "Render Graphics",
    description: "Render graphics content: title cards, lower thirds, diagrams, overlays.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
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
        const dir = episodeDir(params.channel, params.series, params.episode);
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
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      assetPath: Type.String({ description: "Relative path within episode (e.g. assets/images/s1.jpg)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const dir = episodeDir(params.channel, params.series, params.episode);
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
    description: "Check which media production capabilities are available and their status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const caps: Record<string, { available: boolean; detail: string }> = {};

      // fal.ai
      try {
        if (process.env.FAL_KEY) {
          caps["image-generation"] = { available: true, detail: "fal.ai Flux/dev configured" };
        } else {
          caps["image-generation"] = { available: false, detail: "FAL_KEY not set" };
        }
      } catch {
        caps["image-generation"] = { available: false, detail: "fal client unavailable" };
      }

      // TTS
      try {
        const ttsUrl = process.env.AVG_TTS_WORKER_URL || "http://127.0.0.1:5197";
        const res = await fetch(`${ttsUrl}/health`);
        const health = await res.json() as any;
        caps["text-to-speech"] = {
          available: health?.service === "healthy",
          detail: health?.dependencies?.find((d: any) => d.name === "mlx-audio")?.detail || "TTS worker reachable",
        };
      } catch {
        caps["text-to-speech"] = { available: false, detail: "TTS worker not reachable" };
      }

      // FFmpeg
      try {
        const { execSync } = await import("node:child_process");
        const ver = execSync("ffmpeg -version 2>&1 | head -1", { encoding: "utf-8" }).toString().trim();
        caps["video-composition"] = { available: true, detail: ver || "ffmpeg available" };
      } catch {
        caps["video-composition"] = { available: false, detail: "ffmpeg not found" };
      }

      // Graphics
      caps["graphics-rendering"] = { available: false, detail: "Not yet wired (sgr-3i9.4)" };

      const allAvailable = Object.values(caps).every(c => c.available);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(caps, null, 2) }],
        details: { capabilities: caps, allAvailable },
      };
    },
  });
}
