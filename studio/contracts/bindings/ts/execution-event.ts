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
  /** Every file the outputs name, hashed, with a read-only copy kept under attempts/<stageId>/<attemptNumber>/ (avg-qr4.6). Present makes this completion a candidate; absent is a completion from before candidates were kept. */
  digests?: FileDigest[];
  /** False when the candidate was kept but did not become the stage's take, because the operator's selected take is locked. Absent means selected. */
  selected?: boolean;
  durationMs?: number;
}

export interface FileDigest {
  /** Relative to the episode directory. */
  path: string;
  sha256: string;
}

export interface TakeSelected {
  stageId: string;
  decision: "selected";
  origin: "human" | "agent" | "policy";
  actor: "pi" | "gateway" | "runtime" | "human" | "system";
  at: string;
  episode: string;
  binding: {
    attemptNumber: number;
    leaseId: string;
    outputs: FileDigest[];
  };
  /** The attempt that was selected when this was decided, or null for none. Informational: the compare-and-swap happened under the stage lock. */
  previous?: number | null;
  signature?: string;
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
