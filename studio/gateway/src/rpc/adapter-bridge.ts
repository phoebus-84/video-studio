// ---------------------------------------------------------------------------
// Adapter bridge health
// ---------------------------------------------------------------------------
// Probes capability providers and reports consolidated health.
// Providers: fal.ai (media generation), Qwen TTS (narration), FFmpeg (composition)
// ---------------------------------------------------------------------------

import type { ComponentHealth, ReadinessState } from "../health/index.js";

export interface AdapterStatus {
  name: string;
  status: ReadinessState;
  detail: string;
}

/** Runs ffmpeg with these arguments and returns its stdout; throws when it cannot run. */
export type FfmpegRunner = (args: string[]) => Promise<string>;

const runFfmpeg: FfmpegRunner = async (args) => {
  // ffmpeg directly, not through a shell pipeline: `head` and `grep` exist
  // on Windows only when Git's tools are on PATH, and without them a
  // working ffmpeg was reported as not found.
  const { execFileSync } = await import("node:child_process");
  return execFileSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf-8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
};

/** Filters the composition needs: burnt-in captions and loudness normalisation. */
const REQUIRED_FILTERS = ["subtitles", "loudnorm"];

export class AdapterBridge {
  private ttsUrl: string;
  private ffmpeg: FfmpegRunner;

  constructor(ttsUrl = "http://127.0.0.1:5197", ffmpeg: FfmpegRunner = runFfmpeg) {
    this.ttsUrl = ttsUrl;
    this.ffmpeg = ffmpeg;
  }

  /** Probe all providers and return consolidated health. */
  async check(): Promise<ComponentHealth> {
    const now = new Date().toISOString();
    const providers = await Promise.all([
      this.checkFal(),
      this.checkTts(),
      this.checkFfmpeg(),
    ]);

    // The reason travels with the status: "fal: degraded (User is locked. Reason: TOP_UP.)".
    const details = providers.map((p) => `${p.name}: ${p.status}${p.detail ? ` (${p.detail})` : ""}`).join(", ");
    const hasDown = providers.some((p) => p.status === "down");
    const hasDegraded = providers.some((p) => p.status === "degraded");
    const allUnknown = providers.every((p) => p.status === "unknown");

    let status: ReadinessState;
    if (hasDown) status = "degraded"; // some providers work, some don't
    else if (hasDegraded) status = "degraded";
    else if (allUnknown) status = "unknown";
    else status = "ready";

    return {
      status,
      detail: `${providers.length} providers: ${details}`,
      lastChecked: now,
    };
  }

  /** Check fal.ai availability. */
  private async checkFal(): Promise<AdapterStatus> {
    const key = process.env.FAL_KEY;
    if (!key) {
      return { name: "fal", status: "unknown", detail: "FAL_KEY not set" };
    }

    // An empty input: fal checks the key and the account before the input,
    // so a locked account answers 403 and a bad key 401, while a usable one
    // gets a 422 for the missing prompt and nothing is generated. The probe
    // used to generate a real image, billed on every health check.
    try {
      const res = await fetch("https://fal.run/fal-ai/flux/dev", {
        method: "POST",
        headers: {
          Authorization: `Key ${key}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok || res.status === 422) {
        return { name: "fal", status: "ready", detail: "key accepted" };
      }
      if (res.status === 401) {
        return { name: "fal", status: "down", detail: "invalid FAL_KEY" };
      }
      if (res.status === 402 || res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
        const why = typeof body.detail === "string" ? body.detail : "balance exhausted or locked";
        return { name: "fal", status: "degraded", detail: why };
      }
      return { name: "fal", status: "down", detail: `HTTP ${res.status}` };
    } catch (err) {
      return { name: "fal", status: "down", detail: err instanceof Error ? err.message : "unreachable" };
    }
  }

  /** Check TTS worker health. */
  private async checkTts(): Promise<AdapterStatus> {
    try {
      const res = await fetch(`${this.ttsUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const model = (data.model as string) || "none";
        return { name: "tts", status: "ready", detail: `model=${model}` };
      }
      return { name: "tts", status: "down", detail: `HTTP ${res.status}` };
    } catch {
      return { name: "tts", status: "unknown", detail: "not reachable" };
    }
  }

  /** Check FFmpeg availability. */
  private async checkFfmpeg(): Promise<AdapterStatus> {
    let ver: string, filters: string;
    try {
      ver = (await this.ffmpeg(["-version"])).split(/\r?\n/)[0]!.trim();
      filters = await this.ffmpeg(["-filters"]);
    } catch {
      return { name: "ffmpeg", status: "down", detail: "ffmpeg not found" };
    }
    // A filter line is " T.. name  A->A  description": the name is the second column.
    const names = new Set(filters.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[1]));
    const missing = REQUIRED_FILTERS.filter((name) => !names.has(name));
    const version = `${ver.split(" ")[0]} ${ver.split(" ")[2]}`;
    // It runs, but cannot burn captions or level the sound: not ready to compose.
    if (missing.length > 0) return { name: "ffmpeg", status: "degraded", detail: `${version} without ${missing.join(", ")}` };
    return { name: "ffmpeg", status: "ready", detail: version };
  }
}
