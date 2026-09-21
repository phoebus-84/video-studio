#!/usr/bin/env node
// ---------------------------------------------------------------------------
// video-pipeline-runtime CLI
//
// Operator CLI: init, resolve, validate, run, complete, status, rerun, approve,
// doctor.
// Defaults to human-readable output; --json for machine-readable.
// --dry-run for destructive/paid operations.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { ConsoleLogger } from "./logging.js";
import { VERSION } from "./index.js";
import { resolveSettings } from "./settings/index.js";
import {
  resolvePipeline,
  InMemoryPipelineLoader,
  createDefaultLoader,
  createSnapshot,
} from "./pipeline/index.js";
import type { PipelineLoader } from "./pipeline/types.js";
import { doctor } from "./workspace/doctor.js";
import { NodeFileSystem } from "./ports/filesystem.js";
import { SystemClock } from "./ports/clock.js";
import { FileSystemSnapshotStore } from "./pipeline/fs-snapshot-store.js";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import {
  appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH,
} from "@studio/contracts/src/journal.mjs";
import { buildGateReview, hashArtifacts } from "@studio/contracts/src/gate-review.mjs";
import { initChannel, initSeries, initEpisode } from "./workspace/init.js";
import { ExecutionService } from "./execution/index.js";
import type { ExecutionError, StageOutcome } from "./execution/index.js";
import type { RerunMode } from "./rerun/index.js";
import { err, ok } from "./result.js";
import type { Result } from "./result.js";

// ── Exit codes ──────────────────────────────────────────────────────────────

const EX_OK = 0;
const EX_USAGE = 1;
const EX_RUNTIME = 2;
const EX_INVALID = 3;

const DEFAULT_PIPELINE = "narrated-illustrated-video";

// ── Types ───────────────────────────────────────────────────────────────────

interface CliContext {
  logger: ConsoleLogger;
  jsonMode: boolean;
  dryRun: boolean;
}

interface CliCommand {
  name: string;
  description: string;
  usage: string;
  examples: string[];
  run(ctx: CliContext, args: string[]): Promise<number>;
}

// ── JSON output ─────────────────────────────────────────────────────────────

