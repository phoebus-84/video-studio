#!/usr/bin/env node
// ---------------------------------------------------------------------------
// video-pipeline-runtime CLI
//
// Operator CLI: init, resolve, validate, run, complete, status, rerun, approve,
// reject, doctor.
// Defaults to human-readable output; --json for machine-readable.
// --dry-run for destructive/paid operations.
// ---------------------------------------------------------------------------

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
import { initChannel, initSeries, initEpisode } from "./workspace/init.js";
import { ExecutionService, JournalReviewGate, JournalBudgetGuard, readEpisodeBudget } from "./execution/index.js";
import { releaseSpend } from "@studio/contracts/src/budget.mjs";
import type { SourceRef } from "@studio/contracts/src/source-pins.mjs";
import type { ExecutionError, StageEvidence, StageOutcome } from "./execution/index.js";
import { resolveCliCredential } from "./execution/principal.js";
import { approveReference, listReferences, withdrawReference } from "./references.js";
import { reviewSheet, sheetReviewStatus } from "./sheet-review.js";
import { releaseTemplate, sealTheme, ThemeReleaseError } from "./theme-release.js";
import { checkMedia, initChannelRepo, MEDIA_LOCK, writeMediaLock } from "./channel-repo.js";
import { verifySeriesReference } from "@studio/contracts/src/series-references.mjs";
import { channelPath, seriesPath } from "@studio/contracts/src/layout.mjs";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { declaredPipeline, PipelineDeclarationError } from "./pipeline/declared.js";
import type { RerunMode } from "./rerun/index.js";
import { err, ok } from "./result.js";
import type { Result } from "./result.js";

// ── Exit codes ──────────────────────────────────────────────────────────────

const EX_OK = 0;
const EX_USAGE = 1;
const EX_RUNTIME = 2;
const EX_INVALID = 3;

/** The pipeline of an episode that neither `--pipeline` nor the library names. */
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
  if (parts.length !== 3 || parts.some((part) => part === "")) return null;
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
    return createDefaultLoader(libraryRoot, builtinPipelines()) as unknown as PipelineLoader;
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

/**
 * One value-taking flag's value, or undefined when it is absent — or followed
 * by another flag, which is never a value (`--note --dry-run` has no note).
 */
function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  const value = idx >= 0 ? args[idx + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
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
  const pipelineId = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipelineId === "number") return pipelineId;
  try {
    const { settings, report } = resolveSettings({
      channel: emptyLayer(),
      series: emptyLayer(),
      episode: emptyLayer(),
    });
    const loader = makeLoader(args);
    const pipeline = await resolvePipeline(loader, pipelineId);
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

  const operatorKey = cliOperatorKey(ctx);
  if (typeof operatorKey === "number") return operatorKey;
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;
  // Only status reads a series episode's stages from its files: the bridge loads the composer, which nothing else here needs.
  const unloaded = await loadStageEvidence();
  if (unloaded && existsSync(join(episodePath(libraryFrom(args) || ".", parsed.channel, parsed.series, parsed.episode), "episode-spec.json"))) {
    ctx.logger.warn(`this episode's stages are read from its files, but the studio's reader could not be loaded (${unloaded}): showing the journal's`);
  }
  const service = makeService(args, ttl.value, operatorKey);
  const status = await service.status(parsed, pipeline);
  if (!status.ok) {
    emit(ctx, { error: `${status.error.code}: ${status.error.message}` });
    return exitCodeFor(status.error);
  }

  // The budget is back now that a ledger stands behind it (avg-91o). The
  // old field reported `consumed: 0, reserved: 0` unconditionally; this one
  // is the journal's spend, and null only when the ledger cannot be read.
  let budget: Awaited<ReturnType<typeof readEpisodeBudget>> | null = null;
  try {
    budget = await readEpisodeBudget(libraryFrom(args) || ".", parsed);
  } catch { /* reported as null rather than failing the status */ }
  const fromFiles = status.value.source === "files";
  emit(ctx, {
    message: `Status for ${parsed.channel}/${parsed.series}/${parsed.episode}` +
      (fromFiles ? " (read from its files)" : ""),
    episode: parsed,
    pipeline: status.value.pipeline,
    source: status.value.source ?? "journal",
    stages: status.value.stages,
    budget,
  });
  return EX_OK;
}

// ── pin (avg-7zp.5) ─────────────────────────────────────────────────────────

