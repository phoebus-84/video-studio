// ---------------------------------------------------------------------------
// Rerun planner types
// ---------------------------------------------------------------------------

import type { StalenessReport } from "../staleness/types.js";
import type { StageInstance } from "../engine/types.js";

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
  /** Estimated cost (from prior attempts or default). */
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
  /** Total estimated cost for the rerun. */
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