function emit(ctx: CliContext, data: Record<string, unknown>): void {
  if (ctx.jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    if (data.message) ctx.logger.info(String(data.message));
    if (data.warning) ctx.logger.warn(String(data.warning));
    if (data.error) ctx.logger.error(String(data.error));
    const { message: _message, warning: _warning, error: _error, ...rest } = data;
    if (Object.keys(rest).length > 0) {
      ctx.logger.info(JSON.stringify(rest, null, 2));
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parsePath(input: string) {
  const parts = input.split("/");
  if (parts.length !== 3) return null;
  return { channel: parts[0]!, series: parts[1]!, episode: parts[2]! };
}

function emptyLayer() {
  return { approvalPolicy: undefined, budget: undefined, outputProfile: undefined, locale: undefined, extensions: undefined };
}

/**
 * Resolve the library root from `--library`, falling back to the environment.
 *
 * Every command documents `--library`, but pipeline loading used to read only
 * AVG_LIBRARY_ROOT — so passing the flag alone silently produced an empty
 * in-memory loader and every episode reported "Pipeline not found".
 */
function libraryFrom(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--library" && args[i + 1]) return args[i + 1]!;
  }
  return process.env.AVG_LIBRARY_ROOT ?? "";
}

/**
 * Snapshot store rooted at a library.
 *
 * Episode slugs are `<channel>/<series>/<episode>`; the layout module turns
 * that into a path, so this does not need to know about containers.
 */
function makeSnapshotStore(libraryRoot: string): FileSystemSnapshotStore {
  return new FileSystemSnapshotStore(new NodeFileSystem(), (slug) => {
    const [channel, series, episode] = slug.split("/");
    return episodePath(libraryRoot, channel!, series!, episode!);
  });
}

function makeLoader(args: string[] = []): PipelineLoader {
  const libraryRoot = libraryFrom(args);
  if (libraryRoot) {
    return createDefaultLoader(libraryRoot) as unknown as PipelineLoader;
  }
  return new InMemoryPipelineLoader() as unknown as PipelineLoader;
}

// ── Argument helpers ───────────────────────────────────────────────────────

function extractPipeline(args: string[]): { pipeline?: string; remaining: string[] } {
  const idx = args.indexOf("--pipeline");
  if (idx >= 0 && idx + 1 < args.length) {
    const pipeline = args[idx + 1];
    const remaining = [...args];
    remaining.splice(idx, 2);
    return { pipeline, remaining };
  }
  return { remaining: args };
}

// ── doctor ──────────────────────────────────────────────────────────────────

async function cmdDoctor(ctx: CliContext, args: string[]): Promise<number> {
  // Parse --library <path>
  let libraryRoot = "";
  let channel: string | undefined;
  let series: string | undefined;
  let episode: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--library" && args[i + 1]) libraryRoot = args[++i]!;
    else if (args[i] === "--channel" && args[i + 1]) channel = args[++i];
    else if (args[i] === "--series" && args[i + 1]) series = args[++i];
    else if (args[i] === "--episode" && args[i + 1]) episode = args[++i];
  }

  if (!libraryRoot) {
    emit(ctx, { error: "--library <path> is required" });
    return EX_USAGE;
  }

  const fs = new NodeFileSystem();
  const report = await doctor({ fs, libraryRoot, channel, series, episode });

  if (ctx.jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    if (report.ok) {
      ctx.logger.info("✓ Workspace is healthy");
    } else {
      const errors = report.findings.filter((f) => f.code.startsWith("E_"));
      const warnings = report.findings.filter((f) => f.code.startsWith("W_"));
      ctx.logger.error(`${errors.length} error(s), ${warnings.length} warning(s)`);
      for (const f of report.findings) {
        const prefix = f.code.startsWith("E_") ? "✗" : "!";
        ctx.logger.error(`  ${prefix} [${f.code}] ${f.path}: ${f.message}`);
      }
    }
  }

  return report.ok ? EX_OK : EX_USAGE;
}

// ── init ────────────────────────────────────────────────────────────────────

/**
 * Create a channel, series and episode workspace.
 *
 * This used to parse the path, print "Workspace initialized" and return without
 * touching the disk — the whole implementation in workspace/init.ts, with its
 * contracts and canonical tree, was never called. Anything downstream that
 * expected a workspace contract (status, resolve, the studio) therefore failed
 * on episodes this command claimed to have created.
 *
 * Each level is idempotent, so re-running against an existing tree is safe.
 */
async function cmdInit(ctx: CliContext, args: string[]): Promise<number> {
  if (args.length < 1) {
    emit(ctx, { error: "Missing path. Usage: vpr init <channel>/<series>/<episode>" });
    return EX_USAGE;
  }
  const parsed = parsePath(args[0]!);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${args[0]}". Expected: <channel>/<series>/<episode>` });
    return EX_USAGE;
  }

  let libraryRoot = process.env.AVG_LIBRARY_ROOT ?? "";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--library" && args[i + 1]) libraryRoot = args[++i]!;
  }
  if (!libraryRoot) {
    emit(ctx, { error: "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }

  if (ctx.dryRun) {
    emit(ctx, {
      message: `[DRY RUN] Would init: ${parsed.channel}/${parsed.series}/${parsed.episode}`,
      dryRun: true,
    });
    return EX_OK;
  }

  const opts = { fs: new NodeFileSystem(), clock: new SystemClock(), logger: ctx.logger };

  const channelR = await initChannel(libraryRoot, parsed.channel, {}, opts);
  if (!channelR.ok) {
    emit(ctx, { error: `Init failed at channel: ${channelR.error.message}` });
    return EX_RUNTIME;
  }

  const seriesR = await initSeries(channelR.value.path, parsed.series, {}, opts);
  if (!seriesR.ok) {
    emit(ctx, { error: `Init failed at series: ${seriesR.error.message}` });
    return EX_RUNTIME;
  }

  const episodeR = await initEpisode(seriesR.value.path, parsed.episode, {}, opts);
  if (!episodeR.ok) {
    emit(ctx, { error: `Init failed at episode: ${episodeR.error.message}` });
    return EX_RUNTIME;
  }

  emit(ctx, {
    message: `Workspace initialized: ${parsed.channel}/${parsed.series}/${parsed.episode}`,
    ...parsed,
    path: episodeR.value.path,
  });
  return EX_OK;
}

// ── resolve ─────────────────────────────────────────────────────────────────

async function cmdResolve(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  if (remaining.length < 1) {
    emit(ctx, { error: "Usage: vpr resolve <channel>/<series>/<episode> [--pipeline <name>]" });
    return EX_USAGE;
  }
  const parsed = parsePath(remaining[0]!);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${remaining[0]}". Expected: <channel>/<series>/<episode>` });
    return EX_USAGE;
  }
  try {
    const { settings, report } = resolveSettings({
      channel: emptyLayer(),
      series: emptyLayer(),
      episode: emptyLayer(),
    });
    const loader = makeLoader(args);
    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);
    const episodeSlug = `${parsed.channel}/${parsed.series}/${parsed.episode}`;
    const libraryRoot = libraryFrom(args);
    const store = libraryRoot ? makeSnapshotStore(libraryRoot) : null;
    const previous = store ? await store.loadLatest(episodeSlug) : null;
    const snapshot = await createSnapshot({
      episodeSlug,
      pipeline,
      settings,
      providerBindings: [],
      sources: [],
      skillIds: [],
      previousVersion: previous?.version,
    });

    // Persist it. Without this the resolved contract died with the process and
    // every later command reported "Pipeline not found".
    if (store) {
      await store.save(snapshot);
    }

    emit(ctx, {
      message: `Snapshot created: ${snapshot.snapshotId}`,
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      pipeline: pipeline.name,
      stageCount: pipeline.stages.length,
      stages: pipeline.stages.map((s) => ({ id: s.definition.id, dependsOn: s.definition.dependsOn })),
      settingsReport: report,
    });
    return EX_OK;
  } catch (e) {
    emit(ctx, { error: `Resolve failed: ${e instanceof Error ? e.message : String(e)}` });
    return EX_RUNTIME;
  }
}

// ── status ──────────────────────────────────────────────────────────────────

async function cmdStatus(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  if (remaining.length < 1) {
    emit(ctx, { error: "Usage: vpr status <channel>/<series>/<episode> [--pipeline <name>]" });
    return EX_USAGE;
  }
  const parsed = parsePath(remaining[0]!);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${remaining[0]}"` });
    return EX_USAGE;
  }

  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }

  const service = makeService(args, ttl.value);
  const status = await service.status(parsed, pipelineName ?? DEFAULT_PIPELINE);
  if (!status.ok) {
    emit(ctx, { error: `${status.error.code}: ${status.error.message}` });
    return exitCodeFor(status.error);
  }

  // No budget field. The old one reported `consumed: 0, reserved: 0`
  // unconditionally — a number a caller can act on, that nothing measured.
  // Budget reporting returns when there is a ledger behind it (avg-91o).
  emit(ctx, {
    message: `Status for ${parsed.channel}/${parsed.series}/${parsed.episode}`,
    episode: parsed,
    pipeline: status.value.pipeline,
    stages: status.value.stages,
  });
  return EX_OK;
}

