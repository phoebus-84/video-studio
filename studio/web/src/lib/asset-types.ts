/** An immutable generated asset attempt. */
export interface AssetAttempt {
  id: string;
  sceneId: string;
  /** Asset type: image, video, or audio narration. */
  kind: "image" | "audio" | "video";
  /**
   * Primary generation input. Image: the intent prompt. Audio: the narration
   * text. Empty string means "no input recorded", never a fabricated summary.
   */
  prompt: string;
  /** TTS voice/style instruction (audio only). Null when none recorded. */
  instruct: string | null;
  referenceImages: string[];
  /** Provider name when known from provenance records, else null (hidden). */
  provider: string | null;
  /** Model identifier when known, else null (hidden). */
  model: string | null;
  seed: number | null;
  /** Pixel dimensions for image/video; null when unknown (audio, unprobed). */
  dimensions: { width: number; height: number } | null;
  /** Duration in seconds for audio/video media; null otherwise. */
  durationSeconds: number | null;
  /** File size in bytes when known. */
  fileSize: number | null;
  cost: number | null;
  license: string;
  /** Real file mtime from disk; null when the file does not exist. */
  createdAt: string | null;
  selected: boolean;
  /** Public URL for the generated image (served by gateway). */
  imageUrl: string | null;
  /** Public URL for video files (served by gateway). */
  videoUrl: string | null;
  /** Public URL for audio narration WAV (served by gateway). */
  audioUrl: string | null;
  /** Local file path relative to the episode asset directory. */
  filePath: string | null;
  /** Whether the file is available on disk. */
  fileAvailable: boolean;
  /** Asset generation state. */
  state: "ready" | "generating" | "failed" | "idle";
  /** Review anchor type for regeneration. */
  anchorType: "assets" | "narration";
}

export interface AssetGroup {
  sceneId: string;
  sceneTitle: string;
  attempts: AssetAttempt[];
}
