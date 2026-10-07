/**
 * TypeScript bindings generated from provider-job.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/provider-job.schema.json
 * Auto-generated — do not edit directly.
 */

export type JobStatus = "submitted" | "polling" | "completed" | "failed" | "cancelled";

export interface OutputAsset {
  path: string;
  sha256?: string;
  bytes?: number;
  contentType: string;
}

export interface CostBreakdown {
  amount: number;
  currency: string;
}

export interface ProviderJob {
  apiVersion: "studio.video/v1alpha1";
  kind: "ProviderJob";
  id: string;
  capability: "image.generate" | "image.edit" | "speech.synthesize" | "speech.align" | "graphics.render" | "terminal.record" | "video.compose" | "media.probe";
  provider: string;
  profile: string;
  /** Provider-side request identifier. Persisted before polling so the job survives restarts. */
  requestId: string;
  submittedAt: string;
  completedAt?: string;
  status: JobStatus;
  /** Endpoint-specific parameters validated by the versioned contract before submission. */
  params?: Record<string, unknown>;
  outputs?: OutputAsset[];
  cost?: CostBreakdown;
  /** Map of artifact path to revision at submission time. */
  sourceRevisions?: Record<string, string>;
  /** Caller-chosen key surviving restarts. Duplicate submissions with the same key return the recorded result. */
  idempotencyKey: string;
}
