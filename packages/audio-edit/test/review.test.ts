import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { place, renderRecipe, type Recipe } from "../src/index.js";
import { noise, pcm, tone, workdir } from "./helpers.js";

/** What the first review found (avg-8hs.5). */

let dir: string;
beforeEach(() => { dir = workdir(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const render = (recipe: Recipe, name = "out.wav") => renderRecipe(recipe, { root: dir, output: join(dir, name) });

describe("review fixes", () => {
  it("never gains a mix too short to measure, and says why", async () => {
    tone(dir, "blip.wav", 440, 0.2, -20);
    const result = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "blip.wav", at: 0 }] }], master: { loudness: -16 } });
    expect(result.normalization).toBe("none");
    expect(result.concerns.join("\n")).toMatch(/too short to measure its loudness/);
    expect(result.loudness.truePeak).toBeLessThan(-15);
  });

  it("moves an automation smoothly, not in steps of a frame", async () => {
    tone(dir, "a.wav", 440, 2);
    const result = await render({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0, automation: [[0, -40], [1, 0]] }] }] });
    const x = pcm(result.path, 0.1, 0.8);
    const per = 480;
    let worst = 0;
    let previous: number | null = null;
    for (let i = 0; i + per <= x.length; i += per) {
      let s = 0;
      for (let k = i; k < i + per; k++) s += x[k]! * x[k]!;
      const db = 10 * Math.log10(s / per);
      if (previous !== null) worst = Math.max(worst, Math.abs(db - previous));
      previous = db;
    }
    // 40 dB over 1 s is 0.4 dB per 10 ms: a step of a frame (~90 ms) would be 3.6 dB.
    expect(worst).toBeLessThan(1);
  });

  it("refuses crossfades that pile up, and a crossfade on a clip placed by time", () => {
    const three = (crossfade: number): Recipe => ({ output: {}, tracks: [{ id: "t", clips: [
      { id: "a", source: "x", at: 0 }, { id: "b", source: "x", at: "after", crossfade }, { id: "c", source: "x", at: "after", crossfade },
    ] }] });
    expect(() => place(three(0.8), { x: 1 })).toThrow(/\$\.tracks\[0\]\.clips\[2\]/);
    expect(place(three(0.2), { x: 1 }).map((p) => p.start)).toEqual([0, 0.8, 1.6]);
    expect(() => place({ output: {}, tracks: [{ id: "t", clips: [{ id: "a", source: "x", at: 0 }, { id: "b", source: "x", at: 2, crossfade: 0.1 }] }] }, { x: 1 })).toThrow(/crossfade.*"after"/);
  });

  it("hears a drop at a join of the voice even under loud music", async () => {
    tone(dir, "v.wav", 440, 2, -12);
    noise(dir, "m.wav", 4, -6);
    const result = await render({ output: {}, tracks: [
      { id: "voice", clips: [{ id: "a", source: "v.wav", out: 1, at: 0 }, { id: "b", source: "v.wav", in: 1, at: "after", crossfade: 0.02, gain: -9 }] },
      { id: "music", clips: [{ id: "m", source: "m.wav", at: 0 }] },
    ] });
    const join = result.joins.find((j) => j.track === "voice")!;
    expect(join.jumpDb!).toBeCloseTo(-9, 0);
  });

  it("refuses an mp3 at a rate mp3 cannot carry", async () => {
    tone(dir, "a.wav", 440, 1);
    await expect(render({ output: { sampleRate: 96000 }, tracks: [{ id: "t", clips: [{ id: "a", source: "a.wav", at: 0 }] }] }, "out.mp3")).rejects.toMatchObject({ code: "bad-recipe" });
  });
});
