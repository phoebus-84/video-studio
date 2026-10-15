/**
 * TypeScript bindings generated from audio-edit.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/audio-edit.schema.json
 * Auto-generated — do not edit directly.
 */

export type Hash = string;

export type Path = string;

export interface Placement {
  track: string;
  clip: string;
  source: Path;
  in: number;
  out: number;
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
  /** The take the clip was cut from, when its source is one. */
  take?: string;
}

export interface AudioEdit {
  apiVersion: "studio.video/v1alpha1";
  kind: "AudioEdit";
  /** As it was given: sources may name takes, cuts may name words, pauses may be reshaped. */
  recipe: Record<string, unknown>;
  /** The time-only recipe it became (@av/audio-edit's Recipe), sources as workspace paths. */
  resolved: Record<string, unknown>;
  /** Every file read, by its path, with its hash. */
  inputs: Record<string, Hash>;
  output: {
    path: Path;
    hash: Hash;
    durationSeconds: number;
  };
  placements: Placement[];
  report: {
    loudness: {
    integrated: number | null;
    range: number | null;
    truePeak: number | null;
  };
    normalization: "none" | "gain" | "gain+limiter";
    clipped: number;
    headTrim: number;
    joins: Record<string, unknown>[];
    concerns: string[];
  };
  /** The output's words, carried from the timings of the takes it was cut from, in output order. */
  words?: {
    text: string;
    start: number;
    end: number;
  }[];
  /** The pauses the edit reshaped: after which word of which take, how long it was, how long it is, and where it falls on the output. */
  pauses?: {
    take: string;
    word: string;
    before: number;
    after: number;
    at: number;
  }[];
  createdAt: string;
}
