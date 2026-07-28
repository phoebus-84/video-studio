/** A scene in the production timeline. */
export interface SceneSummary {
  id: string;
  index: number;
  title: string;
  durationSeconds: number;
  role: SceneRole | string;
  intent: string;
  /** Selected asset identity, or null if none. */
  selectedAssetId: string | null;
  /** Total immutable attempts for this scene. */
  attemptCount: number;
  /** Current scene status. */
  status: "idle" | "completed" | "in-progress";
  narrationStatus: "idle" | "ready" | "completed" | "missing" | "stale" | "generating";
  captionsStatus: "idle" | "ready" | "completed" | "missing" | "stale";
  transition: TransitionType | string | null;
  stale: boolean;
  /** Enriched fields from gateway Phase 1 */
  assetUrl?: string | null;
  narrationUrl?: string | null;
  narrationDuration?: number;
}

export type SceneRole =
  | "opener"
  | "explanation"
  | "demonstration"
  | "comparison"
  | "summary"
  | "outro"
  | "narrator"
  | "girl"
  | "wolf"
  | "woodcutter"
  | "grandmother";

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
