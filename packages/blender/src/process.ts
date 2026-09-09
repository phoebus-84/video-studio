import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

/** No shell, bounded in-memory output, full logs on disk, cancellable process group. */
export async function runProcess(
  executable: string, args: string[],
  options: { cwd: string; logPath: string; timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  options.signal?.throwIfAborted();
  const log = await open(options.logPath, "a");
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: options.cwd, shell: false, detached: process.platform !== "win32",
        stdio: ["ignore", log.fd, log.fd],
      });
      let reason: Error | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch { /* already exited */ }
      };
      const stop = (error: Error) => {
        if (reason) return;
        reason = error;
        kill("SIGTERM");
        escalation = setTimeout(() => kill("SIGKILL"), 2000);
      };
      const abort = () => stop(new Error("Operation cancelled"));
      const timer = setTimeout(() => stop(new Error(`Process exceeded ${options.timeoutMs}ms`)), options.timeoutMs);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const cleanup = () => {
        clearTimeout(timer);
        if (escalation) clearTimeout(escalation);
        options.signal?.removeEventListener("abort", abort);
      };
      child.once("error", (err) => { cleanup(); reject(err); });
      child.once("close", (code, signal) => {
        // A parent may exit on SIGTERM while its descendants ignore it. The
        // process group can outlive its leader, so reap it before clearing the
        // escalation timer rather than reporting cancellation with workers left.
        if (reason && process.platform !== "win32") kill("SIGKILL");
        cleanup();
        if (reason) reject(reason);
        else if (code !== 0) reject(new Error(`${executable} exited ${code ?? signal}; see ${options.logPath}`));
        else resolve(options.logPath);
      });
    });
  } finally { await log.close(); }
}
