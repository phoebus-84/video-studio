#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CLI entry point
//
// Minimal shell wired through the port system so every side-effect is
// injectable and testable.
// ---------------------------------------------------------------------------

import { SystemClock } from "./ports/clock.js";
import { ConsoleLogger } from "./logging.js";
import { VERSION } from "./index.js";

async function main(): Promise<void> {
  const logger = new ConsoleLogger({ minLevel: "info" });
  const clock = new SystemClock();

  logger.info(`video-pipeline-runtime v${VERSION}`, {
    node: process.version,
    pid: process.pid,
    cwd: process.cwd(),
  });

  // Placeholder: print help when invoked with no subcommand.
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp(logger);
    return;
  }

  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  logger.warn(`Unknown command: ${cmd}`, { argv: process.argv.slice(2) });
  logger.info(`Run 'vpr --help' for usage.`);

  // Prove the clock is wired.
  logger.debug(`Current time via injected clock: ${clock.now().toISOString()}`);
}

function printHelp(logger: ConsoleLogger): void {
  const lines = [
    `video-pipeline-runtime v${VERSION}`,
    "",
    "Usage: vpr <subcommand> [options]",
    "",
    "Subcommands (placeholder – implemented in later phases):",
    "  init       Initialize a new workspace",
    "  resolve    Resolve and snapshot a pipeline",
    "  run        Execute a stage",
    "  status     Show pipeline/artifact status",
    "",
    "Options:",
    "  --help, -h      Show this help",
    "  --version, -v   Print version",
  ];
  for (const line of lines) {
    logger.info(line);
  }
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${String(e)}\n`);
  process.exitCode = 1;
});
