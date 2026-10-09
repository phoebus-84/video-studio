// toolbox@1.0.0 — released: never edit this file; add toolbox/<next>.ts instead.
//
// What a series' compiler or validator needs and should not rewrite (avg-d1x,
// phase 3): the helpers today's compilers each carry a copy of. A compiler in
// a series release imports it by version, `@studio/series/toolbox/1.0.0`, and
// `vpr template seal` inlines it into the release's bundle, so the release
// keeps this exact behaviour whatever later versions do.

import type { CompileProblem, EditTimeline } from "../types.js";

/** Whole frames for a time in seconds, rounded to the nearest. */
export const frames = (seconds: number, fps: number): number => Math.round(seconds * fps);

/** A time or measure to the millisecond: what a timeline stores, so a rebuild writes the same text. */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A string's words, split on whitespace. */
export const tokens = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * A word as it is compared with what the voice said: lower case in its
 * language, accents and punctuation gone ("Perché," → "perche").
 */
export const normalizeWord = (word: string, locale = "it-IT"): string =>
  word.toLocaleLowerCase(locale).normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");

/** Deterministic noise in [0, 1) for an integer: the same blinks, sways and scatter on every build. */
export const noise = (i: number): number => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A plain object (not null, not an array). */
export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Items into the fewest lanes where none overlaps another: each goes into the
 * first lane whose last item ends before it starts. A track holds one lane:
 * a timeline's tracks never have overlaps.
 */
export function lanes<T extends { from: number; duration: number }>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const item of [...items].sort((a, b) => a.from - b.from)) {
    const lane = out.find((l) => l[l.length - 1]!.from + l[l.length - 1]!.duration <= item.from);
    if (lane) lane.push(item);
    else out.push([item]);
  }
  return out;
}

export interface SpokenWord {
  text: string;
  start: number;
  end: number;
}

/**
 * The `n`th time (1-based) a take says `word`, from its measured words, or
 * null. A word matches when it normalizes to the same, or one of its parts
 * around an apostrophe does («L'Italia» answers "italia"); with `prefix`, a
 * word that starts with it matches when none matches whole.
 */
export function findWord(
  words: readonly SpokenWord[],
  word: string,
  options: { n?: number; locale?: string; prefix?: boolean } = {},
): { word: SpokenWord; found: number } | { word: null; found: number } {
  const n = options.n ?? 1;
  const want = normalizeWord(word, options.locale);
  if (want === "") return { word: null, found: 0 };
  const same = (text: string) => normalizeWord(text, options.locale) === want || text.split(/['’]/).some((part) => normalizeWord(part, options.locale) === want);
  let hits = words.filter((w) => same(w.text));
  if (hits.length === 0 && options.prefix) hits = words.filter((w) => normalizeWord(w.text, options.locale).startsWith(want));
  return { word: hits[n - 1] ?? null, found: hits.length };
}

/** A problem located in the spec, as compileSpec reports it. */
export const problem = (code: string, path: string, message: string): CompileProblem => ({ code, path, message });

/** The kits a timeline draws with, once each, as `name@version`: what a release must pin or the application must have. */
export function kitsOf(timeline: Pick<EditTimeline, "tracks">): string[] {
  const seen = new Set<string>();
  for (const track of timeline.tracks) {
    for (const item of track.items as { kit?: { name: string; version: string } }[]) {
      if (item.kit) seen.add(`${item.kit.name}@${item.kit.version}`);
    }
  }
  return [...seen].sort();
}
