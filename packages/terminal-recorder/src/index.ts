// ── Terminal recorder ───────────────────────────────────────────────────────
//
// Records a terminal session to video from a VHS tape.
//
// This lived inline in the studio agent as `execSync("vhs …")`, mixed together
// with episode paths and artifact directories, so `terminal.record` was a
// capability with no provider anyone could compose. Recording a terminal is
// useful well outside video production, so it belongs here: this module knows
// about tapes and output files, and nothing about episodes, scenes or stages.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync, renameSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";

/** Where the recorder binary lives, and how long it may take. */
export interface RecorderOptions {
  /** VHS executable. Resolved from PATH when omitted. */
  vhsPath?: string;
  /** Give up after this long. A tape is a script; a hung one blocks forever. */
  timeoutMs?: number;
}

export interface RecordRequest {
  /** Tape source. Either the script itself or a path to one. */
  tape: { content: string } | { path: string };
  /** Where the finished recording should end up. */
  outputPath: string;
  /** Working directory for the tape's own relative paths. */
  workingDir?: string;
}

export interface Recording {
  outputPath: string;
  bytes: number;
  /** The tape that produced it, kept beside the output for provenance. */
  tapePath: string;
}

export class TerminalRecorderError extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(code: string, message: string, detail = "") {
    super(message);
    this.name = "TerminalRecorderError";
    this.code = code;
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Whether a recorder is available, and which version.
 *
 * Callers should ask before offering the capability rather than discovering a
 * missing binary halfway through a production.
 */
export function probe(options: RecorderOptions = {}): { available: boolean; detail: string } {
  const vhs = options.vhsPath ?? "vhs";
  const result = spawnSync(vhs, ["--version"], { encoding: "utf-8" });

  if (result.error || result.status !== 0) {
    return {
      available: false,
      detail: "vhs not found. Install it with: brew install vhs ttyd",
    };
  }
  return { available: true, detail: (result.stdout || "").trim() || "vhs available" };
}

/**
 * Record a tape to video.
 *
 * VHS writes its output relative to the tape's `Output` directive, so the tape
 * is written into the destination directory and the result moved into place.
 * That keeps the caller from having to know VHS's conventions.
 */
export function record(request: RecordRequest, options: RecorderOptions = {}): Recording {
  const vhs = options.vhsPath ?? "vhs";
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const outputPath = resolve(request.outputPath);
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  const content = "content" in request.tape
    ? request.tape.content
    : readTape(request.tape.path);

  // The tape is kept beside the recording: it is the source that produced it,
  // and a recording whose script is gone cannot be reproduced or reviewed.
  const tapePath = join(outputDir, `${basename(outputPath, ".mp4")}.tape`);
  writeFileSync(tapePath, ensureOutputDirective(content, basename(outputPath)), "utf-8");

  const result = spawnSync(vhs, [basename(tapePath)], {
    cwd: request.workingDir ?? outputDir,
    encoding: "utf-8",
    timeout,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new TerminalRecorderError(
        "RECORDER_MISSING",
        "vhs is not installed or not on PATH",
        "Install it with: brew install vhs ttyd",
      );
    }
    if (code === "ETIMEDOUT") {
      throw new TerminalRecorderError(
        "RECORDER_TIMEOUT",
        `Recording exceeded ${timeout}ms`,
        "A tape that waits on input never finishes; check its Sleep and Type directives.",
      );
    }
    throw new TerminalRecorderError("RECORDER_FAILED", result.error.message);
  }

  if (result.status !== 0) {
    throw new TerminalRecorderError(
      "RECORDER_FAILED",
      `vhs exited with code ${result.status}`,
      (result.stderr || result.stdout || "").trim(),
    );
  }

  // VHS names its output from the Output directive; move it only if it landed
  // somewhere else.
  const produced = join(request.workingDir ?? outputDir, basename(outputPath));
  if (produced !== outputPath) {
    if (!existsSync(produced)) {
      throw new TerminalRecorderError(
        "NO_OUTPUT",
        `vhs reported success but produced no ${basename(outputPath)}`,
        (result.stderr || "").trim(),
      );
    }
    renameSync(produced, outputPath);
  }

  if (!existsSync(outputPath)) {
    throw new TerminalRecorderError(
      "NO_OUTPUT",
      `vhs reported success but produced no ${basename(outputPath)}`,
      (result.stderr || "").trim(),
    );
  }

  return { outputPath, bytes: statSync(outputPath).size, tapePath };
}

function readTape(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    throw new TerminalRecorderError(
      "TAPE_UNREADABLE",
      `Cannot read tape at ${path}`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Ensure the tape writes where we expect.
 *
 * A tape without an `Output` directive produces `out.gif`, and one pointing
 * elsewhere silently writes to a path the caller never sees. Rather than
 * rejecting either, the directive is set to the requested filename.
 */
export function ensureOutputDirective(tape: string, fileName: string): string {
  const withoutOutput = tape
    .split("\n")
    .filter((line) => !/^\s*Output\s+/i.test(line))
    .join("\n")
    .trimStart();

  return `Output ${fileName}\n${withoutOutput}${withoutOutput.endsWith("\n") ? "" : "\n"}`;
}