// ── validate ────────────────────────────────────────────────────────────────

async function cmdValidate(ctx: CliContext, args: string[]): Promise<number> {
  if (args.length < 1) {
    emit(ctx, { error: "Usage: vpr validate <pipeline|snapshot> [path]" });
    return EX_USAGE;
  }
  const type = args[0];

  if (type === "pipeline") {
    if (!args[1]) {
      emit(ctx, { error: "Path required for pipeline validation" });
      return EX_USAGE;
    }
    const parsed = parsePath(args[1]);
    if (!parsed) {
      emit(ctx, { error: `Invalid path "${args[1]}"` });
      return EX_USAGE;
    }
    try {
      resolveSettings({ channel: emptyLayer(), series: emptyLayer(), episode: emptyLayer() });
      const loader = makeLoader(args);
      const pipeline = await resolvePipeline(loader, DEFAULT_PIPELINE);
      emit(ctx, {
        message: "Pipeline validation passed",
        valid: true,
        name: pipeline.name,
        stages: pipeline.stages.length,
      });
      return EX_OK;
    } catch (e) {
      emit(ctx, { message: `Validation failed: ${e instanceof Error ? e.message : String(e)}`, valid: false });
      return EX_INVALID;
    }
  }

  emit(ctx, { error: `Unknown validation type: ${type}. Valid: pipeline, snapshot` });
  return EX_USAGE;
}

// ── rerun ───────────────────────────────────────────────────────────────────

/**
 * Modes `planRerun` can compute with no staleness report — which is every
 * mode but `rerun-affected-downstream`, since that is the only one that reads
 * one. See the comment on `planRerun` in `src/rerun/planner.ts`.
 */
const JOURNAL_DERIVABLE_MODES = ["retry-current", "rerun-selected", "full-rebuild"] as const;

async function cmdRerun(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const pathArg = positionalArgs(remaining)[0];
  if (!pathArg) {
    emit(ctx, { error: "Usage: vpr rerun <channel>/<series>/<episode> [--mode <mode>] [--stages a,b]" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}"` });
    return EX_USAGE;
  }

  const modeIdx = remaining.indexOf("--mode");
  const mode = (modeIdx >= 0 ? remaining[modeIdx + 1] : "retry-current") as string;

  // Refused here, before the service is asked, so the CLI's error names what
  // owns this mode rather than the service's generic "not a known stage".
  if (mode === "rerun-affected-downstream") {
    emit(ctx, {
      error: 'mode "rerun-affected-downstream" needs staleness propagation, ' +
        "which is not implemented yet (avg-33r). Available: " + JOURNAL_DERIVABLE_MODES.join(", "),
    });
    return EX_USAGE;
  }
  if (!JOURNAL_DERIVABLE_MODES.includes(mode as typeof JOURNAL_DERIVABLE_MODES[number])) {
    emit(ctx, {
      error: `Unknown mode "${mode}". Available: ${JOURNAL_DERIVABLE_MODES.join(", ")}` +
        ' (and "rerun-affected-downstream", once avg-33r lands)',
    });
    return EX_USAGE;
  }

  const stagesIdx = remaining.indexOf("--stages");
  const selected = stagesIdx >= 0
    ? remaining[stagesIdx + 1]!.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }

  const service = makeService(args, ttl.value);
  const pipeline = pipelineName ?? DEFAULT_PIPELINE;

  const plan = await service.planRerun(parsed, pipeline, mode as RerunMode, selected);
  if (!plan.ok) {
    emit(ctx, { error: `${plan.error.code}: ${plan.error.message}` });
    return EX_RUNTIME;
  }

  if (ctx.dryRun) {
    emit(ctx, {
      message: `[DRY RUN] Rerun plan (${mode}): ${plan.value.rerunStageIds.length} stage(s)`,
      mode, dryRun: true, stages: plan.value.rerunStageIds,
      estimatedCost: plan.value.totalEstimatedCost,
    });
    return EX_OK;
  }

  const outcomes = await service.rerun(parsed, pipeline, plan.value.rerunStageIds);
  if (!outcomes.ok) {
    emit(ctx, {
      error: `${outcomes.error.code}: ${outcomes.error.message}`,
      ...(outcomes.error.partialOutcomes ? { partial: outcomes.error.partialOutcomes } : {}),
    });
    return EX_RUNTIME;
  }
  emit(ctx, {
    message: `Rerun (${mode}): ${outcomes.value.length} stage(s)`,
    mode, stages: plan.value.rerunStageIds,
    outcomes: outcomes.value.map(outcomeFields),
  });
  return EX_OK;
}

// ── approve ─────────────────────────────────────────────────────────────────

