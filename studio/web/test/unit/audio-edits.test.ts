import { describe, expect, it } from "vitest";
import { envelope, lanesOf, marksOf, placeOf, whereLabel, type EditRecord } from "../../src/lib/audio-edits";

const record: EditRecord = {
  output: { path: "assets/takes/recita-pause.wav", hash: "sha256:x", durationSeconds: 3 },
  resolved: { tracks: [
    { id: "voice", clips: [{ id: "r", gain: -2 }] },
    { id: "bed", gain: -18, duck: { under: "voice", gain: -6 }, clips: [{ id: "air", automation: [[0, -4], [2, 0]] }] },
  ] },
  placements: [
    { track: "voice", clip: "r.2", source: "assets/takes/recita.wav", in: 1.1, out: 2, start: 1.6, end: 2.5, fadeIn: 0.012, fadeOut: 0, take: "recita" },
    { track: "voice", clip: "r", source: "assets/takes/recita.wav", in: 0, out: 1.1, start: 0, end: 1.1, fadeIn: 0, fadeOut: 0.012, take: "recita" },
    { track: "voice", clip: "r.room1", source: "assets/takes/recita.wav", in: 0.4, out: 0.62, start: 1.088, end: 1.308, fadeIn: 0.012, fadeOut: 0.012, take: "recita" },
    { track: "bed", clip: "air", source: "assets/sounds/fs-autunno.ogg", in: 4, out: 7, start: 0, end: 3, fadeIn: 1, fadeOut: 1 },
  ],
  report: { loudness: { integrated: -16, range: 3, truePeak: -1.1 }, normalization: "gain", clipped: 0, headTrim: 0.1,
    joins: [{ track: "voice", before: "r", after: "r.room1", at: 1.088, click: false, jumpDb: null }, { track: "bed", before: "a", after: "b", at: 2.2, click: true, jumpDb: 1 }],
    concerns: ["a click at 2.200 s (bed: a → b): lengthen the crossfade there", "a drop of 9.0 dB at 2.700 s (voice: x → y): match the clips' gains if it is not meant"] },
  words: [{ text: "Gemmea", start: 0.1, end: 0.6 }],
  pauses: [{ take: "recita", word: "chiaro", before: 0.3, after: 0.8, at: 1.1 }],
  createdAt: "2026-10-14T10:00:00Z",
};

describe("the Audio tab's layout", () => {
  it("lays the clips out in lanes, in the recipe's track order, room tone marked", () => {
    const lanes = lanesOf(record);
    expect(lanes.map((l) => l.track)).toEqual(["voice", "bed"]);
    expect(lanes[0]!.clips.map((c) => [c.id, c.room, c.label])).toEqual([["r", false, "recita"], ["r.room1", true, "recita"], ["r.2", false, "recita"]]);
    expect(lanes[0]!.clips[0]!.gain).toBe(-2);
    expect(lanes[1]).toMatchObject({ gain: -18, duck: { under: "voice", gain: -6 }, clips: [{ label: "fs-autunno.ogg", automation: [[0, -4], [2, 0]] }] });
  });

  it("marks joins, clicks, reshaped pauses and concerns that name a time, in time order", () => {
    expect(marksOf(record).map((m) => [m.at, m.kind])).toEqual([[1.088, "join"], [1.1, "pause"], [2.2, "click"], [2.7, "concern"]]);
    expect(marksOf(record)[1]!.label).toBe("after «chiaro»: 0.30 s → 0.80 s");
  });

  it("reads files where the edit lives", () => {
    expect(placeOf({ kind: "source", channel: "dentro-i-versi", source: "novembre", pin: "fonte" })).toEqual({ channel: "dentro-i-versi", source: "novembre" });
    expect(whereLabel({ kind: "source", channel: "c", source: "novembre", pin: "fonte" })).toBe("sources/novembre (pin fonte)");
    expect(whereLabel({ kind: "episode", channel: "c", series: "short", episode: "novembre" })).toBe("short/novembre");
  });

  it("summarises the peaks into columns", () => {
    const peaks = { window: 0.01, peaks: Array.from({ length: 100 }, (_, i): [number, number] => [-i / 100, i / 100]) };
    const env = envelope(peaks, 0, 1, 4);
    expect(env).toHaveLength(4);
    expect(env[3]![1]).toBeCloseTo(0.99, 2);
    expect(envelope(null, 0, 1, 4)).toEqual([]);
  });
});
