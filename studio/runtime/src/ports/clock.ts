// ---------------------------------------------------------------------------
// Clock port
//
// Abstracts time so that every unit test can run deterministically.
// ---------------------------------------------------------------------------

export interface Clock {
  /** Current wall-clock time. */
  now(): Date;

  /** Current time as milliseconds since the Unix epoch. */
  nowMs(): number;

  /** Resolve after at least `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

// ---- System-clock implementation -------------------------------------------

/**
 * Real system clock.  Use only at the process boundary; inject `Clock`
 * everywhere else.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }

  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
