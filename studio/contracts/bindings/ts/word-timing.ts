/**
 * TypeScript bindings generated from word-timing.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/word-timing.schema.json
 * Auto-generated — do not edit directly.
 */

export type ContentHash = string;

export type Seconds = number;

export type Unit = number;

export interface TakeRef {
  id: string;
  /** The narration segment and attempt this take belongs to, when it came from the narration manifest. */
  source?: {
    segmentId?: string;
    attemptId?: string;
  };
}

export interface AudioRef {
  path: string;
  hash: ContentHash;
  durationSeconds: number;
}

export interface Alignment {
  /** Open vocabulary, e.g. elevenlabs, whisper-cpp. */
  provider: string;
  model?: string;
  /** forced: aligned against known text; asr: transcribed and snapped to the text; derived: carried through an audio edit from the timings of the takes it was cut from (avg-8hs.5). */
  method: "forced" | "asr" | "derived";
  createdAt: string;
}

export interface Word {
  /** The written token, as on screen: one token, no whitespace, so word index equals token index. */
  text: string;
  /** How the token was pronounced, only where it differs from text. */
  spoken?: string;
  start: Seconds;
  end: Seconds;
  confidence?: Unit;
}

export interface Line {
  id: string;
  firstWord: number;
  lastWord: number;
  speaker?: string;
}

export type SpeechSpan = [Seconds, Seconds];

export interface Energy {
  /** Samples per second, independent of any timeline fps. */
  rate: number;
  values: Unit[];
}

export interface WordTiming {
  apiVersion: "studio.video/v1alpha1";
  kind: "WordTiming";
  take: TakeRef;
  audio: AudioRef;
  /** The written text the words reproduce. */
  text: string;
  /** The text sent to the TTS, when it differs from text. */
  spokenText?: string;
  language: string;
  alignment: Alignment;
  words: Word[];
  lines?: Line[];
  speech?: SpeechSpan[];
  energy?: Energy;
  metadata?: Record<string, unknown>;
}
