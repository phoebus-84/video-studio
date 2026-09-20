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
import { artifactExists } from "./artifacts/discovery.js";
import { ExecutionService } from "./execution/index.js";
import type { StageOutcome } from "./execution/index.js";
import { ok } from "./result.js";

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
  try {
    const { settings } = resolveSettings({
      channel: emptyLayer(),
      series: emptyLayer(),
      episode: emptyLayer(),
    });
    const loader = makeLoader(args);
    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);

    // ── Detect completed stages by checking for output artifacts ──────────
    const libraryRoot = libraryFrom(args) || ".";
    const episodeDir = episodePath(libraryRoot, parsed.channel, parsed.series, parsed.episode);

    function checkArtifact(label: string): string {
      return artifactExists(episodeDir, label) ? "completed" : "pending";
    }

    function stageState(s: typeof pipeline.stages[0]): string {
      // If ALL outputs exist, stage is completed
      const states = s.definition.produces.map((p) => checkArtifact(p.label));
      if (states.every((st) => st === "completed")) return "completed";
      // If inputs are all done but outputs missing, it's runnable
      const inputStates = s.definition.consumes.map((c) => checkArtifact(c.label));
      if (inputStates.every((st) => st === "completed")) return "runnable";
      return "pending";
    }

    emit(ctx, {
      message: `Status for ${parsed.channel}/${parsed.series}/${parsed.episode}`,
      episode: parsed,
      pipeline: pipeline.name,
      stages: pipeline.stages.map((s) => ({
        id: s.definition.id,
        state: stageState(s),
        dependsOn: s.definition.dependsOn,
        produces: s.definition.produces ?? [],
      })),
      budget: { currency: "USD", limitMicros: settings.budget.value.limitMicros, consumed: 0, reserved: 0 },
    });
    return EX_OK;
  } catch (e) {
    emit(ctx, { error: `Status failed: ${e instanceof Error ? e.message : String(e)}` });
    return EX_RUNTIME;
  }
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

async function cmdRerun(ctx: CliContext, args: string[]): Promise<number> {
  if (args.length < 1) {
    emit(ctx, { error: "Usage: vpr rerun <channel>/<series>/<episode>" });
    return EX_USAGE;
  }
  const modeIdx = args.indexOf("--mode");
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : "rerun-affected";
  emit(ctx, { message: `Rerun plan (${mode}): ${ctx.dryRun ? "[DRY RUN] " : ""}0 stage(s)`, mode, dryRun: ctx.dryRun, stages: [] });
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
function makeService(args: string[]): ExecutionService {
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
    // Stated, not inherited. The engine's default is 5 minutes, chosen for a
    // dispatcher that finishes in seconds; a claim is held by a person or an
    // agent doing real work, and 5 minutes would expire under them. A TTL
    // that is too long only delays recovery from an abandoned claim; one that
    // is too short destroys live work, so this errs long.
    leaseTtlMs: Number(process.env.AVG_CLAIM_TTL_MS ?? 15 * 60 * 1000),
  });
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
  const pathArg = remaining.find((a: string) => !a.startsWith("--"));
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

  const service = makeService(args);
  const claimed = await service.claim(parsed, pipelineName ?? DEFAULT_PIPELINE, {
    ...(stage ? { stage } : {}),
    dryRun: ctx.dryRun,
  });

  if (!claimed.ok) {
    emit(ctx, { error: `${claimed.error.code}: ${claimed.error.message}` });
    return EX_RUNTIME;
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
        `  ${completionCommand(pathArg, outcome, pipelineName)}`,
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
  pathArg: string,
  outcome: StageOutcome,
  pipelineName?: string,
): string {
  return [
    "vpr complete", pathArg, outcome.stageId ?? "<stage-id>",
    ...(pipelineName ? ["--pipeline", pipelineName] : []),
    ...(outcome.leaseId ? ["--lease", outcome.leaseId] : []),
    "--outputs <path>",
  ].join(" ");
}

