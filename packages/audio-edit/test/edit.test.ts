import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeAudio, place, quietestPoint, renderRecipe, scan, type Recipe } from "../src/index.js";
import { duckExpression } from "../src/graph.js";
import { framed, frequency, noise, pcm, rmsDb, tone, workdir } from "./helpers.js";

let dir: string;
beforeEach(() => { dir = workdir(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const render = (recipe: Recipe, name = "out.wav") => renderRecipe(recipe, { root: dir, output: join(dir, name) });

describe("placing clips", () => {
  it("puts a clip after the previous one, overlapped by its crossfade, both faded over it", () => {
    const recipe: Recipe = { output: {}, tracks: [{ id: "voice", clips: [
      { id: "a", source: "a.wav", in: 0, out: 1.5, at: 0 },
      { id: "b", source: "b.wav", in: 0.5, at: "after", crossfade: 0.05 },
    ] }] };
    const [a, b] = place(recipe, { "a.wav": 2, "b.wav": 2 });
    expect(a).toMatchObject({ start: 0, end: 1.5, fadeOut: 0.05 });
    expect(b).toMatchObject({ in: 0.5, out: 2, start: 1.45, end: 2.95, fadeIn: 0.05 });
  });

  it("names the field of every mistake", () => {
    const err = (recipe: unknown) => { try { place(recipe as Recipe, { "a.wav": 2 }); } catch (e) { return (e as { path?: string }).path; } return "ok"; };
    const one = (clip: object) => ({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0, ...clip }] }] });
    expect(err(one({ in: 1, out: 0.5 }))).toBe("$.tracks[0].clips[0].out");
    expect(err(one({ at: "after" }))).toBe("$.tracks[0].clips[0].at");
    expect(err(one({ in: 3 }))).toBe("$.tracks[0].clips[0].in");
    expect(err(one({ automation: [[1, 0], [0.5, -3]] }))).toBe("$.tracks[0].clips[0].automation[1]");
    expect(err({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0 }] , duck: { under: "t", gain: -6 } }] })).toBe("$.tracks[0].duck.under");
    expect(err({ output: { channels: 3 }, tracks: [] })).toBe("$.output.channels");
  });
});

