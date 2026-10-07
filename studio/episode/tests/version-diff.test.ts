import { describe, expect, it } from "vitest";
import { alignInstants, changedFrame, CompareError, judge, measure, type AlignSide } from "../src/version-diff.js";

/**
 * The pure half of a version comparison (avg-jao.5): which frames of the two
 * versions are compared, how different two frames are, and what the
 * differences mean against the sections a correction was expected to touch.
 */

const side = (sections: AlignSide["sections"], durationInFrames = 300, fps = 30): AlignSide => ({ fps, durationInFrames, sections });
const three = (b = 100) => [
  { id: "intro", from: 0, duration: 100 },
  { id: "block-1", from: 100, duration: b },
  { id: "block-2", from: 100 + b, duration: 100 },
];
const pairs = (r: ReturnType<typeof alignInstants>) => r.picks.map((p) => [p.newFrame, p.oldFrame, p.reason ?? null]);

describe("alignInstants", () => {
  it("compares the same frames when nothing moved", () => {
    const r = alignInstants(side(three()), side(three()));
    expect(r.alignment).toBe("sections");
    expect(r.picks.length).toBeGreaterThanOrEqual(20);
    for (const p of r.picks) expect(p.oldFrame).toBe(p.newFrame);
  });

  it("keeps later sections aligned when one got longer, by section and offset", () => {
    // block-1 is 30 frames longer in the new version: block-2 starts at 230, not 200.
    const r = alignInstants(side(three(130), 330), side(three(100), 300));
    const late = r.picks.filter((p) => p.section === "block-2");
    expect(late.length).toBeGreaterThan(0);
    for (const p of late) expect(p.oldFrame).toBe(p.newFrame - 30);
    // Inside block-1, past the old length, there is nothing to compare with.
    const beyond = r.picks.filter((p) => p.section === "block-1" && p.newFrame - 100 >= 100);
    expect(beyond.length).toBeGreaterThan(0);
    for (const p of beyond) expect([p.oldFrame, p.reason]).toEqual([null, "beyond-old-section"]);
  });

  it("says a section the old version did not have is new", () => {
    const newer = [...three(), { id: "coda", from: 300, duration: 60 }];
    const r = alignInstants(side(newer, 360), side(three(), 300));
    const coda = r.picks.filter((p) => p.section === "coda");
    expect(coda.length).toBeGreaterThan(0);
    for (const p of coda) expect([p.oldFrame, p.reason]).toEqual([null, "new-section"]);
  });

  it("falls back to time without timelines, with shifts, and says when the old video is too short", () => {
    const r = alignInstants(side(null, 300), side(null, 260), { times: [1, 5, 9.5], shifts: [{ from: 4, by: -0.5 }] });
    expect(r.alignment).toBe("time");
    expect(pairs(r)).toEqual([[30, 30, null], [150, 135, null], [285, null, "missing-in-old"]]);
    expect(r.picks.map((p) => p.label)).toEqual(["1s", "5s", "9.5s"]);
    expect(r.picks[0]!.section).toBeNull();
  });

  it("applies every shift whose start has passed", () => {
    const r = alignInstants(side(null), side(null, 400), { times: [2, 6], shifts: [{ from: 1, by: 1 }, { from: 5, by: 2 }] });
    expect(pairs(r)).toEqual([[60, 90, null], [180, 270, null]]);
  });

  it("ignores shifts, with a warning, when both versions have sections", () => {
    const r = alignInstants(side(three()), side(three()), { shifts: [{ from: 0, by: 3 }] });
    expect(r.warnings).toEqual(["shifts ignored: both versions have sections, aligned by section"]);
    for (const p of r.picks) expect(p.oldFrame).toBe(p.newFrame);
  });

  it("maps by time across frame rates", () => {
    const r = alignInstants(side(null, 300, 30), side(null, 250, 25), { times: [4] });
    expect(pairs(r)).toEqual([[120, 100, null]]);
    const s = alignInstants(side([{ id: "a", from: 0, duration: 300 }], 300, 30), side([{ id: "a", from: 0, duration: 250 }], 250, 25), { times: [4] });
    expect(pairs(s)).toEqual([[120, 100, null]]);
  });

  it("refuses times outside the new video, and bad shifts", () => {
    expect(() => alignInstants(side(null), side(null), { times: [10] })).toThrow(CompareError);
    expect(() => alignInstants(side(null), side(null), { times: [-1] })).toThrow(/bad-options|not inside/);
    expect(() => alignInstants(side(null), side(null), { times: [] })).toThrow(/at least one time/);
    expect(() => alignInstants(side(null), side(null), { shifts: [{ from: Number.NaN, by: 1 }] })).toThrow(/shift/);
  });

  it("reports a section the new version no longer has, and one whose length changed", () => {
    // block-1 deleted; block-2 shortened from 100 to 60 frames.
    const newer = [{ id: "intro", from: 0, duration: 100 }, { id: "block-2", from: 100, duration: 60 }];
    const r = alignInstants(side(newer, 160), side(three(), 300));
    expect(r.structure).toEqual([
      { section: "block-1", change: "removed", oldFrames: 100, newFrames: 0 },
      { section: "block-2", change: "resized", oldFrames: 100, newFrames: 60 },
    ]);
  });

  it("reports added sections and a difference in length when aligning by time", () => {
    const added = alignInstants(side([...three(), { id: "coda", from: 300, duration: 60 }], 360), side(three(), 300));
    expect(added.structure).toEqual([{ section: "coda", change: "added", oldFrames: 0, newFrames: 60 }]);
    const byTime = alignInstants(side(null, 300), side(null, 330), { times: [1] });
    expect(byTime.structure).toEqual([{ section: null, change: "length", oldFrames: 330, newFrames: 300 }]);
    expect(alignInstants(side(null, 300), side(null, 300), { times: [1] }).structure).toEqual([]);
  });

  it("passes on what the sheet's instants had to drop", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `s-${i}`, from: i * 2, duration: 2 }));
    const r = alignInstants(side(many, 400), side(many, 400));
    expect(r.warnings.some((w) => /instants dropped/.test(w))).toBe(true);
  });

  it("numbers picks in order and deduplicates repeated times", () => {
    const r = alignInstants(side(null), side(null), { times: [2, 1, 2.01] });
    expect(r.picks.map((p) => [p.index, p.newFrame])).toEqual([[0, 30], [1, 60]]);
  });
});

