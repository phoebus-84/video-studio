/** An immutable generated asset attempt. */
export interface AssetAttempt {
  id: string;
  sceneId: string;
  /** Asset type: image, video, or audio narration. */
  kind: "image" | "audio" | "video";
  prompt: string;
  referenceImages: string[];
  provider: string;
  model: string;
  seed: number | null;
  dimensions: { width: number; height: number };
  cost: number | null;
  license: string;
  createdAt: string;
  selected: boolean;
  /** Public URL for the generated image (served by gateway). */
  imageUrl: string | null;
  /** Public URL for video terminal recordings (served by gateway). */
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
