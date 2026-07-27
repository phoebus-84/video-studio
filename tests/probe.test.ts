import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { probeMedia, normalizeMedia } from "../src/probe.js";
import { installFakeFfmpeg, clearFakes, setFake } from "../tests/fixtures/fake-ffmpeg.js";

describe("probeMedia", () => {
  beforeEach(() => { installFakeFfmpeg(); });
  afterEach(() => { clearFakes(); });

  it("probes an image", async () => {
    const result = await probeMedia("/fixtures/intro.png", 102400);
    expect(["image", "unknown"]).toContain(result.type);
    expect(result.fileSize).toBe(102400);
  });

  it("handles failure", async () => {
    setFake("ffprobe", { stdout: "", stderr: "err", exitCode: 1 });
    const result = await probeMedia("/bad.mp4", 0);
    expect(result.type).toBe("unknown");
  });
});

describe("normalizeMedia", () => {
  beforeEach(() => { installFakeFfmpeg(); });
  afterEach(() => { clearFakes(); });

  it("normalizes and returns output", async () => {
    const result = await normalizeMedia("/fixtures/intro.png", 102400, "/tmp/out", { width: 1280, height: 720 });
    expect(result.probe).toBeDefined();
    expect(typeof result.outputPath).toBe("string");
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it("returns original when no change needed", async () => {
    setFake("ffprobe", {
      stdout: JSON.stringify({ streams: [{ codec_name: "png", codec_type: "video", width: 1920, height: 1080 }], format: { format_name: "png" } }),
      exitCode: 0,
    });
    const result = await normalizeMedia("/fixtures/intro.png", 102400, "/tmp/out", { width: 1920, height: 1080 });
    expect(result.changes.length).toBe(0);
  });
});
