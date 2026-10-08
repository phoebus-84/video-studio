// ---------------------------------------------------------------------------
// The execution service
// ---------------------------------------------------------------------------
// One meaning for run/status/rerun, shared by every caller.
//
// Three paths each had their own: the CLI persisted nothing and printed an
// instruction, the gateway executed handlers and wrote artifacts, the agent
// described tools as executing and waiting. Meanwhile the engine built for this
// — leases, attempts, validated transitions — had no production callers at all.
//
// State comes from replaying the episode journal, never from which files happen
// to exist. The service writes through @studio/contracts' journal, which is the
// log replay reads; studio/runtime/src/journal/ is a separate, unwired
// implementation with a different vocabulary and must not be used here.
// ---------------------------------------------------------------------------

import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { parseJournal, JOURNAL_RELATIVE_PATH, appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import type { JournalEvent } from "@studio/contracts/src/journal.mjs";
import { deriveExecutionState, leaseState } from "@studio/contracts/src/execution-state.mjs";
import type { StageAttempt } from "@studio/contracts/src/execution-state.mjs";
import { buildGateReview, hashArtifacts, REVIEW_EVENT_FOR } from "@studio/contracts/src/gate-review.mjs";
import { signReceipt, planHashOf } from "@studio/contracts/src/receipt.mjs";
import { deriveTakes, buildTakeSelection } from "@studio/contracts/src/takes.mjs";
import type { ArtifactHash } from "@studio/contracts/src/gate-review.mjs";
import { expandOutputs, preserveCandidate, verifyCandidate, materialize, removeDisplaced, driftOf } from "./takes.js";
import { resolvePipeline } from "../pipeline/resolver.js";
import { createDefaultLoader } from "../pipeline/fs-loader.js";
import type { ResolvedPipeline, ResolvedStage } from "../pipeline/types.js";
import { addPin, pinStaleness, renewPin, verifyPins } from "./pins.js";
import type { PinActor, PinRefusal } from "./pins.js";
import type { PinChange, SourcePin, SourceRef } from "@studio/contracts/src/source-pins.mjs";
import { ok, err, type Result } from "../result.js";
import { StageStateMachine, LeaseError, attemptsSinceLastSuccess } from "../engine/state-machine.js";
import { DEFAULT_ENGINE_CONFIG, type StageInstance as EngineStageInstance } from "../engine/types.js";
import { FileLock } from "../ports/file-lock.js";
import { planRerun } from "../rerun/index.js";
import type { RerunMode, RerunPlan } from "../rerun/index.js";
import { propagate } from "../staleness/index.js";
import type {
  EpisodeRef, EpisodeStatus, ExecutionError, ExecutionServiceOptions, StageStatusReport,
  StageState, CompleteInput, DispatchContext, StageOutcome, ReviewVerdict, ReviewInput, Principal, ReviewContext,
  OutcomeStatus, SelectInput, EpisodeTakes, StageTakesReport,
} from "./types.js";

/** What `claimInternal` hands back: the outcome, plus what a caller needs to perform the stage. */
interface ClaimInternal {
  outcome: StageOutcome;
  /** The selected stage. Absent when nothing was selected. */
  stage?: ResolvedStage;
  /** Ready for dispatch, with `attemptNumber` set. Absent when nothing was selected. */
  ctx?: DispatchContext;
  episodeDir: string;
}

/**
 * The refusal a composition with no budget guard earns.
 *
 * Shared by `claimInternal` and `status` so the two say the same sentence
 * about the same stage.
 */
function noBudgetGuardRefusal(stageId: string): string {
  return `no budget guard is configured, so "${stageId}" may not spend`;
}

/** The refusal a budget guard's "no" becomes — the same sentence from `claim` and `status`. */
function budgetRefusal(stageId: string, message: string): string {
  return `budget refused "${stageId}": ${message}`;
}

/** How long `select()` holds a stage's lock: enough to verify and copy a large take. */
const SELECT_LOCK_TTL_MS = 10 * 60_000;

export class ExecutionService {
  constructor(private readonly options: ExecutionServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private episodeDir(ref: EpisodeRef): string {
    return episodePath(this.options.libraryRoot, ref.channel, ref.series, ref.episode);
  }

  /** `status` for an episode whose stages follow its files (avg-qwc). */
  private async statusFromFiles(
    ref: EpisodeRef, pipeline: string, stages: ResolvedStage[], episodeDir: string,
  ): Promise<Result<EpisodeStatus, ExecutionError>> {
    let verdicts: Record<string, { state: StageState; reason: string }>;
    try {
      verdicts = await this.options.stageEvidence!.stages({ ref, episodeDir, operatorKey: this.options.operatorKey ?? null });
    } catch (e) {
      return err({ code: "EVIDENCE_UNREADABLE", message: `${episodeSlug(ref)}: its files cannot be read: ${e instanceof Error ? e.message : String(e)}` });
    }
    const of = (id: string) => verdicts[id] ?? { state: "pending" as const, reason: "the episode's files say nothing about this stage" };
    const reports: StageStatusReport[] = stages.map((stage) => {
      const id = stage.definition.id;
      const verdict = of(id);
      const dependsOn = stage.definition.dependsOn ?? [];
      return {
        stageId: id,
        name: stage.definition.name,
        status: verdict.state === "failed" ? "failed" : verdict.state === "pending" ? "pending" : "completed",
        attempts: 0,
        outputArtifacts: [],
        lease: { state: "none" },
        dependenciesMet: dependsOn.every((d) => of(d).state === "completed"),
        state: verdict.state,
        stateReason: verdict.reason,
        dependsOn,
        produces: (stage.definition.produces ?? []).map((artifact) => artifact.label),
      };
    });
    return ok({ ref, pipeline, stages: reports, source: "files" });
  }

  /**
   * The lock the state machine arbitrates a stage with.
   *
   * Built here rather than inline so the service's injected clock governs the
   * lockfile's expiry as well as replay's. On the wall clock they disagree: a
   * caller that moves `now` past a lease's TTL sees replay call the attempt
   * timed out while the lockfile it left behind is still live, and the stage
   * stays unclaimable until real time catches up.
   */
  private lock(episodeDir: string): FileLock {
    return new FileLock(path.join(episodeDir, ".locks"), () => this.now().getTime());
  }

  /** Resolve the pipeline, failing rather than guessing when it cannot be read. */
  protected async resolve(pipeline: string): Promise<Result<ResolvedPipeline, ExecutionError>> {
    try {
      const loader = createDefaultLoader(
        this.options.libraryRoot,
        this.options.builtinPipelines || undefined,
      );
      const resolved = await resolvePipeline(loader, pipeline);
      if (!resolved || resolved.stages.length === 0) {
        return err({ code: "PIPELINE_UNRESOLVED", message: `Pipeline "${pipeline}" resolved to no stages` });
      }
      return ok(resolved);
    } catch (e) {
      return err({
        code: "PIPELINE_UNRESOLVED",
        message: `Pipeline "${pipeline}" could not be resolved: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  /**
   * Read the journal strictly.
   *
   * A malformed line is surfaced, not skipped: this log is the only record of
   * what ran, so a line nobody can read is a gap in the history rather than a
   * cosmetic problem.
   */
  protected async readJournal(episodeDir: string): Promise<Result<JournalEvent[], ExecutionError>> {
    const file = path.join(episodeDir, JOURNAL_RELATIVE_PATH);
    let contents: string;
    try {
      contents = await readFile(file, "utf-8");
    } catch (e) {
      // Absent is a new episode. Anything else — a permissions error, an
      // unreadable mount, a directory sitting where the file should be — is
      // a real failure and must not be reported as "everything pending":
      // that would be the same file-existence inference this module exists
      // to remove, just inverted (absence of a readable file taken as
      // affirmative evidence of state).
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
        return ok([]); // No journal yet is a new episode, not a broken one.
      }
      return err({
        code: "JOURNAL_UNREADABLE",
        message: `Journal for this episode could not be read: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    try {
      return ok(parseJournal(contents, { strict: true }));
    } catch (e) {
      return err({
        code: "JOURNAL_UNREADABLE",
        message: `Journal for this episode could not be read: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async status(ref: EpisodeRef, pipeline: string): Promise<Result<EpisodeStatus, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const episodeDir = this.episodeDir(ref);
    if (this.options.stageEvidence?.appliesTo({ ref, episodeDir, stageIds: resolved.value.stages.map((s) => s.definition.id) })) {
      return this.statusFromFiles(ref, pipeline, resolved.value.stages, episodeDir);
    }
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const stages = resolved.value.stages;
    const stageIds = stages.map((s) => s.definition.id);
    const now = this.now();

    let derived;
    try {
      derived = deriveExecutionState(events.value, stageIds, now);
    } catch (e) {
      return err({
        code: "REPLAY_INVALID",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    // One review verdict per dependency per `status()` call, shared by every
    // stage in the loop below. See `whyBlocked`.
    const verdicts = new Map<string, ReviewVerdict>();
    // Which episode a human receipt must be signed for (avg-qr4.3 final review).
    const reviewCtx: ReviewContext = { episode: episodeSlug(ref) };

    // Index of the newest event of each kind per stage, for staleness. A
    // reverse loop rather than `Array.prototype.findLastIndex`: that needs
    // `lib: es2023`, which this tsconfig does not declare, and widening the
    // lib for one call site is a bigger change than a ten-line loop.
    const lastIndexOfType = (type: string, id: string): number => {
      for (let i = events.value.length - 1; i >= 0; i--) {
        const e = events.value[i]!;
        if (e.type === type && (e.data as { stageId?: string })?.stageId === id) return i;
      }
      return -1;
    };
    const staleSince = (id: string): number => {
      for (let i = events.value.length - 1; i >= 0; i--) {
        const e = events.value[i]!;
        if (e.type === "staleness-marked" &&
          ((e.data as { affected?: { stageId: string }[] })?.affected ?? []).some((a) => a.stageId === id)) {
          return i;
        }
      }
      return -1;
    };

    // Which take each stage stands on (avg-qr4.6). No hashing: this is polled.
    const takes = deriveTakes(events.value, stageIds, {
      key: this.options.operatorKey ?? null, episode: episodeSlug(ref),
    });

    // Shared material this episode pinned (avg-7zp.5): a changed source makes
    // the stages that read it, and their downstream, stale. Read-only — stat
    // first, hash only what moved.
    const pinned = await pinStaleness(this.options.libraryRoot, ref, episodeDir, resolved.value);

    const reports: StageStatusReport[] = [];
    for (const stage of stages) {
      const instance = derived.get(stage.definition.id)!;
      const lease = leaseState(instance, now);
      const depsMet = dependenciesMet(stage, derived);
      // Only a stage that has not run yet has a question to ask: the rest are
      // described by what the journal already recorded.
      let stateReason: string | null = null;
      if (instance.status === "pending") {
        try {
          stateReason = await this.whyBlocked(stage, stages, derived, episodeDir, reviewCtx, verdicts);
        } catch (e) {
          // An injected gate that throws instead of returning a verdict used
          // to escape `status` as an unhandled rejection. Every other failure
          // here is a typed refusal, and this is the read-only path a CLI
          // polls: a gate nobody can get an answer out of is a stage nobody
          // should be told is runnable, not a crash in the poller.
          stateReason =
            `"${stage.definition.id}" cannot be judged: its review gate failed: ` +
            `${e instanceof Error ? e.message : String(e)}`;
        }
        // The budget guard, which `claimInternal` asks below the gates above.
        // Ordered after `whyBlocked` so both paths name the same first
        // problem, and so this never masks a dependency or review refusal.
        // Its verdict is asked for too, since avg-91o made `maySpend` a
        // read: the spend is reserved by the paid call itself, so a polled
        // status no longer mints anything by asking.
        if (!stateReason && !this.options.budget) {
          stateReason = noBudgetGuardRefusal(stage.definition.id);
        } else if (!stateReason && this.options.budget) {
          try {
            const permitted = await this.options.budget.maySpend(stage, {
              episodeDir, ref, attemptNumber: instance.attempts.length + 1, log: () => {},
            });
            if (!permitted.ok) stateReason = budgetRefusal(stage.definition.id, permitted.error.message);
          } catch (e) {
            stateReason = budgetRefusal(stage.definition.id, e instanceof Error ? e.message : String(e));
          }
        }
      }

      let state: StageState;
      if (instance.status === "completed") {
        // Staleness wraps the review question rather than replacing it: a
        // stage a `staleness-marked` outruns since it both last ran AND last
        // won an approval is stale regardless of what the review gate would
        // say about it — the gate answers "did this get accepted", not
        // "does that acceptance still describe what it depends on".
        const marked = staleSince(stage.definition.id);
        if (marked > lastIndexOfType("stage-completed", stage.definition.id) &&
            marked > lastIndexOfType("approval-granted", stage.definition.id)) {
          state = "stale";
          const trigger = (events.value[marked]!.data as { trigger?: string } | undefined)?.trigger;
          stateReason = trigger?.startsWith("pin:")
            ? `"${stage.definition.id}" is stale: source pin "${trigger.slice(4)}" was renewed after it ran`
            : `"${stage.definition.id}" is stale: an upstream stage changed after it ran`;
        } else if (pinned.has(stage.definition.id)) {
          state = "stale";
          stateReason = `"${stage.definition.id}" is stale: ${pinned.get(stage.definition.id)}`;
        } else if (stage.definition.gates.review === "none") {
          state = "completed";
        } else {
          // avg-qr4.3 defined what an approval is, so status no longer has to
          // guess: ask the gate, as a dependent would — through the same memo,
          // so a dependent judged below reuses this answer.
          let verdict = verdicts.get(stage.definition.id);
          if (!verdict && this.options.review) {
            try {
              verdict = await this.options.review.isOutstanding(stage.definition.id, episodeDir, stage, reviewCtx);
              verdicts.set(stage.definition.id, verdict);
            } catch (e) {
              // Same reasoning as the `whyBlocked` catch above: a gate that
              // throws is a stage nobody can call accepted, not a crash in
              // the poller.
              stateReason =
                `"${stage.definition.id}" cannot be judged: its review gate failed: ` +
                `${e instanceof Error ? e.message : String(e)}`;
            }
          }
          state = verdict?.state === "approved" ? "completed" : "awaiting_review";
          if (verdict?.state === "outstanding" && verdict.reason) {
            stateReason = `"${stage.definition.id}" ${verdict.reason}`;
          }
        }
      } else if (instance.status === "running") {
        state = "running";
      } else if (instance.status === "failed") {
        state = "failed";
      } else if (!depsMet) {
        // Waiting its turn, not stuck. `blocked` is reserved for a refusal
        // somebody has to clear — an outstanding review, `autopilot: false` —
        // because that is the distinction a caller acts on. `stateReason`
        // still carries what it is waiting for.
        state = "pending";
      } else {
        state = stateReason ? "blocked" : "runnable";
      }

      const take = takes.get(stage.definition.id)!.selected;
      const gaps = instance.attempts
        .filter((a) => a.startRecorded === false)
        .map((a) => `attempt ${a.number} has no recorded start`);

      reports.push({
        stageId: stage.definition.id,
        name: stage.definition.name,
        status: instance.status,
        attempts: instance.attempts.length,
        outputArtifacts: instance.outputArtifacts,
        lease,
        dependenciesMet: depsMet,
        state,
        dependsOn: stage.definition.dependsOn ?? [],
        // The manifest's declared labels, which is what lets a caller ask
        // "which stage produces artifacts/script.md?" of a stage that has
        // never run. `outputArtifacts` above is the journal's record of what
        // was actually written.
        produces: (stage.definition.produces ?? []).map((artifact) => artifact.label),
        ...(gaps.length > 0 ? { gaps } : {}),
        ...(stateReason ? { stateReason } : {}),
        ...(take ? { take: { attemptNumber: take.attemptNumber, origin: take.origin, locked: take.locked } } : {}),
      });
    }

    return ok({ ref, pipeline, stages: reports });
  }

  /** Pin shared material for this episode (avg-7zp.5): inventory it and write source/pins/<id>.json. */
  async addPin(
    ref: EpisodeRef, pipeline: string,
    input: { id: string; source: SourceRef; usedBy: string[]; paths?: string[] },
  ): Promise<Result<{ ok: true; pin: SourcePin } | { ok: false; refusal: PinRefusal }, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    return ok(await addPin(this.options.libraryRoot, ref, this.episodeDir(ref), resolved.value, { ...input, now: this.now() }));
  }

  /** Every pin of the episode and what changed in its source. Writes nothing. */
  async verifyPins(ref: EpisodeRef): Promise<{ id: string; source?: SourceRef; changed: PinChange[]; problem?: string }[]> {
    return verifyPins(this.options.libraryRoot, ref, this.episodeDir(ref));
  }

  /**
   * Accept a pinned source's current version: rewrite the inventory and journal
   * which stages must be redone. Any actor may: renewal hides nothing.
   */
  async renewPin(
    ref: EpisodeRef, pipeline: string, id: string, actor: PinActor,
  ): Promise<Result<{ ok: true; changed: PinChange[]; affected: string[] } | { ok: false; refusal: PinRefusal }, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    return ok(await renewPin(this.options.libraryRoot, ref, this.episodeDir(ref), resolved.value, { id, actor, now: this.now() }));
  }

  /**
   * Bridge replay's stage instance to the engine's.
   *
   * Replay produces a deliberate subset — it receives stage ids and cannot
   * invent a human-readable name, and it leaves createdAt null for a stage the
   * journal has never mentioned. The pipeline supplies the name; a stage with
   * no history is created now.
   */
  private toEngineInstance(
    derived: { stageId: string; status: string; attempts: unknown[]; outputArtifacts: string[]; createdAt: string | null },
    stage: ResolvedStage,
  ): EngineStageInstance {
    return {
      stageId: derived.stageId,
      name: stage.definition.name,
      status: derived.status as EngineStageInstance["status"],
      attempts: derived.attempts.map((a) => ({ ...(a as object) })) as EngineStageInstance["attempts"],
      outputArtifacts: [...derived.outputArtifacts],
      createdAt: derived.createdAt ?? this.now().toISOString(),
    };
  }

  /**
   * Every declared output exists, has bytes in it, and stays inside the
   * episode. Returns why not, or null.
   *
   * A dispatcher's returned path is trusted enough to `stat`, not enough to
   * record blind: `path.join`/`path.resolve` silently collapse a leading
   * `../..`, so a relative path that climbs out of the episode — or an
   * absolute one naming a file elsewhere on disk — would otherwise validate
   * against a real file and land in `stage-completed.outputs` verbatim. The
   * same defect @studio/contracts' `hashArtifacts` closed with a `..` guard;
   * this checks the resolved path rather than the string, since dispatchers
   * are allowed to return absolute paths where hashArtifacts's callers are not.
   */
  private async validateOutputs(episodeDir: string, outputs: string[]): Promise<string | null> {
    if (outputs.length === 0) return "the stage produced no outputs";
    for (const file of outputs) {
      const absolute = path.isAbsolute(file) ? path.resolve(file) : path.resolve(episodeDir, file);
      const rel = path.relative(episodeDir, absolute);
      if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        return `declared output "${file}" resolves outside the episode directory`;
      }
      let info;
      try {
        info = await stat(absolute);
      } catch {
        return `declared output "${path.relative(episodeDir, absolute)}" was not written`;
      }
      if (info.size === 0) {
        return `declared output "${path.relative(episodeDir, absolute)}" is empty`;
      }
    }
    return null;
  }

  /**
   * Why this stage may not run, or null.
   *
   * Shared by `claimInternal` and `status` so the two cannot disagree. They
   * did: `status` used the exported `dependenciesMet`, which tests only for
   * `completed`, while a run also consulted the review gate — so status
   * reported a stage as ready that a run then refused.
   *
   * `verdicts` memoises the review gate for the length of one caller's
   * question. `status` asks this of every stage, and a fan-in of eight behind
   * one reviewed stage asked `isOutstanding` about that stage eight times for
   * a single poll — and `JournalReviewGate.isOutstanding` re-reads the whole
   * journal and sha256s every artifact the review covered, which for the
   * shipped pipeline includes the narration wav and the final mp4. Sharing
   * one map across the loop also stops a report contradicting itself when an
   * artifact changes mid-loop. `claimInternal` passes none: a claim asks
   * about one stage, once.
   */
  private async whyBlocked(
    stage: ResolvedStage,
    stages: ResolvedStage[],
    derived: Map<string, { status: string }>,
    episodeDir: string,
    reviewCtx: ReviewContext,
    verdicts?: Map<string, ReviewVerdict>,
    principal: Principal = "agent",
  ): Promise<string | null> {
    const stageId = stage.definition.id;

    // A dependency is satisfied when it completed AND its review, if one is
    // required, is not outstanding. Completion is what happened; acceptance is
    // whether it counts. Conflating them is how downstream stages came to build
    // on artifacts nobody had accepted.
    const unmet = (stage.definition.dependsOn ?? [])
      .filter((id) => derived.get(id)?.status !== "completed");
    if (unmet.length > 0) {
      return `"${stageId}" depends on ${unmet.map((m) => `"${m}"`).join(", ")}, ` +
        `which ${unmet.length === 1 ? "has" : "have"} not completed`;
    }

    // ── Attendance ────────────────────────────────────────────────────────
    // `gates.autopilot: false` means "a person has to be at the controls for
    // this". The service has no notion of attendance, so the only honest
    // answer is to refuse: it cannot run this stage on anyone's behalf.
    //
    // This was enforced by nothing at all — "autopilot" appeared nowhere in
    // this file. It merely looked enforced, because every `autopilot: false`
    // stage in the shipped manifests (script, compose, safety-review) also
    // happens to have no adapter and so stopped at `canDispatch`.
    // Give one an adapter — or ship a manifest that gates an ordinary stage —
    // and it ran unattended, which is the one thing the flag exists to
    // prevent.
    //
    // Below the unmet-dependency check, which names an earlier and more
    // useful problem, and above everything that leases, dispatches or spends.
    //
    // avg-qr4.3 gave the service a way to know a person is at the controls:
    // the operator principal, resolved from a credential Pi is never given.
    if (!stage.definition.gates.autopilot && principal !== "operator") {
      return `"${stageId}" declares autopilot: false and may not run unattended; ` +
        `sign in as the operator to take this stage`;
    }

    for (const depId of stage.definition.dependsOn ?? []) {
      const depStage = stages.find((s) => s.definition.id === depId);
      if (this.options.review) {
        // An injected gate is authoritative only where it actually knows
        // something. It used to be authoritative for everything, including
        // stages it had never heard of — and since "I have no record" came
        // back as `outstanding: false`, injecting a gate SUPPRESSED the
        // manifest fallback below and made the service more permissive than
        // having no gate at all. That is precisely backwards, and it was the
        // gateway — the only composition that ships — that got the weak path.
        let verdict = verdicts?.get(depId);
        if (!verdict) {
          // The dependency's definition travels with the question: a receipt
          // is bound to its plan hash (avg-qr4.3), and a gate asked without
          // it refuses rather than guessing.
          verdict = await this.options.review.isOutstanding(depId, episodeDir, depStage, reviewCtx);
          verdicts?.set(depId, verdict);
        }
        if (verdict.state === "approved") {
          // A current, satisfied record beats the manifest: this dependency
          // is accepted even if its manifest declares a review.
          continue;
        }
        if (verdict.state === "outstanding") {
          return `"${stageId}" cannot run: "${depId}" ${verdict.reason ?? "has an outstanding review"}`;
        }
        // "no-record": the gate is not evidence either way, so fall through
        // to the manifest rule rather than reading silence as acceptance.
      }

      // The manifest rule, reached with no gate configured or with a gate
      // that holds nothing on this dependency. The service cannot know
      // whether a required review happened, so it does not guess. Absence is
      // refusal exactly where something is protected — a dependency the
      // manifest never asked to be reviewed proceeds untouched.
      const depNeedsReview = depStage?.definition.gates.review !== "none";
      if (depNeedsReview) {
        return `"${stageId}" cannot run: "${depId}" declares ${depStage!.definition.gates.review} ` +
          `review and no accepted review is recorded for it, so whether it was accepted ` +
          `cannot be known`;
      }
    }

    return null;
  }

  /**
   * Select a stage, check every gate, take the lease, and record that the
   * stage has started — then stop.
   *
   * `run` and `claim` are the same code up to this point, and deliberately so:
   * a synchronous dispatcher and an out-of-process performer that each wrote
   * their own `stage-leased` would be the next instance of the split this
   * epic exists to close, and the hardest to notice, because both would be
   * correct in isolation.
   *
   * `precheck` runs after selection and the manifest's own gates, and before
   * anything is leased or spent. `run` uses it to refuse a stage its
   * dispatcher does not handle, so that no stage is ever leased by a caller
   * that cannot perform it — and so that a stage nothing here can perform
   * never reaches the budget guard and mints a reservation for work that is
   * then refused.
   *
   * A bare `claim` passes none: a claim is a promise to perform from
   * somewhere else, and requiring a dispatcher for one would defeat the
   * point. The precheck can only ever make `run` refuse sooner than `claim`
   * does — every gate above it applies to both.
   */
  private async claimInternal(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean; principal?: Principal } = {},
    precheck?: (stage: ResolvedStage) => string | null,
  ): Promise<Result<ClaimInternal, ExecutionError>> {
    const startedAt = Date.now();
    const log = this.options.log ?? (() => {});

    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const stages = resolved.value.stages;
    const stageIds = stages.map((s) => s.definition.id);
    const now = this.now();

    let derived;
    try {
      derived = deriveExecutionState(events.value, stageIds, now);
    } catch (e) {
      return err({
        code: "REPLAY_INVALID",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    // ── Select ────────────────────────────────────────────────────────────
    let stage: ResolvedStage | undefined;
    if (opts.stage) {
      stage = stages.find((s) => s.definition.id === opts.stage);
      if (!stage) {
        return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${opts.stage}"` });
      }
    } else {
      stage = stages.find((s) =>
        derived.get(s.definition.id)!.status !== "completed" && dependenciesMet(s, derived));
    }

    if (!stage) {
      return ok({
        outcome: { stageId: null, status: "idle", outputs: [], durationMs: Date.now() - startedAt },
        episodeDir,
      });
    }

    const stageId = stage.definition.id;
    const blocked = (reason: string): Result<ClaimInternal, ExecutionError> =>
      ok({
        outcome: { stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt, dryRun: opts.dryRun },
        episodeDir,
      });

    // ── Gate ──────────────────────────────────────────────────────────────
    // Dependencies, attendance and review, answered by the same code `status`
    // uses, so the two cannot report different things about one stage.
    const principal = opts.principal ?? "agent";
    const refusal = await this.whyBlocked(stage, stages, derived, episodeDir, { episode: episodeSlug(ref) }, undefined, principal);
    if (refusal) return blocked(refusal);

    const ctx: DispatchContext = {
      episodeDir, ref,
      attemptNumber: derived.get(stageId)!.attempts.length + 1,
      log,
    };

    // Whatever the caller needs true before a lease is taken. Placed here so
    // it sees a stage the manifest's own gates have already cleared, and so a
    // refusal costs nothing: nothing has been leased, written or spent yet.
    const precheckRefusal = precheck?.(stage);
    if (precheckRefusal) return blocked(precheckRefusal);

    if (!this.options.budget) {
      return blocked(noBudgetGuardRefusal(stageId));
    }
    const permitted = await this.options.budget.maySpend(stage, ctx);
    if (!permitted.ok) {
      return blocked(budgetRefusal(stageId, permitted.error.message));
    }

    // ── The state the stage is actually in ────────────────────────────────
    // The retry cap and the current state are checked ABOVE the dry-run
    // return, not below it. A dry run exists to answer the same question a
    // real call would; one that reported "would have dispatched" for a stage
    // the real call refuses — because it is out of retries, or because
    // another process is holding it right now — answers a different question
    // and is worse than no dry run at all. Only the lease acquisition and the
    // writes belong below the return.
    const ttlMs = this.options.leaseTtlMs ?? DEFAULT_ENGINE_CONFIG.leaseTtlMs;
    const engineConfig = { ...DEFAULT_ENGINE_CONFIG, leaseTtlMs: ttlMs };
    const sm = new StageStateMachine(this.lock(episodeDir), engineConfig);

    let instance = this.toEngineInstance(derived.get(stageId)!, stage);

    // `running` after replay means a lease that has not expired yet: someone
    // else is on it. There is no path from `running` to `running`, so the
    // transition below would throw and land in the same `blocked` — this
    // just says so before the dry-run return, where a dry run can see it.
    if (instance.status === "running") {
      return blocked(`"${stageId}" cannot start from its current state ("running")`);
    }
    if (instance.status === "failed" && !sm.canRetry(instance)) {
      return blocked(
        `"${stageId}" has failed ${attemptsSinceLastSuccess(instance).length} time(s) in a row, ` +
        `reaching its retry limit of ${engineConfig.maxAttempts}; it will not be retried ` +
        `automatically (only a successful attempt clears the count)`,
      );
    }
    // A completed stage named explicitly is a rerun: reset it before leasing.
    // A failed one is a retry, and needs the same reset — `failed` has no
    // direct path to `running` in the transition table, only to `pending`.
    // Selecting a failed stage and then transitioning it straight to
    // `running` (skipping this reset) is exactly what used to deadlock the
    // episode: the transition threw on every call, `blocked` never leases,
    // and unnamed selection keeps re-picking the same stage forever because
    // its filter only excludes `completed`.
    //
    // Both are in-memory only: `transition` writes no journal line and takes
    // no lease except when moving to `running`, so a dry run can take them.
    if (instance.status === "completed" || instance.status === "failed") {
      instance = (await sm.transition(instance, "pending")).instance;
    }

    // ── Dry run stops here: everything above is free, everything below writes.
    // `would-run` rather than `completed`: the stage has NOT completed, and a
    // caller looping while the outcome is `completed` — the loop this service
    // is built for — would never terminate under dryRun, since nothing is
    // journaled and the same stage is selected again on every pass. The
    // `dryRun` flag stays too, for callers that switch on it.
    if (opts.dryRun) {
      return ok({
        outcome: {
          stageId, status: "would-run", reason: "dry run — would have dispatched",
          outputs: [], durationMs: Date.now() - startedAt, dryRun: true,
        },
        episodeDir, stage, ctx,
      });
    }

    // ── Lease ─────────────────────────────────────────────────────────────
    let leaseId: string;
    try {
      const started = await sm.transition(instance, "running");
      instance = started.instance;
      leaseId = started.transition.leaseId!;
    } catch (e) {
      if (e instanceof LeaseError) {
        return blocked(`"${stageId}" is already held by another run`);
      }
      // Reaching here means a state the reset above did not anticipate — not
      // the `failed` case, which is handled before this transition is
      // attempted. Describe the stage's situation rather than repeating the
      // machine's transition-table wording.
      log(`unexpected transition failure for "${stageId}": ${e instanceof Error ? e.message : String(e)}`);
      return blocked(`"${stageId}" cannot start from its current state ("${instance.status}")`);
    }

    // A malformed event below throws rather than returning null (see
    // appendJournalEvent's doc comment) — that is a caller bug and must still
    // propagate. But the lease was just taken above and nothing has run yet
    // to depend on it, so a throw would leak the lockfile with no journal
    // event to explain it. Catching only to release-and-rethrow keeps the
    // throw a throw — it must never become a silent `blocked`, or a code bug
    // reads as a busy stage.
    //
    // The region covers everything between taking the lease and the
    // `stage-leased` append, the three statements that open it included: a bad
    // injected clock makes `toISOString()` raise, and by then the lockfile
    // exists. It stops at that append, and the boundary is the same one the
    // whole design turns on — whether the journal already claims the stage.
    // Up to here it does not, so releasing is what keeps the two records
    // agreeing. The moment `stage-leased` lands it does, and releasing would
    // make them contradict, which is why the `stage-started` append below
    // sits OUTSIDE this try and why the `!started` branch releases nothing.
    // A throw from there propagates with the lease held, and the lease lapses.
    let attemptNumber: number;
    let expiresAt: string;
    let leased: JournalEvent | null;
    try {
      attemptNumber = instance.attempts.length;
      expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
      const holder = this.options.holder ?? `runtime/pid-${process.pid}`;
      leased = await appendJournalEvent(episodeDir, {
        type: "stage-leased", actor: "runtime", episode: ref,
        data: {
          stageId, leaseId, attemptNumber, ttlMs, expiresAt, holder,
          // Present only for an operator's own claim: `attended` is a
          // positive assertion that a person is at the controls, so an
          // agent's ordinary lease must not carry it, even as `false`
          // (avg-qr4.3).
          ...(principal === "operator" ? { attended: true as const } : {}),
        },
      });
    } catch (e) {
      await sm.releaseAll();
      throw e;
    }
    if (!leased) {
      // Release and stop. This is the ONE append where releasing is right:
      // the write did not land, so the journal says nothing about this stage,
      // and dropping the lockfile is what keeps the two agreeing. Every append
      // after this one has a lease event in the log behind it.
      await sm.releaseAll();
      return blocked(`"${stageId}" could not be leased: the journal write for its lease did not land`);
    }

    const started = await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber },
    });
    if (!started) {
      // Stop, but do NOT release: the `stage-leased` event above landed, so
      // the journal says this stage is held. Dropping the lockfile now would
      // leave the lockfile and the journal disagreeing, which is the failure
      // this service exists to prevent. The lease lapses on its own and the
      // stage becomes claimable again then — the same path a process that
      // dies right after leasing already takes.
      //
      // Replay survives this gap: it records `startRecorded: false` rather
      // than throwing. Surviving it is not a licence to create it. A lost
      // write here means writes are failing on this machine, and dispatching
      // anyway produces work whose record is already incomplete.
      return blocked(`"${stageId}" could not be started: the journal write for its start did not land`);
    }

    return ok({
      outcome: {
        stageId, status: "claimed", outputs: [],
        attemptNumber, leaseId, expiresAt,
        durationMs: Date.now() - startedAt,
      },
      episodeDir, stage,
      ctx: { ...ctx, attemptNumber },
    });
  }

  /**
   * Take a stage for a performer that is not this process.
   *
   * The stage is leased and recorded as started; the work happens elsewhere;
   * `complete` closes it. The lease bounds how long the claim is honoured —
   * an abandoned claim needs no command of its own, because replay derives
   * the timeout from the lease's own `expiresAt`.
   */
  async claim(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean; principal?: Principal } = {},
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const claimed = await this.claimInternal(ref, pipeline, opts);
    return claimed.ok ? ok(claimed.value.outcome) : claimed;
  }

  /**
   * Close a claim: validate what the performer wrote, record it, release the
   * lease.
   *
   * Runs in a process that may not be the one that claimed, so everything it
   * needs comes from the journal. The open attempt carries the lease id, the
   * attempt number and the expiry.
   */
  async complete(
    ref: EpisodeRef,
    pipeline: string,
    stageId: string,
    input: CompleteInput,
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();

    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const stage = resolved.value.stages.find((s) => s.definition.id === stageId);
    if (!stage) {
      return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
    }

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const now = this.now();
    let derived;
    try {
      derived = deriveExecutionState(
        events.value, resolved.value.stages.map((s) => s.definition.id), now,
      );
    } catch (e) {
      return err({
        code: "REPLAY_INVALID",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const instanceState = derived.get(stageId)!;
    const open = instanceState.attempts.find((a) => a.outcome === undefined);

    /**
     * The one refusal a lapsed attempt is allowed to make, wherever it is
     * reached from: say so to the caller, write nothing to the journal.
     */
    const lapsed = (attempt: StageAttempt): Result<StageOutcome, ExecutionError> => ok({
      stageId,
      status: "failed",
      reason:
        `the lease on "${stageId}" lapsed at ${attempt.expiresAt} and nothing was recorded ` +
        `for it; the stage is retryable and may already have been taken by someone else`,
      outputs: [],
      attemptNumber: attempt.number,
      leaseId: attempt.leaseId,
      durationMs: Date.now() - startedAt,
    });

    /**
     * A terminal event did not land.
     *
     * `appendJournalEvent` returns null rather than throwing when the write
     * fails, and the caller of a TERMINAL write has nothing to roll back:
     * the stage ran, the outputs exist on disk, and the journal is the only
     * record of what ran. Saying "completed" anyway would report something
     * this process does not hold — replay reads an attempt still open, the
     * lease lapses, `closeIfExpired` turns it into a timeout, and the stage
     * that produced outputs comes back as `failed` with nothing anywhere
     * saying why. So the outcome says what is true: the work happened, the
     * record of it did not, and the stage will run again.
     *
     * The lease is deliberately NOT released. Releasing the lockfile while
     * the journal still shows the attempt open would let a second holder
     * take a stage replay reports as `running`, and be refused by the state
     * machine anyway. Letting the lease lapse on its own is what the journal
     * already describes.
     */
    const unrecorded = (what: string): Result<StageOutcome, ExecutionError> => ok({
      stageId,
      status: "failed",
      reason:
        `"${stageId}" ${what}, but the journal write recording that did not land; ` +
        `nothing outside this process knows it happened, so the stage will re-run ` +
        `once its lease lapses`,
      outputs: [],
      attemptNumber: open?.number ?? 0,
      leaseId: open?.leaseId,
      durationMs: Date.now() - startedAt,
    });

    // A lapsed claim is not an open attempt. `deriveExecutionState` closes an
    // attempt whose lease has expired as a `timeout` and moves the stage to
    // `failed`, so the refusal below IS the lease expiring — there is no
    // separate clock comparison to get wrong.
    //
    // Which is what keeps a lapsed performer silent, and the silence is the
    // point. Once a lease expires another holder may already have reclaimed
    // the lockfile and appended its own lease, start and terminal event; a
    // terminal event for the stale lease landing after that makes replay
    // throw (`cannot go from completed to failed`), and because the journal
    // is append-only it throws on every future replay too — every later
    // `status()` and `run()` on the episode returns REPLAY_INVALID forever.
    // Nothing is lost by saying nothing: replay's `closeIfExpired` derives
    // the timeout from the lease's own `expiresAt`, which the `stage-leased`
    // event already carries.
    if (!open) {
      // Which attempt was this caller's: the one it names, or — for a
      // performer that kept no lease id — the stage's last. Not the last one
      // in both cases: by the time an overrunning holder reports, a second
      // holder may already have taken the stage and finished it, so the last
      // attempt would be the second holder's success. The first holder's own
      // claim still lapsed, and a lapse is what it has to be told about.
      const mine = input.leaseId
        ? instanceState.attempts.find((a) => a.leaseId === input.leaseId)
        : instanceState.attempts[instanceState.attempts.length - 1];
      if (mine?.outcome === "timeout") return lapsed(mine);
      return ok({
        stageId,
        status: "blocked",
        reason: `"${stageId}" has no open claim to complete`,
        outputs: [],
        durationMs: Date.now() - startedAt,
      });
    }

    if (input.leaseId && input.leaseId !== open.leaseId) {
      return ok({
        stageId, status: "blocked",
        reason: `the open claim on "${stageId}" is "${open.leaseId}", not "${input.leaseId}"`,
        outputs: [], durationMs: Date.now() - startedAt,
      });
    }

    // The journal's lease id, never the caller's — the check above has just
    // established they agree, and adopting the caller's value would let any
    // process that can read the journal release the live holder's lockfile.
    const leaseId = open.leaseId;
    const attemptNumber = open.number;

    /**
     * Whether this attempt may still write, asked again immediately before
     * every append.
     *
     * The structural refusal above is only true at the instant
     * `deriveExecutionState` ran: `closeIfExpired` had proved the lease live
     * then, which is why there was an open attempt at all. Nothing holds the
     * lease still afterwards, and `validateOutputs` sits between there and
     * the writes below stat-ing a list of paths whose length the performer
     * chooses. A lease that dies in that gap must append nothing — if a
     * second holder reclaimed the stage and finished it, this line lands
     * after its terminal event and replay throws REPLAY_INVALID on every
     * future `status()` and `run()` for the life of the episode, because the
     * journal is append-only.
     *
     * Read off the journal's own `expiresAt`, not a deadline tracked
     * alongside it: there is exactly one record of when a claim dies.
     */
    const held = (): boolean =>
      !open.expiresAt || Date.parse(open.expiresAt) > this.now().getTime();

    const ttlMs = this.options.leaseTtlMs ?? DEFAULT_ENGINE_CONFIG.leaseTtlMs;
    const engineConfig = { ...DEFAULT_ENGINE_CONFIG, leaseTtlMs: ttlMs };
    const sm = new StageStateMachine(this.lock(episodeDir), engineConfig);
    // Adopted so the terminal transition below releases the lockfile. Without
    // it a stage claimed by one process and completed by another holds its
    // lock until the TTL, blocking a retry that should be immediate.
    if (open.expiresAt) {
      sm.adopt(stageId, { resource: `stage:${stageId}`, token: leaseId, expiresAt: new Date(open.expiresAt) });
    }
    const instance = this.toEngineInstance(instanceState, stage);

    // An open attempt on a stage replay still calls `pending` is an attempt
    // whose `stage-started` never landed: `stage-started` is the only event
    // that moves it to `running`. Replay tolerates that gap and records it;
    // the engine's table — untouched here, and pinned byte-identical to
    // replay's by test/unit/engine/transition-table-agreement.test.ts — does
    // not, and `sm.complete`/`sm.fail` below would throw `pending → completed`
    // AFTER the terminal event had already been appended. The work recorded,
    // the gap recorded, and the caller told it crashed.
    //
    // So carry the in-memory instance through `running` first, exactly as
    // replay's `noteMissingStart` does, rather than widening the table:
    // `pending → completed` does not become legal, this run is just known not
    // to have been healthy, and the journal already says so.
    //
    // Assigned, not `sm.transition(instance, "running")`: that overload
    // acquires a fresh lease for `stage:<id>` — which this very attempt is
    // holding, so it would fail — and pushes a second attempt onto an
    // instance whose attempt is already open.
    if (instance.status === "pending") instance.status = "running";

    if (input.failed) {
      const message = input.error ?? "the performer reported failure without saying why";
      if (!held()) return lapsed(open);
      const recorded = await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, message);
      if (!recorded) return unrecorded(`failed ("${message}")`);
      return ok({
        stageId, status: "failed", reason: message, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    const outputs = input.outputs ?? [];
    const invalid = await this.validateOutputs(episodeDir, outputs);
    if (invalid) {
      if (!held()) return lapsed(open);
      const recorded = await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, invalid);
      if (!recorded) return unrecorded(`failed ("${invalid}")`);
      return ok({
        stageId, status: "failed", reason: invalid, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    const relative = outputs.map((o) => path.isAbsolute(o) ? path.relative(episodeDir, o) : o);

    // ── Keep the candidate (avg-qr4.6) ────────────────────────────────────
    // Before anything is recorded: a completion whose bytes were not kept
    // would claim a take nothing can restore. Failing the attempt is the
    // honest outcome — the work may be fine, but it cannot be held to.
    let digests: ArtifactHash[];
    try {
      digests = await preserveCandidate(episodeDir, stageId, attemptNumber, await expandOutputs(episodeDir, relative));
    } catch (e) {
      const reason = `the outputs could not be kept as a candidate: ${e instanceof Error ? e.message : String(e)}`;
      if (!held()) return lapsed(open);
      const recorded = await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, reason);
      if (!recorded) return unrecorded(`failed ("${reason}")`);
      return ok({
        stageId, status: "failed", reason, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    // Whether this candidate becomes the take. Read from the events loaded at
    // the top of this call: this attempt holds `stage:${stageId}` for its
    // whole lease, and `select()` takes the same lock, so no selection can
    // have landed since.
    const current = deriveTakes(events.value, resolved.value.stages.map((s) => s.definition.id), {
      key: this.options.operatorKey ?? null, episode: episodeSlug(ref),
    }).get(stageId)!.selected;
    const lockedTake = current?.locked && current.outputs ? current : null;

    // The journal is written before the lease is released. If this process
    // dies in between, the record says what happened and the lease expires on
    // its own; releasing first would leave a completed stage looking unstarted.
    if (!held()) return lapsed(open);
    const completed = await appendJournalEvent(episodeDir, {
      type: "stage-completed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, outputs: relative, digests, ...(lockedTake ? { selected: false } : {}) },
    });
    // The `stage-leased` append is checked and rolled back; this one is
    // checked and surfaced. Both are dropped writes; only the first can be
    // undone. Saying `completed` off a write that did not land is exactly
    // the thing this service exists to stop — reporting something other
    // than what the journal holds.
    if (!completed) return unrecorded("produced its outputs");

    // Completion is what happened; acceptance is whether it counts. The
    // journal says completed because that is true; the outcome says
    // awaiting_review because that is what the caller needs.
    const needsReview = stage.definition.gates.review !== "none";

    if (lockedTake) {
      return ok(await this.keepBesideLockedTake(
        episodeDir, ref, stage, sm, instance, lockedTake, digests,
        { stageId, outputs: relative, attemptNumber, leaseId, startedAt },
      ));
    }

    // The candidate is the take now. Files only the displaced take had are
    // removed, so a directory output does not keep frames nobody selected;
    // that take's own copy under `attempts/` keeps them. Best-effort: the
    // completion is already recorded, and a leftover file is reported by
    // nothing worse than its presence.
    if (current?.outputs) {
      try {
        await removeDisplaced(episodeDir, digests.map((d) => d.path), current.paths);
      } catch (e) {
        this.options.log?.(`files of the displaced take of "${stageId}" could not be removed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // avg-2n7 deleted the loop that used to write this, so nothing told an
    // operator a stage was waiting for them (avg-qr4.3 notes, point 1).
    //
    // Written HERE — after `stage-completed` lands, but BEFORE
    // `sm.complete(instance)` below, which is the call that releases the
    // `stage:${stageId}` file lock. `review()` takes that same lock, and the
    // only thing it waits on besides the lock is `status === "completed"` —
    // which replay already reports true the instant `stage-completed` is on
    // disk, one line above. Releasing the lock first would open a window
    // where a concurrent operator's `review()` acquires it, appends a signed
    // `approval-granted`, releases it, and only then sees this request land
    // on top: `deriveGateState` governs by the LAST review event in file
    // order, so a genuine human approval would be silently buried under an
    // unsigned, policy-authored request nobody asked for (fix round 1,
    // Important finding). Holding the lock across this write is what keeps
    // `review()` out until the request is on the journal (or given up on).
    //
    // The completion is already durable, so a request that fails to land is
    // reported, not treated as a failed stage: the gate then reads no record
    // and the manifest rule refuses dependents, which still fails closed.
    // A lease found lapsed here (`!held()`) is read the same way one level
    // up: something else may already hold `stage:${stageId}` — another
    // attempt, or another `review()` — so appending now would reopen the
    // very race this ordering exists to close. Skip the write rather than
    // race for it; the stage is still `awaiting_review`, and whichever
    // holder came next governs.
    let requestNote: string | undefined;
    if (needsReview) {
      if (!held()) {
        requestNote = `the review request for "${stageId}" was not attempted because its lease had already lapsed`;
      } else {
        try {
          // The candidate's digests rather than a fresh hash of `relative`:
          // they are the files, a directory output expanded, and the bytes
          // that were kept.
          const request = buildGateReview({
            stageId, decision: "requested", origin: "policy", actor: "runtime", episode: episodeSlug(ref),
            binding: { planHash: planHashOf(stage.definition), outputs: digests },
          });
          const asked = await appendJournalEvent(episodeDir, {
            type: "approval-requested", actor: "runtime", episode: ref, data: { ...request },
          });
          if (!asked) requestNote = `the review request for "${stageId}" could not be written to the journal`;
        } catch (e) {
          requestNote = `the review request for "${stageId}" could not be written: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    // A re-completion of a stage the journal already holds an approval for.
    // `events` was read at the top of this call, before anything below wrote
    // to it, so an `approval-granted` found there predates this attempt — the
    // one thing that tells a first completion (nothing to be stale about yet)
    // apart from a stage that ran again after being accepted (everything
    // downstream of it now rests on artifacts nobody has looked at since).
    // Best-effort and outside the lease: unlike the request above, nothing
    // here governs whether THIS stage counts as accepted.
    const hadApproval = events.value.some(
      (e) => e.type === "approval-granted" && (e.data as { stageId?: string })?.stageId === stageId,
    );
    if (hadApproval) {
      await this.markStale(episodeDir, ref, resolved.value, stageId);
    }

    await sm.complete(instance);

    const base = needsReview
      ? `"${stageId}" declares ${stage.definition.gates.review} review and is not accepted yet`
      : undefined;

    return ok({
      stageId,
      status: needsReview ? "awaiting_review" : "completed",
      outputs: relative, attemptNumber, leaseId,
      durationMs: Date.now() - startedAt,
      ...(base ? { reason: [base, requestNote].filter(Boolean).join("; ") } : {}),
    });
  }

  /**
   * Record which stages a change made stale (avg-33r's third, absorbed by
   * avg-qr4.3). The event says WHY a stage went stale; hash comparison still
   * decides WHETHER an approval stands. Neither replaces the other.
   *
   * Best-effort by design: a staleness record that fails to land loses an
   * explanation, not a safety property — the gate still re-hashes on read.
   */
  private async markStale(
    episodeDir: string, ref: EpisodeRef, pipeline: ResolvedPipeline, trigger: string,
  ): Promise<void> {
    const report = propagate(pipeline, [trigger], episodeSlug(ref));
    const affected = report.stages
      .filter((s) => s.stale && s.stageId !== trigger)
      .map((s) => ({ stageId: s.stageId, path: s.reasons[0]?.path ?? [trigger, s.stageId] }));
    if (affected.length === 0) return;
    const written = await appendJournalEvent(episodeDir, {
      type: "staleness-marked", actor: "runtime", episode: ref,
      data: { stageId: trigger, trigger, affected },
    });
    if (!written) this.options.log?.(`staleness for "${trigger}" could not be recorded`);
  }

  /**
   * Record a decision about a completed stage. The only code that writes a
   * review event, so every caller's approval means the same thing.
   *
   * Origin comes from the principal, never from the request: an `operator`
   * decides as `human` and the receipt is signed; an `agent` decides as
   * `agent`. An agent asking to approve or reject a `review: human` stage is
   * not refused — it is downgraded to a request, so a headless caller stops
   * with an explicit ask instead of assuming yes (harness review, P0).
   *
   * `decision: "requested"` always writes a request, whatever the principal
   * and level (M1). An agent's request — explicit or downgraded — writes
   * nothing when the gate already reads the stage approved (I5), so asking
   * can never cancel a current approval.
   */
  async review(
    ref: EpisodeRef,
    pipeline: string,
    stageId: string,
    input: ReviewInput,
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    const stage = resolved.value.stages.find((s) => s.definition.id === stageId);
    if (!stage) {
      return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
    }
    const blocked = (reason: string): Result<StageOutcome, ExecutionError> =>
      ok({ stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt });

    const level = stage.definition.gates.review;
    if (level === "none") return blocked(`"${stageId}" declares no review, so there is nothing to decide`);

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;
    let derived;
    try {
      derived = deriveExecutionState(events.value, resolved.value.stages.map((s) => s.definition.id), this.now());
    } catch (e) {
      return err({ code: "REPLAY_INVALID", message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}` });
    }
    const instance = derived.get(stageId)!;
    if (instance.status !== "completed") {
      return blocked(`"${stageId}" has not completed, so there is nothing to review`);
    }
    if (instance.outputArtifacts.length === 0) {
      return blocked(`"${stageId}" recorded no outputs, and a decision about nothing cannot be invalidated by anything`);
    }

    // The selected take's files, not whatever the latest attempt reported:
    // an attempt kept beside an operator's locked take is not what the stage
    // stands on (avg-qr4.6). A completion from before candidates were kept
    // has only the paths it reported.
    const selected = deriveTakes(events.value, resolved.value.stages.map((s) => s.definition.id), {
      key: this.options.operatorKey ?? null, episode: episodeSlug(ref),
    }).get(stageId)!.selected;
    const reviewed = selected?.outputs ? selected.paths : instance.outputArtifacts;

    let outputs;
    try {
      outputs = await hashArtifacts(episodeDir, reviewed);
    } catch (e) {
      return blocked(`"${stageId}" cannot be reviewed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const asAgentOnHumanGate = input.principal !== "operator" && level === "human" && input.decision !== "requested";
    const decision = asAgentOnHumanGate ? "requested" : input.decision;
    const origin = input.principal === "operator" ? "human" : "agent";
    if (origin === "human" && decision !== "requested" && !this.options.operatorKey) {
      return blocked(`no operator key is configured to sign with, so a human decision about "${stageId}" cannot be recorded`);
    }

    let record;
    try {
      record = buildGateReview({
        stageId, decision,
        origin,
        actor: "runtime",
        binding: { planHash: planHashOf(stage.definition), outputs },
        // Signed with the decision (avg-qr4.3 final review), so the receipt
        // cannot be carried into a sibling episode that shares its plan.
        episode: episodeSlug(ref),
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
    } catch (e) {
      return blocked(e instanceof Error ? e.message : String(e));
    }
    if (decision !== "requested" && origin === "human") record = signReceipt(record, this.options.operatorKey!);

    // Under the stage's own lock, so a decision cannot interleave with a
    // re-run of the stage it is about. A live lease means the stage is
    // running, and `instance.status` above has already refused that; the lock
    // closes the window between that read and this write.
    const lock = this.lock(episodeDir);
    const lease = await lock.acquire(`stage:${stageId}`, 30_000);
    if (!lease.ok) return blocked(`"${stageId}" is held by a run; try again when it finishes`);
    let written;
    try {
      // avg-qr4.3 final review, I5: an agent's request used to land after
      // the operator's signed grant, and the gate governs by the LAST review
      // event — so Pi asking for a review cancelled a current human approval.
      // Asked under the stage lock, so no grant can land between this read
      // and the write it guards.
      if (decision === "requested" && origin === "agent" && this.options.review) {
        let verdict;
        try {
          verdict = await this.options.review.isOutstanding(stageId, episodeDir, stage, { episode: episodeSlug(ref) });
        } catch {
          // A gate that cannot answer is not evidence of an approval; the
          // request is written, which can only make the stage wait.
          verdict = undefined;
        }
        if (verdict?.state === "approved") {
          return ok({
            stageId, status: "approved", outputs: instance.outputArtifacts, durationMs: Date.now() - startedAt,
            reason: level === "human"
              ? `"${stageId}" is already approved by the operator; nothing was requested`
              : `"${stageId}" is already approved; nothing was requested`,
          });
        }
      }
      written = await appendJournalEvent(episodeDir, {
        type: REVIEW_EVENT_FOR[decision], actor: "runtime", episode: ref, data: { ...record },
      });
    } finally {
      await lock.release(lease.value);
    }
    if (!written) return blocked(`the ${decision} decision for "${stageId}" could not be written to the journal`);

    // After releasing the stage's own lock, not before: `markStale` writes a
    // SEPARATE event about OTHER stages, so holding `stage:${stageId}` across
    // it would block a concurrent run or review of this stage for no benefit
    // — the write this decision itself needed to protect already landed above.
    // A request (`decision === "requested"`) is never signed and never
    // changes what a dependent accepted, so it triggers nothing here.
    if (decision !== "requested") {
      await this.markStale(episodeDir, ref, resolved.value, stageId);
    }

    return ok({
      stageId,
      status: decision,
      outputs: instance.outputArtifacts,
      durationMs: Date.now() - startedAt,
      ...(asAgentOnHumanGate
        ? { reason: `"${stageId}" declares human review; approval requested — an operator must approve it` }
        : {}),
    });
  }

  /**
   * Finish a completion whose candidate does not become the take, because the
   * operator selected one (avg-qr4.6).
   *
   * The performer has just written the canonical paths, so the locked take's
   * files are put back over them — still under this attempt's lease, so
   * nothing can read the canonical paths in between and nothing can select
   * in between. No review request is written: the take did not change, and a
   * request would bury the decision that stands on it.
   */
  private async keepBesideLockedTake(
    episodeDir: string, ref: EpisodeRef, stage: ResolvedStage, sm: StageStateMachine,
    instance: EngineStageInstance, lockedTake: { attemptNumber: number; outputs: ArtifactHash[] | null },
    digests: ArtifactHash[],
    done: { stageId: string; outputs: string[]; attemptNumber: number; leaseId: string; startedAt: number },
  ): Promise<StageOutcome> {
    const { stageId } = done;
    const notes = [
      `"${stageId}" attempt ${done.attemptNumber} was kept as a candidate; ` +
      `the operator's take, attempt ${lockedTake.attemptNumber}, stays selected`,
    ];
    try {
      const bad = await verifyCandidate(episodeDir, stageId, lockedTake.attemptNumber, lockedTake.outputs!);
      if (bad) {
        notes.push(`its files could not be put back: ${bad}`);
      } else {
        await materialize(episodeDir, stageId, lockedTake.attemptNumber, lockedTake.outputs!, digests.map((d) => d.path));
      }
    } catch (e) {
      notes.push(`its files could not be put back: ${e instanceof Error ? e.message : String(e)}`);
    }

    await sm.complete(instance);

    // The stage stands on the locked take, so it is accepted exactly when
    // that take is.
    let status: OutcomeStatus = "completed";
    if (stage.definition.gates.review !== "none") {
      let verdict: ReviewVerdict | undefined;
      try {
        verdict = await this.options.review?.isOutstanding(stageId, episodeDir, stage, { episode: episodeSlug(ref) });
      } catch {
        verdict = undefined;
      }
      if (verdict?.state !== "approved") status = "awaiting_review";
    }
    return {
      stageId, status, outputs: done.outputs, attemptNumber: done.attemptNumber, leaseId: done.leaseId,
      durationMs: Date.now() - done.startedAt, reason: notes.join("; "),
    };
  }

  /**
   * Make an earlier candidate a stage's take (avg-qr4.6).
   *
   * Under the stage's own lock — the one a running attempt holds for its
   * lease and `review()` takes — with the journal re-read inside it, so the
   * compare-and-swap on `expected` compares against the record as it is, not
   * as it was before the lock was won. The candidate's kept files are
   * verified before anything is touched, put in place, and only then
   * recorded: the append is the commit point, and a crash before it leaves
   * drift that `takes()` reports and selecting again repairs.
   */
  async select(
    ref: EpisodeRef,
    pipeline: string,
    stageId: string,
    input: SelectInput,
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    const stage = resolved.value.stages.find((s) => s.definition.id === stageId);
    if (!stage) {
      return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
    }
    const blocked = (reason: string): Result<StageOutcome, ExecutionError> =>
      ok({ stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt });

    const origin = input.principal === "operator" ? "human" : "agent";
    if (origin === "human" && !this.options.operatorKey) {
      return blocked(`no operator key is configured to sign with, so an operator's selection for "${stageId}" cannot be recorded`);
    }

    const episodeDir = this.episodeDir(ref);
    const lock = this.lock(episodeDir);
    // Longer than `review()`'s thirty seconds: a selection hashes and copies
    // a take, which can be a rendered video, and a lock that lapsed halfway
    // would let a run start on files still being replaced.
    const lease = await lock.acquire(`stage:${stageId}`, SELECT_LOCK_TTL_MS);
    if (!lease.ok) return blocked(`"${stageId}" is held by a run; try again when it finishes`);

    let changed = false;
    let outcome: Result<StageOutcome, ExecutionError>;
    try {
      outcome = await (async (): Promise<Result<StageOutcome, ExecutionError>> => {
        const events = await this.readJournal(episodeDir);
        if (!events.ok) return events;
        const stageIds = resolved.value.stages.map((s) => s.definition.id);
        let derived;
        try {
          derived = deriveExecutionState(events.value, stageIds, this.now());
        } catch (e) {
          return err({ code: "REPLAY_INVALID", message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}` });
        }
        // The lock should make this unreachable; a lockfile lost under a
        // live lease must not let a selection land in the middle of an attempt.
        if (derived.get(stageId)!.status === "running") {
          return blocked(`"${stageId}" is running; select a take when it finishes`);
        }

        const takes = deriveTakes(events.value, stageIds, {
          key: this.options.operatorKey ?? null, episode: episodeSlug(ref),
        }).get(stageId)!;
        const current = takes.selected;
        const currentNumber = current?.attemptNumber ?? null;
        const describe = (n: number | null) => (n === null ? "none" : `attempt ${n}`);

        if (input.expected !== undefined && input.expected !== currentNumber) {
          return blocked(
            `the selected take of "${stageId}" is ${describe(currentNumber)}, not ${describe(input.expected)}: ` +
            `it changed since it was read, so nothing was selected`,
          );
        }
        const candidate = takes.candidates.find((c) => c.attemptNumber === input.attemptNumber);
        if (!candidate) {
          return blocked(
            `"${stageId}" has no candidate from attempt ${input.attemptNumber}: it never completed, ` +
            `or it completed before candidates were kept`,
          );
        }
        const same = currentNumber === candidate.attemptNumber;
        if (current?.locked && origin !== "human" && !same) {
          return blocked(`the operator selected attempt ${currentNumber} of "${stageId}"; only the operator can change it`);
        }

        const bad = await verifyCandidate(episodeDir, stageId, candidate.attemptNumber, candidate.outputs);
        if (bad) return blocked(`attempt ${candidate.attemptNumber} of "${stageId}" cannot be selected: ${bad}`);

        const displaced = !same && current?.outputs ? current.paths : [];
        try {
          await materialize(episodeDir, stageId, candidate.attemptNumber, candidate.outputs, displaced);
        } catch (e) {
          return blocked(
            `attempt ${candidate.attemptNumber} of "${stageId}" could not be put in place: ` +
            `${e instanceof Error ? e.message : String(e)}; select it again to finish`,
          );
        }
        const paths = candidate.outputs.map((o) => o.path);

        // Already the take: its files are back in place, and there is
        // nothing new to record — unless the operator is locking a take that
        // policy or an agent selected.
        if (same && !(origin === "human" && !current!.locked)) {
          return ok({
            stageId, status: "selected", outputs: paths, attemptNumber: candidate.attemptNumber,
            durationMs: Date.now() - startedAt,
            reason: `attempt ${candidate.attemptNumber} of "${stageId}" was already selected; its files are in place`,
          });
        }

        let record = buildTakeSelection({
          stageId, origin, actor: "runtime", attemptNumber: candidate.attemptNumber,
          leaseId: candidate.leaseId, outputs: candidate.outputs, episode: episodeSlug(ref), previous: currentNumber,
        });
        if (origin === "human") record = signReceipt(record, this.options.operatorKey!);
        const written = await appendJournalEvent(episodeDir, {
          type: "take-selected", actor: "runtime", episode: ref, data: { ...record },
        });
        if (!written) {
          // Put the files back, so they keep agreeing with the record.
          let note = "";
          if (!same) {
            if (current?.outputs && !(await verifyCandidate(episodeDir, stageId, current.attemptNumber, current.outputs))) {
              await materialize(episodeDir, stageId, current.attemptNumber, current.outputs, paths)
                .catch(() => { note = "; the previous take's files could not be put back"; });
            } else {
              note = "; the previous take has no kept copy to put back, so the files now differ from the record";
            }
          }
          return blocked(`the selection of attempt ${candidate.attemptNumber} for "${stageId}" could not be written to the journal${note}`);
        }
        changed = !same;

        // A new take is something nobody has reviewed. Written under the lock,
        // as `complete()` writes its request, so it cannot bury a grant that
        // lands after it; skipped when the gate already accepts these bytes.
        let requestNote: string | undefined;
        if (changed && stage.definition.gates.review !== "none") {
          let verdict: ReviewVerdict | undefined;
          try {
            verdict = await this.options.review?.isOutstanding(stageId, episodeDir, stage, { episode: episodeSlug(ref) });
          } catch {
            verdict = undefined;
          }
          if (verdict?.state !== "approved") {
            const request = buildGateReview({
              stageId, decision: "requested", origin: "policy", actor: "runtime", episode: episodeSlug(ref),
              binding: { planHash: planHashOf(stage.definition), outputs: candidate.outputs },
            });
            const asked = await appendJournalEvent(episodeDir, {
              type: "approval-requested", actor: "runtime", episode: ref, data: { ...request },
            });
            requestNote = asked
              ? `"${stageId}" declares ${stage.definition.gates.review} review and the selected take is not accepted yet`
              : `the review request for "${stageId}" could not be written to the journal`;
          }
        }

        return ok({
          stageId, status: "selected", outputs: paths, attemptNumber: candidate.attemptNumber,
          durationMs: Date.now() - startedAt,
          ...(requestNote ? { reason: requestNote } : {}),
        });
      })();
    } finally {
      await lock.release(lease.value);
    }

    // Outside the stage's lock, as in `review()`: staleness is a separate
    // record about OTHER stages.
    if (changed) await this.markStale(episodeDir, ref, resolved.value, stageId);
    return outcome;
  }

  /**
   * Every stage's candidates and selected take, and whether the selected
   * take's files on disk still match its record (avg-qr4.6).
   *
   * This hashes; `status()`, which is polled, does not.
   */
  async takes(ref: EpisodeRef, pipeline: string): Promise<Result<EpisodeTakes, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const takes = deriveTakes(events.value, resolved.value.stages.map((s) => s.definition.id), {
      key: this.options.operatorKey ?? null, episode: episodeSlug(ref),
    });
    const stages: StageTakesReport[] = [];
    for (const stage of resolved.value.stages) {
      const entry = takes.get(stage.definition.id)!;
      const selected = entry.selected;
      stages.push({
        stageId: entry.stageId,
        selected: selected
          ? {
            attemptNumber: selected.attemptNumber, origin: selected.origin, locked: selected.locked,
            at: selected.at, paths: selected.paths, verified: selected.verified, legacy: selected.outputs === null,
          }
          : null,
        candidates: entry.candidates.map((c) => ({
          attemptNumber: c.attemptNumber, at: c.at, outputs: c.outputs,
          selected: selected?.attemptNumber === c.attemptNumber,
        })),
        drifted: selected?.outputs ? await driftOf(episodeDir, selected.outputs) : [],
      });
    }
    return ok({ ref, pipeline, stages });
  }

  /**
   * Perform one stage here and now.
   *
   * Exactly `claim`, then the configured dispatcher, then `complete` — not a
   * parallel implementation that happens to agree with them.
   */
  async run(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean; principal?: Principal } = {},
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();

    const claimed = await this.claimInternal(ref, pipeline, opts, (stage) => {
      if (!this.options.dispatcher) {
        return `no dispatcher is configured, so "${stage.definition.id}" cannot be performed`;
      }
      if (this.options.dispatcher.canDispatch?.(stage) === false) {
        return `the configured dispatcher does not handle "${stage.definition.id}"`;
      }
      return null;
    });
    if (!claimed.ok) return claimed;

    const { outcome, stage, ctx } = claimed.value;
    if (outcome.status !== "claimed" || !stage || !ctx) return ok(outcome);

    const stageId = stage.definition.id;
    // Non-null rather than a destructure: `claimed` carries this on every
    // `claimed` outcome, but the type cannot say so.
    const leaseId = outcome.leaseId!;

    // ── Dispatch ──────────────────────────────────────────────────────────
    let outputs: string[];
    try {
      outputs = await this.options.dispatcher!.dispatch(stage, ctx);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // `complete` decides whether this failure may still be recorded — a
      // lapsed claim writes nothing at all. Either way the caller hears what
      // its dispatcher actually did, which is the one thing `complete`
      // cannot read back out of the journal.
      const failed = await this.complete(ref, pipeline, stageId, { leaseId, failed: true, error: message });
      if (!failed.ok) return failed;
      const reason = failed.value.reason === message
        ? message
        : `${failed.value.reason} (it then threw: ${message})`;
      return ok({ ...failed.value, reason, durationMs: Date.now() - startedAt });
    }

    const done = await this.complete(ref, pipeline, stageId, { outputs, leaseId });
    return done.ok ? ok({ ...done.value, durationMs: Date.now() - startedAt }) : done;
  }

  /**
   * Record a failed attempt and release its lease, in that order.
   *
   * Only ever reached with an attempt this process still holds: both call
   * sites ask `held()` immediately before calling, which reads the lease's
   * own `expiresAt` off the journal. That guard, not the structural "no open
   * attempt" refusal higher up, is what keeps a lapsed holder from appending
   * a terminal event after a second holder has already closed the stage —
   * the structural check was only true at the instant `deriveExecutionState`
   * ran, and `validateOutputs` sits between there and here.
   *
   * Returns whether the journal write landed. `appendJournalEvent` returns
   * null instead of throwing, and a dropped `stage-failed` means the lease
   * is still open as far as every other reader is concerned; the lease is
   * left to lapse rather than released, so the journal and the lockfile
   * agree. The caller says so out loud.
   */
  private async recordFailure(
    episodeDir: string, ref: EpisodeRef, sm: StageStateMachine,
    instance: EngineStageInstance, stageId: string, leaseId: string,
    attemptNumber: number, error: string,
  ): Promise<boolean> {
    const recorded = await appendJournalEvent(episodeDir, {
      type: "stage-failed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, error, retryable: true },
    });
    if (!recorded) return false;
    await sm.fail(instance, error, true);
    return true;
  }

  /**
   * Run named stages again.
   *
   * There is no separate machinery: a completed stage that is named explicitly
   * takes a fresh lease, which replay reads as a new attempt — `completed ->
   * pending` is a legal transition precisely because the journal is cumulative
   * across runs.
   *
   * Every id is validated against the resolved pipeline before any of them
   * runs. A typo in the third of three ids must not leave the first two
   * reran with no way for the caller to know it happened — a caller asking
   * for three reruns and getting one, undocumented, is worse than getting
   * none plus a clear error.
   *
   * Stops at the first stage that does not complete, so a caller is not left
   * guessing which of several reruns is responsible for the state they see.
   * A hard error partway through (the journal becoming unreadable, say) does
   * not discard what already ran: it rides along on the error as
   * `partialOutcomes`.
   */
  async rerun(
    ref: EpisodeRef,
    pipeline: string,
    stageIds: string[],
  ): Promise<Result<StageOutcome[], ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    const declared = new Set(resolved.value.stages.map((s) => s.definition.id));
    for (const stageId of stageIds) {
      if (!declared.has(stageId)) {
        return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
      }
    }

    const outcomes: StageOutcome[] = [];
    for (const stageId of stageIds) {
      const outcome = await this.run(ref, pipeline, { stage: stageId });
      if (!outcome.ok) return err({ ...outcome.error, partialOutcomes: outcomes });
      outcomes.push(outcome.value);
      if (outcome.value.status !== "completed") break;
    }
    return ok(outcomes);
  }

  /**
   * Which stages a rerun would touch.
   *
   * The stage map `planRerun` needs is exactly what replay produces, so this
   * is replay plus the planner — no new machinery, and no second notion of
   * what a rerun covers.
   *
   * A `StalenessReport` is computed here — via `propagate`, the same function
   * `markStale` calls — only for `rerun-affected-downstream`, the one mode
   * that reads one; the other three derive their rerun set from the stage map
   * alone and would silently plan nothing against a report that named stages
   * they never asked about. With no `selectedStages` there is nothing to
   * propagate FROM, so that case is refused before the planner is even asked,
   * with a message naming what is missing rather than the planner's generic
   * "not computed yet". The episode slug is built from `ref` and passed
   * through explicitly, so the plan names the episode it was actually
   * computed for rather than falling back to the pipeline's name.
   */
  async planRerun(
    ref: EpisodeRef,
    pipeline: string,
    mode: RerunMode,
    selectedStages: string[] = [],
  ): Promise<Result<RerunPlan, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;

    // Validated before anything else — including before the journal is read
    // — for the same reason `rerun()` validates every id up front: an
    // unknown id silently dropped from the rerun set is not a smaller rerun,
    // it is a rerun of the wrong thing with no record that anything was
    // refused. Without this, `rerun-selected --stages typo-id` planned zero
    // stages and reported "0 stage(s)" at exit 0 — this task's own defect,
    // recreated one layer up from where Task 3 already closed it in
    // `rerun()`.
    const declared = new Set(resolved.value.stages.map((s) => s.definition.id));
    for (const stageId of selectedStages) {
      if (!declared.has(stageId)) {
        return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
      }
    }

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;

    const stageIds = resolved.value.stages.map((s) => s.definition.id);
    let derived;
    try {
      derived = deriveExecutionState(events.value, stageIds, this.now());
    } catch (e) {
      return err({
        code: "REPLAY_INVALID",
        message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const engineInstances = new Map(
      resolved.value.stages.map((s) => [
        s.definition.id, this.toEngineInstance(derived.get(s.definition.id)!, s),
      ]),
    );

    const slug = episodeSlug(ref);

    let report;
    if (mode === "rerun-affected-downstream") {
      if (selectedStages.length === 0) {
        // Refused here, before the planner (and before `propagate`, which has
        // nothing to compute FROM with no changed stages): a mode this build
        // implements but a caller who forgot to name what changed. Not
        // STAGE_UNKNOWN — nothing named here is unknown, a required argument
        // is simply absent.
        return err({
          code: "MODE_UNSUPPORTED",
          message: 'mode "rerun-affected-downstream" needs the stages that changed (--stages a,b)',
        });
      }
      report = propagate(resolved.value, selectedStages, slug);
    }

    try {
      return ok(planRerun(report, resolved.value, engineInstances, mode, selectedStages, slug));
    } catch (e) {
      // The planner still throws for a mode this switch does not otherwise
      // reach with a report — kept as a catch-all rather than trusted to
      // never fire twice for the same reason.
      return err({
        code: "MODE_UNSUPPORTED",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/** Every stage this one is built on has completed. */
export function dependenciesMet(
  stage: ResolvedStage,
  derived: Map<string, { status: string }>,
): boolean {
  return (stage.definition.dependsOn ?? []).every(
    (id) => derived.get(id)?.status === "completed",
  );
}

/**
 * The "channel/series/episode" slug a human receipt signs and the review gate
 * compares against (avg-qr4.3 final review), and staleness reports name.
 */
export function episodeSlug(ref: EpisodeRef): string {
  return `${ref.channel}/${ref.series}/${ref.episode}`;
}
