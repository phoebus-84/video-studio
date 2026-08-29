import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveSceneSpine,
  sceneSpineOrigin,
  discoverAssetIds,
  readSceneSpine,
  materializeSceneSpine,
} from "../src/workspace/scene-spine.js";

/**
 * An episode with eleven finished images, eleven narration clips and a rendered
 * MP4 showed no scenes in the studio. `artifacts/episode.json` is authored once,
 * empty, with O_EXCL, and nothing in the agent, the pipelines or the runtime
 * ever wrote scenes into it — so the file the studio builds its scene list from
 * was empty by construction, and no amount of finished work changed that.
 */
describe("scene spine", () => {
  describe("derivation", () => {
    it("takes the scenes episode.json names", () => {
      const scenes = deriveSceneSpine({
        episodeJson: { scenes: [{ id: "s1" }, { id: "s2" }] },
      });
      expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
      expect(sceneSpineOrigin({ episodeJson: { scenes: [{ id: "s1" }] } })).toBe("episode.json");
    });

    it("reads episode.json as a bare array too", () => {
      const scenes = deriveSceneSpine({ episodeJson: [{ id: "s1" }, { id: "s2" }] });
      expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    });

    it("falls back to timing when episode.json names no scenes", () => {
      // The empty array is the real case: authored, never written to.
      const sources = {
        episodeJson: { scenes: [] },
        timing: {
          version: 2,
          scenes: [
            { sceneId: "s1", startSeconds: 0, durationSeconds: 9.03 },
            { sceneId: "s2", startSeconds: 9.03, durationSeconds: 7.42 },
          ],
        },
      };
      expect(sceneSpineOrigin(sources)).toBe("timing.json");
      const scenes = deriveSceneSpine(sources);
      expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
      expect(scenes[1]!.durationSeconds).toBe(7.42);
      expect(scenes[1]!.startSeconds).toBe(9.03);
    });

    it("reads the runtime's timing dialect as well as the compose one", () => {
      // The executor writes segments[]/startSec/durationSec; the agent's
      // compose path writes scenes[]/startSeconds/durationSeconds. Reading one
      // dialect only leaves the other's durations at zero, which displays as
      // scenes that exist but have no length.
      const scenes = deriveSceneSpine({
        timing: {
          segments: [
            { id: "s1", startSec: 0, durationSec: 4 },
            { id: "s2", startSec: 4.5, durationSec: 6 },
          ],
        },
      });
      expect(scenes.map((s) => [s.id, s.startSeconds, s.durationSeconds])).toEqual([
        ["s1", 0, 4],
        ["s2", 4.5, 6],
      ]);
    });

    it("falls back to the narration manifest when there is no timing", () => {
      const sources = {
        narration: [
          { segmentId: "s1", text: "First line.", durationSeconds: 4, pauseAfterMs: 300 },
          { segmentId: "s2", text: "Second line.", durationSeconds: 6, pauseAfterMs: 0 },
        ],
      };
      expect(sceneSpineOrigin(sources)).toBe("narration-manifest");
      const scenes = deriveSceneSpine(sources);
      expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
      // The pause after a segment sits between it and the next start.
      expect(scenes[0]!.startSeconds).toBe(0);
      expect(scenes[1]!.startSeconds).toBe(4.3);
      expect(scenes[0]!.intent).toBe("First line.");
    });

    it("falls back to the asset files when nothing else exists", () => {
      const sources = { assetIds: ["s1", "s2", "s3"] };
      expect(sceneSpineOrigin(sources)).toBe("assets");
      expect(deriveSceneSpine(sources).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    });

    it("has no scenes when the episode has produced nothing", () => {
      expect(sceneSpineOrigin({})).toBe("none");
      expect(deriveSceneSpine({})).toEqual([]);
      expect(deriveSceneSpine({ episodeJson: { scenes: [] } })).toEqual([]);
    });

    it("never overwrites a curated field with a derived one", () => {
      // Someone retitled a scene and edited its prompt in the studio. A
      // derivation that recomputed those would silently discard the edit.
      const scenes = deriveSceneSpine({
        episodeJson: {
          scenes: [{ id: "s1", title: "The Ides of March", intent: "hand-written", kind: "video" }],
        },
        timing: { scenes: [{ sceneId: "s1", startSeconds: 0, durationSeconds: 9 }] },
        artDirection: { scenes: [{ id: "s1", prompt: "a generated prompt" }] },
        narration: [{ segmentId: "s1", text: "spoken line", durationSeconds: 9, pauseAfterMs: 0 }],
      });
      expect(scenes[0]!.title).toBe("The Ides of March");
      expect(scenes[0]!.intent).toBe("hand-written");
      expect(scenes[0]!.kind).toBe("video");
      // What it did not carry is filled in.
      expect(scenes[0]!.instruct).toBe("a generated prompt");
      expect(scenes[0]!.durationSeconds).toBe(9);
    });

    it("fills intent from narration and instruct from art direction", () => {
      const scenes = deriveSceneSpine({
        timing: { scenes: [{ sceneId: "s1", durationSeconds: 9 }] },
        artDirection: { scenes: [{ id: "s1", prompt: "Wide cinematic interior" }] },
        narration: [{ segmentId: "s1", text: "Rome's most powerful man.", durationSeconds: 9, pauseAfterMs: 0 }],
      });
      expect(scenes[0]!.intent).toBe("Rome's most powerful man.");
      expect(scenes[0]!.instruct).toBe("Wide cinematic interior");
    });

    it("numbers scenes in order, whatever the source", () => {
      const scenes = deriveSceneSpine({ assetIds: ["s1", "s2", "s3"] });
      expect(scenes.map((s) => s.index)).toEqual([0, 1, 2]);
    });
  });

  describe("on disk", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "spine-"));
      await mkdir(join(dir, "artifacts"), { recursive: true });
      await mkdir(join(dir, "assets", "images"), { recursive: true });
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("recovers scene IDs from image filenames in natural order", async () => {
      for (const f of ["s10.png", "s2.png", "s1.png", "s4a.png"]) {
        await writeFile(join(dir, "assets", "images", f), "x");
      }
      expect(await discoverAssetIds(dir)).toEqual(["s1", "s2", "s4a", "s10"]);
    });

    it("does not mistake a sidecar for a scene", async () => {
      // `manifest.json` sits beside the images and is not scene `manifest`.
      await writeFile(join(dir, "assets", "images", "s1.png"), "x");
      await writeFile(join(dir, "assets", "images", "manifest.json"), "{}");
      await writeFile(join(dir, "assets", "images", "reference.png"), "x");
      expect(await discoverAssetIds(dir)).toEqual(["s1"]);
    });

    it("counts a scene once when it has both a tape and an image", async () => {
      await mkdir(join(dir, "assets", "tapes"), { recursive: true });
      await writeFile(join(dir, "assets", "images", "s1.png"), "x");
      await writeFile(join(dir, "assets", "tapes", "s1.mp4"), "x");
      expect(await discoverAssetIds(dir)).toEqual(["s1"]);
    });

    it("derives scenes for an episode whose episode.json was never written", async () => {
      // Exactly how the workspace authoring leaves it.
      await writeFile(join(dir, "artifacts", "episode.json"), JSON.stringify({ scenes: [] }));
      await writeFile(join(dir, "artifacts", "timing.json"), JSON.stringify({
        version: 2,
        scenes: [
          { sceneId: "s1", startSeconds: 0, durationSeconds: 9.03 },
          { sceneId: "s2", startSeconds: 9.03, durationSeconds: 7.42 },
        ],
      }));

      const scenes = await readSceneSpine(dir);
      expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    });

    it("materializes the derived spine so studio edits have somewhere to land", async () => {
      // The studio saves a prompt by finding the scene by ID in this file and
      // assigning to it. With no scenes the assignment finds nothing and the
      // edit is dropped without an error.
      await writeFile(join(dir, "artifacts", "episode.json"), JSON.stringify({ scenes: [] }));
      await writeFile(join(dir, "artifacts", "timing.json"), JSON.stringify({
        scenes: [{ sceneId: "s1", startSeconds: 0, durationSeconds: 9 }],
      }));

      const written = await materializeSceneSpine(dir);
      expect(written).toHaveLength(1);

      const onDisk = JSON.parse(await readFile(join(dir, "artifacts", "episode.json"), "utf-8"));
      expect(onDisk.scenes[0].id).toBe("s1");
      expect(onDisk.scenes[0].durationSeconds).toBe(9);
    });

    it("leaves a curated episode.json completely alone", async () => {
      const curated = { title: "Giulio Cesare", scenes: [{ id: "s1", title: "Mine" }] };
      await writeFile(join(dir, "artifacts", "episode.json"), JSON.stringify(curated));
      await writeFile(join(dir, "artifacts", "timing.json"), JSON.stringify({
        scenes: [{ sceneId: "s1" }, { sceneId: "s2" }],
      }));

      expect(await materializeSceneSpine(dir)).toBeNull();
      const onDisk = JSON.parse(await readFile(join(dir, "artifacts", "episode.json"), "utf-8"));
      expect(onDisk).toEqual(curated);
    });

    it("keeps the other keys of episode.json when filling in scenes", async () => {
      await writeFile(join(dir, "artifacts", "episode.json"), JSON.stringify({
        title: "Giulio Cesare",
        scenes: [],
      }));
      await writeFile(join(dir, "artifacts", "timing.json"), JSON.stringify({
        scenes: [{ sceneId: "s1", durationSeconds: 9 }],
      }));

      await materializeSceneSpine(dir);
      const onDisk = JSON.parse(await readFile(join(dir, "artifacts", "episode.json"), "utf-8"));
      expect(onDisk.title).toBe("Giulio Cesare");
      expect(onDisk.scenes).toHaveLength(1);
    });

    it("writes nothing when the episode has produced nothing", async () => {
      await writeFile(join(dir, "artifacts", "episode.json"), JSON.stringify({ scenes: [] }));
      expect(await materializeSceneSpine(dir)).toBeNull();
      const onDisk = JSON.parse(await readFile(join(dir, "artifacts", "episode.json"), "utf-8"));
      expect(onDisk.scenes).toEqual([]);
    });

    it("is idempotent: the second call changes nothing", async () => {
      await writeFile(join(dir, "assets", "images", "s1.png"), "x");

      expect(await materializeSceneSpine(dir)).toHaveLength(1);
      const first = await readFile(join(dir, "artifacts", "episode.json"), "utf-8");
      expect(await materializeSceneSpine(dir)).toBeNull();
      expect(await readFile(join(dir, "artifacts", "episode.json"), "utf-8")).toBe(first);
    });

    it("creates episode.json when the episode never had one", async () => {
      await writeFile(join(dir, "assets", "images", "s1.png"), "x");
      await materializeSceneSpine(dir);
      const onDisk = JSON.parse(await readFile(join(dir, "artifacts", "episode.json"), "utf-8"));
      expect(onDisk.scenes.map((s: { id: string }) => s.id)).toEqual(["s1"]);
    });
  });
});
