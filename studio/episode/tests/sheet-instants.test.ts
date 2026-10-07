import { describe, expect, it } from "vitest";
import { SHEET_MAX_PICKS, sheetInstants, type SheetTimeline } from "../src/sheet-instants.js";

/**
 * sheetInstants (avg-3th.1): the frames a layout sheet shows, from the
 * timeline alone. avg-jao.5 renders two versions at exactly these frames, so
 * every case here is exact.
 */

const timeline = (sections?: SheetTimeline["sections"], durationInFrames = 300): SheetTimeline =>
  ({ fps: 30, durationInFrames, ...(sections ? { sections } : {}) });

const frames = (t: SheetTimeline, ...rest: Parameters<typeof sheetInstants> extends [unknown, ...infer R] ? R : never) =>
  sheetInstants(t, ...rest).picks.map((p) => p.frame);

describe("sheetInstants", () => {
  it("always shows the first and the last frame", () => {
    const { picks } = sheetInstants(timeline([{ id: "a", from: 0, duration: 300 }]), undefined, 2);
    expect(picks.at(0)).toEqual({ frame: 0, label: "first" });
    expect(picks.at(-1)).toEqual({ frame: 299, label: "last" });
  });

  it("spreads the rest over the sections by length, at least one each, never on a cut", () => {
    // 22 to spread: a (200 of 300 frames) gets 15, b gets 7, c (1 frame) still gets 1.
    const t = timeline([{ id: "b", from: 200, duration: 99 }, { id: "a", from: 0, duration: 200 }, { id: "c", from: 299, duration: 1 }]);
    const { picks } = sheetInstants(t);
    const count = (id: string) => picks.filter((p) => p.label.split(" / ").includes(id)).length;
    expect(count("a")).toBe(15);
    expect(count("b")).toBe(7);
    expect(count("c")).toBe(1);
    expect(picks.find((p) => p.label.includes("a"))!.frame).toBe(Math.floor(200 * 0.6 / 15));
    expect(picks.some((p) => p.frame === 200)).toBe(false);
  });

  it("treats a timeline without sections as one section", () => {
    const { picks } = sheetInstants(timeline(undefined, 100), undefined, 4);
    expect(picks).toEqual([
      { frame: 0, label: "first" },
      { frame: 30, label: "timeline" },
      { frame: 80, label: "timeline" },
      { frame: 99, label: "last" },
    ]);
  });

  it("ignores empty sections", () => {
    const { picks } = sheetInstants(timeline([{ id: "a", from: 0, duration: 300 }, { id: "gone", from: 100, duration: 0 }]), undefined, 3);
    expect(picks.map((p) => p.label)).toEqual(["first", "a", "last"]);
  });

  it("adds each rule's instant in every matching section, labelled with the rule", () => {
    const t = timeline([{ id: "intro", from: 0, duration: 60 }, { id: "block-1", from: 60, duration: 120 }, { id: "block-2", from: 180, duration: 120 }]);
    const { picks, warnings } = sheetInstants(t, {
      instants: [
        { at: "start", offsetSeconds: 1 },
        { at: "middle", sections: ["block-*"] },
        { at: "end", offsetSeconds: -0.5, sections: ["intro"] },
      ],
    }, 2);
    expect(warnings).toEqual([]);
    const ruled = picks.filter((p) => p.label.includes("·"));
    expect(ruled).toEqual([
      { frame: 30, label: "intro · start+1s" },
      { frame: 44, label: "intro · end-0.5s" },
      { frame: 90, label: "block-1 · start+1s" },
      { frame: 120, label: "block-1 · middle" },
      { frame: 210, label: "block-2 · start+1s" },
      { frame: 240, label: "block-2 · middle" },
    ]);
  });

  it("warns about, and drops, an instant outside its section or a rule matching nothing", () => {
    const t = timeline([{ id: "intro", from: 0, duration: 30 }, { id: "body", from: 30, duration: 270 }]);
    const { picks, warnings } = sheetInstants(t, {
      instants: [
        { at: "start", offsetSeconds: 2 },
        { at: "end", offsetSeconds: 1 },
        { at: "start", sections: ["outro"] },
      ],
    }, 2);
    expect(warnings).toEqual([
      "rule 1 (start+2s) falls outside section intro",
      "rule 2 (end+1s) falls outside section intro",
      "rule 2 (end+1s) falls outside section body",
      "rule 3 (start) matches no section",
    ]);
    expect(picks.map((p) => p.label)).toEqual(["first", "intro", "body · start+2s", "body", "last"]);
  });

  it("merges picks on one frame, labels in order, each once", () => {
    const t = timeline([{ id: "a", from: 0, duration: 300 }]);
    const { picks } = sheetInstants(t, { instants: [{ at: "start" }, { at: "end" }] }, 2);
    expect(picks).toEqual([
      { frame: 0, label: "first / a · start" },
      { frame: 180, label: "a" },
      { frame: 299, label: "last / a · end" },
    ]);
    // A section too short for its share puts several spread picks on one frame.
    expect(sheetInstants(timeline([{ id: "a", from: 0, duration: 2 }], 2), undefined, 10).picks)
      .toEqual([{ frame: 0, label: "first / a" }, { frame: 1, label: "last / a" }]);
  });

  it("never picks more frames than a sheet holds: the defaults first, then the rules in order, the rest dropped with a warning", () => {
    // 8 sections × 32 rules is valid in a release, and would be 273 frames.
    const sections = Array.from({ length: 8 }, (_, i) => ({ id: `block-${i + 1}`, from: i * 300, duration: 300 }));
    const rules = { instants: Array.from({ length: 32 }, (_, i) => ({ at: "start" as const, offsetSeconds: i * 0.25 })) };
    const { picks, warnings } = sheetInstants(timeline(sections, 2400), rules);
    expect(picks).toHaveLength(SHEET_MAX_PICKS);
    // Every default frame is still there…
    const frames = new Set(picks.map((p) => p.frame));
    for (const p of sheetInstants(timeline(sections, 2400)).picks) expect(frames.has(p.frame)).toBe(true);
    // …rule 1 reached every section, and the last rule none.
    expect(picks.filter((p) => p.label.includes("· start")).length).toBeGreaterThanOrEqual(8);
    expect(picks.some((p) => p.label.includes("start+7.75s"))).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(new RegExp(`^\\d+ instants dropped: a sheet holds at most ${SHEET_MAX_PICKS} frames$`));
  });

  it("decides the same frames every time", () => {
    const t = timeline([{ id: "a", from: 0, duration: 137 }, { id: "b", from: 137, duration: 163 }]);
    const rules = { instants: [{ at: "middle" as const }] };
    expect(frames(t, rules)).toEqual(frames(structuredClone(t), structuredClone(rules)));
    expect(frames(t, rules).length).toBeGreaterThanOrEqual(24);
  });
});
