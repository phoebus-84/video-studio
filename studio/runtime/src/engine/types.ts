// ---------------------------------------------------------------------------
// Stage engine types
// ---------------------------------------------------------------------------

import type { ResolvedPipeline } from "../pipeline/types.js";

/** The states a stage can be in. */
export type StageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

/** A single attempt at executing a stage. */
export interface StageAttempt {
  /** Monotonic attempt number (1-based). */
  number: number;
  /** Lease ID acquired for this attempt. */
  leaseId: string;
  /** When this attempt started. */
  startedAt: string;
  /** When this attempt ended (if completed or failed). */
  endedAt?: string;
  /** Outcome: succeeded, failed, or timed out. */
  outcome?: "success" | "failure" | "timeout";
  /** Error details if failed. */
  error?: string;
  /** Whether this failure is retryable. */
  retryable?: boolean;
}

/** Full state for a single stage in an episode. */
export interface StageInstance {
  /** Stage ID from the pipeline definition. */
  stageId: string;
  /** Human-readable name. */
  name: string;
  /** Current status. */
  status: StageStatus;
  /** All attempts (most recent last). */
  attempts: StageAttempt[];
  /** Reference to ephemeral output artifacts. */
  outputArtifacts: string[];
  /** When this stage instance was first created. */
  createdAt: string;
}

/** Execution context for the stage engine. */
export interface ExecutionContext {
  /** Episode slug being executed. */
  episodeSlug: string;
  /** The resolved pipeline that defines stages and their order. */
  pipeline: ResolvedPipeline;
  /** Current instances keyed by stage ID. */
  stages: Map<string, StageInstance>;
}

/** Configuration for the stage engine. */
export interface EngineConfig {
  /** Maximum attempts per stage (default 3). */
  maxAttempts: number;
  /** Lease TTL in milliseconds (default 5 minutes). */
  leaseTtlMs: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  maxAttempts: 3,
  leaseTtlMs: 5 * 60 * 1000,
};

/** Result of a stage transition. */
export interface StageTransition {
  stageId: string;
  from: StageStatus;
  to: StageStatus;
  attemptNumber: number;
  leaseId?: string;
}

/** Valid transitions for the stage state machine. */
export const VALID_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  pending: ["running"],
  running: ["completed", "failed"],
  // Deliberately diverges from a single-run reading: this table is also the
  // one an execution service consults, and the journal it replays is
  // cumulative across runs. Re-running a completed stage is a first-class
  // operation — rerun/planner.ts exists to plan it — so `completed` is not the
  // end of the stage's life, only of that attempt. Mirrors the same allowance
  // in @studio/contracts' execution-state replay; if you are tempted to
  // "restore" completed: [], read that module's table comment first. The two
  // tables are pinned equal by
  // studio/runtime/test/unit/engine/transition-table-agreement.test.ts.
  completed: ["pending"],
  failed: ["pending"], // retry resets to pending
};
