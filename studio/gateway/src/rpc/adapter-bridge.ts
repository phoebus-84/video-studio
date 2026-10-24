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

export class AdapterBridge {
  private ttsUrl: string;

  constructor(ttsUrl = "http://127.0.0.1:5197") {
    this.ttsUrl = ttsUrl;
  }

  /** Probe all providers and return consolidated health. */
  async check(): Promise<ComponentHealth> {
    const now = new Date().toISOString();
    const providers = await Promise.all([
      this.checkFal(),
      this.checkTts(),
      this.checkFfmpeg(),
    ]);

    const details = providers.map((p) => `${p.name}: ${p.status}`).join(", ");
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

    try {
      const res = await fetch("https://fal.run/fal-ai/flux/dev", {
        method: "POST",
        headers: {
          Authorization: `Key ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "health check",
          image_size: "square_hd",
          num_inference_steps: 1,
          num_images: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const hasImages = "images" in data;
        return { name: "fal", status: "ready", detail: hasImages ? "connected" : "response without images" };
      }
      if (res.status === 402 || res.status === 403) {
        return { name: "fal", status: "degraded", detail: "balance exhausted or locked" };
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
    try {
      // ffmpeg directly, not through a shell pipeline: `head` and `grep` exist
      // on Windows only when Git's tools are on PATH, and without them a
      // working ffmpeg was reported as not found.
      const { execFileSync } = await import("node:child_process");
      const run = (args: string[]) =>
        execFileSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf-8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const ver = run(["-version"]).split(/\r?\n/)[0]!.trim();
      const filters = run(["-filters"]);
      const count = (name: string) => filters.split(/\r?\n/).filter((line) => line.includes(name)).length;
      const hasSubtitles = count("subtitles");
      const hasLoudnorm = count("loudnorm");
      return {
        name: "ffmpeg",
        status: "ready",
        detail: `${ver.split(" ")[0]} ${ver.split(" ")[2]} (subtitles=${hasSubtitles}, loudnorm=${hasLoudnorm})`,
      };
    } catch {
      return { name: "ffmpeg", status: "down", detail: "ffmpeg not found" };
    }
  }
}
