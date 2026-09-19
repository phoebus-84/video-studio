// ---------------------------------------------------------------------------
// Stage state machine — transitions, guards, lease acquisition
// ---------------------------------------------------------------------------

import type { Lock, Lease } from "../ports/lock.js";
import type {
  StageStatus,
  StageInstance,
  StageAttempt,
  StageTransition,
  EngineConfig,
} from "./types.js";
import { VALID_TRANSITIONS } from "./types.js";

/** Error class for stage transition failures. */
export class StageTransitionError extends Error {
  constructor(
    message: string,
    public readonly stageId: string,
    public readonly from: StageStatus,
    public readonly to: StageStatus,
  ) {
    super(message);
    this.name = "StageTransitionError";
  }
}

/** Error class for lease acquisition failures. */
export class LeaseError extends Error {
  constructor(
    message: string,
    public readonly stageId: string,
  ) {
    super(message);
    this.name = "LeaseError";
  }
}

/**
 * The attempts made since this stage last succeeded.
 *
 * A retry limit is a limit on how many times a stage may fail in a row, not
 * on how many times it may ever run. Counting every attempt is what made a
 * stage that had completed three times and then failed once unrunnable —
 * permanently, because replay pushes an attempt for every `stage-leased` it
 * reads, successful ones included, and the journal is append-only, so the
 * count only ever grows. A stage that has succeeded starts its failure
 * budget over; what the cap is about is what happened after that success.
 *
 * Attempts with no recorded outcome count. A holder that crashed or whose
 * lease lapsed writes no terminal event at all — replay closes that attempt
 * as a timeout — and a stage whose dispatcher hangs every time needs a cap
 * just as much as one that throws.
 */
export function attemptsSinceLastSuccess(instance: StageInstance): StageAttempt[] {
  let lastSuccess = -1;
  for (let i = instance.attempts.length - 1; i >= 0; i -= 1) {
    if (instance.attempts[i]!.outcome === "success") {
      lastSuccess = i;
      break;
    }
  }
  return instance.attempts.slice(lastSuccess + 1);
}

/**
 * Stage state machine.
 *
 * Enforces valid transitions and manages lease lifecycle through the Lock port.
 */
export class StageStateMachine {
  private lock: Lock;
  private config: EngineConfig;
  private activeLeases = new Map<string, Lease>(); // stageId → Lease

  constructor(lock: Lock, config: EngineConfig) {
    this.lock = lock;
    this.config = config;
  }

  /**
   * Transition a stage from one state to another.
   */
  async transition(
    instance: StageInstance,
    to: StageStatus,
  ): Promise<{ instance: StageInstance; transition: StageTransition }> {
    const from = instance.status;

    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new StageTransitionError(
        `Invalid transition: ${from} → ${to} for stage "${instance.stageId}"`,
        instance.stageId,
        from,
        to,
      );
    }

    const transition: StageTransition = {
      stageId: instance.stageId,
      from,
      to,
      attemptNumber: instance.attempts.length + 1,
    };

    // Acquire lease for running transitions
    if (to === "running") {
      const resourceId = `stage:${instance.stageId}`;
      const leaseResult = await this.lock.acquire(resourceId, this.config.leaseTtlMs);
      if (!leaseResult.ok) {
        throw new LeaseError(
          `Failed to acquire lease for stage "${instance.stageId}": ${leaseResult.error.message}`,
          instance.stageId,
        );
      }
      const lease = leaseResult.value;
      transition.leaseId = lease.token;

      const attempt: StageAttempt = {
        number: instance.attempts.length + 1,
        leaseId: lease.token,
        startedAt: new Date().toISOString(),
      };
      instance.attempts = [...instance.attempts, attempt];
      this.activeLeases.set(instance.stageId, lease);
    }

    // Release lease on terminal states
    // Terminal for lease purposes means "this attempt is over", which is not
    // the same as "the stage can never move again". Inferring it from the
    // transition table being empty tied the two together: `failed` is
    // retryable, so its list was non-empty, so a failed stage never released
    // its lock and held it until the TTL expired. Naming the outcomes keeps
    // the lease lifecycle independent of what the stage may do next.
    const isTerminal = to === "completed" || to === "failed";
    if (isTerminal) {
      const activeLease = this.activeLeases.get(instance.stageId);
      if (activeLease) {
        await this.lock.release(activeLease);
        this.activeLeases.delete(instance.stageId);
      }

      const lastAttempt = instance.attempts[instance.attempts.length - 1];
      if (lastAttempt) {
        lastAttempt.endedAt = new Date().toISOString();
        if (to === "completed") {
          lastAttempt.outcome = "success";
        }
      }
    }

    instance.status = to;

    return { instance, transition };
  }

  async complete(
    instance: StageInstance,
  ): Promise<{ instance: StageInstance; transition: StageTransition }> {
    return this.transition(instance, "completed");
  }

  async fail(
    instance: StageInstance,
    error: string,
    retryable: boolean,
  ): Promise<{ instance: StageInstance; transition: StageTransition }> {
    const lastAttempt = instance.attempts[instance.attempts.length - 1];
    if (lastAttempt) {
      lastAttempt.error = error;
      lastAttempt.retryable = retryable;
      lastAttempt.outcome = "failure";
    }
    return this.transition(instance, "failed");
  }

  /**
   * Whether this stage may be attempted again.
   *
   * The budget is spent by consecutive failures, not by attempts: see
   * `attemptsSinceLastSuccess`.
   */
  canRetry(instance: StageInstance): boolean {
    return attemptsSinceLastSuccess(instance).length < this.config.maxAttempts;
  }

  /** Release all active leases. */
  async releaseAll(): Promise<void> {
    for (const [, lease] of this.activeLeases) {
      try {
        await this.lock.release(lease);
      } catch {
        // Best effort
      }
    }
    this.activeLeases.clear();
  }

  get activeLeaseCount(): number {
    return this.activeLeases.size;
  }
}
