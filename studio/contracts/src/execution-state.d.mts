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

export declare function deriveExecutionState(
  events: JournalEvent[],
  stageIds: string[],
  now?: Date,
): Map<string, StageInstance>;
