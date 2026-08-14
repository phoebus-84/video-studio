/**
 * Argv-only process runner. No shell interpolation ever.
 *
 * Spawns a process with an array of arguments. Supports:
 * - Cancellation with process-tree termination via AbortSignal
 * - Timeout enforcement
 * - Working directory and environment overrides
 * - Structured result with stdout/stderr capture
 * - Paths with spaces and Unicode (no quoting needed — this is argv, not shell)
 */

import type { ChildProcess } from "node:child_process";
import { getSpawn } from "./process-factory.js";
import type { ProcessOptions, ProcessResult } from "./types.js";
import { ProcessCancelledError, ProcessTimeoutError } from "./types.js";

/**
 * Run a process with argv-only arguments (no shell interpolation).
 *
 * Paths with spaces and Unicode are passed as-is in argv and work correctly
 * because the child process receives the exact string as a single argument.
 */
export function runProcess(
  command: string,
  args: string[] = [],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const {
    cwd,
    env,
    timeoutMs,
    signal,
    captureStderr = true,
    redact = [],
  } = options;

  return new Promise<ProcessResult>((resolve, reject) => {
    const startMs = Date.now();
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let signalHandler: (() => void) | null = null;
    let stdout = "";
    let stderr = "";

    const spawnFn = getSpawn();
    const proc: ChildProcess = spawnFn(command, args, {
      cwd: cwd ?? process.cwd(),
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", captureStderr ? "pipe" : "ignore"],
      windowsHide: true,
      // A new Unix process group lets cancellation reach FFmpeg descendants.
      // Windows uses taskkill /T and does not require detached process groups.
      detached: process.platform !== "win32",
    });

    // Helper to kill the process tree (OS-level + Node.js child process).
    // Signal the group before the root so descendants cannot be orphaned when
    // the root exits first.
    function killTree(signal: string): void {
      if (proc.pid !== undefined) {
        killProcessGroup(proc.pid, signal);
      }
      proc.kill(signal as NodeJS.Signals);
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    if (captureStderr) {
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    // Result with optional redaction
    function redactText(s: string): string {
      let out = s;
      for (const secret of redact) {
        if (secret.length === 0) continue;
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escaped, "g"), "[REDACTED]");
      }
      return out;
    }

    function settle(result: ProcessResult) {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (signalHandler && signal) {
        signal.removeEventListener("abort", signalHandler);
      }
      // If the root closed during cancellation, force-kill any descendant that
      // ignored SIGTERM while the original process-group ID is still known.
      if (result.cancelled && proc.pid !== undefined) {
        killProcessGroup(proc.pid, "SIGKILL");
      }
      resolve({
        ...result,
        stdout: redactText(result.stdout),
        stderr: redactText(result.stderr),
        durationMs: Date.now() - startMs,
      });
    }

    proc.on("error", (err) => {
      reject(err);
    });

    proc.on("close", (code, sig) => {
      settle({
        exitCode: code,
        signal: sig,
        stdout,
        stderr,
        durationMs: 0,
        cancelled: signal?.aborted || false,
      });
    });

    // Timeout
    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        killTree("SIGKILL");
        reject(new ProcessTimeoutError(timeoutMs));
        settled = true;
      }, timeoutMs);
    }

    // External cancellation via AbortSignal
    if (signal) {
      if (signal.aborted) {
        killTree("SIGTERM");
        reject(new ProcessCancelledError(signal.reason ?? "aborted"));
        settled = true;
        return;
      }
      signalHandler = () => {
        killTree("SIGTERM");
        // Give SIGTERM a chance, then SIGKILL
        setTimeout(() => killTree("SIGKILL"), 3000);
      };
      signal.addEventListener("abort", signalHandler, { once: true });
    }
  });
}

/**
 * Kill a process group at the OS level (Unix process groups, Windows taskkill).
 * This is a best-effort complement to childProcess.kill().
 */
function killProcessGroup(pid: number | undefined, signal: string): void {
  if (pid === undefined) return;

  try {
    if (process.platform === "win32") {
      getSpawn()("taskkill", ["/T", "/F", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, signal as NodeJS.Signals);
      } catch {
        try {
          process.kill(pid, signal as NodeJS.Signals);
        } catch {
          // Process already dead — fine
        }
      }
    }
  } catch {
    // Best-effort; the process may already be dead
  }
}
