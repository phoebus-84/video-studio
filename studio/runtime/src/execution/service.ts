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
import { resolvePipeline } from "../pipeline/resolver.js";
import { createDefaultLoader } from "../pipeline/fs-loader.js";
import type { ResolvedPipeline, ResolvedStage } from "../pipeline/types.js";
import { ok, err, type Result } from "../result.js";
import { StageStateMachine, LeaseError, attemptsSinceLastSuccess } from "../engine/state-machine.js";
import { DEFAULT_ENGINE_CONFIG, type StageInstance as EngineStageInstance } from "../engine/types.js";
import { FileLock } from "../ports/file-lock.js";
import type {
  EpisodeRef, EpisodeStatus, ExecutionError, ExecutionServiceOptions, StageStatusReport,
  StageState, CompleteInput, DispatchContext, StageOutcome,
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

export class ExecutionService {
  constructor(private readonly options: ExecutionServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private episodeDir(ref: EpisodeRef): string {
    return episodePath(this.options.libraryRoot, ref.channel, ref.series, ref.episode);
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

    const reports: StageStatusReport[] = [];
    for (const stage of stages) {
      const instance = derived.get(stage.definition.id)!;
      const lease = leaseState(instance, now);
      const depsMet = dependenciesMet(stage, derived);
      // Only a stage that has not run yet has a question to ask: the rest are
      // described by what the journal already recorded.
      const blockedReason = instance.status === "pending"
        ? await this.whyBlocked(stage, stages, derived, episodeDir)
        : null;

      let state: StageState;
      if (instance.status === "completed") {
        // A completed stage that declares a review reports `awaiting_review`
        // even where a ReviewGate would say `approved`. That is a known
        // simplification: reconciling it needs avg-qr4.3's definition of what
        // an approval is, and the studio's action for `awaiting_review` is
        // "approve", which is harmless to offer twice.
        state = stage.definition.gates.review !== "none" ? "awaiting_review" : "completed";
      } else if (instance.status === "running") {
        state = "running";
      } else if (instance.status === "failed") {
        state = "failed";
      } else if (!depsMet) {
        // Waiting its turn, not stuck. `blocked` is reserved for a refusal
        // somebody has to clear — an outstanding review, `autopilot: false` —
        // because that is the distinction a caller acts on. `blockedReason`
        // still carries what it is waiting for.
        state = "pending";
      } else {
        state = blockedReason ? "blocked" : "runnable";
      }

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
        ...(blockedReason ? { blockedReason } : {}),
      });
    }

    return ok({ ref, pipeline, stages: reports });
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
   */
  private async whyBlocked(
    stage: ResolvedStage,
    stages: ResolvedStage[],
    derived: Map<string, { status: string }>,
    episodeDir: string,
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
    // happens to have no gateway handler and so stopped at `canDispatch`.
    // Give one a handler — or ship a manifest that gates an ordinary stage —
    // and it ran unattended, which is the one thing the flag exists to
    // prevent.
    //
    // Below the unmet-dependency check, which names an earlier and more
    // useful problem, and above everything that leases, dispatches or spends.
    if (!stage.definition.gates.autopilot) {
      return `"${stageId}" declares autopilot: false and may not run unattended; ` +
        `a person has to run it`;
    }

    for (const depId of stage.definition.dependsOn ?? []) {
      if (this.options.review) {
        // An injected gate is authoritative only where it actually knows
        // something. It used to be authoritative for everything, including
        // stages it had never heard of — and since "I have no record" came
        // back as `outstanding: false`, injecting a gate SUPPRESSED the
        // manifest fallback below and made the service more permissive than
        // having no gate at all. That is precisely backwards, and it was the
        // gateway — the only composition that ships — that got the weak path.
        const verdict = await this.options.review.isOutstanding(depId, episodeDir);
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
      const depStage = stages.find((s) => s.definition.id === depId);
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
    opts: { stage?: string; dryRun?: boolean } = {},
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
    const refusal = await this.whyBlocked(stage, stages, derived, episodeDir);
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
      return blocked(`no budget guard is configured, so "${stageId}" may not spend`);
    }
    const permitted = await this.options.budget.maySpend(stage, ctx);
    if (!permitted.ok) {
      return blocked(`budget refused "${stageId}": ${permitted.error.message}`);
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

    const attemptNumber = instance.attempts.length;
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    const holder = this.options.holder ?? `runtime/pid-${process.pid}`;

    const leased = await appendJournalEvent(episodeDir, {
      type: "stage-leased", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, ttlMs, expiresAt, holder },
    });
    if (!leased) {
      // Nothing else has been recorded yet — release the lease we just took
      // and stop before dispatching. A dropped stage-started or
      // stage-completed self-heals (the lease expires, the stage becomes
      // retryable); a dropped stage-leased with stage-started still landing
      // would leave replay looking at a terminal-shaped gap it can never
      // close, since the journal is append-only. Failing here, before any
      // work happens, is the only point that can be undone.
      await sm.releaseAll();
      return blocked(`"${stageId}" could not be leased: the journal write for its lease did not land`);
    }
    await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber },
    });

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
    opts: { stage?: string; dryRun?: boolean } = {},
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

    if (input.failed) {
      const message = input.error ?? "the performer reported failure without saying why";
      if (!held()) return lapsed(open);
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, message);
      return ok({
        stageId, status: "failed", reason: message, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    const outputs = input.outputs ?? [];
    const invalid = await this.validateOutputs(episodeDir, outputs);
    if (invalid) {
      if (!held()) return lapsed(open);
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, invalid);
      return ok({
        stageId, status: "failed", reason: invalid, outputs: [],
        attemptNumber, leaseId, durationMs: Date.now() - startedAt,
      });
    }

    const relative = outputs.map((o) => path.isAbsolute(o) ? path.relative(episodeDir, o) : o);

    // The journal is written before the lease is released. If this process
    // dies in between, the record says what happened and the lease expires on
    // its own; releasing first would leave a completed stage looking unstarted.
    if (!held()) return lapsed(open);
    await appendJournalEvent(episodeDir, {
      type: "stage-completed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, outputs: relative },
    });
    await sm.complete(instance);

    // Completion is what happened; acceptance is whether it counts. The
    // journal says completed because that is true; the outcome says
    // awaiting_review because that is what the caller needs.
    const needsReview = stage.definition.gates.review !== "none";
    return ok({
      stageId,
      status: needsReview ? "awaiting_review" : "completed",
      outputs: relative, attemptNumber, leaseId,
      durationMs: Date.now() - startedAt,
      ...(needsReview
        ? { reason: `"${stageId}" declares ${stage.definition.gates.review} review and is not accepted yet` }
        : {}),
    });
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
    opts: { stage?: string; dryRun?: boolean } = {},
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
   * Only ever reached with an attempt replay still shows as open. A lapsed
   * one has no open attempt, so `complete` refuses above this and writes
   * nothing — see the reasoning on that branch.
   */
  private async recordFailure(
    episodeDir: string, ref: EpisodeRef, sm: StageStateMachine,
    instance: EngineStageInstance, stageId: string, leaseId: string,
    attemptNumber: number, error: string,
  ): Promise<void> {
    await appendJournalEvent(episodeDir, {
      type: "stage-failed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, error, retryable: true },
    });
    await sm.fail(instance, error, true);
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