async function cmdApprove(ctx: CliContext, args: string[]): Promise<number> {
  if (args.length < 2) {
    emit(ctx, { error: "Usage: vpr approve <channel>/<series>/<episode> <stage-id>" });
    return EX_USAGE;
  }
  const pathArg = args[0]!;
  const stageId = args[1]!;
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would approve stage "${stageId}" for ${pathArg}`, dryRun: true });
    return EX_OK;
  }

  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}" (expected <channel>/<series>/<episode>)` });
    return EX_USAGE;
  }
  const libraryRoot = libraryFrom(args);
  if (!libraryRoot) {
    emit(ctx, { error: "No library root: pass --library <path> or set AVG_LIBRARY_ROOT" });
    return EX_USAGE;
  }
  const episodeDir = episodePath(libraryRoot, parsed.channel, parsed.series, parsed.episode);

  // An approval is the one moment a person takes responsibility for an
  // episode, and it has to be a record that can still be checked afterwards.
  //
  // Writing `{ stageId }` and nothing else — which is what this did — is worse
  // than writing nothing: `deriveGateState` reads an approval that names no
  // artifacts as `invalidated`, the review gate turns `invalidated` into an
  // outstanding review, and the journal is append-only. So approving a stage
  // used to block every dependent of it forever, with no way to undo it.
  //
  // What makes the record checkable is the hash binding: the artifacts the
  // stage actually produced, hashed as they are at this moment, so that
  // re-rendering one of them invalidates the approval rather than silently
  // inheriting it.
  let events;
  try {
    events = parseJournal(
      await readFile(nodePath.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8"),
      { strict: true },
    );
  } catch (e) {
    const why = (e as NodeJS.ErrnoException)?.code === "ENOENT"
      ? "it has no journal, so no stage has been recorded as completed"
      : `its journal could not be read: ${e instanceof Error ? e.message : String(e)}`;
    emit(ctx, { error: `Cannot approve "${stageId}" for ${pathArg}: ${why}. Nothing was recorded.` });
    return EX_RUNTIME;
  }

  // The journal's own account of what the stage produced, not the manifest's
  // account of what it was supposed to produce. Only the former can be hashed.
  const completion = [...events]
    .reverse()
    .find((e) => e.type === "stage-completed" && (e.data as { stageId?: string })?.stageId === stageId);
  if (!completion) {
    emit(ctx, {
      error: `Cannot approve "${stageId}" for ${pathArg}: the journal records no completed ` +
        `attempt for it, so there are no artifacts to approve. Nothing was recorded.`,
    });
    return EX_RUNTIME;
  }

  const produced = ((completion.data as { outputs?: string[] })?.outputs ?? []);
  if (produced.length === 0) {
    emit(ctx, {
      error: `Cannot approve "${stageId}" for ${pathArg}: its completion recorded no outputs, ` +
        `and an approval of nothing cannot be invalidated by anything. Nothing was recorded.`,
    });
    return EX_RUNTIME;
  }

  let outputs;
  try {
    outputs = await hashArtifacts(episodeDir, produced);
  } catch (e) {
    emit(ctx, {
      error: `Cannot approve "${stageId}" for ${pathArg}: ` +
        `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.`,
    });
    return EX_RUNTIME;
  }

  const review = buildGateReview({ stageId, decision: "approved", actor: "human", outputs });
  const written = await appendJournalEvent(episodeDir, {
    type: "approval-granted",
    actor: "human",
    episode: parsed,
    data: { ...review },
  });
  if (!written) {
    emit(ctx, { error: `Approval of "${stageId}" for ${pathArg} could not be written to the journal` });
    return EX_RUNTIME;
  }

  emit(ctx, {
    message: `Stage "${stageId}" approved for ${pathArg} (${outputs.length} artifact(s) recorded by hash)`,
    path: pathArg,
    stageId,
    recorded: true,
    artifacts: outputs.map((o) => o.path),
  });
  return EX_OK;
}

// ── run / complete ──────────────────────────────────────────────────────────

/**
 * The execution service, composed for the CLI.
 *
 * The CLI injects no dispatcher: the four handlers that perform stages
 * automatically live in @studio/gateway, which depends on this package and
 * not the reverse. That is why `vpr run` claims rather than performs — a
 * terminal cannot run `illustrations`, and pretending otherwise would be a
 * lie about where work happens.
 */
function makeService(args: string[], leaseTtlMs: number): ExecutionService {
  return new ExecutionService({
    libraryRoot: libraryFrom(args) || ".",
    // `|| undefined`, not a bare read, for the reason documented in the
    // gateway's production.ts: an empty string is not nullish, so it does not
    // trigger `createDefaultLoader`'s `??` fallback — the operator's escape
    // hatch would be dead exactly when it is reached for.
    builtinPipelines: process.env.AVG_BUILTIN_PIPELINES || undefined,
    // Absence is refusal, and there is no budget subsystem wired anywhere yet
    // — BudgetLedger's reserve/consume/release have no callers (avg-91o). An
    // explicit pass-through keeps the gap visible in code rather than making
    // every claim fail for a reason nobody can act on.
    budget: { maySpend: async () => ok({ reserveId: "cli", estimatedCost: 0 }) },
    holder: `cli/pid-${process.pid}`,
    // Stated, not inherited; see `claimTtlMs`.
    leaseTtlMs,
  });
}

/**
 * The loader the service itself builds, for the few CLI reads that need the
 * manifest rather than the journal's account of it.
 *
 * Composed from the same two inputs `makeService` passes, so the CLI cannot
 * read one pipeline while the service runs another.
 */
function serviceLoader(args: string[]): PipelineLoader {
  return createDefaultLoader(
    libraryFrom(args) || ".",
    process.env.AVG_BUILTIN_PIPELINES || undefined,
  ) as unknown as PipelineLoader;
}

