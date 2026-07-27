/** Narration status for a single TTS segment. */
export type NarrationSegmentStatus =
  | "ready"
  | "generating"
  | "missing"
  | "failed"
  | "stale";

export interface NarrationSegment {
  id: string;
  sceneId: string;
  text: string;
  durationSeconds: number | null;
  status: NarrationSegmentStatus;
  attemptCount: number;
  /** Whether the local audio file exists. */
  fileAvailable: boolean;
}

export interface VoiceProfile {
  id?: string;
  name: string;
  modelSize: "0.6B" | "1.7B" | string;
  installed: boolean;
  sampleRate?: number;
}

export const STATUS_SYMBOLS: Record<NarrationSegmentStatus, string> = {
  ready: "✓",
  generating: "◎",
  missing: "—",
  failed: "✗",
  stale: "⚠",
};
