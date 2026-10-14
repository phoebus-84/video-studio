// A recipe for one audio file: clips of other files placed on tracks, mixed,
// mastered. Times are seconds; gains are dB. Everything here is time-only:
// anchoring a cut on a word is the caller's work (the studio resolves words
// to seconds before calling).

export interface Clip {
  id: string;
  /** The source file, relative to the recipe's root (or absolute inside it). */
  source: string;
  /** Where the clip starts and ends in its source. Default: the whole file. */
  in?: number;
  out?: number;
  /** Where it starts on the output: seconds, or "after" the previous clip of its track (minus that join's crossfade). */
  at: number | "after";
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Overlap with the previous clip of its track, both faded at constant power over it. */
  crossfade?: number;
  /** A gain curve in dB over the clip: [seconds from the clip's start, dB] points, linear between them, held at the ends. */
  automation?: [number, number][];
}

export interface Duck {
  /** The track whose clips push this one down while they play. */
  under: string;
  /** How much, in dB (a negative number). */
  gain: number;
  attack?: number;
  release?: number;
}

export interface Track {
  id: string;
  gain?: number;
  clips: Clip[];
  duck?: Duck;
}

export interface Master {
  gain?: number;
  /** Integrated loudness target, LUFS (EBU R128, two passes). */
  loudness?: number;
  /** True-peak ceiling, dBTP. Default -1 when loudness is set. */
  truePeak?: number;
  /** At most this much silence is kept at the head and at the tail. */
  trim?: { head?: number; tail?: number };
  fadeIn?: number;
  fadeOut?: number;
}

export interface Recipe {
  output: { sampleRate?: number; channels?: 1 | 2 };
  tracks: Track[];
  master?: Master;
}

/** A clip where it ended up. */
export interface Placement {
  track: string;
  clip: string;
  source: string;
  /** In its source. */
  in: number;
  out: number;
  /** On the output, before the master's head trim. */
  start: number;
  end: number;
  /** Its fades as applied, a crossfade included. */
  fadeIn: number;
  fadeOut: number;
}
