import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeMultitrackVideo, parseSoundCueSheet } from "../src/multitrack-compose.js";
import { synthesizeNonverbalBuzz } from "../src/nonverbal-audio.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("multitrack composition", () => {
  it("mixes frame-addressed local audio and writes canonical immutable output", async () => {
    const episodeDir = await mkdtemp(join(tmpdir(), "pva-compose-"));
    roots.push(episodeDir);
    const videoPath = join(episodeDir, "assets", "animation", "visuals.mp4");
    await mkdir(join(episodeDir, "assets", "animation"), { recursive: true });
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=#F5E6D3:s=320x568:d=1:r=30",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
    ], { stdio: "ignore" });
    await synthesizeNonverbalBuzz({
      emotion: "idea",
      durationSeconds: 0.25,
      outputPath: join(episodeDir, "assets", "audio", "idea.wav"),
      seed: "compose-test",
    });
    const cueSheet = parseSoundCueSheet({
      version: 1,
      episode: "test",
      fps: 30,
      cues: [
        {
          id: "idea",
          kind: "buzz",
          startFrame: 9,
          durationFrames: 8,
          gain: 0.7,
          purpose: "Test cue",
          assetPath: "assets/audio/idea.wav",
        },
        {
          id: "impact-silence",
          kind: "silence",
          startFrame: 20,
          durationFrames: 3,
          gain: 0,
          purpose: "Authored silence",
        },
      ],
    });

    const result = await composeMultitrackVideo({ episodeDir, videoPath, cueSheet, label: "test-render" });
    const current = JSON.parse(await readFile(join(episodeDir, "output", "current.json"), "utf-8"));
    expect(result.durationSeconds).toBeGreaterThanOrEqual(1);
    expect(result.audioCueCount).toBe(1);
    expect(current.renderId).toBe(result.renderId);
    const report = JSON.parse(await readFile(result.reportPath, "utf-8"));
    expect(report.output.targetIntegratedLoudnessLufs).toBe(-14);
    expect(report.output.normalizationTruePeakCeilingDb).toBe(-1.2);
    expect(report.output.measuredTruePeakDb).toBeLessThanOrEqual(-1);
  }, 30_000);

  it("rejects traversal in cue assets", () => {
    expect(() => parseSoundCueSheet({
      version: 1,
      episode: "test",
      fps: 30,
      cues: [{ id: "bad", kind: "foley", startFrame: 0, durationFrames: 3, gain: 1, purpose: "Bad", assetPath: "../secret.wav" }],
    })).toThrow(/relative/);
  });
});
