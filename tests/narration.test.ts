import { describe, expect, it } from "vitest";
import { narrationCompositionInput, type CanonicalNarrationManifest } from "../src/narration.js";

function manifest(): CanonicalNarrationManifest {
  return {
    schemaVersion: "0.1.0",
    entries: [
      { segmentId: "s10", acceptedAttemptId: "a10", wav: { path: "s10.wav", durationSeconds: 2, contentHash: "sha256:a" }, pauseAfterMs: 250 },
      { segmentId: "s2", acceptedAttemptId: "a2", wav: { path: "s2.wav", durationSeconds: 1, contentHash: "sha256:b" }, pauseAfterMs: 0 },
    ],
    finalWav: { path: "narration-full.wav", durationSeconds: 3.25, contentHash: "sha256:c" },
    captions: [
      { segmentId: "s2", index: 2, startSeconds: 2.25, endSeconds: 3.25, text: "Second" },
      { segmentId: "s10", index: 1, startSeconds: 0, endSeconds: 2, text: "First" },
    ],
  };
}

describe("canonical narration composition projection", () => {
  it("uses manifest order, measured final duration, and caption index", () => {
    const result = narrationCompositionInput(manifest());
    expect(result.audioPath).toBe("narration-full.wav");
    expect(result.durationSeconds).toBe(3.25);
    expect(result.orderedSegmentIds).toEqual(["s10", "s2"]);
    expect(result.captions).toEqual([
      { text: "First", start: 0, duration: 2 },
      { text: "Second", start: 2.25, duration: 1 },
    ]);
  });

  it("rejects stale duration, duplicate IDs, and invalid cues", () => {
    expect(() => narrationCompositionInput({ ...manifest(), finalWav: { ...manifest().finalWav, durationSeconds: 3 } })).toThrow("does not match");
    const duplicate = manifest();
    duplicate.entries[1]!.segmentId = "s10";
    expect(() => narrationCompositionInput(duplicate)).toThrow("duplicate");
    const invalidCue = manifest();
    invalidCue.captions[0]!.endSeconds = 4;
    expect(() => narrationCompositionInput(invalidCue)).toThrow("invalid canonical caption");
  });
});