const CLAIM_TTL_ENV = "AVG_CLAIM_TTL_MS";
const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;

/**
 * The shortest claim anyone can mean.
 *
 * A floor on scale, not on sign. `> 0` tests the wrong property: the
 * realistic mistakes here are all unit confusions — `15` meaning fifteen
 * minutes, `900` meaning nine hundred seconds, `1e3` meaning something other
 * than a thousand milliseconds — and each of them passes a positivity check
 * and then burns a stage exactly the way `0` does. A claim exists precisely
 * because the work happens out of process, in another program or another
 * person's hands, and nothing that qualifies finishes inside ten seconds.
 */
const MIN_CLAIM_TTL_MS = 10_000;

/**
 * How long a claim is honoured, validated rather than coerced.
 *
 * Stated, not inherited: the engine's default is 5 minutes, chosen for a
 * dispatcher that finishes in seconds. A claim is held by a person or an
 * agent doing real work, and 5 minutes would expire under them. A TTL that is
 * too long only delays recovery from an abandoned claim; one that is too
 * short destroys live work, so this errs long.
 *
 * `Number(process.env.X ?? default)` is not enough, and the failure is
 * silent. `??` catches only `undefined`, so `AVG_CLAIM_TTL_MS=""` reaches
 * `Number("")` and yields `0`: the CLI claims, journals `stage-leased` and
 * `stage-started`, and every later `complete` reports the lease lapsed — the
 * stage is burned with no error printed anywhere. `abc` yields `NaN`, which
 * surfaces later as `cannot start from its current state ("pending")` and
 * names the wrong cause entirely. The service treats `0` and `NaN` as
 * deliberate, so this is the only place either can be caught.
 *
 * `MIN_CLAIM_TTL_MS` rather than `> 0`, because a positivity check catches
 * only the least likely way to get this wrong. `1e3` is positive and finite
 * and produces a one-second claim, which is the same silent burn by a
 * different route.
 *
 * The distinction this draws is "not set" against "set wrong", and empty is
 * the one invalid-looking value that belongs on the first side. In shell,
 * `export AVG_CLAIM_TTL_MS=` and `AVG_CLAIM_TTL_MS=${AVG_CLAIM_TTL_MS:-}`
 * are ordinary ways to NOT set a variable, so a CI doing either would hard
 * fail on every `vpr` invocation over a value it never meant to supply.
 * `abc`, `0` and `-1` are the other side: somebody typed a value and got it
 * wrong, and `0` in particular burns the stage in silence, so those refuse
 * loudly.
 *
 * Which also keeps this agreeing with `builtinPipelines` three lines above,
 * where `|| undefined` exists so that an empty string means unset and the
 * operator's escape hatch survives one. Two adjacent environment variables
 * disagreeing about what empty means is the kind of thing nobody discovers
 * until it bites.
 */
function claimTtlMs(): Result<number, string> {
  const raw = process.env[CLAIM_TTL_ENV];
  if (raw === undefined || raw === "") return ok(DEFAULT_CLAIM_TTL_MS);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return err(
      `${CLAIM_TTL_ENV} must be a number of milliseconds, and is ${JSON.stringify(raw)}. ` +
      `Unset it to use the ${DEFAULT_CLAIM_TTL_MS}ms default.`,
    );
  }
  if (parsed < MIN_CLAIM_TTL_MS) {
    // Name the floor AND the units. An operator who meant "15 minutes" and
    // wrote `15` needs to learn that this is milliseconds, not merely that
    // their number was rejected.
    return err(
      `${CLAIM_TTL_ENV} is in milliseconds and must be at least ${MIN_CLAIM_TTL_MS}, ` +
      `and is ${JSON.stringify(raw)} (${parsed}ms). A claim is held by a performer outside ` +
      `this process, so a shorter lease expires before the work can finish. ` +
      `Unset it to use the ${DEFAULT_CLAIM_TTL_MS}ms default.`,
    );
  }
  return ok(parsed);
}

/**
 * The exit code an ExecutionError earns.
 *
 * A stage the pipeline never declared is a mistyped argument, not a broken
 * system: `EX_USAGE`, so a script can tell "you asked for something that does
 * not exist" from "the journal could not be read". A `RerunMode` this build
 * does not implement is the same family of caller mistake — the request
 * named something real (a mode `RerunMode` declares) that this composition
 * cannot honor yet — so `MODE_UNSUPPORTED` earns `EX_USAGE` alongside it.
 * `cmdRerun` refuses `rerun-affected-downstream` before calling the service,
 * so no CLI path reaches this today; it is here for whichever caller does.
 * Everything else — unreadable journal, unresolvable pipeline, journal and
 * pipeline in disagreement — is `EX_RUNTIME`.
 */
function exitCodeFor(error: ExecutionError): number {
  return error.code === "STAGE_UNKNOWN" || error.code === "MODE_UNSUPPORTED" ? EX_USAGE : EX_RUNTIME;
}

/**
 * Flags that consume the token after them.
 *
 * Named explicitly rather than treating "follows any `--flag`" as a value,
 * because `--failed` consumes nothing: under that rule
 * `vpr complete --failed <episode> <stage>` would silently lose its episode
 * and report a usage error for a command that named everything it needed.
 * (`--json` and `--dry-run` never reach a command — main strips them — but
 * they are the same shape of flag and the same trap.)
 */
