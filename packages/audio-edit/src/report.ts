// What a join sounds like, measured on the output: a click (a sample step far
// above the signal's own motion right there) and a level jump (short-term
// RMS just before against just after, the crossfade excluded).

import { spawn } from "node:child_process";
import { FFMPEG } from "./media.js";
import type { Placement } from "./types.js";

export interface JoinReport {
  track: string;
  before: string;
  after: string;
  /** On the output. */
  at: number;
  click: boolean;
  /** dB, after minus before; null when either side is silence. */
  jumpDb: number | null;
}

async function samples(file: string, from: number, seconds: number, sampleRate: number): Promise<Float32Array> {
  const ff = spawn(FFMPEG(), ["-hide_banner", "-v", "error", "-ss", String(Math.max(0, from)), "-t", String(seconds), "-i", file, "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "ignore"] });
  const chunks: Buffer[] = [];
  for await (const c of ff.stdout as AsyncIterable<Buffer>) chunks.push(c);
  const buf = Buffer.concat(chunks);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

const rmsDb = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  const lo = Math.max(0, a);
  const hi = Math.min(x.length, b);
  for (let i = lo; i < hi; i++) s += x[i]! * x[i]!;
  const r = hi > lo ? Math.sqrt(s / (hi - lo)) : 0;
  return r < 1e-4 ? null : 20 * Math.log10(r);
};

/** Each join between consecutive clips of a track: where the next clip starts. */
export async function joinReport(file: string, placements: Placement[], sampleRate: number): Promise<JoinReport[]> {
  const out: JoinReport[] = [];
  const byTrack = new Map<string, Placement[]>();
  for (const p of placements) byTrack.set(p.track, [...(byTrack.get(p.track) ?? []), p]);
  for (const [track, clips] of byTrack) {
    const ordered = [...clips].sort((a, b) => a.start - b.start);
    for (let k = 1; k < ordered.length; k++) {
      const prev = ordered[k - 1]!;
      const next = ordered[k]!;
      if (next.start > prev.end + 0.05) continue; // a gap: not a join
      const at = next.start;
      const window = 0.35;
      const x = await samples(file, at - window, 2 * window + Math.max(0, prev.end - next.start), sampleRate);
      const centre = Math.round(Math.min(window, at) * sampleRate);
      // Click: the largest step within ±3 ms of the join, against the steps of the 50 ms around it.
      const near = Math.round(0.003 * sampleRate);
      const around = Math.round(0.05 * sampleRate);
      let step = 0;
      for (let i = centre - near; i < centre + near; i++) if (i > 0 && i < x.length) step = Math.max(step, Math.abs(x[i]! - x[i - 1]!));
      let motion = 0;
      let n = 0;
      for (let i = centre - around; i < centre + around; i++) {
        if (i > 0 && i < x.length && Math.abs(i - centre) > near) { motion += Math.abs(x[i]! - x[i - 1]!); n++; }
      }
      const typical = n ? motion / n : 0;
      const click = step > 0.05 && step > 12 * Math.max(typical, 1e-4);
      const overlap = Math.round(Math.max(0, prev.end - next.start) * sampleRate);
      const span = Math.round(0.3 * sampleRate);
      const before = rmsDb(x, centre - span, centre);
      const after = rmsDb(x, centre + overlap, centre + overlap + span);
      out.push({ track, before: prev.clip, after: next.clip, at, click, jumpDb: before === null || after === null ? null : Math.round((after - before) * 10) / 10 });
    }
  }
  return out;
}
