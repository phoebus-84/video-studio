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
 * to close. `JournalReviewGate` (journal-review-gate.ts) is the one both the
 * CLI and the gateway compose, backed by signed gate-review records.
 */
export interface ReviewGate {
  /**
   * `stage` is the definition the receipt is bound to (avg-qr4.3). `ctx`
   * names the episode being judged, as the "channel/series/episode" slug a
   * human receipt signs (avg-qr4.3 final review): without it, a receipt
   * copied from a sibling episode with the same plan and bytes read approved.
   * Both are optional so test fakes that ignore them still satisfy the port;
   * a real gate refuses without either.
   */
  isOutstanding(
    stageId: string, episodeDir: string, stage?: ResolvedStage, ctx?: ReviewContext,
  ): Promise<ReviewVerdict>;
}

/** What the service tells a review gate about the episode it is judging. */
export interface ReviewContext {
  /** The "channel/series/episode" slug built from the service's `EpisodeRef`. */
  episode: string;
}

/**
 * What a budget guard's "yes" carries, opaque to the service.
 *
 * Since avg-91o nothing is reserved here — a paid call reserves its own
 * estimate in the journal's spend ledger (`@studio/contracts/src/budget.mjs`)
 * — so `JournalBudgetGuard` answers `{ reserveId: "none", estimatedCost: 0 }`.
 */
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
 *
 * A READ: `status` asks it on every poll, so an implementation must not mint
 * anything by answering. `JournalBudgetGuard` refuses a stage that declares a
 * paid capability once the episode's budget is used up.
 */
export interface BudgetGuard {
  maySpend(stage: ResolvedStage, ctx: DispatchContext): Promise<Result<Reservation, { code: string; message: string }>>;
}

/**
 * Who is asking. Resolved by the caller from a credential — the gateway from
 * which token a request carried, the CLI from whether it can read the
 * operator key — and never from anything the caller merely says about itself.
 * Omitted means `agent`: omission never grants.
 */
export type Principal = "operator" | "agent";

export interface ReviewInput {
  /**
   * `requested` always writes a request, for any principal and any review
   * level (avg-qr4.3 final review, M1): `pva_request_approval` sent
   * `approved`, so on a `review: skill` stage an agent "asking" granted.
   */
  decision: "approved" | "rejected" | "requested";
  principal: Principal;
  /** Required for a rejection. */
  note?: string;
}

/** Why a call ended the way it did. */
export type OutcomeStatus =
  /** The stage ran and its declared outputs hold up. */
  | "completed"
  /** A human decision was asked for but not given; see `ReviewInput`. */
  | "requested"
  /** `review()` recorded an approval. */
  | "approved"
  /** `review()` recorded a rejection. */
  | "rejected"
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
  | "awaiting_review"
  /**
   * The stage is leased and started, and something out of process is
   * performing it. Only `claim` returns this; `run` performs the work itself
   * and never leaves a stage in this state on return.
   *
   * A caller looping until nothing advances must treat this as a halt.
   */
  | "claimed"
  /** `select()` put a take in place, or found it already there (avg-qr4.6). */
  | "selected"
  /** The operator permitted one next attempt without accepting any outputs. */
  | "retry_granted";

export interface StageOutcome {
  /** Null when nothing was selected. */
  stageId: string | null;
  status: OutcomeStatus;
  /** Why, in a form worth putting in front of a person. */
  reason?: string;
  outputs: string[];
  attemptNumber?: number;
  leaseId?: string;
  /**
   * When this claim lapses, ISO-8601. Set on `claimed`, so a performer knows
   * its deadline and `complete` can refuse a claim that has passed it.
   */
  expiresAt?: string;
  durationMs: number;
  /** True when this was a dry run: nothing was leased, dispatched or written. */
  dryRun?: boolean;
}

/** What a performer reports when it finishes a claimed stage. */
export interface CompleteInput {
  /**
   * The paths the performer wrote, absolute or relative to the episode
   * directory. Required unless `failed`.
   *
   * The performer names its outputs; the service does not go looking for
   * them. Resolving the manifest's labels to files would mean `artifactExists`
   * and its six-candidates-per-label search, which is the inference this
   * module exists to remove. A performer that cannot say what it wrote has
   * not finished.
   */
  outputs?: string[];
  /**
   * The claim being closed. When omitted, the stage's single open attempt is
   * used — and if there is none, the claim has lapsed and is refused.
   */
  leaseId?: string;
  /** The performer is reporting that the work failed. */
  failed?: boolean;
  /** Why, when `failed`. */
  error?: string;
}

