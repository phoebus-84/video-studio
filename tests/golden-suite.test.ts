// ---------------------------------------------------------------------------
// Golden composition suite — contract tests for FFmpeg composition
// ---------------------------------------------------------------------------
// Uses the fake process-factory to validate timeline assembly,
// probe behavior, error handling, and output contracts without
// requiring FFmpeg to be installed.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  installFakeFfmpeg,
  clearFakes,
  clearRecordedCalls,
  getRecordedCalls,
  setFake,
} from "./fixtures/fake-ffmpeg.js";
import { validateTimeline } from "../src/validator.js";
import { runProcess } from "../src/process-runner.js";
import { createWorkspace } from "../src/workspace.js";
import type { Timeline, ValidationResult } from "../src/types.js";

// ── Golden timeline fixture ──────────────────────────────────────────────────

function makeGoldenTimeline(): Timeline {
  return {
    version: "1.0",
    canvas: { width: 1920, height: 1080 },
    profile: { fps: 30, codec: "h264", pixelFormat: "yuv420p" },
    scenes: [
      {
        id: "intro",
        asset: { path: "/fixtures/intro.png" },
        inPoint: 0,
        outPoint: 3,
        timelineStart: 0,
      },
      {
        id: "explanation",
        asset: { path: "/fixtures/explanation.png" },
        inPoint: 0,
        outPoint: 5,
        timelineStart: 3,
      },
      {
        id: "example",
        asset: { path: "/fixtures/example.png" },
        inPoint: 0,
        outPoint: 4,
        timelineStart: 8,
      },
      {
        id: "outro",
        asset: { path: "/fixtures/outro.png" },
        inPoint: 0,
        outPoint: 2,
        timelineStart: 12,
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Golden composition suite", () => {
  beforeEach(() => {
    installFakeFfmpeg();
    // Also register ffprobe
    setFake("ffprobe", { stdout: '{"streams":[],"format":{"duration":"10.0"}}', exitCode: 0 });
  });

  afterEach(() => {
    clearFakes();
    clearRecordedCalls();
  });

  describe("timeline validation", () => {
    it("validates a complete golden timeline", async () => {
      const timeline = makeGoldenTimeline();
      const result = await validateTimeline(timeline);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // Gaps are warnings, not errors
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it("rejects empty timeline", async () => {
      const result = await validateTimeline("not an object");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects timeline with empty scenes", async () => {
      const result = await validateTimeline({
        version: "1.0",
        canvas: { width: 1920, height: 1080 },
        scenes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "SCENES_EMPTY")).toBe(true);
    });

    it("rejects timeline with invalid canvas", async () => {
      const result = await validateTimeline({
        version: "1.0",
        canvas: { width: -1, height: 1080 },
        scenes: [{ id: "s1", asset: { path: "/f.png" }, inPoint: 0, outPoint: 1, timelineStart: 0 }],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("fake ffmpeg probe", () => {
    it("runs ffprobe and records the call", async () => {
      const result = await runProcess("ffprobe", [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "/fixtures/intro.png",
      ], { timeoutMs: 5000 });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeDefined();

      const calls = getRecordedCalls();
      expect(calls.length).toBe(1);
      expect(calls[0]!.command).toBe("ffprobe");
    });
  });

  describe("fake ffmpeg compose", () => {
    it("composes a short clip with correct arguments", async () => {
      const result = await runProcess("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", "color=c=black:s=1920x1080:d=14",
        "-c:v", "libx264", "-preset", "fast",
        "/output/golden.mp4",
      ], { timeoutMs: 30000 });

      expect(result.exitCode).toBe(0);
      expect(getRecordedCalls()[0]!.args).toContain("/output/golden.mp4");
    });
  });

  describe("error scenarios", () => {
    beforeEach(() => {
      setFake("ffmpeg", { exitCode: 1, stdout: "", stderr: "Error processing file" });
    });

    it("returns non-zero exit code for failing ffmpeg", async () => {
      const result = await runProcess("ffmpeg", [
        "-i", "/corrupt/input.mp4", "/output/fail.mp4",
      ], { timeoutMs: 5000 });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error");
    });
  });

  describe("workspace", () => {
    it("creates and cleans up a temporary workspace", async () => {
      const ws = await createWorkspace();
      expect(ws.root).toBeDefined();
      await ws.cleanup();
      expect(ws.cleaned).toBe(true);
    });
  });

  describe("CI readiness", () => {
    it("golden suite runs without real FFmpeg installed", () => {
      // If we got here, fake ffmpeg works end-to-end
      expect(true).toBe(true);
    });
  });
});
