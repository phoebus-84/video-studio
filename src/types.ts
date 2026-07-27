// ─── Core types for fal-media-adapter ────────────────────────────────
// Versioned contracts, configuration, and injectable dependency shapes.

/**
 * fal.ai API endpoint binding chosen by Pi and recorded in the pipeline
 * snapshot.  The adapter only executes what is explicitly approved.
 */
export interface EndpointBinding {
  /** Stable endpoint identity (e.g. "fal-ai/flux/dev") */
  readonly endpointId: string;
  /** Request shape version identifier */
  readonly contractVersion: string;
  /** Resolved API base URL */
  readonly baseUrl: string;
}

/**
 * Input shape for a tracked generation / edit request.
 * Concrete profiles refine this via versioned contracts.
 */
export interface GenerationInput {
  /** Caller-chosen idempotency key – must survive restarts. */
  readonly idempotencyKey: string;
  /** Endpoint binding from the resolved pipeline snapshot. */
  readonly binding: EndpointBinding;
  /** Endpoint-specific payload (validated by the versioned contract). */
  readonly parameters: Record<string, unknown>;
  /** Maximum wall-clock wait before the caller gives up (ms). */
  readonly timeoutMs: number;
}

/** Lifecycle status of a remote fal job. */
export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/** Normalized result envelope returned by every successful invocation. */
export interface GenerationResult {
  readonly idempotencyKey: string;
  readonly status: "completed";
  readonly outputs: readonly OutputAsset[];
  readonly providerRequestId: string;
  readonly cost: CostBreakdown | null;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

/** One downloadable output asset produced by a generation. */
export interface OutputAsset {
  readonly url: string;
  readonly contentType: string;
  readonly contentLength: number | null;
  readonly sha256: string | null;
}

/** Machine-readable cost breakdown (fal.ai pricing). */
export interface CostBreakdown {
  readonly amount: number;
  readonly currency: string;
  readonly breakdown: Record<string, number>;
}

// ─── Injectable dependency interfaces ─────────────────────────────────

/** Abstract HTTP transport so tests never hit the network. */
export interface Transport {
  request(req: HttpRequest, signal?: AbortSignal): Promise<HttpResponse>;
}

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Abstract clock for deterministic time in tests. */
export interface Clock {
  now(): Date;
  /** Milliseconds since epoch (same source as now()). */
  nowMs(): number;
}

/** Abstract sleeper so tests don't actually wait. */
export interface Sleeper {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Abstract downloader that writes a remote URL to a local path. */
export interface Downloader {
  download(
    url: string,
    destPath: string,
    expectedSha256?: string,
    signal?: AbortSignal,
  ): Promise<DownloadResult>;
}

export interface DownloadResult {
  readonly destPath: string;
  readonly contentLength: number;
  readonly sha256: string;
}

// ─── Configuration ────────────────────────────────────────────────────

/** Resolved configuration after environment and defaults are applied. */
export interface FalAdapterConfig {
  readonly falKey: string;
  readonly baseUrl: string;
  readonly defaultTimeoutMs: number;
  readonly maxRetries: number;
}
