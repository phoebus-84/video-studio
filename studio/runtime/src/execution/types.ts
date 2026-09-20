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
 * What a review gate knows about a stage.
 *
 * Three answers, not two. A boolean cannot tell "I hold a current record and
 * it accepts this stage" apart from "I have never heard of this stage", and
 * the service needs that distinction. While this was a boolean, an injected
 * gate answering `false` for a stage it had no record of suppressed the
 * service's manifest fallback — which made injecting a gate strictly WEAKER
 * than injecting none, in the one composition that ships.
 */
export type ReviewGateState =
  /** A review exists, is current, and accepted what the stage produced. */
  | "approved"
  /** Asked for and not granted, or granted and since invalidated. */
  | "outstanding"
  /**
   * The gate holds nothing about this stage. Not evidence of acceptance and
   * not evidence of refusal — the service falls back to the manifest.
   */
  | "no-record";

export interface ReviewVerdict {
  state: ReviewGateState;
  /** Why, when `outstanding`. Written to go in front of a person. */
  reason?: string;
}

/**
 * Whether a stage's review is satisfied, outstanding, or unknown to the gate.
 *
 * Injected rather than owned, because what an approval IS belongs to
 * avg-qr4.3, and the service deciding it first is the mistake this epic exists
 * to close. The gateway supplies one backed by gate-review records.
 */
export interface ReviewGate {
  isOutstanding(stageId: string, episodeDir: string): Promise<ReviewVerdict>;
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
   * Consulted for dependency acceptance. Its `approved` and `outstanding`
   * answers are authoritative; `no-record` falls through to the manifest rule,
   * which refuses where a dependency declares a review. So a gate can only
   * ever make the service stricter, never more permissive than having none —
   * see the dependency check in service.ts.
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
