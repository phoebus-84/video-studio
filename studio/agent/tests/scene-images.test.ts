import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSceneImages,
  resolveSceneFrames,
  concatScript,
  DEFAULT_SCENE_SECONDS,
} from "../src/scene-images.js";

/**
 * Choosing the images for a render was one expression:
 *
 *     readdirSync(dir).filter(f => f.match(/^s\d+\.jpg$/)).sort()
 *
 * wrong three ways. Only `.jpg`, so an episode drawn by gpt-image-2 as PNG
 * selected nothing and the compose tool reported "No scene images found" over
 * eleven finished images. Only bare numbers, so a scene split into `s4a` is
 * dropped from the render in silence. And a lexicographic sort, so at ten
 * scenes the episode plays out of order.
 */
describe("scene images", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pva-frames-"));
    mkdirSync(join(dir, "assets", "images"), { recursive: true });
    mkdirSync(join(dir, "artifacts", "narration"), { recursive: true });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const image = (name: string) => writeFileSync(join(dir, "assets", "images", name), "x");

  describe("selection", () => {
    it("finds PNG images, which is what the image model writes", () => {
      image("s1.png");
      image("s2.png");
      expect(listSceneImages(dir)).toEqual(["s1.png", "s2.png"]);
    });

    it("finds every image format a scene may be drawn in", () => {
      image("s1.png");
      image("s2.jpg");
      image("s3.jpeg");
      image("s4.webp");
      image("s5.PNG");
      expect(listSceneImages(dir)).toHaveLength(5);
    });

    it("keeps a scene with a letter suffix", () => {
      image("s4.png");
      image("s4a.png");
      image("s4b.png");
      expect(listSceneImages(dir)).toEqual(["s4.png", "s4a.png", "s4b.png"]);
    });

    it("orders past nine the way a person reads it", () => {
      for (const n of [1, 2, 9, 10, 11]) image(`s${n}.png`);
      // `.sort()` gives s1, s10, s11, s2, s9 — an episode played out of order.
      expect(listSceneImages(dir)).toEqual(["s1.png", "s2.png", "s9.png", "s10.png", "s11.png"]);
    });

    it("ignores files that are not scenes", () => {
      image("s1.png");
      image("reference.png");
      image("manifest.json");
      image("character-sheet.png");
      expect(listSceneImages(dir)).toEqual(["s1.png"]);
    });

    it("uses one image per scene when a scene has two", () => {
      image("s1.png");
      image("s1.jpg");
      expect(listSceneImages(dir)).toHaveLength(1);
    });

    it("returns nothing rather than throwing when there is no image directory", () => {
      expect(listSceneImages(mkdtempSync(join(tmpdir(), "pva-empty-")))).toEqual([]);
    });
  });

  describe("durations", () => {
    it("gives each scene the length its timing document states", () => {
      image("s1.png");
      image("s2.png");
      writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
        scenes: [
          { sceneId: "s1", durationSeconds: 9.03 },
          { sceneId: "s2", durationSeconds: 7.42 },
        ],
      }));
      expect(resolveSceneFrames(dir).map((f) => f.durationSeconds)).toEqual([9.03, 7.42]);
    });

    it("reads the runtime's timing dialect too", () => {
      image("s1.png");
      writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
        segments: [{ id: "s1", durationSec: 4.5 }],
      }));
      expect(resolveSceneFrames(dir)[0]!.durationSeconds).toBe(4.5);
    });

    it("falls back to the narration, holding a scene for its line plus the pause", () => {
      image("s1.png");
      writeFileSync(join(dir, "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
        entries: [
          { segmentId: "s1", wav: { path: "a.wav", durationSeconds: 8.48 }, pauseAfterMs: 300 },
        ],
      }));
      expect(resolveSceneFrames(dir)[0]!.durationSeconds).toBeCloseTo(8.78, 5);
    });

    it("prefers the timing document to the narration", () => {
      image("s1.png");
      writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
        scenes: [{ sceneId: "s1", durationSeconds: 5 }],
      }));
      writeFileSync(join(dir, "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
        entries: [{ segmentId: "s1", wav: { path: "a.wav", durationSeconds: 9 }, pauseAfterMs: 0 }],
      }));
      expect(resolveSceneFrames(dir)[0]!.durationSeconds).toBe(5);
    });

    it("holds a scene nothing describes rather than dropping it", () => {
      image("s1.png");
      image("s2.png");
      writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
        scenes: [{ sceneId: "s1", durationSeconds: 4 }],
      }));
      expect(resolveSceneFrames(dir).map((f) => f.durationSeconds))
        .toEqual([4, DEFAULT_SCENE_SECONDS]);
    });
  });

  describe("concat script", () => {
    it("repeats the final entry so the last scene is not one frame long", () => {
      // The demuxer applies `duration` to the transition into the next entry,
      // so without a repeat the closing image flashes past.
      const script = concatScript([
        { path: "/e/frame001.png", durationSeconds: 2 },
        { path: "/e/frame002.png", durationSeconds: 3 },
      ]);
      expect(script.trimEnd().split("\n")).toEqual([
        "file '/e/frame001.png'",
        "duration 2.000000",
        "file '/e/frame002.png'",
        "duration 3.000000",
        "file '/e/frame002.png'",
      ]);
    });

    it("escapes a quote in a path instead of ending the argument early", () => {
      const script = concatScript([{ path: "/e/it's.png", durationSeconds: 1 }]);
      expect(script).toContain("file '/e/it'\\''s.png'");
    });

    it("refuses to build an empty script", () => {
      expect(() => concatScript([])).toThrow("No frames");
    });
  });
});
