// ── Pipeline Runtime Client ─────────────────────────────────────────────────
//
// Invokes the video-pipeline-runtime CLI (vpr) via child_process.
// All commands use --json for machine-readable output.
// Timeouts and error handling protect the gateway from hung processes.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RuntimeClientOptions {
  /** Path to the vpr CLI entry point (default: auto-discover) */
  cliPath?: string;
  /** Default timeout per command in ms (default: 60_000) */
  defaultTimeoutMs?: number;
  /** Library root for workspace operations */
  libraryRoot: string;
  /** Logger */
  log?: (msg: string) => void;
}

export interface RuntimeCommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  data?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

// ── Client ──────────────────────────────────────────────────────────────────

export class RuntimeClient {
  private readonly cliPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly libraryRoot: string;
  private readonly log: (msg: string) => void;

  constructor(options: RuntimeClientOptions) {
    this.cliPath = options.cliPath ?? this.discoverCli();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
    this.libraryRoot = options.libraryRoot;
    this.log = options.log ?? (() => {});
  }

  /**
   * Locate the runtime CLI by resolving the package, not by guessing paths.
   *
   * This previously tried three hardcoded sibling directories and then fell
   * back to bare "vpr" on PATH — so a layout change silently downgraded the
   * gateway to whatever "vpr" happened to mean on the host, or to nothing.
   * ADR-0026 requires package resolution; the workspace makes it exact.
   */
  private discoverCli(): string {
    try {
      return createRequire(import.meta.url).resolve("@studio/runtime/cli");
    } catch {
      throw new Error(
        "Cannot resolve @studio/runtime. The gateway requires the runtime as a " +
          "workspace dependency; run `bun install` at the repository root. " +
          "Falling back to a PATH binary is not supported because it cannot be " +
          "version-matched to the contracts this gateway was built against.",
      );
    }
  }

