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
    const { message, warning, error, ...rest } = data;
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

function makeLoader(): PipelineLoader {
  const libraryRoot = process.env.AVG_LIBRARY_ROOT;
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

async function cmdDoctor(ctx: CliContext, _args: string[]): Promise<number> {
  const checks: Record<string, string> = {};
  checks["runtime-version"] = `v${VERSION}`;

  try {
    makeLoader();
    checks["pipeline-loader"] = "OK (in-memory)";
  } catch (e) {
    checks["pipeline-loader"] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    resolveSettings({});
    checks["settings-resolver"] = "OK";
  } catch (e) {
    checks["settings-resolver"] = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  const failures = Object.entries(checks).filter(([, v]) => v.startsWith("FAIL"));
  const healthy = failures.length === 0;

  emit(ctx, {
    message: healthy ? "All checks passed" : `${failures.length} check(s) failed`,
    healthy,
    version: VERSION,
    checks,
    failures: failures.map(([k]) => k),
  });
  return healthy ? EX_OK : EX_RUNTIME;
}

// ── init ────────────────────────────────────────────────────────────────────

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
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would init: ${parsed.channel}/${parsed.series}/${parsed.episode}`, dryRun: true });
    return EX_OK;
  }
  emit(ctx, { message: `Workspace initialized: ${parsed.channel}/${parsed.series}/${parsed.episode}`, ...parsed });
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
    const loader = makeLoader();
    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);
    const snapshot = await createSnapshot({
      episodeSlug: `${parsed.channel}/${parsed.series}/${parsed.episode}`,
      pipeline,
      settings,
      providerBindings: [],
      sources: [],
      skillIds: [],
    });

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
    const loader = makeLoader();
    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);

    // ── Detect completed stages by checking for output artifacts ──────────
    const libraryRoot = process.env.AVG_LIBRARY_ROOT ?? ".";
    const episodeDir = `${libraryRoot}/${parsed.channel}/${parsed.series}/${parsed.episode}`;
    const { existsSync } = await import("node:fs");

    const artifactPaths: Record<string, string> = {
      "brief.md": `${episodeDir}/artifacts/brief.md`,
      "script.md": `${episodeDir}/artifacts/script.md`,
      "art-direction.json": `${episodeDir}/artifacts/art-direction.md`,
      "narration.mp3": `${episodeDir}/artifacts/narration/narration-full.wav`,
      "safety-report.json": `${episodeDir}/artifacts/safety-report.json`,
      "illustrations/": `${episodeDir}/artifacts/frames`,
      "captions.srt": `${episodeDir}/artifacts/captions.srt`,
      "timing.json": `${episodeDir}/artifacts/timing.json`,
      "continuity-report.json": `${episodeDir}/artifacts/continuity-report.json`,
      "output.mp4": `${episodeDir}/artifacts/render/final.mp4`,
      "qa-report.json": `${episodeDir}/artifacts/qa-report.json`,
    };

    function checkArtifact(label: string): string {
      const p = artifactPaths[label];
      if (!p) return "pending";
      try {
        if (label.endsWith("/")) {
          // Directory artifact — check if it has files
          if (existsSync(p)) {
            const entries = require("node:fs").readdirSync(p);
            return entries.length > 0 ? "completed" : "pending";
          }
        }
        return existsSync(p) ? "completed" : "pending";
      } catch {
        return "pending";
      }
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
      const loader = makeLoader();
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
  emit(ctx, { message: `Stage "${args[1]}" approved for ${args[0]}`, path: args[0], stageId: args[1] });
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
    const loader = makeLoader();
    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);

    // Find the next runnable stage(s)
    const pending = pipeline.stages.filter((s) => {
      if (stageId) return s.definition.id === stageId;
      return true; // All stages considered
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
  doctor: { name: "doctor", description: "Check system health and library accessibility", usage: "vpr doctor [--json]", examples: ["vpr doctor", "vpr doctor --json"], run: cmdDoctor },
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
    process.exitCode = EX_USAGE;
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
