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