/** `channel:<name>` or `episode:<series>/<episode>`. */
function parseSourceFlag(value: string | undefined): SourceRef | null {
  if (!value) return null;
  const channel = /^channel:([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(value);
  if (channel) return { kind: "channel-source", name: channel[1]! };
  const episode = /^episode:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(value);
  if (episode) return { kind: "episode", series: episode[1]!, episode: episode[2]! };
  return null;
}

/** Every value of a repeatable value-taking flag. */
function flagValues(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === name) out.push(args[i + 1]!);
  return out;
}

/**
 * `vpr pin add|verify|renew`: shared material an episode reads without
 * copying it (ADR-0035). `verify` writes nothing; `renew` accepts a source's
 * current version and journals which stages must be redone — any actor may,
 * because renewal hides nothing.
 */
async function cmdPin(ctx: CliContext, args: string[]): Promise<number> {
  const usage =
    "Usage: vpr pin add <channel>/<series>/<episode> <id> --source channel:<name>|episode:<series>/<episode> " +
    "--used-by <stage>[,<stage>...] [--path <p>]... | vpr pin verify <channel>/<series>/<episode> | " +
    "vpr pin renew <channel>/<series>/<episode> <id> [--pipeline <name>]";
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const [sub, episodeArg, id] = positionalArgs(remaining);
  const parsed = episodeArg ? parsePath(episodeArg) : null;
  if (!parsed || (sub !== "add" && sub !== "verify" && sub !== "renew")) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }
  const service = makeService(args, ttl.value, null);

  if (sub === "verify") {
    const pins = await service.verifyPins(parsed);
    const changed = pins.filter((p) => p.changed.length > 0 || p.problem).length;
    emit(ctx, { message: `${pins.length} pin(s) for ${episodeArg}, ${changed} with changes or problems`, episode: parsed, pins });
    return EX_OK;
  }
  // Verifying reads only the pins; adding and renewing check their stages against the pipeline.
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;
  if (!id) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }

  if (sub === "add") {
    const source = parseSourceFlag(flagValue(remaining, "--source"));
    const usedBy = (flagValue(remaining, "--used-by") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!source || usedBy.length === 0) {
      emit(ctx, { error: usage });
      return EX_USAGE;
    }
    if (ctx.dryRun) {
      emit(ctx, { message: `[DRY RUN] Would pin ${id} for ${episodeArg}`, dryRun: true });
      return EX_OK;
    }
    const paths = flagValues(remaining, "--path");
    const out = await service.addPin(parsed, pipeline, { id, source, usedBy, ...(paths.length > 0 ? { paths } : {}) });
    if (!out.ok) {
      emit(ctx, { error: `${out.error.code}: ${out.error.message}` });
      return exitCodeFor(out.error);
    }
    if (!out.value.ok) {
      emit(ctx, { error: out.value.refusal.message, code: out.value.refusal.code });
      return out.value.refusal.code === "unknown-stage" ? EX_USAGE : EX_RUNTIME;
    }
    emit(ctx, { message: `Pinned "${id}" for ${episodeArg}: ${Object.keys(out.value.pin.files).length} file(s)`, pin: out.value.pin });
    return EX_OK;
  }

  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would renew pin ${id} for ${episodeArg}`, dryRun: true });
    return EX_OK;
  }
  const actor = resolveCliCredential().principal === "operator" ? "human" : "pi";
  const out = await service.renewPin(parsed, pipeline, id, actor);
  if (!out.ok) {
    emit(ctx, { error: `${out.error.code}: ${out.error.message}` });
    return exitCodeFor(out.error);
  }
  if (!out.value.ok) {
    emit(ctx, { error: out.value.refusal.message, code: out.value.refusal.code });
    return EX_RUNTIME;
  }
  emit(ctx, {
    message: out.value.changed.length === 0
      ? `Pin "${id}" is current: its source has not changed, so nothing was renewed`
      : `Pin "${id}" renewed: ${out.value.changed.length} change(s); stale until they run again: ${out.value.affected.join(", ")}`,
    changed: out.value.changed, affected: out.value.affected,
  });
  return EX_OK;
}

// ── budget (avg-91o) ────────────────────────────────────────────────────────

/**
 * `vpr budget <ep>` reports the spend ledger; `vpr budget <ep> release <id>`
 * closes an open reservation as spending nothing.
 *
 * Releasing is the operator's: it frees budget, and an agent that could free
 * its own reservations would have no cap. It is for a call that died between
 * reserving and settling — check the provider's dashboard first, because an
 * open reservation counts precisely because the provider may have billed it.
 */
async function cmdBudget(ctx: CliContext, args: string[]): Promise<number> {
  const usage = "Usage: vpr budget <channel>/<series>/<episode> [release <reservation-id> [--note <why>]]";
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--note") && !(i > 0 && args[i - 1] === "--library"));
  const parsed = positional[0] ? parsePath(positional[0]) : null;
  if (!parsed) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  const root = libraryFrom(args) || ".";

  if (positional[1] === undefined) {
    try {
      const budget = await readEpisodeBudget(root, parsed);
      emit(ctx, { message: `Budget for ${positional[0]}`, episode: parsed, budget });
      return EX_OK;
    } catch (e) {
      emit(ctx, { error: `The budget cannot be read: ${e instanceof Error ? e.message : String(e)}` });
      return EX_RUNTIME;
    }
  }

  const reserveId = positional[2];
  if (positional[1] !== "release" || !reserveId) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would release ${reserveId} for ${positional[0]}`, dryRun: true });
    return EX_OK;
  }
  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }
  if (credential.principal !== "operator") {
    emit(ctx, { error: `Only the operator can release a reservation: it frees budget. Nothing was recorded.` });
    return EX_RUNTIME;
  }
  const note = flagValue(args, "--note");
  const released = await releaseSpend(episodePath(root, parsed.channel, parsed.series, parsed.episode), {
    episode: parsed, actor: "human", reserveId,
    reason: note ? `released by the operator: ${note}` : "released by the operator",
  });
  if (!released.ok) {
    emit(ctx, { error: released.reason, code: released.code });
    return EX_RUNTIME;
  }
  emit(ctx, { message: `Reservation ${reserveId} is released for ${positional[0]}`, reserveId });
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
      const pipelineId = pipelineFor(ctx, args, parsed, extractPipeline(args).pipeline);
      if (typeof pipelineId === "number") return pipelineId;
      const pipeline = await resolvePipeline(loader, pipelineId);
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
 * Every `RerunMode` this CLI accepts.
 *
 * Used only to validate `--mode` and to list the choices in a usage error —
 * `rerun-affected-downstream` was refused by name here until avg-qr4.3 task 9
 * gave `ExecutionService.planRerun` a `StalenessReport` to compute for it
 * (`propagate`, from `--stages`); the service itself now owns the one
 * refusal that mode still has (no stages named to propagate from).
 */
const RERUN_MODES = ["retry-current", "rerun-selected", "rerun-affected-downstream", "full-rebuild"] as const;

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

  if (!RERUN_MODES.includes(mode as typeof RERUN_MODES[number])) {
    emit(ctx, { error: `Unknown mode "${mode}". Available: ${RERUN_MODES.join(", ")}` });
    return EX_USAGE;
  }

  // Not `remaining[stagesIdx + 1]!` — the same shape of mistake `--mode`
  // avoids two lines above: asserting the token past a trailing flag exists
  // turns a mistyped command line into a FATAL (uncaught TypeError, EX_RUNTIME)
  // instead of the usage error it actually is.
  const stagesIdx = remaining.indexOf("--stages");
  if (stagesIdx >= 0 && !remaining[stagesIdx + 1]) {
    emit(ctx, { error: "--stages requires a comma-separated list of stage ids, e.g. --stages brief,script" });
    return EX_USAGE;
  }
  const selected = stagesIdx >= 0
    ? remaining[stagesIdx + 1]!.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // `--stages` means something to two modes: `rerun-selected` reads it
  // directly, and `rerun-affected-downstream` reads it as what changed, to
  // propagate staleness from (avg-qr4.3, task 9). Parsing it and then
  // discarding it for `retry-current`/`full-rebuild` would silently ignore
  // input the caller went out of their way to supply.
  if (selected.length > 0 && mode !== "rerun-selected" && mode !== "rerun-affected-downstream") {
    emit(ctx, {
      error: `--stages is only used by "rerun-selected" and "rerun-affected-downstream" modes; ` +
        `--mode "${mode}" does not accept it`,
    });
    return EX_USAGE;
  }

  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }

  const operatorKey = cliOperatorKey(ctx);
  if (typeof operatorKey === "number") return operatorKey;
  const service = makeService(args, ttl.value, operatorKey);
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;

  const plan = await service.planRerun(parsed, pipeline, mode as RerunMode, selected);
  if (!plan.ok) {
    emit(ctx, { error: `${plan.error.code}: ${plan.error.message}` });
    return exitCodeFor(plan.error);
  }

  if (ctx.dryRun) {
    // No `estimatedCost`. The plan carries a `totalEstimatedCost`, but it is
    // a unitless weight summed from attempt counts
    // (studio/runtime/src/rerun/planner.ts) — emitting it under that name
    // hands the operator a number shaped like money that no part of this
    // repo can price. What the stages are is the answer to "what would this
    // do".
    emit(ctx, {
      message: `[DRY RUN] Rerun plan (${mode}): ${plan.value.rerunStageIds.length} stage(s)`,
      mode, dryRun: true, stages: plan.value.rerunStageIds,
      preserved: plan.value.preservedStageIds,
    });
    return EX_OK;
  }

  const outcomes = await service.rerun(parsed, pipeline, plan.value.rerunStageIds);
  if (!outcomes.ok) {
    emit(ctx, {
      error: `${outcomes.error.code}: ${outcomes.error.message}`,
      ...(outcomes.error.partialOutcomes ? { partial: outcomes.error.partialOutcomes } : {}),
    });
    return exitCodeFor(outcomes.error);
  }
  emit(ctx, {
    message: `Rerun (${mode}): ${outcomes.value.length} stage(s)`,
    mode, stages: plan.value.rerunStageIds,
    // `stages` is the plan; `rerun()` stops at the first stage that does not
    // complete, so a caller cannot infer from `stages` alone which of them
    // were actually attempted. This is that list, in attempt order.
    executed: outcomes.value.map((o) => o.stageId),
    outcomes: outcomes.value.map(outcomeFields),
  });
  return EX_OK;
}