/**
 * A stage's place in its pipeline.
 *
 * `StageStatusReport.status` has four members, which is everything the journal
 * can say about a stage on its own. These seven are answers about a stage IN
 * its pipeline: `runnable`, `blocked` and `awaiting_review` need the
 * dependency check, the manifest's gates and the review gate.
 *
 * `status` answers the CLAIM question, and says so here rather than implying
 * more. A stage reported `runnable` has passed every gate a claim applies:
 * its dependencies have completed, their reviews are satisfied, it does not
 * declare `autopilot: false`, and the budget guard lets it spend. Those come
 * from the same code a claim runs, so the two cannot disagree about them.
 *
 * One thing it deliberately does not promise: whether THIS composition can
 * also perform the stage itself. `run` refuses a stage its injected
 * dispatcher does not handle, but that is a run-only gate, and `status`
 * cannot know whether its caller means to run or to claim. The CLI injects no
 * dispatcher at all and performs claimed stages by hand, so reporting "no
 * dispatcher is configured" as `blocked` would be false for that caller.
 */
export type StageState =
  | "pending" | "runnable" | "running" | "blocked" | "failed" | "completed" | "awaiting_review"
  /**
   * A completed stage whose upstream was decided on again after it ran — a
   * `staleness-marked` naming it is newer than both its last `stage-completed`
   * and its last `approval-granted` (avg-qr4.3, absorbing avg-33r's third).
   * The record explains WHY; the review gate's hash comparison still governs
   * WHETHER an approval stands — this is reporting, not a second gate.
   */
  | "stale";

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
  /**
   * As a claim would see it. This is what a caller should switch on; see
   * `StageState` for what `runnable` does and does not promise.
   */
  state: StageState;
  /**
   * Why the stage is in the `state` it is in, when there is something to say.
   *
   * Set for `blocked` (the gate that refuses) and for `pending` (what it is
   * still waiting on); absent otherwise. Both come from the same refusal the
   * run path would give, so this is the sentence a caller can show verbatim.
   *
   * Not `blockedReason`: it is populated for stages that are not blocked, and
   * a field whose name reports something other than what it holds is the
   * defect this module exists to remove.
   */
  stateReason?: string;
  /** The stage ids this stage is built on, as the manifest declares them. */
  dependsOn: string[];
  /**
   * The artifact labels the manifest says this stage will write.
   *
   * Not `outputArtifacts`, which is what the journal recorded as actually
   * written. A declaration and a record are different facts: `produces`
   * answers "which stage makes artifacts/script.md?" for a stage that has
   * never run, and `outputArtifacts` cannot.
   */
  produces: string[];
  /**
   * What this stage's history is missing, when it is missing something.
   *
   * One sentence per gap, in the same spirit as `stateReason`: text a caller
   * can show verbatim. Today the only gap is an attempt whose `stage-started`
   * event never landed, which replay records rather than throwing on.
   *
   * Absent when there is nothing to say. A gap means a journal write was lost
   * on the machine that ran this stage — the stage's own result may be fine,
   * but something else may have been lost at the same time.
   */
  gaps?: string[];
  /**
   * Which attempt's outputs this stage currently stands on (avg-qr4.6).
   * Absent when nothing has completed. Hashes are not compared here — this
   * is polled; `takes()` reports drift.
   */
  take?: TakeSummary;
}

/** A stage's selected take, as `status()` reports it. */
export interface TakeSummary {
  attemptNumber: number;
  /** `policy` for a completion that selected itself; `human` or `agent` for an explicit selection. */
  origin: "human" | "agent" | "policy";
  /** The operator selected it: a later attempt is kept as a candidate instead of replacing it. */
  locked: boolean;
}