  /** Check if the runtime is reachable. */
  async health(): Promise<{ reachable: boolean; version?: string; error?: string }> {
    try {
      const result = await this.doctor();
      if (result.ok && result.data) {
        return { reachable: true, version: (result.data as Record<string, unknown>).version as string };
      }
      return { reachable: false, error: result.error ?? "Doctor command failed" };
    } catch (err) {
      return { reachable: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Command wrappers ──────────────────────────────────────────────────────

  /** vpr init <channel>/<series>/<episode> */
  async init(ref: EpisodeRef, pipeline?: string): Promise<RuntimeCommandResult> {
    const episodeRef = `${ref.channel}/${ref.series}/${ref.episode}`;
    const args = ["init", episodeRef];
    if (pipeline) args.push("--pipeline", pipeline);
    return this.exec(args);
  }

  /** vpr resolve <channel>/<series>/<episode> [--pipeline <name>] */
  async resolve(ref: EpisodeRef, pipeline?: string): Promise<RuntimeCommandResult> {
    const args = ["resolve", `${ref.channel}/${ref.series}/${ref.episode}`];
    if (pipeline) args.push("--pipeline", pipeline);
    return this.exec(args);
  }

  /** vpr status <channel>/<series>/<episode> [--pipeline <name>] */
  async status(ref: EpisodeRef, pipeline?: string): Promise<RuntimeCommandResult> {
    const args = ["status", `${ref.channel}/${ref.series}/${ref.episode}`];
    if (pipeline) args.push("--pipeline", pipeline);
    return this.exec(args);
  }

  /** vpr run <channel>/<series>/<episode> [--stage <id>] [--pipeline <name>] */
  async run(ref: EpisodeRef, stageId?: string, dryRun = false, pipeline?: string): Promise<RuntimeCommandResult> {
    const args = ["run", `${ref.channel}/${ref.series}/${ref.episode}`];
    if (stageId) args.push("--stage", stageId);
    if (pipeline) args.push("--pipeline", pipeline);
    if (dryRun) args.push("--dry-run");
    return this.exec(args, { timeoutMs: 300_000 }); // 5 min for runs
  }

  /** vpr rerun <channel>/<series>/<episode> */
  async rerun(ref: EpisodeRef, mode?: string, dryRun = false): Promise<RuntimeCommandResult> {
    const args = ["rerun", `${ref.channel}/${ref.series}/${ref.episode}`];
    if (mode) args.push("--mode", mode);
    if (dryRun) args.push("--dry-run");
    return this.exec(args);
  }

  /** vpr approve <channel>/<series>/<episode> <stage> */
  async approve(ref: EpisodeRef, stageId: string, dryRun = false): Promise<RuntimeCommandResult> {
    const args = ["approve", `${ref.channel}/${ref.series}/${ref.episode}`, stageId];
    if (dryRun) args.push("--dry-run");
    return this.exec(args);
  }

  /** vpr validate pipeline|snapshot [target] */
  async validate(what: "pipeline" | "snapshot", target?: string): Promise<RuntimeCommandResult> {
    const args = ["validate", what];
    if (target) args.push(target);
    return this.exec(args);
  }

  /** vpr doctor */
  async doctor(): Promise<RuntimeCommandResult> {
    return this.exec(["doctor"]);
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  private exec(
    args: string[],
    options?: { timeoutMs?: number },
  ): Promise<RuntimeCommandResult> {
    const startMs = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<RuntimeCommandResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const done = (result: RuntimeCommandResult) => {
        if (settled) return;
        settled = true;
        result.durationMs = Date.now() - startMs;
        resolve(result);
      };

      // The CLI requires --library explicitly; it does not read
      // AVG_LIBRARY_ROOT. Passing only the environment variable made every
      // runtime call exit 1 with "--library <path> is required", which surfaced
      // as runtime "down" in /health.
      const fullArgs = [...args, "--library", this.libraryRoot, "--json"];
      const env = {
        ...process.env,
        AVG_LIBRARY_ROOT: this.libraryRoot,
      };

      this.log?.(`RuntimeClient: vpr ${fullArgs.join(" ")}`);

      let proc: ChildProcess;
      try {
        if (this.cliPath.endsWith(".ts")) {
          proc = spawn("npx", ["tsx", this.cliPath, ...fullArgs], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } else {
          proc = spawn(process.execPath, [this.cliPath, ...fullArgs], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
          });
        }
      } catch (err) {
        done({
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        });
        return;
      }

      // Timeout
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        done({
          ok: false,
          exitCode: -1,
          stdout,
          stderr,
          error: `Command timed out after ${timeoutMs}ms: vpr ${args.join(" ")}`,
          durationMs: 0,
        });
      }, timeoutMs);

      // Collect stdout
      const rl = createInterface({ input: proc.stdout! });
      rl.on("line", (line) => {
        stdout += line + "\n";
      });

      // Collect stderr
      const errRl = createInterface({ input: proc.stderr! });
      errRl.on("line", (line) => {
        stderr += line + "\n";
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = code ?? -1;

        if (exitCode !== 0) {
          done({
            ok: false,
            exitCode,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: stderr.trim() || `vpr exited with code ${exitCode}`,
            durationMs: 0,
          });
          return;
        }

        // Parse JSON output — prefer full document over line-by-line
        let data: Record<string, unknown> | undefined;
        try {
          const trimmed = stdout.trim();
          if (trimmed) {
            // Try full document first (multi-line JSON objects)
            try {
              data = JSON.parse(trimmed);
            } catch {
              // Fall back to newline-delimited JSON objects
              const lines = trimmed.split("\n");
              for (const line of lines) {
                try {
                  const parsed = JSON.parse(line);
                  if (typeof parsed === "object" && parsed !== null) {
                    data = parsed as Record<string, unknown>;
                  }
                } catch {
                  // skip non-JSON lines
                }
              }
            }
          }
        } catch {
          // Non-JSON output is OK for some commands
        }

        done({
          ok: true,
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          data,
          durationMs: 0,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        done({
          ok: false,
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: err.message,
          durationMs: 0,
        });
      });
    });
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createRuntimeClient(
  libraryRoot: string,
  opts?: Partial<RuntimeClientOptions>,
): RuntimeClient {
  return new RuntimeClient({ libraryRoot, ...opts });
}
