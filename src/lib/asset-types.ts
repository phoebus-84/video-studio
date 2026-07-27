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
  /** Local file path relative to the episode asset directory. */
  filePath: string;
  /** Whether the file is available on disk. */
  fileAvailable: boolean;
}

export interface AssetGroup {
  sceneId: string;
  sceneTitle: string;
  attempts: AssetAttempt[];
}
