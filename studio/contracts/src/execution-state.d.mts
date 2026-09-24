import type { JournalEvent } from "./journal.d.mts";

export type StageStatus = "pending" | "running" | "completed" | "failed";

export interface StageAttempt {
  number: number;
  leaseId: string;
  startedAt: string;
  endedAt?: string;
  outcome?: "success" | "failure" | "timeout";
  error?: string;
  retryable?: boolean;
  ttlMs?: number;
  expiresAt?: string;
  holder?: string;
  /**
   * `false` when this attempt's `stage-started` event never landed and replay
   * inferred the step from the terminal event that followed it. Absent on a
   * healthy attempt — the field marks the exception, not the rule.
   *
   * Says whether one specific event was recorded, and nothing else. It is not
   * a health score for the attempt; `outcome` already says how it ended.
   */
  startRecorded?: boolean;
}

/**
 * A deliberate SUBSET of the engine's `StageInstance`
 * (studio/runtime/src/engine/types.ts), not an interchangeable copy of it.
 * `deriveExecutionState` receives only stage ids, so it cannot invent a
 * human-readable `name` — this type omits it, where the engine's requires
 * it. `createdAt` is also nullable here (a stage the journal never mentions
 * has none), where the engine's is a non-nullable `string`. A
 * `Map<string, StageInstance>` built here does NOT structurally satisfy the
 * engine's `ExecutionContext.stages` — a consumer bridging the two must
 * supply the missing `name` and settle the nullability of `createdAt`
 * itself.
 */
export interface StageInstance {
  stageId: string;
  status: StageStatus;
  attempts: StageAttempt[];
  outputArtifacts: string[];
  createdAt: string | null;
}

/**
 * The transition table replay enforces.
 *
 * Exported so the engine's copy (studio/runtime/src/engine/types.ts) can be
 * pinned equal to it by a test. Both tables are consulted on every claim —
 * this one during replay, the engine's during `sm.transition` — and two
 * copies of one meaning drift.
 */
export declare const VALID_TRANSITIONS: Readonly<Record<StageStatus, StageStatus[]>>;

export declare function deriveExecutionState(
  events: JournalEvent[],
  stageIds: string[],
  now?: Date,
): Map<string, StageInstance>;

export interface LeaseState {
  state: "none" | "live" | "expired";
  holder?: string;
  expiresAt?: string;
}

export declare function leaseState(instance: StageInstance, now?: Date): LeaseState;
