import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readWavFacts,
  buildNarrationManifest,
  validateNarrationManifest,
  segmentsFromLegacyManifest,
  assembleNarrationSegments,
  findFinalWav,
  writeNarrationManifest,
  naturalSegmentOrder,
  silenceFromLegacyManifest,
} from "../src/narration-manifest.js";

/**
 * Nothing in the agent ever wrote a narration manifest: pva_synthesize_speech
 * drops a WAV per scene and stops, and the voice worker's correct writer only
 * runs in a mastering flow the agent never calls. So a session invented the
 * shape, and produced `segments[]` with `sceneId`/`audioPath` where every
 * canonical reader looks for `entries[]` with `segmentId` and a `wav` artifact.
 * The file named a valid `finalWav`, so composition worked and nothing
 * complained — while the studio showed the episode as having no narration.
 */

/** A minimal 16-bit mono WAV of a given duration. */
function wav(path: string, seconds: number, sampleRate = 24000): void {
  const frames = Math.round(seconds * sampleRate);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);            // PCM
  buffer.writeUInt16LE(1, 22);            // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);           // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  writeFileSync(path, buffer);
}

describe("narration manifest writer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pva-narration-"));
    mkdirSync(join(dir, "artifacts", "narration"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const seed = (id: string, seconds: number, rate?: number): string => {
    const relative = join("artifacts", "narration", `${id}.wav`);
    wav(join(dir, relative), seconds, rate);
    return relative;
  };

  describe("measuring WAVs", () => {
    it("reads the duration from the header, not from an assumed sample rate", () => {
      // The gateway estimates duration from file size at a hardcoded 24 kHz,
      // which is wrong by a factor of two for a 48 kHz mastered final.
      const relative = seed("s1", 3, 48000);
      const facts = readWavFacts(join(dir, relative), relative);
      expect(facts.durationSeconds).toBeCloseTo(3, 5);
      expect(facts.sampleRate).toBe(48000);
      expect(facts.channels).toBe(1);
      expect(facts.sampleWidthBytes).toBe(2);
    });

    it("records a content hash and the real byte size", () => {
      const relative = seed("s1", 1);
      const facts = readWavFacts(join(dir, relative), relative);
      expect(facts.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(facts.sizeBytes).toBe(44 + 24000 * 2);
    });

    it("refuses a file that is not a WAV", () => {
      writeFileSync(join(dir, "artifacts", "narration", "s1.wav"), "not audio at all");
      expect(() => readWavFacts(join(dir, "artifacts", "narration", "s1.wav"), "x"))
        .toThrow("not a RIFF/WAVE file");
    });
  });

  describe("building", () => {
    it("writes entries with segmentId and a measured wav, as readers expect", () => {
      const doc = buildNarrationManifest(dir, {
        segments: [
          { segmentId: "s1", wavPath: seed("s1", 2), text: "First." },
          { segmentId: "s2", wavPath: seed("s2", 3), text: "Second." },
        ],
      });

      const entries = doc.entries as Array<Record<string, any>>;
      expect(entries.map((e) => e.segmentId)).toEqual(["s1", "s2"]);
      expect(entries[0]!.wav.path).toBe(join("artifacts", "narration", "s1.wav"));
      expect(entries[0]!.wav.durationSeconds).toBeCloseTo(2, 5);
      expect(validateNarrationManifest(doc)).toEqual([]);
    });

    it("puts the pause after a segment, not before the next one", () => {
      // The voice worker accumulates duration and then the pause. A writer that
      // disagreed would put the studio's captions and the rendered audio out of
      // step by the sum of the gaps.
      const doc = buildNarrationManifest(dir, {
        segments: [
          { segmentId: "s1", wavPath: seed("s1", 2), text: "First.", pauseAfterMs: 300 },
          { segmentId: "s2", wavPath: seed("s2", 3), text: "Second." },
        ],
      });
      const captions = doc.captions as Array<Record<string, number>>;
      expect(captions[0]!.startSeconds).toBeCloseTo(0, 5);
      expect(captions[0]!.endSeconds).toBeCloseTo(2, 5);
      expect(captions[1]!.startSeconds).toBeCloseTo(2.3, 5);
    });

    it("captions only the segments that have text", () => {
      const doc = buildNarrationManifest(dir, {
        segments: [
          { segmentId: "s1", wavPath: seed("s1", 2), text: "Spoken." },
          { segmentId: "s2", wavPath: seed("s2", 2) },
        ],
      });
      expect(doc.entries).toHaveLength(2);
      expect(doc.captions).toHaveLength(1);
    });

    it("measures the final WAV when the episode has one", () => {
      const finalPath = seed("narration-full", 5, 48000);
      const doc = buildNarrationManifest(dir, {
        segments: [{ segmentId: "s1", wavPath: seed("s1", 2) }],
        finalWavPath: finalPath,
      });
      const finalWav = doc.finalWav as Record<string, number | string>;
      expect(finalWav.durationSeconds).toBeCloseTo(5, 5);
      expect(finalWav.sampleRate).toBe(48000);
    });

    it("refuses a segment whose WAV is not there", () => {
      expect(() => buildNarrationManifest(dir, {
        segments: [{ segmentId: "s1", wavPath: "artifacts/narration/absent.wav" }],
      })).toThrow("does not exist");
    });

    it("refuses a repeated segment ID", () => {
      const relative = seed("s1", 1);
      expect(() => buildNarrationManifest(dir, {
        segments: [
          { segmentId: "s1", wavPath: relative },
          { segmentId: "s1", wavPath: relative },
        ],
      })).toThrow("more than once");
    });

    it("refuses to build nothing", () => {
      expect(() => buildNarrationManifest(dir, { segments: [] })).toThrow("at least one segment");
    });
  });

  describe("silence at either end", () => {
    it("starts the timeline after the lead-in, not at zero", () => {
      const doc = buildNarrationManifest(dir, {
        segments: [{ segmentId: "s1", wavPath: seed("s1", 2), text: "First." }],
        leadInSilenceSeconds: 0.25,
        leadOutSilenceSeconds: 0.25,
      });
      const captions = doc.captions as Array<Record<string, number>>;
      expect(captions[0]!.startSeconds).toBeCloseTo(0.25, 5);
      expect(captions[0]!.endSeconds).toBeCloseTo(2.25, 5);
      expect(doc.leadInSilenceSeconds).toBe(0.25);
      expect(doc.leadOutSilenceSeconds).toBe(0.25);
    });

    it("says nothing about silence when there is none", () => {
      const doc = buildNarrationManifest(dir, {
        segments: [{ segmentId: "s1", wavPath: seed("s1", 2) }],
      });
      expect(doc.leadInSilenceSeconds).toBeUndefined();
      expect(doc.leadOutSilenceSeconds).toBeUndefined();
    });

    it("recovers the silence an older manifest recorded", () => {
      // The improvised shape wrote introSilenceSeconds/outroSilenceSeconds.
      expect(silenceFromLegacyManifest({
        introSilenceSeconds: 0.25,
        outroSilenceSeconds: 0.25,
        segments: [{ sceneId: "s1", startSeconds: 0.25 }],
      })).toEqual({ leadInSilenceSeconds: 0.25, leadOutSilenceSeconds: 0.25 });
    });

    it("reads the lead-in from the first segment's start when it is not named", () => {
      expect(silenceFromLegacyManifest({ segments: [{ sceneId: "s1", startSeconds: 0.4 }] }))
        .toEqual({ leadInSilenceSeconds: 0.4 });
    });

    it("reports no silence for a narration that starts on the first word", () => {
      expect(silenceFromLegacyManifest({ segments: [{ sceneId: "s1", startSeconds: 0 }] })).toEqual({});
      expect(silenceFromLegacyManifest(null)).toEqual({});
    });
  });

  describe("validation", () => {
    it("names the improvised shape for what it is", () => {
      const problems = validateNarrationManifest({
        finalWav: { path: "artifacts/narration/narration-full.wav" },
        segments: [
          { sceneId: "s1", audioPath: "artifacts/narration/s1.wav", audioDurationSeconds: 8.48 },
        ],
      });
      expect(problems).toHaveLength(1);
      // The count matters: it says the work exists and is merely unreadable.
      expect(problems[0]).toContain("1 'segments' but no 'entries'");
    });

    it("catches an entry with no measured duration", () => {
      const problems = validateNarrationManifest({
        entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav" } }],
      });
      expect(problems).toEqual([expect.stringContaining("wav.durationSeconds")]);
    });

    it("catches an entry with no wav at all", () => {
      const problems = validateNarrationManifest({ entries: [{ segmentId: "s1" }] });
      expect(problems).toEqual([expect.stringContaining("no 'wav' artifact")]);
    });

    it("accepts the worker's snake_case", () => {
      expect(validateNarrationManifest({
        entries: [{ segment_id: "s1", wav: { path: "a.wav", duration_seconds: 2 } }],
      })).toEqual([]);
    });
  });

  describe("recovering an episode written in the old shape", () => {
    it("reads the segments back, deriving each pause from the gap that follows", () => {
      const segments = segmentsFromLegacyManifest({
        segments: [
          { sceneId: "s1", audioPath: "artifacts/narration/s1.wav", text: "One.", startSeconds: 0.25, endSeconds: 8.73 },
          { sceneId: "s2", audioPath: "artifacts/narration/s2.wav", text: "Two.", startSeconds: 9.03, endSeconds: 16.15 },
        ],
      });
      expect(segments[0]).toMatchObject({ segmentId: "s1", text: "One.", pauseAfterMs: 300 });
      expect(segments[1]!.pauseAfterMs).toBe(0);
    });

    it("prefers the old manifest to the bare files, because it carries the text", () => {
      seed("s1", 2);
      seed("s2", 3);
      writeFileSync(join(dir, "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
        segments: [
          { sceneId: "s1", audioPath: "artifacts/narration/s1.wav", text: "One.", startSeconds: 0, endSeconds: 2 },
          { sceneId: "s2", audioPath: "artifacts/narration/s2.wav", text: "Two.", startSeconds: 2.3, endSeconds: 5.3 },
        ],
      }));

      const segments = assembleNarrationSegments(dir);
      expect(segments.map((s) => s.text)).toEqual(["One.", "Two."]);
      expect(segments[0]!.pauseAfterMs).toBe(300);
    });
  });

  describe("assembling from disk", () => {
    it("falls back to the WAV files in natural order", () => {
      for (const id of ["s10", "s2", "s1", "s4a"]) seed(id, 1);
      expect(assembleNarrationSegments(dir).map((s) => s.segmentId))
        .toEqual(["s1", "s2", "s4a", "s10"]);
    });

    it("ignores files that are not segments", () => {
      seed("s1", 1);
      seed("narration-full", 4);
      seed("narration-premaster", 4);
      expect(assembleNarrationSegments(dir).map((s) => s.segmentId)).toEqual(["s1"]);
    });

    it("takes caption text from the script the studio saves", () => {
      seed("s1", 2);
      writeFileSync(
        join(dir, "artifacts", "narration-script.json"),
        JSON.stringify([{ id: "s1", text: "From the script." }]),
      );
      expect(assembleNarrationSegments(dir)[0]!.text).toBe("From the script.");
    });

    it("finds the assembled narration without being told where it is", () => {
      seed("narration-full", 4);
      expect(findFinalWav(dir)).toBe(join("artifacts", "narration", "narration-full.wav"));
    });

    it("orders segments the way a person reads them", () => {
      expect(["s10", "s1", "s4a", "s4", "s2"].sort(naturalSegmentOrder))
        .toEqual(["s1", "s2", "s4", "s4a", "s10"]);
    });
  });

  describe("writing", () => {
    it("writes a manifest the canonical readers accept", () => {
      const doc = buildNarrationManifest(dir, {
        segments: [{ segmentId: "s1", wavPath: seed("s1", 2), text: "One." }],
        finalWavPath: seed("narration-full", 2),
      });
      const written = writeNarrationManifest(dir, doc);

      const onDisk = JSON.parse(readFileSync(written, "utf-8"));
      expect(validateNarrationManifest(onDisk)).toEqual([]);
      expect(onDisk.entries[0].segmentId).toBe("s1");
      expect(onDisk.finalWav.path).toBe(join("artifacts", "narration", "narration-full.wav"));
    });

    it("refuses to write a document that is not canonical", () => {
      // The whole point: the improvised shape cannot be produced by this path.
      expect(() => writeNarrationManifest(dir, { segments: [{ sceneId: "s1" }] } as never))
        .toThrow("Refusing to write a non-canonical manifest");
    });
  });
});
