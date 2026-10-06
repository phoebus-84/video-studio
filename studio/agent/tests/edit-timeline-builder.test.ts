import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { buildEditTimeline, CROSSFADE_FRAMES } from "../src/edit-timeline-builder.js";

/**
 * The studio's edit timeline, built from an episode on disk (avg-tk7.6). No
 * render here: these pin what the timeline says. Images are never decoded by
 * the builder, so any bytes will do; WAVs are read for their length.
 */

const REF = { channel: "c", series: "s", episode: "e" };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edit-timeline-builder-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(relative: string, content: string | Buffer): void {
  mkdirSync(dirname(join(dir, relative)), { recursive: true });
  writeFileSync(join(dir, relative), content);
}

/** A silent 16-bit mono WAV of the given length. */
function wav(relative: string, seconds: number, sampleRate = 8000): void {
  const data = Math.round(seconds * sampleRate) * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data, 40);
  file(relative, Buffer.concat([header, Buffer.alloc(data)]));
}

function scenes(lengths: Record<string, number>): void {
  for (const id of Object.keys(lengths)) file(`assets/images/${id}.png`, `image ${id}`);
  file("artifacts/timing.json", JSON.stringify({
    scenes: Object.entries(lengths).map(([sceneId, durationSeconds]) => ({ sceneId, durationSeconds })),
  }));
}

function build(profile?: string) {
  const result = buildEditTimeline(dir, { episodeRef: REF, ...(profile ? { profile } : {}) });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result;
}

const track = (timeline: { tracks: Array<{ id: string; items: any[] }> }, id: string) =>
  timeline.tracks.find((t) => t.id === id)?.items ?? [];

