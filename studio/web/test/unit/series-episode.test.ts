import { describe, expect, test } from "vitest";
import { formatSheetTime, nextStill, parseEpisodeKey, sheetStatusLine, type LayoutSheetAnswer } from "../../src/lib/sheet-review";
import { inOrder, wordAt, type TakeView } from "../../src/lib/narration-takes";

/**
 * The Storyboard and Narration tabs of a spec-driven episode (avg-goz): which
 * word is being said, where the sheet stands, how its stills are labelled.
 */

const sheet: NonNullable<LayoutSheetAnswer["sheet"]> = {
  createdAt: "2026-10-08T18:24:18.796Z", scale: 0.25, columns: 6, rows: 12, rules: "dentro-i-versi-long@1.2.0",
  grid: { path: "artifacts/layout-sheet/sheet.jpg", hash: "sha256:aa" }, frames: [],
};
const answer = (over: Partial<LayoutSheetAnswer>): LayoutSheetAnswer => ({ specDriven: true, sheet, timelineChanged: false, review: { state: "unreviewed", message: "" }, ...over });

describe("wordAt", () => {
  const words = [{ text: "Un", start: 0, end: 0.24 }, { text: "lampo", start: 0.3, end: 0.7 }, { text: "nel", start: 0.7, end: 0.9 }];
  test("the word being said, its start included and its end not", () => {
    expect(wordAt(words, 0)).toBe(0);
    expect(wordAt(words, 0.5)).toBe(1);
    expect(wordAt(words, 0.7)).toBe(2);
  });
  test("none between words, before the first or after the last, or without words", () => {
    expect(wordAt(words, 0.27)).toBe(-1);
    expect(wordAt(words, -1)).toBe(-1);
    expect(wordAt(words, 5)).toBe(-1);
    expect(wordAt(null, 0.5)).toBe(-1);
  });
});

describe("inOrder", () => {
  const take = (id: string): TakeView => ({ id, text: id, voice: null, durationSeconds: 1, audio: null, words: null });
  test("the units' order with their pauses, then the takes no unit names", () => {
    const rows = inOrder([{ id: "lesson", sequence: [{ take: "b" }, { take: "a", pauseBefore: 1 }] }], [take("a"), take("b"), take("c")]);
    expect(rows.map((r) => [r.unit, r.take.id, r.pauseBefore])).toEqual([["lesson", "b", null], ["lesson", "a", 1], [null, "c", null]]);
  });
});

describe("sheetStatusLine", () => {
  test("no sheet, a moved timeline: nothing to review", () => {
    expect(sheetStatusLine(answer({ sheet: null }))).toMatchObject({ tone: "muted", reviewable: false });
    expect(sheetStatusLine(answer({ timelineChanged: true }))).toMatchObject({ tone: "warn", reviewable: false });
  });
  test("unreviewed, approved and verified, rejected with its note", () => {
    expect(sheetStatusLine(answer({}))).toMatchObject({ tone: "muted", text: "Not reviewed yet.", reviewable: true });
    expect(sheetStatusLine(answer({ review: { state: "approved", at: "2026-10-08T18:28:04.981Z", verified: true, message: "" } })).text)
      .toBe("Approved at 2026-10-08T18:28:04.981Z (verified).");
    expect(sheetStatusLine(answer({ review: { state: "rejected", note: "the hand covers the gloss", message: "" } })))
      .toMatchObject({ tone: "bad", text: "Rejected: the hand covers the gloss" });
  });
});

describe("the stills", () => {
  test("labelled mm:ss.ff at 30 fps", () => {
    expect(formatSheetTime(0)).toBe("00:00.00");
    expect(formatSheetTime(146.5)).toBe("02:26.15");
    expect(formatSheetTime(577.3)).toBe("09:37.09");
  });
  test("stepped through with wrap-around", () => {
    expect(nextStill(66, 67, 1)).toBe(0);
    expect(nextStill(0, 67, -1)).toBe(66);
    expect(nextStill(3, 0, 1)).toBe(0);
  });
  test("the library's selection names an episode", () => {
    expect(parseEpisodeKey("dentro-i-versi/long/il-lampo")).toEqual({ channel: "dentro-i-versi", series: "long", episode: "il-lampo" });
    expect(parseEpisodeKey("dentro-i-versi/long")).toBeNull();
  });
});
