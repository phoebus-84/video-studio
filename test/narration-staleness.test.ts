import { describe, expect, it } from "vitest";
import { planNarrationSegmentRerun } from "../src/runtime/narration-staleness.js";

const entries = [
  { segmentId: "a", wavPath: "a.wav", durationSeconds: 1, pauseAfterMs: 100, acceptedAttemptId: "attempt-a" },
  { segmentId: "b", wavPath: "b.wav", durationSeconds: 2, pauseAfterMs: 100, acceptedAttemptId: "attempt-b" },
  { segmentId: "c", wavPath: "c.wav", durationSeconds: 3, pauseAfterMs: 0, acceptedAttemptId: "attempt-c" },
];

describe("targeted narration staleness", () => {
  it("preserves neighbors and timing when duration is unchanged", () => {
    const impact = planNarrationSegmentRerun(entries, "b", "attempt-b2", { durationChanged: false });
    expect(impact.stale).toEqual(["accepted-attempt:b"]);
    expect(impact.affected).toEqual(expect.arrayContaining(["narration-manifest.json", "narration-full.wav", "mastering-report.json", "final-render"]));
    expect(impact.affected).not.toContain("timing.json");
    expect(impact.preserved).toEqual(expect.arrayContaining([
      "attempt:attempt-a", "quality:a", "transform:a",
      "attempt:attempt-c", "quality:c", "transform:c",
      "timing.json", "caption:b",
    ]));
    expect(impact.preserved).not.toContain("attempt:attempt-b");
  });

  it("invalidates only downstream caption timing when duration changes", () => {
    const impact = planNarrationSegmentRerun(entries, "b", "attempt-b2", { durationChanged: true });
    expect(impact.affected).toEqual(expect.arrayContaining(["timing.json", "caption:b", "caption:c"]));
    expect(impact.affected).not.toContain("caption:a");
  });

  it("rejects unknown segments", () => {
    expect(() => planNarrationSegmentRerun(entries, "missing", "x", { durationChanged: false })).toThrow("unknown narration segment");
  });
});
