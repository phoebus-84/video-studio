// Type declarations for cue resolution (avg-7zp.2).
// The Cue type itself is generated from the schema into bindings/ts/cue.ts.

import type { WordTiming } from "../bindings/ts/word-timing.ts";

export type CueProblemCode = "invalid-cue" | "unknown-word" | "unknown-line" | "unknown-mark" | "before-start";

export interface CueProblem {
  code: CueProblemCode;
  message: string;
}

/** One take placed in the episode. `timing` must already pass validateWordTiming. */
export interface CueScope {
  timing: WordTiming;
  /** Where the take starts in the episode, in seconds (>= 0). */
  startSeconds: number;
  /** Frames per second of the episode (a positive integer). */
  fps: number;
  /** Named marks supplied by the series compiler, in seconds of the take. */
  marks?: Record<string, number>;
}

/** Lower-case, no accents, letters and digits only: "Perché," → "perche". */
export declare function normalizeWord(text: string): string;

/**
 * Resolve one cue to an absolute frame. Data problems are returned; a scope
 * with a non-integer fps or a negative startSeconds throws TypeError.
 */
export declare function resolveCue(
  cue: unknown,
  scope: CueScope,
): { frame: number; seconds: number } | { problem: CueProblem };

/** Resolve every cue a series compiler collected, reporting each problem with its path. */
export declare function resolveCues(entries: { path: string; cue: unknown; scope: CueScope }[]): {
  frames: Record<string, number>;
  problems: (CueProblem & { path: string })[];
};
