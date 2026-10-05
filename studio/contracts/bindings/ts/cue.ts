/**
 * TypeScript bindings generated from cue.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/cue.schema.json
 * Auto-generated — do not edit directly.
 */

export type WordPattern = string;

export type Offset = number;

export type At = "start" | "end";

export interface WordCue {
  word: WordPattern;
  /** Which occurrence, counted from 1. */
  n?: number;
  at?: At;
  offset?: Offset;
}

export interface LineCue {
  /** Line (verse) number, counted from 1. */
  line: number;
  at?: At;
  offset?: Offset;
}

export interface TakeCue {
  /** start is 0; end is the end of the last spoken word. */
  take: "start" | "end";
  offset?: Offset;
}

export interface MarkCue {
  /** A named mark supplied by the series compiler, e.g. picture:2. */
  mark: string;
  offset?: Offset;
}

export type Cue = WordPattern | number | WordCue | LineCue | TakeCue | MarkCue;