describe("rendering", () => {
  it("joins the start of one take to the end of another, without a click", async () => {
    tone(dir, "a.wav", 440, 2);
    tone(dir, "b.wav", 660, 2);
    const result = await render({ output: {}, tracks: [{ id: "voice", clips: [
      { id: "a", source: "a.wav", out: 1.5, at: 0 },
      { id: "b", source: "b.wav", in: 0.5, at: "after", crossfade: 0.03 },
    ] }] });
    expect(result.durationSeconds).toBeCloseTo(2.97, 2);
    expect(frequency(pcm(result.path, 0.3, 0.5))).toBeCloseTo(440, -1);
    expect(frequency(pcm(result.path, 2.0, 0.5))).toBeCloseTo(660, -1);
    expect(result.joins).toEqual([{ track: "voice", before: "a", after: "b", at: 1.47, click: false, jumpDb: expect.any(Number) }]);
    expect(Math.abs(result.joins[0]!.jumpDb!)).toBeLessThan(1);
    expect(result.concerns).toEqual([]);
  });

  it("hears the click of a hard cut in the middle of a wave, and says where", async () => {
    tone(dir, "a.wav", 440, 2, -6);
    const result = await render({ output: {}, tracks: [{ id: "voice", clips: [
      // Cut on the wave's crest (440 Hz: 1.000568 s is a quarter period past a zero), then start at a zero: a step of the full amplitude.
      { id: "a", source: "a.wav", out: 1.000568, at: 0 },
      { id: "b", source: "a.wav", in: 0.5, at: "after" },
    ] }] });
    expect(result.joins[0]!.click).toBe(true);
    expect(result.concerns.join("\n")).toMatch(/a click at 1\.001 s \(voice: a → b\): lengthen the crossfade/);
  });

  it("applies a clip's gain, and an automation curve over it", async () => {
    tone(dir, "a.wav", 440, 3);
    const flat = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0 }] }] }, "flat.wav");
    const lower = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0, gain: -6 }] }] }, "lower.wav");
    expect(rmsDb(pcm(lower.path)) - rmsDb(pcm(flat.path))).toBeCloseTo(-6, 0);
    const ramp = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0, automation: [[0, 0], [1, -20]] }] }] }, "ramp.wav");
    const early = rmsDb(pcm(ramp.path, 0, 0.02));
    const late = rmsDb(pcm(ramp.path, 1.5, 0.5));
    expect(early - late).toBeCloseTo(20, 0);
  });

  it("layers tracks and ducks the bed under the voice by what it says", async () => {
    tone(dir, "voice.wav", 880, 1);
    noise(dir, "bed.wav", 4);
    const tracks = (duck: boolean): Recipe["tracks"] => [
      { id: "voice", gain: -90, clips: [{ id: "v", source: "voice.wav", at: 1.5 }] },
      { id: "bed", clips: [{ id: "b", source: "bed.wav", at: 0 }], ...(duck ? { duck: { under: "voice", gain: -12, attack: 0.2, release: 0.2 } } : {}) },
    ];
    const ducked = await render({ output: {}, tracks: tracks(true) }, "ducked.wav");
    const plain = await render({ output: {}, tracks: tracks(false) }, "plain.wav");
    // The same bed, the same window: only the duck differs.
    expect(rmsDb(pcm(plain.path, 1.7, 0.6)) - rmsDb(pcm(ducked.path, 1.7, 0.6))).toBeCloseTo(12, 0);
    expect(rmsDb(pcm(plain.path, 0.2, 0.8)) - rmsDb(pcm(ducked.path, 0.2, 0.8))).toBeCloseTo(0, 0);
  });

  it("brings the mix to its loudness with a gain, and keeps the true peak under the ceiling", async () => {
    tone(dir, "a.wav", 440, 4, -30);
    const result = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0 }] }], master: { loudness: -16, truePeak: -1 } });
    expect(result.loudness.integrated).toBeCloseTo(-16, 0);
    expect(result.loudness.truePeak).toBeLessThanOrEqual(-0.8);
    expect(result.normalization).toBe("gain");
  });

  it("trims the head and the tail to the silence it keeps, and says by how much", async () => {
    framed(dir, "f.wav", 1, 2, 1.5);
    const result = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "f", source: "f.wav", at: 0 }] }], master: { trim: { head: 0.1, tail: 0.25 }, fadeOut: 0.1 } });
    expect(result.headTrim).toBeCloseTo(0.9, 1);
    expect(result.durationSeconds).toBeCloseTo(2.35, 1);
    expect(result.placements[0]!.start).toBeCloseTo(-0.9, 1);
  });

  it("holds the true peak with a limiter when the gain alone would pass it, and says so", async () => {
    // A spiky signal: loud peaks, low average.
    tone(dir, "a.wav", 440, 4, -40);
    tone(dir, "spike.wav", 2000, 0.02, -6);
    const result = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0 }, { id: "s", source: "spike.wav", at: 2 }] }], master: { loudness: -14, truePeak: -1 } });
    expect(result.normalization).toBe("gain+limiter");
    expect(result.loudness.truePeak).toBeLessThanOrEqual(-0.5);
    expect(result.concerns.join("\n")).toContain("needed a limiter");
  });

  it("makes the same file from the same recipe", async () => {
    tone(dir, "a.wav", 440, 2);
    noise(dir, "n.wav", 2);
    const recipe: Recipe = { output: {}, tracks: [
      { id: "a", clips: [{ id: "a", source: "a.wav", at: 0, fadeIn: 0.1 }] },
      { id: "n", gain: -10, clips: [{ id: "n", source: "n.wav", at: 0.5 }] },
    ], master: { loudness: -20 } };
    expect((await render(recipe, "one.flac")).sha256).toBe((await render(recipe, "two.flac")).sha256);
  });

  it("refuses a source outside its root and a format it does not write", async () => {
    tone(dir, "a.wav", 440, 1);
    const outside = workdir();
    try {
      tone(outside, "far.wav", 440, 1);
      symlinkSync(join(outside, "far.wav"), join(dir, "link.wav"));
      await expect(render({ output: {}, tracks: [{ id: "t", clips: [{ id: "x", source: "link.wav", at: 0 }] }] })).rejects.toMatchObject({ code: "missing-source" });
      await expect(render({ output: {}, tracks: [{ id: "t", clips: [{ id: "x", source: "../x.wav", at: 0 }] }] })).rejects.toMatchObject({ code: "missing-source" });
      await expect(render({ output: {}, tracks: [{ id: "t", clips: [{ id: "x", source: "a.wav", at: 0 }] }] }, "out.aiff")).rejects.toMatchObject({ code: "bad-recipe" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("analysis", () => {
  it("measures loudness, silences, peaks per 10 ms, and clipping", async () => {
    framed(dir, "f.wav", 0.5, 1, 0.5);
    const a = await analyzeAudio(join(dir, "f.wav"));
    expect(a.durationSeconds).toBeCloseTo(2, 2);
    expect(a.peaks.length).toBe(200);
    expect(a.silences[0]![0]).toBe(0);
    expect(a.silences[0]![1]).toBeCloseTo(0.5, 1);
    expect(a.loudness.integrated).toBeLessThan(-5);
    tone(dir, "hot.wav", 440, 1, 6, true);
    expect((await scan(join(dir, "hot.wav"))).clipped).toBeGreaterThan(1000);
  });

  it("finds the quietest point between two times", () => {
    const rms = Array.from({ length: 100 }, (_, i) => (i >= 40 && i <= 44 ? 0.001 : 0.3));
    expect(quietestPoint(rms, 0.2, 0.8)).toBeCloseTo(0.425, 2);
  });

  it("ramps a duck in before the voice and out after it", () => {
    const expr = duckExpression([[1, 2], [2.3, 3]], -12, 0.25, 0.6);
    // the two phrases are closer than attack + release: one merged span
    expect(expr).toBe("-12*min(clip((t-0.75)/0.25,0,1),clip((3.6-t)/0.6,0,1))");
  });
});
