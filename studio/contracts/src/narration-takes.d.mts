// Type declarations for narration takes (avg-7zp.4).
// The document types are generated from the schema into bindings/ts/narration-takes.ts.

import type { NarrationTakes } from "../bindings/ts/narration-takes.ts";
import type { WordTiming } from "../bindings/ts/word-timing.ts";
import type { CueTiming } from "./cues.mjs";

export type NarrationTakesProblemCode =
  | "schema"
  | "duplicate-id"
  | "unknown-take"
  | "bad-pause"
  | "missing-timing"
  | "timing-mismatch"
  | "bad-hold";

export interface NarrationTakesProblem {
  code: NarrationTakesProblemCode;
  message: string;
  path: string;
}

/** Every problem in `doc`; an empty array means the document is valid. */
export declare function validateNarrationTakes(doc: unknown): NarrationTakesProblem[];

/** One stretch of a take's audio, placed in the unit. Seconds. */
export interface LayoutPiece {
  take: string;
  /** Where the piece starts, from the start of the unit. */
  at: number;
  /** Where in the take's audio the piece starts. */
  from: number;
  duration: number;
}

export interface UnitLayout {
  durationSeconds: number;
  pieces: LayoutPiece[];
  /** The unit's words and lines in unit time: what cues resolve against. */
  timing: CueTiming;
  /** Present only when every take has energy at one rate. */
  energy?: { rate: number; values: number[] };
}

/**
 * Lay out one unit. `doc` must pass validateNarrationTakes; `timings` maps take id
 * to its valid WordTiming. Throws RangeError for a unit that does not exist.
 */
export declare function layoutUnit(
  doc: NarrationTakes,
  unitId: string,
  timings: Record<string, WordTiming>,
): { layout: UnitLayout } | { problems: NarrationTakesProblem[] };