const VALUE_FLAGS = new Set([
  "--outputs", "--error", "--lease", "--library", "--pipeline", "--stage",
  // `rerun`'s own value-taking flags: `--mode` names a `RerunMode`, `--stages`
  // a comma-separated stage id list. Both must be listed here or their values
  // leak into `positionalArgs` — harmlessly today, since only index 0 of that
  // list is used, but silently wrong the moment a second positional is added.
  "--mode", "--stages",
]);

/**
 * The bare arguments, with flag values removed.
 *
 * Shared by `run`, `complete` and `rerun` because the naive version —
 * `args.find((a) => !a.startsWith("--"))` — is actively destructive now that
 * `run` writes. `vpr run --library a/b/c childrens/fairy-tales/ep` took
 * `a/b/c` as the episode, leased a stage and journaled `stage-leased` and
 * `stage-started` under a library the user never named. While `run` only
 * printed advice this was harmless nonsense; claiming made it corruption of
 * an episode nobody asked about.
 */
function positionalArgs(args: string[]): string[] {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token.startsWith("--")) {
      if (VALUE_FLAGS.has(token)) i++;
      continue;
    }
    positional.push(token);
  }
  return positional;
}

/**
 * One argument, safe to paste into a shell.
 *
 * The completion command `run` prints is meant to be pasted, and a library
 * path with a space in it would otherwise arrive as two arguments.
 */
function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Turn a StageOutcome into the CLI's JSON shape. */
function outcomeFields(outcome: StageOutcome): Record<string, unknown> {
  return {
    stage: outcome.stageId,
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.outputs.length > 0 ? { outputs: outcome.outputs } : {}),
    ...(outcome.leaseId ? { leaseId: outcome.leaseId } : {}),
    ...(outcome.expiresAt ? { expiresAt: outcome.expiresAt } : {}),
    ...(outcome.attemptNumber ? { attemptNumber: outcome.attemptNumber } : {}),
    ...(outcome.dryRun ? { dryRun: true } : {}),
  };
}

async function cmdRun(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const pathArg = positionalArgs(remaining)[0];
  if (!pathArg) {
    emit(ctx, { error: "Usage: vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] [--dry-run]" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}"` });
    return EX_USAGE;
  }
  const stageIdx = remaining.indexOf("--stage");
  const stage = stageIdx >= 0 ? remaining[stageIdx + 1] : undefined;

  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }

  const service = makeService(args, ttl.value);
  const claimed = await service.claim(parsed, pipelineName ?? DEFAULT_PIPELINE, {
    ...(stage ? { stage } : {}),
    dryRun: ctx.dryRun,
  });

  if (!claimed.ok) {
    emit(ctx, { error: `${claimed.error.code}: ${claimed.error.message}` });
    return exitCodeFor(claimed.error);
  }

  const outcome = claimed.value;
  if (outcome.status === "idle") {
    emit(ctx, { message: "Nothing to run: every stage is complete or none is runnable", ...outcomeFields(outcome) });
    return EX_OK;
  }
  if (outcome.status === "claimed") {
    emit(ctx, {
      message:
        `Claimed "${outcome.stageId}" until ${outcome.expiresAt}. Perform it, then:\n` +
        `  ${completionCommand(args, pathArg, outcome, pipelineName)}`,
      ...outcomeFields(outcome),
    });
    return EX_OK;
  }
  if (outcome.status === "would-run") {
    emit(ctx, { message: `[DRY RUN] Would claim "${outcome.stageId}"`, ...outcomeFields(outcome) });
    return EX_OK;
  }
  // Everything else — `blocked` above all — exits 0. The service worked and
  // refused; a refusal a person must clear is not a CLI failure, and only an
  // ExecutionError above earns EX_RUNTIME.
  emit(ctx, { message: outcome.reason ?? `"${outcome.stageId}" did not run`, ...outcomeFields(outcome) });
  return EX_OK;
}

/**
 * The exact `vpr complete` to paste when this claim is done, `--lease` and all.
 *
 * Not advice: the command. `complete` takes `leaseId` optionally, and when it
 * is omitted it closes whichever claim is open — which, once a lapsed claim
 * has been retaken, is the SECOND holder's. The first performer reporting
 * late would then close someone else's attempt with its own outputs.
 *
 * The id cannot be recovered afterwards either: `LeaseState` carries `state`,
 * `holder` and `expiresAt` and no id, so `vpr status` has nothing to show.
 * Printing the whole line here is the only thing that makes the safe form the
 * easy one.
 */
function completionCommand(
  args: string[],
  pathArg: string,
  outcome: StageOutcome,
  pipelineName?: string,
): string {
  // Every argument needed to reach the same episode again, not only the
  // lease. A line printed without `--library` resolves against the current
  // directory when pasted, finds no journal, and reports
  // `"brief" has no open claim to complete` at exit 0 — telling the performer
  // its claim does not exist at the exact moment it does. `--pipeline` is
  // carried for the same reason.
  const library = libraryFrom(args);
  const passedLibrary = args.includes("--library");
  return [
    "vpr complete", pathArg, outcome.stageId ?? "<stage-id>",
    ...(passedLibrary && library ? ["--library", shellQuote(library)] : []),
    ...(pipelineName ? ["--pipeline", shellQuote(pipelineName)] : []),
    ...(outcome.leaseId ? ["--lease", outcome.leaseId] : []),
    // Upper-case placeholder, not `<path>`: `<` is a shell redirect, so the
    // line as printed would be a syntax error the moment it was pasted.
    "--outputs PATH",
  ].join(" ");
}

