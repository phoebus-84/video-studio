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
import { resolvePipeline } from "../pipeline/resolver.js";
import { createDefaultLoader } from "../pipeline/fs-loader.js";
import type { ResolvedPipeline, ResolvedStage } from "../pipeline/types.js";
import { ok, err, type Result } from "../result.js";
import { StageStateMachine, LeaseError, attemptsSinceLastSuccess } from "../engine/state-machine.js";
import { DEFAULT_ENGINE_CONFIG, type StageInstance as EngineStageInstance } from "../engine/types.js";
import { FileLock } from "../ports/file-lock.js";
import type {
  EpisodeRef, EpisodeStatus, ExecutionError, ExecutionServiceOptions, StageStatusReport,
  DispatchContext, StageOutcome,
} from "./types.js";

export class ExecutionService {
  constructor(private readonly options: ExecutionServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private episodeDir(ref: EpisodeRef): string {
    return episodePath(this.options.libraryRoot, ref.channel, ref.series, ref.episode);
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

    const reports: StageStatusReport[] = stages.map((stage) => {
      const instance = derived.get(stage.definition.id)!;
      return {
        stageId: stage.definition.id,
        name: stage.definition.name,
        status: instance.status,
        attempts: instance.attempts.length,
        outputArtifacts: instance.outputArtifacts,
        lease: leaseState(instance, now),
        dependenciesMet: dependenciesMet(stage, derived),
      };
    });

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

  async run(
    ref: EpisodeRef,
    pipeline: string,
    opts: { stage?: string; dryRun?: boolean } = {},
  ): Promise<Result<StageOutcome, ExecutionError>> {
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
      return ok({ stageId: null, status: "idle", outputs: [], durationMs: Date.now() - startedAt });
    }

    const stageId = stage.definition.id;
    const blocked = (reason: string): Result<StageOutcome, ExecutionError> =>
      ok({ stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt, dryRun: opts.dryRun });

    // ── Gate ──────────────────────────────────────────────────────────────
    // A dependency is satisfied when it completed AND its review, if one is
    // required, is not outstanding. Completion is what happened; acceptance is
    // whether it counts. Conflating them is how downstream stages came to build
    // on artifacts nobody had accepted.
    const unmet = (stage.definition.dependsOn ?? [])
      .filter((id) => derived.get(id)?.status !== "completed");
    if (unmet.length > 0) {
      return blocked(
        `"${stageId}" depends on ${unmet.map((m) => `"${m}"`).join(", ")}, ` +
        `which ${unmet.length === 1 ? "has" : "have"} not completed`,
      );
    }

    for (const depId of stage.definition.dependsOn ?? []) {
      if (this.options.review) {
        // A gate is injected: it is authoritative for every dependency,
        // regardless of what that dependency's own manifest declares. This is
        // what lets a caller-supplied gate say "this is outstanding" even for
        // a dependency whose gates.review is "none" — the gate's record beats
        // the manifest's default.
        const verdict = await this.options.review.isOutstanding(depId, episodeDir);
        if (verdict.outstanding) {
          return blocked(
            `"${stageId}" cannot run: "${depId}" ${verdict.reason ?? "has an outstanding review"}`,
          );
        }
        continue;
      }

      // No gate configured: the service cannot know whether a required
      // review happened, so it does not guess. Absence is refusal exactly
      // where something is protected — a dependency the manifest never asked
      // to be reviewed proceeds untouched.
      const depStage = stages.find((s) => s.definition.id === depId);
      const depNeedsReview = depStage?.definition.gates.review !== "none";
      if (depNeedsReview) {
        return blocked(
          `"${depId}" declares ${depStage!.definition.gates.review} review and no review gate ` +
          `is configured, so whether it was accepted cannot be known`,
        );
      }
    }

    const ctx: DispatchContext = {
      episodeDir, ref,
      attemptNumber: derived.get(stageId)!.attempts.length + 1,
      log,
    };

    if (!this.options.dispatcher) {
      return blocked(`no dispatcher is configured, so "${stageId}" cannot be performed`);
    }
    if (this.options.dispatcher.canDispatch?.(stage) === false) {
      return blocked(`the configured dispatcher does not handle "${stageId}"`);
    }
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
    const sm = new StageStateMachine(new FileLock(path.join(episodeDir, ".locks")), engineConfig);

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
        stageId, status: "would-run", reason: "dry run — would have dispatched",
        outputs: [], durationMs: Date.now() - startedAt, dryRun: true,
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

    // Once the lease has lapsed this attempt may say nothing about the stage,
    // in any journal line: see `lapsed` below.
    const lapsed = (detail = ""): Result<StageOutcome, ExecutionError> => ok({
      stageId, status: "failed",
      reason: `the lease on "${stageId}" expired after ${ttlMs}ms, while the stage was ` +
        `still running${detail}`,
      outputs: [], attemptNumber, leaseId, durationMs: Date.now() - startedAt,
    });

    // ── Dispatch ──────────────────────────────────────────────────────────
    let outputs: string[];
    try {
      outputs = await this.options.dispatcher.dispatch(stage, { ...ctx, attemptNumber });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (this.leaseLapsed(expiresAt)) return lapsed(` (it then threw: ${message})`);
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, message);
      return ok({ stageId, status: "failed", reason: message, outputs: [], attemptNumber, leaseId,
        durationMs: Date.now() - startedAt });
    }

    // The lease may have expired while the stage was working. If it has,
    // something else may already have taken the stage, so this attempt's
    // outputs cannot be trusted — and nothing is written.
    if (this.leaseLapsed(expiresAt)) return lapsed();

    // ── Validate ──────────────────────────────────────────────────────────
    const invalid = await this.validateOutputs(episodeDir, outputs);
    // Validation is filesystem work and takes time; re-checked so that the
    // gap between the check above and either write below stays as small as
    // it can be made without renewing the lease.
    if (this.leaseLapsed(expiresAt)) {
      return lapsed(invalid ? ` (its outputs were also invalid: ${invalid})` : "");
    }
    if (invalid) {
      await this.recordFailure(episodeDir, ref, sm, instance, stageId, leaseId, attemptNumber, invalid);
      return ok({ stageId, status: "failed", reason: invalid, outputs: [], attemptNumber, leaseId,
        durationMs: Date.now() - startedAt });
    }

    const relative = outputs.map((o) => path.isAbsolute(o) ? path.relative(episodeDir, o) : o);

    // The journal is written before the lease is released. If this process dies
    // in between, the record says what happened and the lease expires on its
    // own; releasing first would leave a completed stage looking unstarted.
    await appendJournalEvent(episodeDir, {
      type: "stage-completed", actor: "runtime", episode: ref,
      data: { stageId, leaseId, attemptNumber, outputs: relative },
    });
    await sm.complete(instance);

    // A stage that declares a review has run, and its outputs hold up — but it
    // is not accepted. Its journal record says completed because that is true;
    // its outcome says awaiting_review because that is what the caller needs.
    const needsReview = stage.definition.gates.review !== "none";
    return ok({
      stageId,
      status: needsReview ? "awaiting_review" : "completed",
      outputs: relative, attemptNumber, leaseId,
      durationMs: Date.now() - startedAt,
      ...(needsReview ? { reason: `"${stageId}" declares ${stage.definition.gates.review} review and is not accepted yet` } : {}),
    });
  }

  /**
   * Whether this attempt's lease has lapsed, and with it this attempt's
   * right to write anything at all about the stage.
   *
   * Once the lease expires, another holder may already have reclaimed the
   * lockfile and appended its own `stage-leased`/`stage-started`. A terminal
   * event for the stale lease landing after that holder's own terminal event
   * makes replay throw (`cannot go from completed to failed`) — and since the
   * journal is append-only, it throws on every future replay too: every
   * later `status()` and `run()` on that episode returns REPLAY_INVALID
   * forever. Landing before it is only marginally better: replay survives but
   * reports a state nobody was ever in.
   *
   * So a lapsed attempt writes nothing. Nothing is lost by the silence:
   * replay's `closeIfExpired` derives the timeout from the lease's own
   * `expiresAt`, which is already in the journal, so an explicit event adds
   * no information and risks the whole episode.
   */
  private leaseLapsed(expiresAt: string): boolean {
    return this.now().getTime() >= Date.parse(expiresAt);
  }

  /**
   * Record a failed attempt and release its lease, in that order.
   *
   * Every call site must check `leaseLapsed` first: a dispatcher that throws
   * after its lease lapsed must not append either, for exactly the reason
   * that method documents.
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
