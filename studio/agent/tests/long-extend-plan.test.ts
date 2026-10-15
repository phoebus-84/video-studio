// pva_extend_episode plans a long soundtrack from a few music pieces: seeded,
// never the same piece twice in a row, ending exactly where the video does,
// and cut into chunks whose sample windows join without a gap or an overlap.

import { describe, expect, it } from "vitest";
import {
  CHUNK_SECONDS,
  MASTER,
  SAMPLE_RATE,
  chunkGraph,
  clipSamples,
  clipStartSample,
  combineLoudness,
  hoursLabel,
  levelGain,
  masterChain,
  planMusic,
  seedFrom,
  type Piece,
} from "../src/long-extend-plan.js";

const pieces: Piece[] = [
  { id: "flauto-1", source: "assets/sounds/flauto-1.ogg", region: [12, 206], measuredLufs: -18.4 },
  { id: "flauto-2", source: "assets/sounds/flauto-2.ogg", region: [0, 81.6], measuredLufs: -12.2 },
  { id: "flauto-3", source: "assets/sounds/flauto-3.ogg", region: [0, 67.6], measuredLufs: -13.8 },
  { id: "flauto-4", source: "assets/sounds/flauto-4.ogg", region: [0, 68.5], measuredLufs: -11.1 },
  { id: "flauto-6", source: "assets/sounds/flauto-6.ogg", region: [0, 37], measuredLufs: -11.7 },
];