async function cmdComplete(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const positional = positionalArgs(remaining);
  if (positional.length < 2) {
    emit(ctx, {
      error: "Usage: vpr complete <channel>/<series>/<episode> <stage-id> " +
        "[--lease <id>] --outputs <path>[,<path>...] | --failed [--error <message>]",
    });
    return EX_USAGE;
  }
  const parsed = parsePath(positional[0]!);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${positional[0]}"` });
    return EX_USAGE;
  }
  const stageId = positional[1]!;
  const pipeline = pipelineName ?? DEFAULT_PIPELINE;

  const flag = (name: string): string | undefined => {
    const i = remaining.indexOf(name);
    return i >= 0 ? remaining[i + 1] : undefined;
  };
  const failed = remaining.includes("--failed");
  const outputs = flag("--outputs")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  if (!failed && outputs.length === 0) {
    emit(ctx, {
      error: "--outputs is required: name the files you wrote, or pass --failed. " +
        "The performer is the only party that knows what it produced.",
    });
    return EX_USAGE;
  }

  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }
  const service = makeService(args, ttl.value);

  if (ctx.dryRun) {
    return completeDryRun(ctx, service, args, parsed, pipeline, stageId, failed, outputs);
  }

  const done = await service.complete(parsed, pipeline, stageId, {
    ...(failed ? { failed: true, error: flag("--error") } : { outputs }),
    ...(flag("--lease") ? { leaseId: flag("--lease") } : {}),
  });

  if (!done.ok) {
    emit(ctx, { error: `${done.error.code}: ${done.error.message}` });
    return exitCodeFor(done.error);
  }
  // Every outcome the service returns here is a report that landed, including
  // `awaiting_review` — a stage declaring `review: human` completes, its
  // `stage-completed` is journaled, and acceptance is someone else's turn.
  // Mapping it to a non-zero exit would tell every script that a successful
  // stage had failed.
  emit(ctx, {
    message: done.value.reason ?? `"${stageId}" is ${done.value.status}`,
    ...outcomeFields(done.value),
  });
  return EX_OK;
}

/** Whether the manifest puts this stage behind a review. */
async function declaresReview(args: string[], pipeline: string, stageId: string): Promise<boolean> {
  try {
    const resolved = await resolvePipeline(serviceLoader(args), pipeline);
    const stage = resolved?.stages.find((st) => st.definition.id === stageId);
    return stage ? stage.definition.gates.review !== "none" : false;
  } catch {
    // The caller has already resolved this pipeline through the service, so
    // a failure here is not worth a second error path; predict the
    // un-reviewed outcome.
    return false;
  }
}

/**
 * What `vpr complete` would do, without doing it.
 *
 * A dry run exists to answer the same question the real call would; the
 * service says of its own that one reporting "would have dispatched" for a
 * stage the real call refuses is worse than no dry run at all. Echoing the
 * arguments back — which is what this did — reported
 * `[DRY RUN] Would complete "totally-made-up"` for a stage no pipeline
 * declares and no one has claimed, and emitted no `status` field for a
 * caller to switch on.
 *
 * `complete` has no `dryRun` option and giving it one belongs to the service,
 * so this reproduces the refusals a real call makes before it writes: the
 * pipeline does not declare the stage, and nothing is claimed. Two it cannot
 * reproduce, and does not pretend to — a `--lease` that names the wrong
 * attempt, because `LeaseState` carries no id for it to compare against, and
 * an output path that is missing or empty, because that is stat-ed at
 * completion time and a file can appear between now and then.
 */
async function completeDryRun(
  ctx: CliContext,
  service: ExecutionService,
  args: string[],
  ref: { channel: string; series: string; episode: string },
  pipeline: string,
  stageId: string,
  failed: boolean,
  outputs: string[],
): Promise<number> {
  const status = await service.status(ref, pipeline);
  if (!status.ok) {
    emit(ctx, { error: `${status.error.code}: ${status.error.message}` });
    return exitCodeFor(status.error);
  }
  const report = status.value.stages.find((s) => s.stageId === stageId);
  if (!report) {
    emit(ctx, { error: `STAGE_UNKNOWN: Pipeline "${pipeline}" declares no stage "${stageId}"` });
    return EX_USAGE;
  }

  const would = (status: string, message: string, extra: Record<string, unknown> = {}): number => {
    emit(ctx, { message: `[DRY RUN] ${message}`, stage: stageId, status, dryRun: true, ...extra });
    return EX_OK;
  };

  if (report.lease.state === "expired") {
    return would(
      "failed",
      `the claim on "${stageId}" lapsed at ${report.lease.expiresAt} and nothing would be recorded ` +
      `for it; the stage is retryable and may already have been taken by someone else`,
      { reason: `the claim on "${stageId}" lapsed at ${report.lease.expiresAt}` },
    );
  }
  if (report.lease.state !== "live") {
    return would("blocked", `"${stageId}" has no open claim to complete`, {
      reason: `"${stageId}" has no open claim to complete`,
    });
  }
  if (failed) {
    return would("failed", `Would record "${stageId}" as failed and release its claim`);
  }

  // Completion is what happens; acceptance is whether it counts. A stage
  // declaring a review reports `awaiting_review`, so a dry run that always
  // said `completed` would mispredict exactly the stages a person is waiting
  // on. The manifest is the only place that says which those are, so it is
  // read rather than guessed.
  const needsReview = await declaresReview(args, pipeline, stageId);
  return would(
    needsReview ? "awaiting_review" : "completed",
    `Would complete "${stageId}" with ${outputs.length} output(s)` +
    (needsReview ? `, which then awaits review` : ""),
    { outputs },
  );
}