// ── approve / reject ────────────────────────────────────────────────────────

/**
 * `vpr approve` and `vpr reject` share everything but the decision: both
 * parse the same arguments, resolve the same credential and go through the
 * same `ExecutionService.review` call, which is the only code that writes a
 * review event (avg-qr4.3). Splitting them risked the two drifting apart —
 * `approve` checking something `reject` forgot, or the reverse.
 *
 * Who is deciding is resolved from the filesystem, not asked for: a caller
 * that can read the operator key is the operator, and its decision is
 * signed; one that cannot is an agent, and asking a `review: human` stage to
 * approve downgrades to a request rather than assuming yes.
 */
async function cmdReview(ctx: CliContext, args: string[], decision: "approved" | "rejected"): Promise<number> {
  const verb = decision === "approved" ? "approve" : "reject";
  if (args.length < 2) {
    emit(ctx, { error: `Usage: vpr ${verb} <channel>/<series>/<episode> <stage-id>${decision === "rejected" ? " --note <text>" : ""}` });
    return EX_USAGE;
  }
  const pathArg = args[0]!;
  const stageId = args[1]!;
  const note = flagValue(args, "--note");
  if (decision === "rejected" && !note) {
    emit(ctx, { error: "vpr reject needs --note: a rejection nobody can act on is noise" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}" (expected <channel>/<series>/<episode>)` });
    return EX_USAGE;
  }
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would ${verb} stage "${stageId}" for ${pathArg}`, dryRun: true });
    return EX_OK;
  }

  // Resolved from the filesystem, never from a flag: nothing on the command
  // line can make this process the operator. A key other users can read
  // refuses outright, the same rule the gateway applies to its own token.
  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }

  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }

  const service = makeService(args, ttl.value, credential.operatorKey);
  const { pipeline: pipelineName } = extractPipeline(args);
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;
  const out = await service.review(parsed, pipeline, stageId, { decision, principal: credential.principal, note });
  if (!out.ok) {
    emit(ctx, { error: out.error.message, code: out.error.code });
    return EX_RUNTIME;
  }
  const o = out.value;
  emit(ctx, { message: o.reason ?? `Stage "${stageId}" ${o.status} for ${pathArg}`, path: pathArg, stageId, status: o.status });
  return o.status === decision ? EX_OK : EX_RUNTIME;
}

async function cmdApprove(ctx: CliContext, args: string[]): Promise<number> {
  return cmdReview(ctx, args, "approved");
}

async function cmdReject(ctx: CliContext, args: string[]): Promise<number> {
  return cmdReview(ctx, args, "rejected");
}

// ── reference (avg-jao.6) ───────────────────────────────────────────────────

/**
 * `vpr reference approve | withdraw | verify | list`: golden references
 * (ADR-0037). Approving and withdrawing sign with the operator key, resolved
 * as `vpr approve` resolves it; Pi only ever proposes.
 */
async function cmdReference(ctx: CliContext, args: string[]): Promise<number> {
  const usage =
    "Usage: vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | " +
    "vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | " +
    "vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--library <path>] [--json]";
  const libraryRoot = libraryFrom(args);
  const [sub, target, a, b] = positionalArgs(args);
  if (!libraryRoot) {
    emit(ctx, { error: "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }
  const seriesOf = (value: string | undefined) => {
    const parts = (value ?? "").split("/");
    return parts.length === 2 && parts.every(Boolean) ? { channel: parts[0]!, series: parts[1]! } : null;
  };
  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }
  const key = credential.operatorKey;
  const refused = (out: { code: string; message: string; problems?: unknown[] }) => {
    emit(ctx, { error: out.message, code: out.code, ...(out.problems ? { problems: out.problems } : {}) });
    return EX_RUNTIME;
  };

  if (sub === "approve") {
    const ref = target ? parsePath(target) : null;
    if (!ref || !a) {
      emit(ctx, { error: usage });
      return EX_USAGE;
    }
    const note = flagValue(args, "--note");
    const out = approveReference({ libraryRoot, ref, referenceId: a, key, dryRun: ctx.dryRun, ...(note !== undefined ? { note } : {}) });
    if (!out.ok) return refused(out);
    const { path, descriptor, written } = out.value;
    emit(ctx, {
      message: written
        ? `${a} is now a reference of ${ref.channel}/${ref.series}: ${path}`
        : `[DRY RUN] ${a} would become a reference of ${ref.channel}/${ref.series}: ${path}`,
      path,
      descriptor,
      dryRun: !written,
    });
    return EX_OK;
  }

  if (sub === "withdraw") {
    const series = seriesOf(target);
    const reason = flagValue(args, "--reason");
    if (!series || !a || !b || !reason) {
      emit(ctx, { error: usage });
      return EX_USAGE;
    }
    if (ctx.dryRun) {
      emit(ctx, { message: `[DRY RUN] Would withdraw ${a}/${b} of ${target}`, dryRun: true });
      return EX_OK;
    }
    const out = withdrawReference({ libraryRoot, ...series, templateId: a, referenceId: b, key, reason });
    if (!out.ok) return refused(out);
    emit(ctx, { message: `${b} is withdrawn: ${out.value.path}`, path: out.value.path, withdrawal: out.value.withdrawal });
    return EX_OK;
  }

  if (sub === "verify") {
    const series = seriesOf(target);
    if (!series || !a || !b) {
      emit(ctx, { error: usage });
      return EX_USAGE;
    }
    const verdict = verifySeriesReference({ seriesDir: seriesPath(libraryRoot, series.channel, series.series), templateId: a, referenceId: b, key });
    emit(ctx, {
      message: `${a}/${b}: ${verdict.state}${verdict.problems[0] ? ` — ${verdict.problems[0].code} at ${verdict.problems[0].path}: ${verdict.problems[0].message}` : ""}`,
      state: verdict.state,
      problems: verdict.problems,
      ...(verdict.withdrawal ? { withdrawal: verdict.withdrawal } : {}),
    });
    return verdict.state === "trusted" ? EX_OK : EX_RUNTIME;
  }

  if (sub === "list") {
    const series = seriesOf(target);
    if (!series) {
      emit(ctx, { error: usage });
      return EX_USAGE;
    }
    const references = listReferences({ libraryRoot, ...series, key }).map(({ templateId, referenceId, verdict }) => ({
      templateId,
      referenceId,
      state: verdict.state,
      ...(verdict.problems[0] ? { problem: verdict.problems[0] } : {}),
    }));
    emit(ctx, {
      message: references.length === 0
        ? `${target} has no references`
        : references.map((r) => `${r.templateId}/${r.referenceId}: ${r.state}${r.problem ? ` (${r.problem.code})` : ""}`).join("\n"),
      references,
    });
    return EX_OK;
  }

  emit(ctx, { error: usage });
  return EX_USAGE;
}

// ── sheet (avg-3th.2) ───────────────────────────────────────────────────────

/**
 * `vpr sheet approve | reject | status`: the operator's signed review of an
 * episode's layout sheet. A spec-driven episode does not render without an
 * approval of its current sheet.
 */
async function cmdSheet(ctx: CliContext, args: string[]): Promise<number> {
  const usage =
    "Usage: vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | " +
    "vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode> [--library <path>]";
  const libraryRoot = libraryFrom(args);
  const [sub, target] = positionalArgs(args);
  if (!libraryRoot) {
    emit(ctx, { error: "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }
  const ref = target ? parsePath(target) : null;
  if (!ref || !["approve", "reject", "status"].includes(sub ?? "")) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}${sub === "status" ? "" : ". Nothing was recorded."}` });
    return EX_RUNTIME;
  }
  const key = credential.operatorKey;

  if (sub === "status") {
    const status = sheetReviewStatus({ libraryRoot, ref, key });
    emit(ctx, { ...status, message: `${target}: ${status.message}` });
    return status.state === "approved" ? EX_OK : EX_RUNTIME;
  }

  const note = flagValue(args, "--note");
  if (sub === "reject" && !note) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  const out = reviewSheet({ libraryRoot, ref, key, decision: sub === "approve" ? "approved" : "rejected", dryRun: ctx.dryRun, ...(note !== undefined ? { note } : {}) });
  if (!out.ok) {
    emit(ctx, { error: out.message, code: out.code });
    return EX_RUNTIME;
  }
  const { path, review, written } = out.value;
  emit(ctx, {
    message: `${written ? "" : "[DRY RUN] "}${target}'s sheet ${written ? "is" : "would be"} ${review.decision}: ${path} (the render checks that it still pictures the timeline)`,
    path,
    review,
    dryRun: !written,
  });
  return EX_OK;
}