/** What `select()` is asked to do. */
export interface SelectInput {
  /** The attempt whose candidate becomes the stage's take. */
  attemptNumber: number;
  /**
   * The attempt the caller believes is selected now, or null for none. When
   * given and wrong, the selection is refused rather than silently winning —
   * this is what keeps two sessions from selecting conflicting takes.
   */
  expected?: number | null;
  principal: Principal;
}

/** One kept attempt of a stage. */
export interface CandidateReport {
  attemptNumber: number;
  at: string;
  outputs: { path: string; sha256: string }[];
  selected: boolean;
}

/** A stage's candidates and selected take, as `takes()` reports them. */
export interface StageTakesReport {
  stageId: string;
  selected: (TakeSummary & {
    at: string;
    paths: string[];
    /** False when an operator selection's signature did not verify; null when nothing was checked. */
    verified: boolean | null;
    /** True for a completion from before candidates were kept: it cannot be restored. */
    legacy: boolean;
  }) | null;
  candidates: CandidateReport[];
  /**
   * Files of the selected take whose bytes on disk differ from its record,
   * or are missing. Selecting the same attempt again restores them.
   */
  drifted: string[];
}

export interface EpisodeTakes {
  ref: EpisodeRef;
  pipeline: string;
  stages: StageTakesReport[];
}

export interface EpisodeStatus {
  ref: EpisodeRef;
  pipeline: string;
  stages: StageStatusReport[];
  /** Where the stages' states come from: the journal, or the episode's files (avg-qwc). */
  source?: "journal" | "files";
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
    | "STAGE_UNKNOWN"
    /**
     * The caller asked for something this build cannot compute as asked — a
     * `rerun-affected-downstream` plan with no `selectedStages` to propagate
     * staleness from (avg-qr4.3, task 9) — as distinct from `STAGE_UNKNOWN`,
     * which is asking for something that does not exist at all. Conflating
     * the two names the wrong fix: a caller told `STAGE_UNKNOWN` for an
     * argument it forgot would reasonably go looking for a typo in a stage id
     * that was never the problem.
     */
    | "MODE_UNSUPPORTED"
    /** An episode whose stages follow its files, and the files could not be read (avg-qwc). */
    | "EVIDENCE_UNREADABLE";
  message: string;
  /**
   * Set only when a hard error interrupts `rerun` partway through its list.
   * Whatever ran before the error — completed, blocked, or failed — is not
   * discarded; it is here instead of the caller's returned array. Not named
   * "completed": some of these outcomes may not be.
   */
  partialOutcomes?: StageOutcome[];
}

/** One stage as an episode's files show it (avg-qwc). */
export interface StageEvidenceVerdict {
  state: "pending" | "completed" | "awaiting_review" | "stale" | "failed";
  reason: string;
}

/**
 * Where an episode's stages come from when they are made by tools that write
 * files, not by claims: a spec-driven series episode (avg-qwc). Injected by
 * the composition roots, which know the studio's episodes; the runtime does not.
 */
export interface StageEvidence {
  /**
   * Whether this episode's stages, in this pipeline, follow its files rather
   * than the journal. Cheap: asked on every status. `stageIds` are the
   * pipeline's: evidence that does not know them all must say no.
   */
  appliesTo(input: { ref: EpisodeRef; episodeDir: string; stageIds: string[] }): boolean;
  /** Each stage's verdict, by stage id. */
  stages(input: { ref: EpisodeRef; episodeDir: string; operatorKey: string | null }): Promise<Record<string, StageEvidenceVerdict>>;
}

export interface ExecutionServiceOptions {
  /** Root of the library tree episodes live under. */
  libraryRoot: string;
  /**
   * An episode whose stages follow its files (avg-qwc): `status` reads them
   * there. Claims and reviews keep the journal: the stages a dispatcher
   * performs write the same files, so the files stay the truth either way.
   * Absent, every episode's status follows the journal.
   */
  stageEvidence?: StageEvidence;
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
  /**
   * The key human receipts are signed with (avg-qr4.3). Null or absent means
   * this composition cannot sign, so an operator review is refused rather than
   * written unsigned.
   */
  operatorKey?: string | null;
  /** How long a lease lasts. Defaults to the engine's default. */
  leaseTtlMs?: number;
  /** Injected so tests can control time. */
  now?: () => Date;
  log?: (message: string) => void;
}