// ── Registry ────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, CliCommand> = {
  init: { name: "init", description: "Initialize a new episode workspace", usage: "vpr init <channel>/<series>/<episode> [--json] [--dry-run]", examples: ["vpr init my-channel/my-series/ep001"], run: cmdInit },
  resolve: { name: "resolve", description: "Resolve settings and create an immutable pipeline snapshot", usage: "vpr resolve <channel>/<series>/<episode> [--pipeline <name>] [--json]", examples: ["vpr resolve my-channel/my-series/ep001 --json", "vpr resolve my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdResolve },
  status: { name: "status", description: "Show each stage's state as the journal records it", usage: "vpr status <channel>/<series>/<episode> [--pipeline <name>] [--json]", examples: ["vpr status my-channel/my-series/ep001", "vpr status my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdStatus },
  validate: { name: "validate", description: "Validate pipeline DAG or snapshot integrity", usage: "vpr validate <pipeline|snapshot> [path] [--json]", examples: ["vpr validate pipeline my-channel/my-series/ep001"], run: cmdValidate },
  run: { name: "run", description: "Claim the next runnable stage for a performer", usage: "vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr run my-channel/my-series/ep001", "vpr run my-channel/my-series/ep001 --dry-run"], run: cmdRun },
  complete: { name: "complete", description: "Close a claimed stage with the outputs it produced", usage: "vpr complete <channel>/<series>/<episode> <stage-id> [--lease <id>] --outputs <path>[,<path>] | --failed [--error <msg>]", examples: ["vpr complete my-channel/my-series/ep001 brief --lease l-7 --outputs artifacts/brief.md", "vpr complete my-channel/my-series/ep001 brief --failed --error 'the model refused'"], run: cmdComplete },
  rerun: { name: "rerun", description: "Plan targeted reruns with cost estimates", usage: "vpr rerun <channel>/<series>/<episode> [--mode retry-current|rerun-selected|full-rebuild] [--stages a,b] [--json] [--dry-run]", examples: ["vpr rerun my-channel/my-series/ep001 --mode full-rebuild"], run: cmdRerun },
  approve: { name: "approve", description: "Approve a manual gate for a stage", usage: "vpr approve <channel>/<series>/<episode> <stage-id> [--json] [--dry-run]", examples: ["vpr approve my-channel/my-series/ep001 render-outro --dry-run"], run: cmdApprove },
  doctor: { name: "doctor", description: "Validate workspace against canonical tree", usage: "vpr doctor --library <path> [--channel X] [--series Y] [--episode Z] [--json]", examples: ["vpr doctor --library /tmp/library", "vpr doctor --library . --channel my-channel --series season-1 --json"], run: cmdDoctor },
};

// ── Help ────────────────────────────────────────────────────────────────────

function printHelp(logger: ConsoleLogger): void {
  logger.info(`video-pipeline-runtime v${VERSION}`);
  logger.info("");
  logger.info("Usage: vpr <subcommand> [options]");
  logger.info("");
  logger.info("Subcommands:");
  const entries = Object.values(COMMANDS);
  const maxLen = Math.max(...entries.map((c) => c.name.length));
  for (const cmd of entries) {
    const pad = " ".repeat(maxLen - cmd.name.length + 2);
    logger.info(`  ${cmd.name}${pad}${cmd.description}`);
  }
  logger.info("");
  logger.info("Options:");
  logger.info("  --help, -h      Show this help");
  logger.info("  --version, -v   Print version");
  logger.info("  --json          Machine-readable JSON output");
  logger.info("  --dry-run       Preview without executing");
  logger.info("");
  logger.info("Examples:");
  for (const cmd of entries) {
    for (const ex of cmd.examples) {
      logger.info(`  $ ${ex}`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json");
  const dryRun = argv.includes("--dry-run");
  const cmdName = argv[0];

  const logger = new ConsoleLogger({ minLevel: jsonMode ? "error" : "info" });

  if (cmdName === "--version" || cmdName === "-v") {
    if (jsonMode) process.stdout.write(JSON.stringify({ version: VERSION }) + "\n");
    else process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (!cmdName || cmdName === "--help" || cmdName === "-h") {
    printHelp(logger);
    return;
  }

  // Find command: exact match or prefix match
  let command = COMMANDS[cmdName];
  if (!command) {
    const matches = Object.keys(COMMANDS).filter((k) => k.startsWith(cmdName));
    if (matches.length === 1) command = COMMANDS[matches[0]!];
  }

  if (!command) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ error: `Unknown command: ${cmdName}`, exitCode: EX_USAGE }) + "\n");
    } else {
      logger.error(`Unknown command: ${cmdName}`);
      logger.info("Run 'vpr --help' for usage.");
    }
    process.exitCode = 0;
    return;
  }

  const cmdArgs = argv.slice(1).filter((a) => a !== "--json" && a !== "--dry-run");
  const ctx: CliContext = { logger, jsonMode, dryRun };

  try {
    process.exitCode = await command.run(ctx, cmdArgs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (jsonMode) process.stdout.write(JSON.stringify({ error: `FATAL: ${msg}`, exitCode: EX_RUNTIME }) + "\n");
    else process.stderr.write(`FATAL: ${msg}\n`);
    process.exitCode = EX_RUNTIME;
  }
}

main();
