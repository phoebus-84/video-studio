/** An immutable generated asset attempt. */
export interface AssetAttempt {
  id: string;
  sceneId: string;
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
  /** Local file path relative to the episode asset directory. */
  filePath: string | null;
  /** Whether the file is available on disk. */
  fileAvailable: boolean;
  /** Asset generation state. */
  state: "ready" | "generating" | "failed" | "idle";
}

export interface AssetGroup {
  sceneId: string;
  sceneTitle: string;
  attempts: AssetAttempt[];
}
