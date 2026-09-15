/**
 * TypeScript bindings generated from gate-review.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/gate-review.schema.json
 * Auto-generated — do not edit directly.
 */

export interface ArtifactHash {
  /** Path relative to the episode directory. Never absolute: a record that names a reviewer's home directory cannot be checked anywhere else. */
  path: string;
  /** Lowercase hex sha256 of the file's bytes at the moment of review. */
  sha256: string;
}

export interface GateCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn" | "info";
  expected?: string;
  actual?: string;
  /** What was examined to reach this status — a path, a measurement, a tool invocation. */
  evidence?: string;
}

export interface GateReview {
  stageId: string;
  /** There is deliberately no 'rejected'. JOURNAL_EVENTS has no approval-rejected type, and encoding a rejection inside an approval-granted event would contradict itself on disk. See avg-qr4.3. */
  decision: "requested" | "approved";
  actor: "pi" | "gateway" | "runtime" | "human" | "system";
  at: string;
  inputs: ArtifactHash[];
  outputs: ArtifactHash[];
  checks: GateCheck[];
  note?: string;
}
