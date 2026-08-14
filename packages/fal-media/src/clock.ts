// ─── System clock ─────────────────────────────────────────────────────
// Injectable so tests can freeze and advance time deterministically.

import type { Clock } from "./types.js";

/** Default wall-clock implementation. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
}

/**
 * Test-only clock whose time is explicitly set and advanced.
 * The epoch is fixed at construction; advance with `tick(ms)`.
 */
export class ManualClock implements Clock {
  private ms: number;

  constructor(epochMs = 0) {
    this.ms = epochMs;
  }

  now(): Date {
    return new Date(this.ms);
  }

  nowMs(): number {
    return this.ms;
  }

  /** Advance the clock by `ms` milliseconds. */
  tick(ms: number): void {
    if (ms < 0) throw new Error("Cannot tick backwards");
    this.ms += ms;
  }

  /** Set the clock to a specific absolute time in ms since epoch. */
  set(ms: number): void {
    this.ms = ms;
  }
}
