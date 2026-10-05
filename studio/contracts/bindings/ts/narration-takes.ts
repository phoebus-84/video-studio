/**
 * TypeScript bindings generated from narration-takes.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/narration-takes.schema.json
 * Auto-generated — do not edit directly.
 */

export type ContentHash = string;

export type LocalId = string;

export interface AudioRef {
  path: string;
  hash: ContentHash;
  durationSeconds: number;
}

export interface Voice {
  /** Open vocabulary, e.g. elevenlabs, qwen3-tts-local. */
  provider: string;
  model?: string;
  voiceId?: string;
  /** Provider parameters, recorded as sent. */
  settings?: Record<string, unknown>;
  /** An instruction sent separately from the text, e.g. Qwen's composed direction. */
  direction?: string;
}

export interface FileRef {
  path: string;
  hash: ContentHash;
}

export interface TakeSource {
  segmentId?: string;
  attemptId?: string;
}

export interface Take {
  id: LocalId;
  audio: AudioRef;
  /** The written text: on screen, matched by cues, reproduced by the take's WordTiming. */
  text: string;
  /** Exactly what the tool received, in its own format (tags, pronunciation spellings…). */
  spokenText?: string;
  role?: string;
  language?: string;
  voice: Voice;
  /** The take's WordTiming file. */
  timing?: FileRef;
  source?: TakeSource;
}

export interface Hold {
  afterWord: string;
  n?: number;
  seconds: number;
  reason: string;
}

export interface SequenceEntry {
  take: LocalId;
  /** Seconds of silence before this take; required from the second entry on, forbidden on the first. */
  pauseBefore?: number;
  holds?: Hold[];
}

export interface Unit {
  id: LocalId;
  /** JSON path into the spec. */
  source?: string;
  sequence: SequenceEntry[];
}

export interface NarrationTakes {
  apiVersion: "studio.video/v1alpha1";
  kind: "NarrationTakes";
  takes: Take[];
  units: Unit[];
  metadata?: Record<string, unknown>;
}
