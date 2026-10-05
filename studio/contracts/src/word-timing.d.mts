// Type declarations for the word timing checks (avg-7zp.1).
// The document types are generated from the schema into bindings/ts/word-timing.ts.

import type { WordTiming } from "../bindings/ts/word-timing.ts";

export declare const WORD_OVERLAP_TOLERANCE_SECONDS: number;
export declare const DURATION_TOLERANCE_SECONDS: number;
export declare const ENERGY_LENGTH_TOLERANCE_SAMPLES: number;

export type WordTimingProblemCode =
  | "schema"
  | "audio-mismatch"
  | "word-order"
  | "out-of-range"
  | "text-mismatch"
  | "bad-line"
  | "speech-order"
  | "energy-length";

/** One problem, located by a JSON path such as `$.words[12].start`. */
export interface WordTimingProblem {
  code: WordTimingProblemCode;
  message: string;
  path: string;
}

/**
 * Every problem in `doc`; an empty array means the timing is valid. Pass the
 * real hash of the audio file as `audioHash` to reject timing made for another take.
 */
export declare function validateWordTiming(doc: unknown, options?: { audioHash?: string }): WordTimingProblem[];

export interface LineSpan {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

/** Start, end and text of `doc.lines[index]`, derived from its words. Throws RangeError for a missing line. */
export declare function lineSpan(doc: WordTiming, index: number): LineSpan;
