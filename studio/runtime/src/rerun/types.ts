// ---------------------------------------------------------------------------
// Rerun planner types
// ---------------------------------------------------------------------------

/** Supported rerun modes. */
export type RerunMode =
  | "retry-current"
  | "rerun-selected"
  | "rerun-affected-downstream"
  | "full-rebuild";

/** A single stage in a rerun plan. */
export interface RerunStageEntry {
  stageId: string;
  /** Action to take. */
  action: "rerun" | "preserve" | "cancel";
  /** Reason for the action. */
  reason: string;
  /**
   * A unitless relative weight derived from this stage's prior attempts —
   * NOT money. See `stageWeight` in ./planner.ts. No surface may render it
   * with a currency symbol; nothing in this repo has ever priced a stage.
   */
  estimatedCost: number;
  /** Whether prior artifacts will be preserved. */
  preservesArtifacts: boolean;
  /** Whether a provider job is in-flight for this stage. */
  inFlight: boolean;
  /** In-flight provider job ID (if any). */
  inFlightJobId?: string;
}

/** A complete rerun plan. */
export interface RerunPlan {
  /** Episode slug. */
  episodeSlug: string;
  /** Rerun mode used. */
  mode: RerunMode;
  /** Stages in the plan. */
  stages: RerunStageEntry[];
  /**
   * The sum of the re-run stages' `estimatedCost` weights — unitless, and
   * not a spend estimate. See `stageWeight` in ./planner.ts.
   */
  totalEstimatedCost: number;
  /** Stages whose prior work is preserved. */
  preservedStageIds: string[];
  /** Stages that will be re-executed. */
  rerunStageIds: string[];
  /** Whether any in-flight provider jobs need resumption. */
  hasInFlightJobs: boolean;
  /** When this plan was generated. */
  generatedAt: string;
}

/** Recovery state after a crash. */
export interface RecoveryState {
  /** Episode slug. */
  episodeSlug: string;
  /** Stages that were in "running" state at crash time. */
  inFlightStages: string[];
  /** Lease IDs that need release. */
  staleLeases: string[];
  /** Provider job IDs that may need resumption. */
  inFlightProviderJobs: string[];
  /** Whether recovery can proceed safely. */
  recoverable: boolean;
  /** Recovery action required. */
  action: "resume" | "abandon" | "none";
}