// ── theme / template (avg-dcf.6.10) ─────────────────────────────────────────

/** A channel, series, theme or version: one plain path part, never a way out of the library. */
const isNamePart = (part: string) => part !== "" && part !== "." && part !== ".." && !/[\\/]/.test(part);

/**
 * `vpr theme seal`: list a theme release's files with their hashes in its
 * theme.json, so every episode on it is held to them (ADR-0040). Prints the
 * hash a template release pins.
 */
async function cmdTheme(ctx: CliContext, args: string[]): Promise<number> {
  const usage = "Usage: vpr theme seal <channel>/<theme>/<version> [--library <path>]";
  const libraryRoot = libraryFrom(args);
  const [sub, target] = positionalArgs(args);
  const parts = target?.split("/") ?? [];
  if (!libraryRoot || sub !== "seal" || parts.length !== 3 || !parts.every(isNamePart)) {
    emit(ctx, { error: libraryRoot ? usage : "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }
  const [channel, id, version] = parts as [string, string, string];
  try {
    const sealed = sealTheme(channelPath(libraryRoot, channel), id, version, { dryRun: ctx.dryRun });
    emit(ctx, {
      message: ctx.dryRun
        ? `[DRY RUN] ${id}@${version} would be sealed: ${Object.keys(sealed.files).length} file(s), theme.json hash ${sealed.hash}`
        : `${id}@${version} sealed: ${Object.keys(sealed.files).length} file(s); pin it as {"id": "${id}", "version": "${version}", "hash": "${sealed.hash}"} (vpr template release … --theme ${id}@${version})`,
      ...sealed,
      dryRun: ctx.dryRun,
    });
    return EX_OK;
  } catch (error) {
    if (!(error instanceof ThemeReleaseError)) throw error;
    emit(ctx, { error: error.message, code: error.code });
    return EX_RUNTIME;
  }
}

/**
 * `vpr channel init|media <channel>` (avg-d1x phase 5): the channel as its own
 * git repository, its heavy media named by hash in media.lock.jsonl.
 */
async function cmdChannel(ctx: CliContext, args: string[]): Promise<number> {
  const usage = "Usage: vpr channel init <channel> [--commit] | vpr channel media <channel> [--check] [--prune] [--verify] [--library <path>]";
  const libraryRoot = libraryFrom(args);
  const [sub, channel] = positionalArgs(args);
  if (!libraryRoot || (sub !== "init" && sub !== "media") || !channel || !isNamePart(channel)) {
    emit(ctx, { error: libraryRoot ? usage : "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }
  const dir = channelPath(libraryRoot, channel);
  if (!existsSync(dir)) {
    emit(ctx, { error: `there is no channel "${channel}" in ${libraryRoot}` });
    return EX_RUNTIME;
  }
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
  try {
    if (sub === "init") {
      const commit = args.includes("--commit");
      const made = initChannelRepo(dir, { commit });
      const warnings = [
        ...made.warnings,
        ...(made.notIgnored.length ? [`the kept .gitignore leaves ${made.notIgnored.length} media files to git (${made.notIgnored.slice(0, 3).join(", ")}${made.notIgnored.length > 3 ? ", …" : ""}): ignore them before you commit them`] : []),
      ];
      emit(ctx, {
        message: `${channel} is a git repository: ${made.created.join(", ") || "nothing"} written${made.kept.length ? `, ${made.kept.join(", ")} kept` : ""}; ` +
          `${made.media.files} media files (${mb(made.media.bytes)}) named in ${MEDIA_LOCK}` +
          (made.commit ? `; committed ${made.commit}` : commit ? "; nothing new to commit" : "; commit it, and add a remote to share it") +
          warnings.map((w) => `\nwarning: ${w}`).join(""),
        ...made,
      });
      return EX_OK;
    }
    if (args.includes("--check")) {
      const checked = checkMedia(dir, { verify: args.includes("--verify") });
      const said = checked.ok
        ? `${channel}: every media file is here and is the one ${MEDIA_LOCK} names`
        : `${channel}: ${checked.missing.length} missing, ${checked.changed.length} changed, ${checked.unlisted.length} not yet in ${MEDIA_LOCK}`;
      emit(ctx, { ...(checked.ok ? { message: said } : { error: said }), ...checked });
      return checked.ok ? EX_OK : EX_RUNTIME;
    }
    const written = writeMediaLock(dir, { prune: args.includes("--prune"), verify: args.includes("--verify") });
    const absent = written.absent ? `; ${written.absent} not on this machine kept (--prune forgets them)` : "";
    const pruned = written.pruned ? `; ${written.pruned} no longer here forgotten` : "";
    emit(ctx, { message: `${channel}: ${written.files} media files named in ${MEDIA_LOCK} (${mb(written.bytes)} here)${absent}${pruned}; commit it with the work that made them`, ...written });
    return EX_OK;
  } catch (error) {
    emit(ctx, { error: error instanceof Error ? error.message : String(error) });
    return EX_RUNTIME;
  }
}

/**
 * `vpr kit seal|verify <channel>[/<series>] <name> <version>` (avg-d1x): a kit
 * the channel or one of its series carries, built and checked by
 * @studio/episode, loaded at run time as `vpr template seal` loads it.
 */
async function cmdKit(ctx: CliContext, args: string[]): Promise<number> {
  const usage = "Usage: vpr kit seal <channel>[/<series>] <name> <version> [--dry-run] | vpr kit verify <channel>[/<series>] <name> <version> [--library <path>]";
  const libraryRoot = libraryFrom(args);
  const [sub, target, name, version] = positionalArgs(args);
  const parts = target?.split("/") ?? [];
  if (!libraryRoot || (sub !== "seal" && sub !== "verify") || parts.length < 1 || parts.length > 2 || !parts.every(isNamePart) || !name || !version) {
    emit(ctx, { error: libraryRoot ? usage : "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }
  const place = { channelDir: channelPath(libraryRoot, parts[0]!), ...(parts[1] ? { series: parts[1] } : {}), name, version };
  const episode = "@studio/episode";
  let mod: {
    sealKit: (p: typeof place, o: { dryRun?: boolean }) => Promise<{ hash: string; bundle: { path: string; hash: string } }>;
    verifyKit: (p: typeof place) => Promise<{ ok: boolean; problems: { code: string; message: string }[]; warnings: { code: string; message: string }[]; examples: { id: string; ok: boolean; message?: string }[] }>;
    TemplateCodeError: new (...a: never[]) => Error & { code: string };
  };
  try {
    mod = await import(episode);
  } catch (error) {
    emit(ctx, { error: `the studio's episode package could not be loaded: ${error instanceof Error ? error.message : String(error)}` });
    return EX_RUNTIME;
  }
  const label = `${parts.join("/")} kit ${name}@${version}`;
  try {
    if (sub === "seal") {
      const sealed = await mod.sealKit(place, { dryRun: ctx.dryRun });
      emit(ctx, { message: `${ctx.dryRun ? "[DRY RUN] " : ""}${label} ${ctx.dryRun ? "would be sealed" : "sealed"}: pin it in a series release (kits: [{name, version, level}]) and vpr template seal it`, ...sealed, dryRun: ctx.dryRun });
      return EX_OK;
    }
    const verified = await mod.verifyKit(place);
    const examples = verified.examples.map((e) => `${e.ok ? "✓" : "✗"} ${e.id}${e.message ? `: ${e.message}` : ""}`).join("; ");
    const said = `${label}: ${verified.ok ? "verified" : "NOT verified"}${verified.problems.length ? `; ${verified.problems.map((p) => p.message).join("; ")}` : ""}${examples ? `; examples: ${examples}` : "; no examples"}`;
    emit(ctx, {
      ...(verified.ok ? { message: said } : { error: said }),
      ...(verified.warnings.length ? { warning: verified.warnings.map((w) => w.message).join("; ") } : {}),
      ...verified,
    });
    return verified.ok ? EX_OK : EX_RUNTIME;
  } catch (error) {
    if (!(error instanceof mod.TemplateCodeError)) throw error;
    emit(ctx, { error: error.message, code: error.code });
    return EX_RUNTIME;
  }
}

async function cmdTemplateCode(ctx: CliContext, sub: "seal" | "verify" | "fixture", seriesDir: string, id: string, version: string, update: boolean, fixture?: { episodeRef: { channel: string; series: string; episode: string }; to?: string }): Promise<number> {
  type Verified = { ok: boolean; problems: { code: string; message: string }[]; warnings: { code: string; message: string }[]; fixtures: { name: string; ok: boolean; message?: string }[] };
  const episode = "@studio/episode";
  let mod: {
    sealTemplateCode: (s: string, i: string, v: string, o: { dryRun?: boolean }) => Promise<{ hash: string; code: Record<string, { path: string; hash: string }> }>;
    verifyTemplateCode: (s: string, i: string, v: string, o: { update?: boolean; dryRun?: boolean }) => Promise<Verified>;
    captureFixture: (e: string, o: { episodeRef: { channel: string; series: string; episode: string }; name: string; to?: string; dryRun?: boolean }) => { release: string; path: string };
    TemplateCodeError: new (...a: never[]) => Error & { code: string };
  };
  try {
    mod = await import(episode);
  } catch (error) {
    emit(ctx, { error: `the studio's episode package could not be loaded: ${error instanceof Error ? error.message : String(error)}` });
    return EX_RUNTIME;
  }
  try {
    if (sub === "fixture" && fixture) {
      const captured = mod.captureFixture(join(seriesDir, "episodes", fixture.episodeRef.episode), { episodeRef: fixture.episodeRef, name: id, ...(fixture.to ? { to: fixture.to } : {}), dryRun: ctx.dryRun });
      emit(ctx, { message: `${ctx.dryRun ? "[DRY RUN] " : ""}${captured.release}: ${fixture.episodeRef.episode} ${ctx.dryRun ? "would be kept" : "kept"} as fixture "${id}" (${captured.path}); write its golden with vpr template verify --update`, ...captured, dryRun: ctx.dryRun });
      return EX_OK;
    }
    if (sub === "seal") {
      const sealed = await mod.sealTemplateCode(seriesDir, id, version, { dryRun: ctx.dryRun });
      const built = Object.entries(sealed.code).map(([role, b]) => `${role} ${b.path}`).join(", ");
      emit(ctx, { message: `${ctx.dryRun ? "[DRY RUN] " : ""}${id}@${version} ${ctx.dryRun ? "would be sealed" : "sealed"}: ${built}; verify it with vpr template verify`, ...sealed, dryRun: ctx.dryRun });
      return EX_OK;
    }
    const verified = await mod.verifyTemplateCode(seriesDir, id, version, { update, dryRun: ctx.dryRun });
    const fixtures = verified.fixtures.map((f) => `${f.ok ? "✓" : "✗"} ${f.name}${f.message ? `: ${f.message}` : ""}`).join("; ");
    const said = `${id}@${version}: ${verified.ok ? "verified" : "NOT verified"}` +
      `${verified.problems.length ? `; ${verified.problems.map((p) => p.message).join("; ")}` : ""}` +
      `${fixtures ? `; fixtures: ${fixtures}` : "; no fixtures"}`;
    emit(ctx, {
      ...(verified.ok ? { message: said } : { error: said }),
      ...(verified.warnings.length ? { warning: verified.warnings.map((w) => w.message).join("; ") } : {}),
      ...verified,
    });
    return verified.ok ? EX_OK : EX_RUNTIME;
  } catch (error) {
    if (!(error instanceof mod.TemplateCodeError)) throw error;
    emit(ctx, { error: error.message, code: error.code });
    return EX_RUNTIME;
  }
}

/** `vpr template release|seal|verify`: a new release of a series template (a copy of `--from`, pinned to a sealed theme), or its own code sealed and verified. */
async function cmdTemplate(ctx: CliContext, args: string[]): Promise<number> {
  const usage = "Usage: vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] [--library <path>] | " +
    "vpr template seal <channel>/<series> <template-id> <version> [--dry-run] | vpr template verify <channel>/<series> <template-id> <version> [--update] [--dry-run] | " +
    "vpr template fixture <channel>/<series>/<episode> <fixture-name> [--to <version>] [--dry-run]";
  const libraryRoot = libraryFrom(args);
  const [sub, target, id, version] = positionalArgs(args);
  const parts = target?.split("/") ?? [];
  if ((sub === "seal" || sub === "verify") && libraryRoot && parts.length === 2 && parts.every(isNamePart) && id && version) {
    return cmdTemplateCode(ctx, sub, seriesPath(libraryRoot, parts[0]!, parts[1]!), id, version, args.includes("--update"));
  }
  // `fixture <channel>/<series>/<episode> <name>`: `id` holds the fixture's name.
  if (sub === "fixture" && libraryRoot && parts.length === 3 && parts.every(isNamePart) && id && (!args.includes("--to") || flagValue(args, "--to"))) {
    const [channel, series, episode] = parts as [string, string, string];
    const to = flagValue(args, "--to");
    return cmdTemplateCode(ctx, "fixture", seriesPath(libraryRoot, channel, series), id, "", false, { episodeRef: { channel, series, episode }, ...(to ? { to } : {}) });
  }
  const from = flagValue(args, "--from");
  const themeArg = flagValue(args, "--theme");
  const theme = themeArg?.match(/^([^@]+)@([^@]+)$/);
  const compiler = flagValue(args, "--compiler");
  const validator = flagValue(args, "--validator");
  // A flag given without its value is a mistake, never "no theme".
  const flagsComplete = from !== undefined && (!args.includes("--theme") || (theme && isNamePart(theme[1]!) && isNamePart(theme[2]!)))
    && (!args.includes("--compiler") || compiler !== undefined) && (!args.includes("--validator") || validator !== undefined);
  if (!libraryRoot || sub !== "release" || parts.length !== 2 || !parts.every(isNamePart) || !id || !version || !flagsComplete) {
    emit(ctx, { error: libraryRoot ? usage : "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
    return EX_USAGE;
  }
  const [channel, series] = parts as [string, string];
  try {
    const released = releaseTemplate(seriesPath(libraryRoot, channel, series), {
      id, from, version, ...(theme ? { theme: { id: theme[1]!, version: theme[2]! } } : {}),
      ...(compiler !== undefined ? { compiler } : {}), ...(validator !== undefined ? { validator } : {}), dryRun: ctx.dryRun,
    });
    emit(ctx, {
      message: `${ctx.dryRun ? "[DRY RUN] " : ""}${id}@${version} ${ctx.dryRun ? "would be released" : "released"} at ${released.path}${released.theme ? ` on ${released.theme.id}@${released.theme.version}` : " (the theme pin copied from " + from + ")"}; move an episode onto it with pva_upgrade_spec`,
      ...released,
      dryRun: ctx.dryRun,
    });
    return EX_OK;
  } catch (error) {
    if (!(error instanceof ThemeReleaseError)) throw error;
    emit(ctx, { error: error.message, code: error.code });
    return EX_RUNTIME;
  }
}

// ── takes / select (avg-qr4.6) ──────────────────────────────────────────────

async function cmdTakes(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const parsed = remaining[0] ? parsePath(remaining[0]) : null;
  if (!parsed) {
    emit(ctx, { error: "Usage: vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>]" });
    return EX_USAGE;
  }
  const only = remaining[1] && !remaining[1].startsWith("--") ? remaining[1] : undefined;

  const operatorKey = cliOperatorKey(ctx);
  if (typeof operatorKey === "number") return operatorKey;
  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;
  const service = makeService(args, ttl.value, operatorKey);
  const takes = await service.takes(parsed, pipeline);
  if (!takes.ok) {
    emit(ctx, { error: `${takes.error.code}: ${takes.error.message}` });
    return exitCodeFor(takes.error);
  }
  const stages = only ? takes.value.stages.filter((s) => s.stageId === only) : takes.value.stages;
  if (only && stages.length === 0) {
    emit(ctx, { error: `Pipeline "${takes.value.pipeline}" declares no stage "${only}"` });
    return EX_INVALID;
  }
  emit(ctx, {
    message: `Takes for ${remaining[0]}`,
    episode: parsed,
    pipeline: takes.value.pipeline,
    stages,
  });
  return EX_OK;
}

async function cmdSelect(ctx: CliContext, args: string[]): Promise<number> {
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const usage = "Usage: vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>]";
  const parsed = remaining[0] ? parsePath(remaining[0]) : null;
  const stageId = remaining[1];
  const attemptNumber = Number(remaining[2]);
  if (!parsed || !stageId || !Number.isInteger(attemptNumber) || attemptNumber < 1) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  // The compare-and-swap: name the take you looked at, and a selection made
  // by someone else in between refuses this one instead of being replaced.
  const expectFlag = flagValue(args, "--expect");
  let expected: number | null | undefined;
  if (expectFlag !== undefined) {
    expected = expectFlag === "none" ? null : Number(expectFlag);
    if (expected !== null && (!Number.isInteger(expected) || expected < 1)) {
      emit(ctx, { error: `--expect takes an attempt number or "none", not "${expectFlag}"` });
      return EX_USAGE;
    }
  }
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would select attempt ${attemptNumber} of "${stageId}" for ${remaining[0]}`, dryRun: true });
    return EX_OK;
  }

  // Who is selecting comes from the filesystem, as for `approve`: an
  // operator's selection is signed and locks the take.
  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }
  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;
  const service = makeService(args, ttl.value, credential.operatorKey);
  const out = await service.select(parsed, pipeline, stageId, {
    attemptNumber, principal: credential.principal, ...(expected !== undefined ? { expected } : {}),
  });
  if (!out.ok) {
    emit(ctx, { error: out.error.message, code: out.error.code });
    return exitCodeFor(out.error);
  }
  const o = out.value;
  emit(ctx, {
    message: o.reason ?? `Attempt ${attemptNumber} of "${stageId}" is selected for ${remaining[0]}`,
    path: remaining[0], stageId, status: o.status, attemptNumber, outputs: o.outputs,
  });
  return o.status === "selected" ? EX_OK : EX_RUNTIME;
}

// ── run / complete ──────────────────────────────────────────────────────────

/**
 * The operator key for a command that does not itself decide a review, or
 * the exit code to return when the key file refuses.
 *
 * `status`, `run`, `complete` and `rerun` consult the review gate, and a
 * gate with no key reads every human approval as unverifiable (avg-qr4.3) —
 * so a CLI that resolved the key only for `approve`/`reject` would report a
 * stage its own operator approved as still awaiting review. Same resolution
 * and same refusal as `cmdReview`: a key other users can read is an error,
 * never quietly treated as absent; an absent key is `null`.
 */
function cliOperatorKey(ctx: CliContext): string | null | number {
  try {
    return resolveCliCredential().operatorKey;
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }
}

/**
 * The pipeline a command runs on an episode (avg-sxk): `--pipeline`, else
 * the one the library declares (`pipeline.yaml` in the episode, series or
 * channel — the files the gateway reads, though the gateway passes over one
 * it can't read), else `DEFAULT_PIPELINE`. A declaration that can't be read
 * is an error here, never the default: the default would run another
 * pipeline's stages on the episode.
 */
function pipelineFor(
  ctx: CliContext,
  args: string[],
  ref: { channel: string; series: string; episode: string },
  explicit: string | undefined,
): string | number {
  if (explicit) return explicit;
  try {
    return declaredPipeline(libraryFrom(args) || ".", ref)?.name ?? DEFAULT_PIPELINE;
  } catch (e) {
    if (!(e instanceof PipelineDeclarationError)) throw e;
    // Before the service is asked anything: a command stopped here wrote nothing.
    emit(ctx, { error: e.message, code: e.code });
    return EX_RUNTIME;
  }
}

/**
 * Where the built-in pipeline manifests live: `AVG_BUILTIN_PIPELINES` when
 * the operator sets it, else `@studio/pipelines`' directory, resolved through
 * the package as the gateway resolves it (ADR-0026). The CLI is a
 * composition root, like the gateway; the runtime library itself still takes
 * the path as a parameter (`createDefaultLoader`).
 */
function builtinPipelines(): string | undefined {
  if (process.env.AVG_BUILTIN_PIPELINES) return process.env.AVG_BUILTIN_PIPELINES;
  try {
    const manifest = createRequire(import.meta.url).resolve("@studio/pipelines/package.json");
    return manifest.replace(/package\.json$/, "pipelines");
  } catch {
    return undefined;
  }
}

/**
 * The execution service, composed for the CLI.
 *
 * The CLI injects no dispatcher: the adapters that perform stages
 * automatically live in @studio/adapters, which depends on this package and
 * not the reverse. That is why `vpr run` claims rather than performs — this
 * process has no adapter to hand the stage to, and pretending otherwise would
 * be a lie about where work happens.
 */
/**
 * Where a spec-driven series episode's stages are read from (avg-qwc): its
 * files, through @studio/adapters' bridge to @studio/episode. Loaded at run
 * time, as the gateway composes it: those packages depend on this one, so
 * the runtime cannot name them at build time. Absent (the runtime installed
 * alone), status follows the journal for every episode.
 */
let stageEvidence: StageEvidence | undefined;
/** Load the bridge; the reason it could not be loaded, or null. */
async function loadStageEvidence(): Promise<string | null> {
  const adapters = "@studio/adapters";
  try {
    const mod = (await import(adapters)) as { createStudioStageEvidence?: () => StageEvidence };
    stageEvidence = mod.createStudioStageEvidence?.();
    return stageEvidence ? null : `${adapters} has no createStudioStageEvidence`;
  } catch (e) {
    stageEvidence = undefined;
    return e instanceof Error ? e.message : String(e);
  }
}

function makeService(args: string[], leaseTtlMs: number, operatorKey: string | null): ExecutionService {
  return new ExecutionService({
    ...(stageEvidence ? { stageEvidence } : {}),
    libraryRoot: libraryFrom(args) || ".",
    // `|| undefined`, not a bare read, for the reason documented in the
    // gateway's production.ts: an empty string is not nullish, so it does not
    // trigger `createDefaultLoader`'s `??` fallback — the operator's escape
    // hatch would be dead exactly when it is reached for.
    builtinPipelines: builtinPipelines(),
    // The journal's spend ledger (avg-91o), the same guard the gateway
    // composes: a stage that declares a paid capability is refused once the
    // episode's budget is used up. It reserves nothing — the paid call does.
    budget: new JournalBudgetGuard(libraryFrom(args) || "."),
    holder: `cli/pid-${process.pid}`,
    // Stated, not inherited; see `claimTtlMs`.
    leaseTtlMs,
    // The key a human decision is signed with, and verified with (avg-qr4.3).
    // Every caller passes what `resolveCliCredential` resolved from the
    // filesystem — `cmdReview` to sign, the rest so the gate below can verify.
    operatorKey,
    // The same gate the gateway composes. Without one, a CLI fell back to the
    // manifest rule forever and no approval — signed or not — ever let a
    // dependent run from the terminal.
    review: new JournalReviewGate(operatorKey),
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
    builtinPipelines(),
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
 * not exist" from "the journal could not be read". The service's own
 * `MODE_UNSUPPORTED` — `rerun-affected-downstream` asked with no `--stages`
 * to propagate staleness from (avg-qr4.3, task 9) — is the same family of
 * caller mistake, so it earns `EX_USAGE` alongside it. Everything else —
 * unreadable journal, unresolvable pipeline, journal and pipeline in
 * disagreement — is `EX_RUNTIME`.
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
  // `pin`'s (avg-7zp.5).
  "--source", "--used-by", "--path",
  // `reference`'s (avg-jao.6), and the notes `approve`, `reject` and `budget` take.
  "--note", "--reason",
  // `template release`'s (avg-dcf.6.10, avg-dcf.6.9).
  "--from", "--theme", "--compiler", "--validator",
  // `template fixture`'s (avg-d1x, phase 5).
  "--to",
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

  // Resolved once, from the filesystem: whether this caller can read the
  // operator key decides both what `run` may claim — an operator may take a
  // stage `autopilot: false` reserves for a person (avg-qr4.3) — and what a
  // human decision is verified with. Two separate resolutions here risked the
  // usual drift: one path learning "operator" while the other silently kept
  // "agent".
  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }

  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;
  const service = makeService(args, ttl.value, credential.operatorKey);
  const claimed = await service.claim(parsed, pipeline, {
    ...(stage ? { stage } : {}),
    dryRun: ctx.dryRun,
    principal: credential.principal,
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
  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
  if (typeof pipeline === "number") return pipeline;

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
  const operatorKey = cliOperatorKey(ctx);
  if (typeof operatorKey === "number") return operatorKey;
  const service = makeService(args, ttl.value, operatorKey);

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
  // The usage line lists every mode the command accepts. `rerun-affected-downstream`
  // used to reach a deliberate refusal here (avg-33r, before staleness
  // propagation existed); avg-qr4.3 task 9 gave the service a `StalenessReport`
  // to compute for it, so it plans like any other mode now — given `--stages`.
  rerun: { name: "rerun", description: "Plan targeted reruns: which stages re-run, which are preserved", usage: "vpr rerun <channel>/<series>/<episode> [--mode retry-current|rerun-selected|rerun-affected-downstream|full-rebuild] [--stages a,b] [--json] [--dry-run]", examples: ["vpr rerun my-channel/my-series/ep001 --mode full-rebuild"], run: cmdRerun },
  approve: { name: "approve", description: "Approve a manual gate for a stage", usage: "vpr approve <channel>/<series>/<episode> <stage-id> [--json] [--dry-run]", examples: ["vpr approve my-channel/my-series/ep001 render-outro --dry-run"], run: cmdApprove },
  reject: { name: "reject", description: "Reject a stage's output, with a reason", usage: "vpr reject <channel>/<series>/<episode> <stage-id> --note <text> [--json] [--dry-run]", examples: ["vpr reject my-channel/my-series/ep001 script --note 'the wolf is too frightening'"], run: cmdReject },
  pin: { name: "pin", description: "Pin shared material (a channel source or another episode), verify it, or renew it to accept a new version", usage: "vpr pin add <channel>/<series>/<episode> <id> --source channel:<name>|episode:<series>/<episode> --used-by <stage>[,<stage>...] [--path <p>]... | vpr pin verify <channel>/<series>/<episode> | vpr pin renew <channel>/<series>/<episode> <id> [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr pin add my-channel/my-series/ep001 source --source channel:my-source --used-by narration", "vpr pin verify my-channel/my-series/ep001", "vpr pin renew my-channel/my-series/ep001 source"], run: cmdPin },
  budget: { name: "budget", description: "Show the episode's spend ledger; the operator can release an open reservation", usage: "vpr budget <channel>/<series>/<episode> [release <reservation-id> [--note <why>]] [--json] [--dry-run]", examples: ["vpr budget my-channel/my-series/ep001", "vpr budget my-channel/my-series/ep001 release rsv_01J9Z… --note 'fal dashboard shows no charge'"], run: cmdBudget },
  sheet: { name: "sheet", description: "Review an episode's layout sheet: approve it, reject it with a note, or see its review; a spec-driven episode renders only with an approval of its current sheet", usage: "vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode>", examples: ["vpr sheet approve my-channel/my-series/ep001", "vpr sheet reject my-channel/my-series/ep001 --note 'the verse bar covers the hand at 0:12'", "vpr sheet status my-channel/my-series/ep001"], run: cmdSheet },
  reference: { name: "reference", description: "Golden references of a series: approve a proposed one, withdraw, verify, list", usage: "vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--json]", examples: ["vpr reference approve my-channel/my-series/ep001 ep001-v1 --dry-run", "vpr reference verify my-channel/my-series my-template ep001-v1", "vpr reference withdraw my-channel/my-series my-template ep001-v1 --reason 'the recital was re-recorded'"], run: cmdReference },
  theme: { name: "theme", description: "Seal a theme release: its files and their hashes in theme.json, so a changed room never passes for the released one", usage: "vpr theme seal <channel>/<theme>/<version> [--library <path>]", examples: ["vpr theme seal my-channel/my-theme/1.1.0"], run: cmdTheme },
  channel: { name: "channel", description: "Make a channel its own git repository (its heavy media named by hash in media.lock.jsonl), update that list, or check this machine's media against it", usage: "vpr channel init <channel> [--commit] | vpr channel media <channel> [--check] [--prune] [--verify] [--library <path>]", examples: ["vpr channel init my-channel --commit", "vpr channel media my-channel", "vpr channel media my-channel --check", "vpr channel media my-channel --prune"], run: cmdChannel },
  kit: { name: "kit", description: "Seal a kit the channel or a series carries in the library (kit/index.tsx → kit.cjs, kit.json), or verify it", usage: "vpr kit seal <channel>[/<series>] <name> <version> [--dry-run] | vpr kit verify <channel>[/<series>] <name> <version> [--library <path>]", examples: ["vpr kit seal sample sample-card 1.0.0", "vpr kit verify sample/poetry hall 1.0.0"], run: cmdKit },
  template: { name: "template", description: "Release a series template (a copy of an earlier release, optionally pinned to a sealed theme), seal its own compiler and validator, verify them against its fixtures, or keep an episode as a fixture", usage: "vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] | vpr template seal <channel>/<series> <template-id> <version> [--dry-run] | vpr template verify <channel>/<series> <template-id> <version> [--update] | vpr template fixture <channel>/<series>/<episode> <fixture-name> [--to <version>] [--library <path>]", examples: ["vpr template fixture my-channel/my-series/ep001 ep001","vpr template seal sample/poetry poetry-short 1.1.0", "vpr template verify sample/poetry poetry-short 1.1.0", "vpr template release my-channel/my-series my-template 1.1.0 --from 1.0.0 --theme my-theme@1.1.0", "vpr template release my-channel/my-series my-template 1.2.0 --from 1.1.0 --compiler 1.1.0"], run: cmdTemplate },
  takes: { name: "takes", description: "List each stage's kept candidates and its selected take", usage: "vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>] [--json]", examples: ["vpr takes my-channel/my-series/ep001 illustrations"], run: cmdTakes },
  select: { name: "select", description: "Make an earlier candidate a stage's take; an operator's selection locks it", usage: "vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>] [--json] [--dry-run]", examples: ["vpr select my-channel/my-series/ep001 illustrations 2 --expect 3"], run: cmdSelect },
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
