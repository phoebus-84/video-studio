#!/usr/bin/env node
// ---------------------------------------------------------------------------
// video-pipeline-runtime CLI
//
// Operator CLI: init, resolve, validate, run, status, rerun, approve, doctor.
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
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { initChannel, initSeries, initEpisode } from "./workspace/init.js";
import { artifactExists } from "./artifacts/discovery.js";

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
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would approve stage "${args[1]}" for ${args[0]}`, dryRun: true });
    return EX_OK;
  }

  // An approval is the one moment a person takes responsibility for an
  // episode, and it used to leave no trace: this printed "approved" and
  // recorded nothing, so a finished production could not say who had passed
  // its review gates or when.
  const parsed = parsePath(args[0]!);
  const libraryRoot = libraryFrom(args);
  let recorded = false;
  if (parsed && libraryRoot) {
    const written = await appendJournalEvent(
      episodePath(libraryRoot, parsed.channel, parsed.series, parsed.episode),
      {
        type: "approval-granted",
        actor: "human",
        episode: parsed,
        data: { stageId: args[1]! },
      },
    );
    recorded = written !== null;
  }

  emit(ctx, {
    message: `Stage "${args[1]}" approved for ${args[0]}`,
    path: args[0],
    stageId: args[1],
    recorded,
  });
  return EX_OK;
}

// ── run ─────────────────────────────────────────────────────────────────────

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
  const stageId: string | null = stageIdx >= 0 ? remaining[stageIdx + 1] ?? null : null;

  try {
    const loader = makeLoader(args);
    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);

    const libraryRoot = libraryFrom(args) || ".";
    const episodeDir = episodePath(libraryRoot, parsed.channel, parsed.series, parsed.episode);

    // Find the first non-completed stage using the same provider-neutral
    // artifact discovery as status. An explicit stage remains a forced run.
    const pending = pipeline.stages.filter((s) => {
      if (stageId) return s.definition.id === stageId;
      return s.definition.produces.some((output) => !artifactExists(episodeDir, output.label));
    });


    if (ctx.dryRun) {
      emit(ctx, {
        message: `[DRY RUN] Would execute ${pending.length} stage(s)`,
        stages: pending.map((s) => s.definition.id),
        dryRun: true,
      });
      return EX_OK;
    }

    // For MVP: report which stage is ready to execute next
    // Actual execution is handled by the Pi agent calling capability tools
    const nextStage = pending[0];
    if (!nextStage) {
      emit(ctx, { message: "All stages complete", completed: true });
      return EX_OK;
    }

    emit(ctx, {
      message: `Ready to execute: ${nextStage.definition.id}`,
      stage: {
        id: nextStage.definition.id,
        name: nextStage.definition.name,
        capabilities: nextStage.definition.capabilities,
        dependsOn: nextStage.definition.dependsOn,
        produces: nextStage.definition.produces,
      },
      instruction: `Pi agent: read skill for stage "${nextStage.definition.id}", ` +
        `call capability tools (${nextStage.definition.capabilities.map((c) => c.capability).join(", ") || "none"}), ` +
        `write outputs to ${parsed.channel}/${parsed.series}/${parsed.episode}/artifacts/`,
    });
    return EX_OK;
  } catch (e) {
    emit(ctx, { error: `Run failed: ${e instanceof Error ? e.message : String(e)}` });
    return EX_RUNTIME;
  }
}

// ── Registry ────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, CliCommand> = {
  init: { name: "init", description: "Initialize a new episode workspace", usage: "vpr init <channel>/<series>/<episode> [--json] [--dry-run]", examples: ["vpr init my-channel/my-series/ep001"], run: cmdInit },
  resolve: { name: "resolve", description: "Resolve settings and create an immutable pipeline snapshot", usage: "vpr resolve <channel>/<series>/<episode> [--pipeline <name>] [--json]", examples: ["vpr resolve my-channel/my-series/ep001 --json", "vpr resolve my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdResolve },
  status: { name: "status", description: "Show pipeline, stage, artifact, and budget projections", usage: "vpr status <channel>/<series>/<episode> [--pipeline <name>] [--json]", examples: ["vpr status my-channel/my-series/ep001", "vpr status my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdStatus },
  validate: { name: "validate", description: "Validate pipeline DAG or snapshot integrity", usage: "vpr validate <pipeline|snapshot> [path] [--json]", examples: ["vpr validate pipeline my-channel/my-series/ep001"], run: cmdValidate },
  run: { name: "run", description: "Execute pipeline stages", usage: "vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr run my-channel/my-series/ep001 --stage write-brief", "vpr run my-channel/my-series/ep001 --pipeline fairy-tale-adaptation"], run: cmdRun },
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
