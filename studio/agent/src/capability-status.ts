// ── What pva_capability_status says about the voice worker and images ───────
//
// avg-twq: the status has to tell the truth. A worker that answers /health is
// not one that can speak: it can run with no CustomVoice model in its models
// directory (avg-07q), or be an older build without /align. And "image
// generation" is not one thing: a series picks fal.ai or an OpenAI plan, and
// only the route the series resolves matters to it.
// ---------------------------------------------------------------------------

import { CODEX_PROVIDER, resolveImageProvider } from "./image-provider.js";

/** The CustomVoice size the worker's /synthesize loads. */
const SYNTHESIS_MODEL_SIZE = "1.7B";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CapabilityReport {
  available: boolean;
  detail: string;
}

interface ModelEntry {
  size?: string;
  profile?: string;
  status?: string;
  path?: string;
}

async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(5000) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch { /* not JSON */ }
  return { status: res.status, body };
}

/**
 * The worker's speech and alignment, from what it says it has: `/health` for
 * the service and its version, `/models` for an installed CustomVoice
 * checkpoint, and `/align` for the aligner.
 */
export async function voiceWorkerStatus(workerUrl: string): Promise<{
  "text-to-speech": CapabilityReport;
  "speech-align-local": CapabilityReport;
  "take-verification": CapabilityReport;
}> {
  let speech: CapabilityReport;
  try {
    const health = await getJson(`${workerUrl}/health`);
    const h = health.body as { service?: string; version?: string } | null;
    const version = typeof h?.version === "string" ? `worker ${h.version}` : "worker (version unknown)";
    if (health.status !== 200 || h?.service !== "healthy") {
      speech = { available: false, detail: `${version} at ${workerUrl} is not healthy (HTTP ${health.status})` };
    } else {
      const models = await getJson(`${workerUrl}/models`);
      const entries = Array.isArray(models.body) ? (models.body as ModelEntry[]) : [];
      const voices = entries.filter((m) => m.profile === "custom_voice");
      // /synthesize loads one checkpoint, the 1.7B CustomVoice (the worker's DEFAULT_CUSTOMVOICE_MODEL);
      // another size installed beside it doesn't make it speak.
      const used = voices.find((m) => m.size === SYNTHESIS_MODEL_SIZE);
      if (models.status !== 200) {
        speech = { available: false, detail: `${version}: /models answered HTTP ${models.status}, so its speech models are unknown` };
      } else if (used?.status !== "complete") {
        const where = (used ?? voices[0])?.path?.replace(/\/[^/]*$/, "") ?? "its models directory";
        speech = {
          available: false,
          detail: `${version} has no ${SYNTHESIS_MODEL_SIZE} CustomVoice model installed in ${where}, the one /synthesize loads: ` +
            "start it with `mise run voice-serve`, or set QTW_MODELS_DIR to where the models are",
        };
      } else {
        speech = { available: true, detail: `${version}, Qwen3-TTS CustomVoice ${SYNTHESIS_MODEL_SIZE}` };
      }
    }
  } catch {
    speech = { available: false, detail: `voice worker not reachable at ${workerUrl}` };
  }

  let align: CapabilityReport;
  try {
    const res = await getJson(`${workerUrl}/align`);
    const a = res.body as { model?: unknown; loaded?: unknown } | null;
    if (res.status !== 200 || typeof a?.model !== "string") {
      align = { available: false, detail: `the worker has no aligner (GET /align answered HTTP ${res.status}): it predates speech alignment, restart it from this checkout` };
    } else {
      align = { available: true, detail: `${a.model}${a.loaded === true ? " (loaded)" : " (loads on first use)"}` };
    }
  } catch {
    align = { available: false, detail: `voice worker not reachable at ${workerUrl}` };
  }
  let transcribe: CapabilityReport;
  try {
    const res = await getJson(`${workerUrl}/transcribe`);
    const t = res.body as { model?: unknown; loaded?: unknown } | null;
    transcribe = res.status !== 200 || typeof t?.model !== "string"
      ? { available: false, detail: `the worker has no transcriber (GET /transcribe answered HTTP ${res.status}): it predates take verification, restart it from this checkout` }
      : { available: true, detail: `${t.model}${t.loaded === true ? " (loaded)" : " (loads on first use)"}` };
  } catch {
    transcribe = { available: false, detail: `voice worker not reachable at ${workerUrl}` };
  }
  return { "text-to-speech": speech, "speech-align-local": align, "take-verification": transcribe };
}

/**
 * Image generation as one series resolves it. Without a series, both routes
 * are reported, each with its own readiness.
 */
export async function imageGenerationStatus(options: {
  libraryRoot: string;
  series?: { channel: string; series: string };
  falConfigured: boolean;
  /** Whether Pi holds an openai-codex login. Never the credential itself. */
  codexLoggedIn: () => Promise<boolean>;
}): Promise<CapabilityReport> {
  const fal = options.falConfigured ? "fal.ai ready (FAL_KEY set)" : "fal.ai not ready (FAL_KEY not set)";
  const codexReady = await options.codexLoggedIn().catch(() => false);
  const codex = codexReady ? "openai-codex ready (logged in)" : "openai-codex not ready (no login in Pi)";
  if (!options.series) {
    return { available: options.falConfigured || codexReady, detail: `${fal}; ${codex}. Pass channel and series for the route a series uses` };
  }
  if (!SLUG.test(options.series.channel) || !SLUG.test(options.series.series)) {
    throw new Error("channel and series must be slugs");
  }
  const provider = resolveImageProvider(options.libraryRoot, options.series.channel, options.series.series);
  const label = `${options.series.channel}/${options.series.series}`;
  return provider.kind === "codex"
    ? { available: codexReady, detail: `${label} uses ${CODEX_PROVIDER}/${provider.model}: ${codex}` }
    : { available: options.falConfigured, detail: `${label} uses fal ${provider.model}: ${fal}` };
}

/**
 * Generated video: both fal routes need only FAL_KEY, but they are different
 * tools at very different prices, so each says so on its own line.
 */
export function videoGenerationStatus(falConfigured: boolean): {
  "video-generation": CapabilityReport;
  "video-generation-flux3-max": CapabilityReport;
  "video-generation-wan": CapabilityReport;
} {
  const missing = "FAL_KEY not set";
  return {
    "video-generation": falConfigured
      ? { available: true, detail: "fal.ai MiniMax H3 configured (pva_generate_minimax_h3_video, ~$0.48/clip)" }
      : { available: false, detail: missing },
    "video-generation-flux3-max": falConfigured
      ? { available: true, detail: "fal.ai FLUX 3 Max configured (pva_generate_flux3_max_video, live account pricing, text or image to video)" }
      : { available: false, detail: missing },
    "video-generation-wan": falConfigured
      ? { available: true, detail: "fal.ai Wan 2.2 A14B turbo configured (pva_generate_wan_video, $0.05–0.10/clip, end frame for loops)" }
      : { available: false, detail: missing },
  };
}