describe("planMusic", () => {
  it("gives the same plan for the same seed, and another for another seed", () => {
    const a = planMusic(pieces, 3600, 42);
    expect(planMusic(pieces, 3600, 42)).toEqual(a);
    expect(planMusic(pieces, 3600, 43).clips.map((c) => c.piece)).not.toEqual(a.clips.map((c) => c.piece));
  });

  it("never plays the same piece twice in a row", () => {
    for (const seed of [1, 2, 3, 20261015, seedFrom("03-cahokia-notte")]) {
      const { clips } = planMusic(pieces, 36_000, seed);
      for (let i = 1; i < clips.length; i++) expect(clips[i]!.piece).not.toBe(clips[i - 1]!.piece);
    }
    // Two pieces can only alternate.
    const { clips } = planMusic(pieces.slice(0, 2), 3600, 7);
    for (let i = 1; i < clips.length; i++) expect(clips[i]!.piece).not.toBe(clips[i - 1]!.piece);
  });

  it("covers the duration exactly: starts at 0, joins by 3–6 s crossfades or 1–3 s gaps, ends on the last second", () => {
    for (const duration of [900, 3600, 7200, 36_000]) {
      const { clips } = planMusic(pieces, duration, 11);
      expect(clips[0]!.at).toBe(0);
      expect(clips[clips.length - 1]!.end).toBe(duration);
      for (let i = 1; i < clips.length; i++) {
        const t = clips[i]!.transition!;
        const join = clips[i]!.at - clips[i - 1]!.end;
        if (t.type === "crossfade") {
          expect(t.seconds).toBeGreaterThanOrEqual(3);
          expect(t.seconds).toBeLessThanOrEqual(6);
          expect(join).toBeCloseTo(-t.seconds, 2);
          expect(clips[i]!.fadeIn).toBeGreaterThanOrEqual(t.seconds);
          expect(clips[i - 1]!.fadeOut).toBeGreaterThanOrEqual(t.seconds);
        } else {
          expect(t.seconds).toBeGreaterThanOrEqual(1);
          expect(t.seconds).toBeLessThanOrEqual(3);
          expect(join).toBeCloseTo(t.seconds, 2);
        }
      }
      for (const c of clips) {
        expect(c.len).toBeCloseTo(c.out - c.in, 3);
        expect(c.end).toBeCloseTo(c.at + c.len, 3);
        expect(c.fadeIn + c.fadeOut).toBeLessThanOrEqual(c.len + 1e-6);
      }
    }
  });

  it("plays whole pieces mostly and sometimes a long section of one, inside its playable stretch", () => {
    const { clips } = planMusic(pieces, 36_000, 5);
    const byId = new Map(pieces.map((p) => [p.id, p]));
    const body = clips.slice(0, -1);
    const whole = body.filter((c) => c.in === byId.get(c.piece)!.region[0] && c.out === byId.get(c.piece)!.region[1]);
    expect(whole.length / body.length).toBeGreaterThan(0.6);
    expect(whole.length).toBeLessThan(body.length);
    for (const c of clips) {
      const [a, b] = byId.get(c.piece)!.region;
      expect(c.in).toBeGreaterThanOrEqual(a);
      expect(c.out).toBeLessThanOrEqual(b + 1e-6);
      if (c !== clips[clips.length - 1] && c.len < b - a) expect(c.len / (b - a)).toBeGreaterThanOrEqual(0.6 - 1e-3);
    }
  });

  it("levels every piece to the same loudness", () => {
    const { clips } = planMusic(pieces, 3600, 9);
    for (const c of clips) expect(pieces.find((p) => p.id === c.piece)!.measuredLufs + c.gainDb).toBeCloseTo(-18, 1);
    expect(levelGain(-60)).toBe(12);
    expect(levelGain(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("refuses what cannot make a soundtrack", () => {
    expect(() => planMusic(pieces.slice(0, 1), 3600, 1)).toThrow(/two music pieces/);
    expect(() => planMusic([pieces[0]!, { ...pieces[1]!, region: [0, 5] }], 3600, 1)).toThrow(/less than/);
  });
});

describe("chunks", () => {
  it("cut the soundtrack into sample windows that join exactly and hold every clip that sounds in them", () => {
    for (const duration of [3600, 3725.5, 36_000]) {
      const plan = planMusic(pieces, duration, 3);
      const { chunks, clips } = plan;
      expect(chunks.length).toBe(Math.ceil(duration / CHUNK_SECONDS));
      expect(chunks[0]!.startSample).toBe(0);
      expect(chunks[chunks.length - 1]!.endSample).toBe(Math.round(duration * SAMPLE_RATE));
      for (let k = 1; k < chunks.length; k++) expect(chunks[k]!.startSample).toBe(chunks[k - 1]!.endSample);
      for (const chunk of chunks) {
        expect(chunk.endSample - chunk.startSample).toBeLessThanOrEqual(CHUNK_SECONDS * SAMPLE_RATE);
        clips.forEach((c, i) => {
          const s = clipStartSample(c);
          const sounds = s < chunk.endSample && s + clipSamples(c) > chunk.startSample;
          expect(chunk.clips.includes(i)).toBe(sounds);
        });
      }
    }
  });

  it("place a clip that crosses a seam by its absolute sample on both sides", () => {
    const plan = planMusic(pieces, 3600, 3);
    const k = plan.chunks.findIndex((ch, i) => i > 0 && ch.clips.some((ci) => plan.chunks[i - 1]!.clips.includes(ci)));
    expect(k).toBeGreaterThan(0);
    const after = plan.chunks[k]!;
    const before = plan.chunks[k - 1]!;
    const ci = after.clips.find((i) => before.clips.includes(i))!;
    const c = plan.clips[ci]!;
    const lineOf = (graph: string, n: number) => graph.split(";\n")[n]!;
    const g0 = chunkGraph(plan, before, (s) => s, -6).graph;
    const g1 = chunkGraph(plan, after, (s) => s, -6).graph;
    const l0 = lineOf(g0, before.clips.indexOf(ci));
    const l1 = lineOf(g1, after.clips.indexOf(ci));
    const offset = clipStartSample(c) - after.startSample;
    expect(offset).toBeLessThan(0);
    expect(l1).toContain(`atrim=start_sample=${-offset}`);
    expect(l0).toContain(`adelay=delays=${clipStartSample(c) - before.startSample}S`);
    // Same decode, same processing up to the shift.
    const head = (l: string) => l.slice(l.indexOf("]") + 1, l.indexOf(",afade=t=out")).trim();
    expect(head(l0)).toBe(head(l1));
    expect(g1).toContain(`atrim=end_sample=${after.endSample - after.startSample},volume=-6dB,ebur128=peak=true[mix]`);
  });
});

describe("mastering", () => {
  it("combines measured parts by energy and keeps the highest peak", () => {
    expect(combineLoudness([{ seconds: 600, integrated: -20, truePeak: -5 }, { seconds: 600, integrated: -20, truePeak: -3 }])).toEqual({ integrated: -20, truePeak: -3 });
    const mixed = combineLoudness([{ seconds: 600, integrated: -20, truePeak: -5 }, { seconds: 600, integrated: -10, truePeak: -1 }]);
    expect(mixed.integrated).toBeCloseTo(10 * Math.log10((0.01 + 0.1) / 2), 6);
  });

  it("gains to -17 LUFS, limits only when the peaks need it, and fades in and out", () => {
    const quiet = masterChain({ integrated: -24, truePeak: -12 }, 3600);
    expect(quiet.gainDb).toBe(MASTER.lufs + 24);
    expect(quiet.limiter).toBe(false);
    expect(quiet.filter).toBe("volume=7dB,afade=t=in:st=0:d=3:curve=qsin,afade=t=out:st=3594:d=6:curve=qsin");
    const peaky = masterChain({ integrated: -24, truePeak: -4 }, 3600);
    expect(peaky.limiter).toBe(true);
    expect(peaky.filter).toContain("alimiter=limit=0.7943");
  });

  it("names the hours", () => {
    expect(hoursLabel(3600)).toBe("1");
    expect(hoursLabel(36_000)).toBe("10");
    expect(hoursLabel(900)).toBe("0.25");
  });
});
