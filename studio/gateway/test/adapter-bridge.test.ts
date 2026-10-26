import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterBridge, type FfmpegRunner } from "../src/rpc/adapter-bridge.js";

const VERSION = "ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers";
const filterLines = (...names: string[]) =>
  ["Filters:", ...names.map((name) => ` T.. ${name}           A->A       ${name} filter`)].join("\r\n");

/** An ffmpeg that answers -version and -filters with these filters. */
const ffmpegWith = (...filters: string[]): FfmpegRunner => async (args) =>
  args[0] === "-version" ? VERSION : filterLines(...filters);

/** fal answers with this status and body; the TTS worker is never reachable. */
function falAnswers(status: number, body: unknown = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!url.startsWith("https://fal.run/")) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(body), { status });
  }));
}

const provider = (detail: string, name: string) => detail.split(", ").find((p) => p.includes(`${name}: `));

describe("AdapterBridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [422, {}, "fal: ready (key accepted)"],
    [200, {}, "fal: ready (key accepted)"],
    [401, {}, "fal: down (invalid FAL_KEY)"],
    [403, { detail: "User is locked. Reason: TOP_UP." }, "fal: degraded (User is locked. Reason: TOP_UP.)"],
    [402, {}, "fal: degraded (balance exhausted or locked)"],
    [500, {}, "fal: down (HTTP 500)"],
  ])("fal answering %i reads as %s", async (status, body, expected) => {
    vi.stubEnv("FAL_KEY", "test-key");
    falAnswers(status, body);
    const health = await new AdapterBridge(undefined, ffmpegWith("subtitles", "loudnorm")).check();
    expect(provider(health.detail!, "fal")).toContain(expected);
  });

  it("probes fal with an empty input, so nothing is generated", async () => {
    vi.stubEnv("FAL_KEY", "test-key");
    falAnswers(422);
    await new AdapterBridge(undefined, ffmpegWith("subtitles", "loudnorm")).check();
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith("https://fal.run/"))!;
    expect(init?.body).toBe("{}");
  });

  it("a locked fal account makes the whole bridge degraded", async () => {
    vi.stubEnv("FAL_KEY", "test-key");
    falAnswers(403, { detail: "User is locked. Reason: TOP_UP." });
    const health = await new AdapterBridge(undefined, ffmpegWith("subtitles", "loudnorm")).check();
    expect(health.status).toBe("degraded");
  });

  it("ffmpeg with the filters the composition needs is ready", async () => {
    vi.stubEnv("FAL_KEY", "");
    falAnswers(422);
    const health = await new AdapterBridge(undefined, ffmpegWith("anull", "subtitles", "loudnorm")).check();
    expect(provider(health.detail!, "ffmpeg")).toBe("ffmpeg: ready (ffmpeg 7.1)");
  });

  it("ffmpeg without subtitles or loudnorm is degraded, naming what is missing", async () => {
    vi.stubEnv("FAL_KEY", "");
    falAnswers(422);
    const health = await new AdapterBridge(undefined, ffmpegWith("anull", "loudnorm")).check();
    expect(provider(health.detail!, "ffmpeg")).toBe("ffmpeg: degraded (ffmpeg 7.1 without subtitles)");
    expect(health.status).toBe("degraded");
  });

  it("an ffmpeg that cannot run is down", async () => {
    vi.stubEnv("FAL_KEY", "");
    falAnswers(422);
    const missing: FfmpegRunner = async () => { throw new Error("spawn ffmpeg ENOENT"); };
    const health = await new AdapterBridge(undefined, missing).check();
    expect(provider(health.detail!, "ffmpeg")).toBe("ffmpeg: down (ffmpeg not found)");
  });
});