describe("buildEditTimeline", () => {
  it("lays the scenes out in reading order, for their lengths, with crossfades centred on each boundary", () => {
    scenes({ s1: 2, s2: 3, s10: 1 });
    const { timeline } = build();
    expect(timeline.durationInFrames).toBe(180);
    expect(track(timeline, "scenes").map((it) => [it.id, it.from, it.duration, it.transitionIn?.duration ?? null])).toEqual([
      ["scene-s1", 0, 66, null],
      ["scene-s2", 54, 102, CROSSFADE_FRAMES],
      ["scene-s10", 144, 36, CROSSFADE_FRAMES],
    ]);
    expect(track(timeline, "scenes").every((it) => it.kit.name === "still" && it.props.fit === "contain")).toBe(true);
    expect(validateEditTimeline(timeline)).toEqual([]);
  });

  it("gives a very short scene no crossfade on either side", () => {
    scenes({ s1: 2, s2: 0.3, s3: 2 });
    const { timeline } = build();
    expect(track(timeline, "scenes").map((it) => [it.from, it.duration, it.transitionIn ?? null])).toEqual([
      [0, 60, null],
      [60, 9, null],
      [69, 60, null],
    ]);
  });

  it("plays the manifest's final WAV, captions its lines, and holds the last scene to the end of the narration", () => {
    scenes({ s1: 3, s2: 3 });
    wav("artifacts/narration/final.wav", 7);
    wav("artifacts/narration/s1.wav", 3);
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 3 }, pauseAfterMs: 0 }],
      finalWav: { path: "artifacts/narration/final.wav", durationSeconds: 7 },
      captions: [
        { segmentId: "s1", index: 1, startSeconds: 0.25, endSeconds: 3, text: "C'era una volta" },
        { segmentId: "s2", index: 2, startSeconds: 3.5, endSeconds: 6.9, text: "  un lampo.  " },
      ],
    }));
    const { timeline } = build();
    expect(timeline.durationInFrames).toBe(210);
    expect(track(timeline, "scenes").at(-1)).toMatchObject({ from: 84, duration: 126 });
    expect(track(timeline, "voice")).toEqual([{ id: "narration", from: 0, duration: 210, asset: "narration" }]);
    expect(timeline.assets.narration).toMatchObject({ path: "artifacts/narration/final.wav", kind: "audio" });
    expect(track(timeline, "captions").map((it) => [it.from, it.duration, it.kit.version, it.props])).toEqual([
      [8, 82, "1.1.0", { text: "C'era una volta", position: "bottom" }],
      [105, 102, "1.1.0", { text: "un lampo.", position: "bottom" }],
    ]);
  });

  it("plays a manifest's segments in order, with lead-in and pauses, when it has no final WAV", () => {
    scenes({ s1: 2, s2: 2 });
    wav("artifacts/narration/s1.wav", 1.5);
    wav("artifacts/narration/s2.wav", 1);
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      leadInSilenceSeconds: 0.5,
      entries: [
        { segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 1.5 }, pauseAfterMs: 500 },
        { segmentId: "s2", wav: { path: "artifacts/narration/s2.wav", durationSeconds: 1 }, pauseAfterMs: 0 },
      ],
    }));
    const { timeline } = build();
    expect(track(timeline, "voice").map((it) => [it.id, it.from, it.duration])).toEqual([
      ["narration-s1", 15, 45],
      ["narration-s2", 75, 30],
    ]);
  });

  it("falls back to the scene WAVs, in reading order, and says it is deprecated", () => {
    scenes({ s1: 1, s2: 1, s10: 1 });
    wav("artifacts/narration/s10.wav", 1);
    wav("artifacts/narration/s2.wav", 1);
    wav("artifacts/narration/s1.wav", 1);
    const result = build();
    expect(track(result.timeline, "voice").map((it) => [it.id, it.from])).toEqual([
      ["narration-s1", 0], ["narration-s2", 30], ["narration-s10", 60],
    ]);
    expect(result.warnings.join(" ")).toMatch(/DEPRECATED/);
  });

  it("keeps the narration but drops the captions of a manifest that is not canonical, and says why", () => {
    scenes({ s1: 2 });
    wav("artifacts/narration/final.wav", 2);
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      segments: [{ id: "s1" }],
      finalWav: { path: "artifacts/narration/final.wav" },
      captions: [{ startSeconds: 0, endSeconds: 1, text: "hidden" }],
    }));
    const result = build();
    expect(track(result.timeline, "voice")).toHaveLength(1);
    expect(track(result.timeline, "captions")).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/not canonical.*no captions.*'segments' but no 'entries'/);
  });

  it("lists every file it read, with its hash", () => {
    scenes({ s1: 1, s2: 1 });
    wav("artifacts/narration/narration-full.wav", 2);
    const { timeline } = build();
    expect(Object.keys(timeline.metadata.inputs)).toEqual([
      "artifacts/narration/narration-full.wav",
      "artifacts/timing.json",
      "assets/images/s1.png",
      "assets/images/s2.png",
    ]);
    expect(Object.values(timeline.metadata.inputs).every((h) => /^sha256:[a-f0-9]{64}$/.test(h))).toBe(true);
    expect(timeline.assets["scene-s1"]!.hash).toBe(timeline.metadata.inputs["assets/images/s1.png"]);
  });

  it("copies the chosen output profile and takes its size", () => {
    scenes({ s1: 1 });
    const { timeline } = build("vertical-1080x1920");
    expect(timeline.resolution).toEqual({ width: 1080, height: 1920 });
    expect(timeline.profile).toMatchObject({ id: "vertical-1080x1920", safeZone: { bottom: 380 }, loudness: { integrated: -14 } });
  });

  it("refuses an episode without scene images, and an unknown profile", () => {
    expect(buildEditTimeline(dir, { episodeRef: REF })).toMatchObject({ ok: false, problems: [{ code: "no-scenes" }] });
    scenes({ s1: 1 });
    expect(buildEditTimeline(dir, { episodeRef: REF, profile: "square" })).toMatchObject({ ok: false, problems: [{ code: "unknown-profile" }] });
  });

  it("refuses a manifest whose final WAV is missing", () => {
    scenes({ s1: 1 });
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 1 } }],
      finalWav: { path: "artifacts/narration/gone.wav" },
    }));
    expect(buildEditTimeline(dir, { episodeRef: REF })).toMatchObject({ ok: false, problems: [{ code: "missing-narration" }] });
  });
});
