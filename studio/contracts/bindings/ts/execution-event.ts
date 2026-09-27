/**
 * TypeScript bindings generated from execution-event.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/execution-event.schema.json
 * Auto-generated — do not edit directly.
 */

export interface StageLeased {
  stageId: string;
  leaseId: string;
  attemptNumber: number;
  ttlMs: number;
  expiresAt: string;
  /** Who took the lease, so an expired one reports as held by X until T rather than as an anonymous block. */
  holder: string;
  /** Present when an operator took the stage (avg-qr4.3). */
  attended?: true;
}

export interface StageStarted {
  stageId: string;
  leaseId: string;
  attemptNumber: number;
}

export interface StageCompleted {
  stageId: string;
  leaseId: string;
  attemptNumber: number;
  outputs: string[];
  durationMs?: number;
}

export interface StageFailed {
  stageId: string;
  leaseId: string;
  attemptNumber: number;
  error: string;
  retryable?: boolean;
  durationMs?: number;
}

export interface AttemptRecorded {
  stageId: string;
  leaseId: string;
  attemptNumber: number;
  outcome: "success" | "failure" | "timeout";
  outputs?: string[];
}