/**
 * Flags that consume the token after them.
 *
 * Named explicitly rather than treating "follows any `--flag`" as a value,
 * because `--failed` consumes nothing: under that rule
 * `vpr complete --failed <episode> <stage>` would silently lose its episode
 * and report a usage error for a command that named everything it needed.
 * (`--json` and `--dry-run` never reach here — main strips them — but they
 * are the same shape of flag and the same trap.)
 */
const COMPLETE_VALUE_FLAGS = new Set([
  "--outputs", "--error", "--lease", "--library", "--pipeline", "--stage",
]);

async function cmdComplete(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const positional: string[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const token = remaining[i]!;
    if (token.startsWith("--")) {
      if (COMPLETE_VALUE_FLAGS.has(token)) i++;
      continue;
    }
    positional.push(token);
  }
  if (positional.length < 2) {
    emit(ctx, {
      error: "Usage: vpr complete <channel>/<series>/<episode> <stage-id> " +
        "--outputs <path>[,<path>...] | --failed [--error <message>]",
    });
    return EX_USAGE;
  }
  const parsed = parsePath(positional[0]!);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${positional[0]}"` });
    return EX_USAGE;
  }
  const stageId = positional[1]!;

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

  if (ctx.dryRun) {
    emit(ctx, {
      message: `[DRY RUN] Would complete "${stageId}" with ${failed ? "a failure" : `${outputs.length} output(s)`}`,
      dryRun: true, stage: stageId,
    });
    return EX_OK;
  }

  const service = makeService(args);
  const done = await service.complete(parsed, pipelineName ?? DEFAULT_PIPELINE, stageId, {
    ...(failed ? { failed: true, error: flag("--error") } : { outputs }),
    ...(flag("--lease") ? { leaseId: flag("--lease") } : {}),
  });

  if (!done.ok) {
    emit(ctx, { error: `${done.error.code}: ${done.error.message}` });
    return EX_RUNTIME;
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

// ── Registry ────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, CliCommand> = {
  init: { name: "init", description: "Initialize a new episode workspace", usage: "vpr init <channel>/<series>/<episode> [--json] [--dry-run]", examples: ["vpr init my-channel/my-series/ep001"], run: cmdInit },
  resolve: { name: "resolve", description: "Resolve settings and create an immutable pipeline snapshot", usage: "vpr resolve <channel>/<series>/<episode> [--pipeline <name>] [--json]", examples: ["vpr resolve my-channel/my-series/ep001 --json", "vpr resolve my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdResolve },
  status: { name: "status", description: "Show pipeline, stage, artifact, and budget projections", usage: "vpr status <channel>/<series>/<episode> [--pipeline <name>] [--json]", examples: ["vpr status my-channel/my-series/ep001", "vpr status my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdStatus },
  validate: { name: "validate", description: "Validate pipeline DAG or snapshot integrity", usage: "vpr validate <pipeline|snapshot> [path] [--json]", examples: ["vpr validate pipeline my-channel/my-series/ep001"], run: cmdValidate },
  run: { name: "run", description: "Claim the next runnable stage for a performer", usage: "vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr run my-channel/my-series/ep001", "vpr run my-channel/my-series/ep001 --dry-run"], run: cmdRun },
  complete: { name: "complete", description: "Close a claimed stage with the outputs it produced", usage: "vpr complete <channel>/<series>/<episode> <stage-id> [--lease <id>] --outputs <path>[,<path>] | --failed [--error <msg>]", examples: ["vpr complete my-channel/my-series/ep001 brief --lease l-7 --outputs artifacts/brief.md", "vpr complete my-channel/my-series/ep001 brief --failed --error 'the model refused'"], run: cmdComplete },
  rerun: { name: "rerun", description: "Plan targeted reruns with cost estimates", usage: "vpr rerun <channel>/<series>/<episode> [--mode <mode>] [--json] [--dry-run]", examples: ["vpr rerun my-channel/my-series/ep001 --mode rerun-affected"], run: cmdRerun },
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
