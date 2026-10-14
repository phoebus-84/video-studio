import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageGenerationStatus, voiceWorkerStatus } from "../src/capability-status.js";

/**
 * pva_capability_status tells the truth (avg-twq, avg-07q): the voice worker
 * speaks only with a CustomVoice model installed and aligns only with /align;
 * image generation is the route a series resolves.
 */

let worker: Server | undefined;
const roots: string[] = [];
afterEach(async () => {
  if (worker) {
    worker.closeAllConnections();
    await new Promise<void>((resolve) => worker!.close(() => resolve()));
    worker = undefined;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fake worker: each route answers [status, body], or 404 when absent. */
async function fakeWorker(routes: Record<string, [number, unknown]>): Promise<string> {
  worker = createServer((req, res) => {
    const answer = routes[req.url ?? ""];
    res.writeHead(answer ? answer[0] : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(answer ? answer[1] : { detail: "Not Found" }));
  });
  await new Promise<void>((resolve) => worker!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
}

const HEALTHY: [number, unknown] = [200, { service: "healthy", model: "ready", version: "1.0.0" }];
const model = (size: string, status: string) => ({
  size, profile: "custom_voice", status, path: `/repo/packages/voice/models/qwen3-tts-${size.toLowerCase()}-customvoice-8bit`,
});

describe("voiceWorkerStatus", () => {
  it("speaks with an installed CustomVoice model, and says the worker's version", async () => {
    const url = await fakeWorker({
      "/health": HEALTHY,
      "/models": [200, [model("0.6B", "not_installed"), model("1.7B", "complete"), { size: "1.7B", profile: "base", status: "complete" }]],
      "/align": [200, { model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", loaded: false }],
    });
    const status = await voiceWorkerStatus(url);
    expect(status["text-to-speech"]).toEqual({ available: true, detail: "worker 1.0.0, Qwen3-TTS CustomVoice 1.7B" });
    expect(status["speech-align-local"]).toEqual({ available: true, detail: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit (loads on first use)" });
    // This worker predates take verification: it has no /transcribe.
    expect(status["take-verification"].available).toBe(false);
    expect(status["take-verification"].detail).toContain("restart it from this checkout");
  });

  it("verifies takes when the worker transcribes (avg-8hs.3)", async () => {
    const url = await fakeWorker({ "/health": HEALTHY, "/models": [200, []], "/transcribe": [200, { model: "mlx-community/whisper-large-v3-turbo", loaded: true }] });
    expect((await voiceWorkerStatus(url))["take-verification"]).toEqual({ available: true, detail: "mlx-community/whisper-large-v3-turbo (loaded)" });
  });

  it("does not speak when no CustomVoice model is installed, and says where it looked", async () => {
    const url = await fakeWorker({ "/health": HEALTHY, "/models": [200, [model("1.7B", "not_installed")]] });
    const speech = (await voiceWorkerStatus(url))["text-to-speech"];
    expect(speech.available).toBe(false);
    expect(speech.detail).toContain("no 1.7B CustomVoice model installed in /repo/packages/voice/models");
    expect(speech.detail).toContain("mise run voice-serve");
  });

  it("does not speak with only the 0.6B model: /synthesize loads the 1.7B one", async () => {
    const url = await fakeWorker({ "/health": HEALTHY, "/models": [200, [model("0.6B", "complete"), model("1.7B", "not_installed")]] });
    const speech = (await voiceWorkerStatus(url))["text-to-speech"];
    expect(speech.available).toBe(false);
    expect(speech.detail).toContain("1.7B");
  });

  it("does not align on a worker without /align, though it answers", async () => {
    const url = await fakeWorker({ "/health": HEALTHY, "/models": [200, [model("1.7B", "complete")]] });
    const align = (await voiceWorkerStatus(url))["speech-align-local"];
    expect(align.available).toBe(false);
    expect(align.detail).toContain("HTTP 404");
  });

  it("does not align when /align answers without a model", async () => {
    const url = await fakeWorker({ "/health": HEALTHY, "/models": [200, []], "/align": [200, { detail: "something else" }] });
    expect((await voiceWorkerStatus(url))["speech-align-local"].available).toBe(false);
  });

  it("is unhealthy when /health says so, and unreachable when nothing answers", async () => {
    const url = await fakeWorker({ "/health": [503, { service: "degraded", version: "1.0.0" }] });
    expect((await voiceWorkerStatus(url))["text-to-speech"]).toEqual({ available: false, detail: `worker 1.0.0 at ${url} is not healthy (HTTP 503)` });
    const gone = await voiceWorkerStatus("http://127.0.0.1:9");
    expect(gone["text-to-speech"].available).toBe(false);
    expect(gone["speech-align-local"].detail).toContain("not reachable");
  });
});

describe("imageGenerationStatus", () => {
  function library(provider: string): string {
    const root = mkdtempSync(join(tmpdir(), "image-status-"));
    roots.push(root);
    const series = join(root, "dentro-i-versi", "series", "long");
    mkdirSync(series, { recursive: true });
    writeFileSync(join(series, "pipeline.yaml"), `pipeline: series-production\nimage:\n  provider: ${provider}\n`);
    return root;
  }
  const SERIES = { channel: "dentro-i-versi", series: "long" };

  it("reports the codex route a series resolves, ready with a login even without FAL_KEY", async () => {
    const status = await imageGenerationStatus({ libraryRoot: library("openai-codex"), series: SERIES, falConfigured: false, codexLoggedIn: async () => true });
    expect(status).toEqual({ available: true, detail: "dentro-i-versi/long uses openai-codex/gpt-6.1: openai-codex ready (logged in)" });
  });

  it("reports the fal route as not ready without FAL_KEY, whatever the login", async () => {
    const status = await imageGenerationStatus({ libraryRoot: library("fal-ai/flux/dev"), series: SERIES, falConfigured: false, codexLoggedIn: async () => true });
    expect(status).toEqual({ available: false, detail: "dentro-i-versi/long uses fal fal-ai/flux/dev: fal.ai not ready (FAL_KEY not set)" });
  });

  it("refuses a channel or series that is not a slug", async () => {
    await expect(imageGenerationStatus({
      libraryRoot: library("openai-codex"), series: { channel: "..", series: "long" }, falConfigured: true, codexLoggedIn: async () => true,
    })).rejects.toThrow(/slug/);
  });

  it("reports both routes without a series, and a failed login check as no login", async () => {
    const status = await imageGenerationStatus({
      libraryRoot: library("openai-codex"), falConfigured: false, codexLoggedIn: async () => { throw new Error("no registry"); },
    });
    expect(status.available).toBe(false);
    expect(status.detail).toBe("fal.ai not ready (FAL_KEY not set); openai-codex not ready (no login in Pi). Pass channel and series for the route a series uses");
  });
});
