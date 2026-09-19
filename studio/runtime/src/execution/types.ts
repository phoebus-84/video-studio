// ---------------------------------------------------------------------------
// Execution service types
// ---------------------------------------------------------------------------

import type { ResolvedStage } from "../pipeline/types.js";
import type { Result } from "../result.js";

/** Which episode a call is about. */
export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/** What a stage's work needs in order to do it. */
export interface DispatchContext {
  /** Absolute path to the episode directory. */
  episodeDir: string;
  ref: EpisodeRef;
  /** Attempt number this dispatch belongs to, for logging and idempotency. */
  attemptNumber: number;
  log: (message: string) => void;
}

/**
 * Whatever actually performs a stage's work.
 *
 * Injected rather than owned: the service leases, gates, validates and records,
 * and what happens inside a stage is not its business. The gateway injects its
 * handlers, the agent path injects Pi, tests inject a fake. Keeping this a port
 * is what lets the service exist without absorbing the adapter registry.
 *
 * Returns the paths it wrote, absolute or relative to the episode directory.
 */
export interface StageDispatcher {
  dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]>;
}

/** A budget reservation, opaque to the service. */
export interface Reservation {
  reserveId: string;
  estimatedCost: number;
}

/**
 * Whether a stage may spend.
 *
 * Absence is refusal: a service with no guard does not run stages that could
 * cost money. "Missing budget reservations fail closed" is met by construction
 * rather than by remembering to check.
 */
export interface BudgetGuard {
  maySpend(stage: ResolvedStage, ctx: DispatchContext): Promise<Result<Reservation, { code: string; message: string }>>;
}

/** Why a call ended the way it did. */
export type OutcomeStatus =
  /** The stage ran and its declared outputs hold up. */
  | "completed"
  /** The stage ran and did not produce what it declared, or threw. Retryable. */
  | "failed"
  /** The stage never started. Someone else's condition to clear. */
  | "blocked"
  /** Nothing was selectable — every stage is done, or none is runnable. */
  | "idle";

export interface StageOutcome {
  /** Null when nothing was selected. */
  stageId: string | null;
  status: OutcomeStatus;
  /** Why, in a form worth putting in front of a person. */
  reason?: string;
  outputs: string[];
  attemptNumber?: number;
  leaseId?: string;
  durationMs: number;
  /** True when this was a dry run: nothing was leased, dispatched or written. */
  dryRun?: boolean;
}

/** One stage's place in the episode, as the journal records it. */
export interface StageStatusReport {
  stageId: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  outputArtifacts: string[];
  lease: { state: "none" | "live" | "expired"; holder?: string; expiresAt?: string };
  /** True when every stage it depends on has completed. */
  dependenciesMet: boolean;
}

export interface EpisodeStatus {
  ref: EpisodeRef;
  pipeline: string;
  stages: StageStatusReport[];
}

export interface ExecutionError {
  code:
    | "PIPELINE_UNRESOLVED"
    | "JOURNAL_UNREADABLE"
    | "STAGE_UNKNOWN";
  message: string;
}

export interface ExecutionServiceOptions {
  /** Root of the library tree episodes live under. */
  libraryRoot: string;
  /** Where the built-in pipeline manifests are, when not on the default path. */
  builtinPipelines?: string;
  dispatcher?: StageDispatcher;
  budget?: BudgetGuard;
  /** Recorded on every lease, so an expired one names who held it. */
  holder?: string;
  /** How long a lease lasts. Defaults to the engine's default. */
  leaseTtlMs?: number;
  /** Injected so tests can control time. */
  now?: () => Date;
  log?: (message: string) => void;
}
