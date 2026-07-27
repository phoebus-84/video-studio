/** A scene in the production timeline. */
export interface SceneSummary {
  id: string;
  index: number;
  title: string;
  durationSeconds: number;
  role: SceneRole;
  intent: string;
  /** Selected asset identity, or null if none. */
  selectedAssetId: string | null;
  /** Total immutable attempts for this scene. */
  attemptCount: number;
  narrationStatus: "ready" | "missing" | "stale" | "generating";
  captionStatus: "ready" | "missing" | "stale";
  transitionFrom: TransitionType | null;
  stale: boolean;
}

export type SceneRole =
  | "opener"
  | "explanation"
  | "demonstration"
  | "comparison"
  | "summary"
  | "outro";

export type TransitionType = "cut" | "dissolve" | "wipe" | "slide";

export const ROLE_LABELS: Record<SceneRole, string> = {
  opener: "Opener",
  explanation: "Explanation",
  demonstration: "Demo",
  comparison: "Comparison",
  summary: "Summary",
  outro: "Outro",
};

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  cut: "Cut",
  dissolve: "Dissolve",
  wipe: "Wipe",
  slide: "Slide",
};
