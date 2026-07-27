// ─── Sleeper ──────────────────────────────────────────────────────────
// Injectable so tests can simulate delays instantly.

import type { Sleeper } from "./types.js";
import { FalCancelledError } from "./errors.js";

const ABORT_CHECK_INTERVAL_MS = 100;

/** Default sleeper using setTimeout. */
export class SystemSleeper implements Sleeper {
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new FalCancelledError("sleep cancelled before start");
    }

    if (ms <= 0) return;

    // For short sleeps, just set a straight timeout + abort listener.
    if (ms < ABORT_CHECK_INTERVAL_MS * 2) {
      await raceSleep(ms, signal);
      return;
    }

    // For longer sleeps, periodically check the signal.
    let remaining = ms;
    while (remaining > 0) {
      if (signal?.aborted) {
        throw new FalCancelledError("sleep cancelled");
      }
      const step = Math.min(remaining, ABORT_CHECK_INTERVAL_MS);
      await raceSleep(step, signal);
      remaining -= step;
    }
  }
}

/**
 * Test-only sleeper that resolves instantly regardless of the duration.
 * Optionally records the last duration requested for assertions.
 */
export class NoopSleeper implements Sleeper {
  public lastMs = 0;

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new FalCancelledError("sleep cancelled before start");
    }
    this.lastMs = ms;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function raceSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FalCancelledError("sleep cancelled"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new FalCancelledError("sleep cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Clean up listener on normal completion.
      const origResolve = resolve;
      resolve = () => {
        signal.removeEventListener("abort", onAbort);
        clearTimeout(timer);
        origResolve();
      };
    }
  });
}