describe("measure", () => {
  it("is zero for identical frames", () => {
    const a = new Uint8Array(100).fill(40);
    expect(measure(a, a.slice())).toEqual({ meanDiff: 0, changedShare: 0 });
  });

  it("counts a frame as changed when its mean moves past the threshold, or enough of its pixels change", () => {
    const a = new Uint8Array(10_000).fill(20);
    const word = a.slice();
    word.fill(235, 0, 30); // 30 of 10 000 pixels: a word — the mean barely moves
    expect(measure(a, word).meanDiff).toBeLessThan(1);
    expect(changedFrame(measure(a, word), 1)).toBe(true);
    const speck = a.slice();
    speck.fill(235, 0, 5); // 5 pixels: noise
    expect(changedFrame(measure(a, speck), 1)).toBe(false);
  });

  it("averages the absolute difference and counts the pixels that changed by more than 16", () => {
    const a = new Uint8Array(100).fill(100);
    const b = a.slice();
    b.fill(200, 0, 10);  // 10 pixels by 100
    b.fill(110, 10, 20); // 10 pixels by 10: changed, but not past 16
    expect(measure(a, b)).toEqual({ meanDiff: 11, changedShare: 0.1 });
  });

  it("refuses frames of different sizes", () => {
    expect(() => measure(new Uint8Array(4), new Uint8Array(5))).toThrow(/sizes/);
  });
});

describe("judge", () => {
  const p = (index: number, section: string | null, changed: boolean) => ({ index, section, changed });

  it("is ok when every change is in an expected section", () => {
    expect(judge([p(0, "intro", false), p(1, "block-3", true), p(2, "block-4", true)], ["block-*"]))
      .toEqual({ verdict: "ok", changed: [1, 2], unexpected: [], unexpectedStructure: [], warnings: [] });
  });

  it("names the unexpected changes, a sectionless one included", () => {
    expect(judge([p(0, "intro", true), p(1, "block-3", true), p(2, null, true)], ["block-3"]))
      .toEqual({ verdict: "unexpected-changes", changed: [0, 1, 2], unexpected: [0, 2], unexpectedStructure: [], warnings: [] });
  });

  it("warns about an expected section that did not change", () => {
    expect(judge([p(0, "intro", false), p(1, "block-3", false)], ["block-3", "coda"]).warnings).toEqual([
      "block-3 was expected to change and did not",
      "coda was expected to change and did not",
    ]);
  });

  it("counts a section that changed shape as a change of that section", () => {
    const structure = [{ section: "block-1", change: "removed" as const, oldFrames: 100, newFrames: 0 }];
    expect(judge([p(0, "intro", false)], ["block-1"], structure))
      .toEqual({ verdict: "ok", changed: [], unexpected: [], unexpectedStructure: [], warnings: [] });
    expect(judge([p(0, "intro", false)], ["intro"], structure)).toEqual({
      verdict: "unexpected-changes", changed: [], unexpected: [], unexpectedStructure: structure,
      warnings: ["intro was expected to change and did not"],
    });
    // A length change without sections cannot be attributed: unexpected whenever there is an expectation.
    const length = [{ section: null, change: "length" as const, oldFrames: 330, newFrames: 300 }];
    expect(judge([], ["block-*"], length).verdict).toBe("unexpected-changes");
  });

  it("only lists without an expectation", () => {
    expect(judge([p(0, "intro", true)], undefined)).toEqual({ verdict: "listed", changed: [0], unexpected: [], unexpectedStructure: [], warnings: [] });
  });
});
