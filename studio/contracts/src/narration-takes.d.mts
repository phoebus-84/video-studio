// Type declarations for narration takes (avg-7zp.4).
// The document types are generated from the schema into bindings/ts/narration-takes.ts.

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
