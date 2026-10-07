// stage-math@1.0.0 — released: never edit this file; add stage-math/<next>.ts instead (ADR-0039).
// The small maths every stage kit animates with, rewritten from CreativeStudio's
// stages: easing curves, ramps and windows over seconds, a deterministic noise,
// and the Envelope a compiler writes into props.

export const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, Number.isFinite(x) ? x : 0));
/** Smoothstep: the titles' and the glass' easing. */
export const smoothstep = (x: number): number => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
/** Smootherstep: the stage's easing (hall, camera, actor, verses). */
export const ease = (x: number): number => {
  const v = clamp(x);
  return v * v * v * (v * (v * 6 - 15) + 10);
};
/** 0 → 1 between seconds a and b, eased. */
export const ramp = (t: number, a: number, b: number): number => ease((t - a) / (b - a));
/** In over 0.9 s from a, out over 0.9 s before b. */
export const pulse = (t: number, a: number, b: number): number => ramp(t, a, a + 0.9) * (1 - ramp(t, b - 0.9, b));
/** In over d from a, out over d before b. */
export const win = (t: number, a: number, b: number, d = 0.3): number => ramp(t, a, a + d) * (1 - ramp(t, b - d, b));
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Deterministic noise in [0, 1). */
export const rnd = (i: number): number => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};
/** A second deterministic noise, for what must not move with `rnd`. */
export const rnd2 = (i: number): number => {
  const x = Math.sin(i * 91.7 + 3.1) * 43758.5453;
  return x - Math.floor(x);
};

/** A value that rises over rampIn from `from`, holds, and falls over rampOut to `to`. Seconds from the item's start. */
export interface Envelope {
  from: number;
  to: number;
  rampIn: number;
  rampOut: number;
  amount: number;
}

export const envelope = (t: number, e: Envelope): number =>
  e.amount * ramp(t, e.from, e.from + e.rampIn) * (1 - ramp(t, e.to - e.rampOut, e.to));
export const sumOf = (t: number, es: readonly Envelope[]): number => es.reduce((s, e) => s + envelope(t, e), 0);
export const maxOf = (t: number, es: readonly Envelope[]): number => es.reduce((m, e) => Math.max(m, envelope(t, e)), 0);
