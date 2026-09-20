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
  /**
   * Whether this dispatcher performs this stage at all.
   *
   * A dispatcher that does not handle a stage is a refusal someone must clear —
   * no adapter exists, no handler is registered — not an attempt that broke.
   * Omit it to mean "I handle everything I am given".
   */
  canDispatch?(stage: ResolvedStage): boolean;
}

/**
 * Whether a stage's review is still outstanding.
 *
 * Injected rather than owned, because what an approval IS belongs to
 * avg-qr4.3, and the service deciding it first is the mistake this epic exists
 * to close. The gateway supplies one backed by gate-review records.
 */
export interface ReviewGate {
  /** Outstanding means requested-but-not-granted, or invalidated. */
  isOutstanding(stageId: string, episodeDir: string): Promise<{ outstanding: boolean; reason?: string }>;
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
  /**
   * A dry run: every gate passed and the stage would have been dispatched,
   * but nothing was leased, dispatched or written.
   *
   * Distinct from `completed` because a caller looping until nothing
   * advances — the loop this service is built for — would otherwise never
   * terminate under `dryRun`: nothing is journaled, so the same stage is
   * selected on every pass and reported complete on every pass.
   */
  | "would-run"
  /** The stage ran and did not produce what it declared, or threw. Retryable. */
  | "failed"
  /** The stage never started. Someone else's condition to clear. */
  | "blocked"
  /** Nothing was selectable — every stage is done, or none is runnable. */
  | "idle"
  /**
   * The stage ran and its outputs hold up, but it declares a review and is not
   * accepted yet. Its dependents must not treat it as done — completion is what
   * happened, acceptance is whether it counts.
   */
  | "awaiting_review";

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
    /**
     * The journal parsed cleanly but replay rejected it: an event names a
     * stage the pipeline does not declare, a lease id repeats, or a terminal
     * event closes an attempt that was never opened. The file is fine — the
     * journal and the pipeline definition disagree, which is a different
     * problem from a corrupt line and calls for a different response.
     */
    | "REPLAY_INVALID"
    | "STAGE_UNKNOWN";
  message: string;
  /**
   * Set only when a hard error interrupts `rerun` partway through its list.
   * Whatever ran before the error — completed, blocked, or failed — is not
   * discarded; it is here instead of the caller's returned array. Not named
   * "completed": some of these outcomes may not be.
   */
  partialOutcomes?: StageOutcome[];
}

export interface ExecutionServiceOptions {
  /** Root of the library tree episodes live under. */
  libraryRoot: string;
  /** Where the built-in pipeline manifests are, when not on the default path. */
  builtinPipelines?: string;
  dispatcher?: StageDispatcher;
  budget?: BudgetGuard;
  /**
   * Consulted for dependency acceptance and for whether a finished stage still
   * needs one. Absent, the service refuses only where the manifest declares a
   * review — see the dependency check in service.ts for why that is not the
   * flat "absence is refusal" the other two ports use.
   */
  review?: ReviewGate;
  /** Recorded on every lease, so an expired one names who held it. */
  holder?: string;
  /** How long a lease lasts. Defaults to the engine's default. */
  leaseTtlMs?: number;
  /** Injected so tests can control time. */
  now?: () => Date;
  log?: (message: string) => void;
}
