// ---------------------------------------------------------------------------
// fal.ai queue client (legacy surface) and the contract-driven client
// ---------------------------------------------------------------------------
// Handles both sync (immediate response) and async (queue-based) endpoints.
// Sync endpoints return images directly. Async endpoints return a request_id
// that must be polled via the queue endpoint.
// ---------------------------------------------------------------------------

import { FetchTransport } from "./transport.js";
import { getProfile, requireValidParameters } from "./profiles.js";
import type { HttpRequest, Transport } from "./types.js";
import { FalHttpError } from "./errors.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FalQueueClientOptions {
  apiKey: string;
  baseUrl?: string;
  queueUrl?: string;
  transport?: Transport;
}

export interface SubmitOptions {
  profile: string;
  params: Record<string, unknown>;
  /** Force async mode even for sync endpoints. */
  async?: boolean;
}

export interface FalJob {
  requestId?: string;
  status: "COMPLETED" | "IN_PROGRESS" | "IN_QUEUE" | "FAILED";
  images?: FalImage[];
  resultUrl?: string;
  progress?: number;
  timings?: { inference?: number };
  seed?: number;
  error?: string;
  cost?: { amount: number; currency: string };
  raw: Record<string, unknown>;
}

export interface FalImage {
  url: string;
  width: number;
  height: number;
  contentType: string;
}

export interface DownloadResult {
  data: Buffer;
  contentType: string;
  contentLength: number;
  url: string;
}

// ── FalClient ───────────────────────────────────────────────────────────────

export class FalQueueClient {
  private apiKey: string;
  private baseUrl: string;
  private queueUrl: string;
  private transport: Transport;
  private _totalSpendUsd = 0;
  private _submissionCount = 0;

  /** Cumulative spend since client creation (USD). */
  get totalSpendUsd(): number { return this._totalSpendUsd; }
  
  /** Total submissions made. */
  get submissionCount(): number { return this._submissionCount; }

  constructor(options: FalQueueClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://fal.run";
    this.queueUrl = options.queueUrl ?? "https://queue.fal.run";
    this.transport = options.transport ?? new FetchTransport();
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Key ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  // ── Generate image (sync) ─────────────────────────────────────────────

  /**
   * Generate an image using a sync endpoint (e.g. flux/dev).
   * Returns immediately with the generated images.
   */
  async generate(options: SubmitOptions): Promise<FalJob> {
    const profile = getProfile(options.profile);
    if (!profile) throw new Error(`Unknown profile: ${options.profile}`);

    const params = requireValidParameters(profile, options.params);
    const url = `${this.baseUrl}/${profile.endpointId}`;

    const req: HttpRequest = {
      method: "POST",
      url,
      headers: this.headers(),
      body: JSON.stringify({ ...params, sync: !options.async }),
    };

    const res = await this.transport.request(req);
    if (res.status >= 400) {
      const body = safeJson(res.body);
      throw new Error(`fal API error ${res.status}: ${body?.detail ?? body?.message ?? res.body}`);
    }

    const data = safeJson(res.body) ?? {};

    // Sync response: has images directly
    if (data.images) {
      return {
        status: "COMPLETED",
        images: (data.images as any[]).map((img: any) => ({
          url: img.url as string,
          width: (img.width ?? 0) as number,
          height: (img.height ?? 0) as number,
          contentType: (img.content_type ?? "image/jpeg") as string,
        })),
        timings: data.timings as { inference?: number },
        seed: data.seed as number,
        raw: data,
      };
    }

    // Async response: has request_id
    if (data.request_id) {
      return {
        requestId: data.request_id as string,
        status: (data.status as FalJob["status"]) ?? "IN_QUEUE",
        raw: data,
      };
    }

    throw new Error(`Unexpected fal response: ${JSON.stringify(data).substring(0, 200)}`);
  }

  // ── Submit and wait (for async endpoints) ──────────────────────────────

  /**
   * Submit a job and poll the queue until completion.
   */
  async submitAndWait(
    options: SubmitOptions,
    pollMs: number = 2000,
    maxWaitMs: number = 300_000,
    signal?: AbortSignal,
  ): Promise<FalJob> {
    // Force async
    const job = await this.generate({ ...options, async: true });

    // If sync (unlikely with async:true), return immediately
    if (job.status === "COMPLETED") {
      const cost = estimateCost(options.profile);
      this._totalSpendUsd += cost.amount;
      this._submissionCount++;
      return { ...job, cost };
    }
    if (!job.requestId) throw new Error("No request_id in async response");

    const profile = getProfile(options.profile)!;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (signal?.aborted) throw new Error("Cancelled");

      const status = await this.pollStatus(profile.endpointId, job.requestId);

      if (status.status === "COMPLETED") {
        const cost = estimateCost(options.profile);
        this._totalSpendUsd += cost.amount;
        this._submissionCount++;
        return { ...status, cost };
      }
      if (status.status === "FAILED") {
        throw new Error(`fal job ${job.requestId} failed: ${status.error ?? "Unknown error"}`);
      }

      await sleep(pollMs);
      pollMs = Math.min(pollMs * 1.5, 15_000);
    }

    throw new Error(`fal job ${job.requestId} timed out after ${maxWaitMs}ms`);
  }

  // ── Poll queue status ──────────────────────────────────────────────────

  private async pollStatus(endpointId: string, requestId: string): Promise<FalJob> {
    const url = `${this.queueUrl}/${endpointId}/requests/${requestId}`;
    const req: HttpRequest = {
      method: "GET",
      url,
      headers: this.headers(),
    };

    const res = await this.transport.request(req);
    const data = safeJson(res.body) ?? {};

    const status = (data.status as string) ?? "IN_PROGRESS";

    // If completed, extract images if available
    if (status === "COMPLETED") {
      // Direct images in poll response (sync-compatible endpoints)
      if (data.images) {
        return {
          requestId,
          status: "COMPLETED",
          images: (data.images as any[])?.map((img: any) => ({
            url: img.url as string,
            width: (img.width ?? 0) as number,
            height: (img.height ?? 0) as number,
            contentType: (img.content_type ?? "image/jpeg") as string,
          })),
          timings: data.timings as { inference?: number },
          seed: data.seed as number,
          raw: data,
        };
      }

      // Async endpoints: fetch the response_url to get images
      if (data.response_url) {
        const imgRes = await fetch(data.response_url as string);
        if (imgRes.ok) {
          const imgData = await imgRes.json() as any;
          if (imgData.images) {
            return {
              requestId,
              status: "COMPLETED",
              images: (imgData.images as any[])?.map((img: any) => ({
                url: img.url as string,
                width: (img.width ?? 0) as number,
                height: (img.height ?? 0) as number,
                contentType: (img.content_type ?? "image/jpeg") as string,
              })),
              timings: data.timings as { inference?: number },
              seed: data.seed as number,
              raw: imgData,
            };
          }
        }
      }

      // Fallback: return with resultUrl
      return {
        requestId,
        status: "COMPLETED",
        resultUrl: (data.response_url ?? data.result_url) as string | undefined,
        raw: data,
      };
    }

    return {
      requestId,
      status: mapStatus(status),
      resultUrl: (data.response_url ?? data.result_url) as string | undefined,
      progress: data.progress as number | undefined,
      error: data.error as string | undefined,
      raw: data,
    };
  }

  // ── Download ───────────────────────────────────────────────────────────

  async download(imageUrl: string): Promise<DownloadResult> {
    // Use native fetch for binary downloads (transport corrupts binary)
    const res = await fetch(imageUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ${imageUrl}: ${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      data: buf,
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      contentLength: buf.length,
      url: imageUrl,
    };
  }

  // ── Health ─────────────────────────────────────────────────────────────

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      // Lightweight: try a sync generation with minimal steps
      const url = `${this.baseUrl}/fal-ai/flux/dev`;
      const req: HttpRequest = {
        method: "POST",
        url,
        headers: this.headers(),
        body: JSON.stringify({
          prompt: "test",
          image_size: "square_hd",
          num_inference_steps: 1,
        }),
      };

      const res = await this.transport.request(req, AbortSignal.timeout(15_000));
      return { ok: res.status < 400, detail: `Status ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJson(body: string): Record<string, unknown> | null {
  try { return JSON.parse(body); } catch { return null; }
}

function mapStatus(s: string): FalJob["status"] {
  switch (s.toUpperCase()) {
    case "COMPLETED": return "COMPLETED";
    case "IN_PROGRESS": return "IN_PROGRESS";
    case "IN_QUEUE": return "IN_QUEUE";
    case "FAILED": return "FAILED";
    default: return "IN_PROGRESS";
  }
}

/**
 * Estimate cost for a fal.ai generation based on the model profile.
 * Uses publicly listed pricing (fal.ai/pricing).
 */
function estimateCost(profileId: string): { amount: number; currency: string } {
  const PRICING: Record<string, number> = {
    "fal-ai/flux/dev": 0.005,
    "fal-ai/flux/dev@v1": 0.005,
    "fal-ai/nano-banana-pro": 0.003,
    "fal-ai/nano-banana-pro@v1": 0.003,
  };
  const amount = PRICING[profileId] ?? PRICING[profileId.replace(/@v\d+$/, "")] ?? 0.005;
  return { amount, currency: "USD" };
}

/** Create a FalClient from environment. */
export function createFalClient(apiKey?: string): FalQueueClient {
  const key = apiKey ?? process.env.FAL_KEY ?? process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_KEY or FAL_API_KEY required");
  return new FalQueueClient({ apiKey: key });
}

// ---------------------------------------------------------------------------
// Contract-driven client
// ---------------------------------------------------------------------------
// The surface described by this package's contracts, profiles, clock, sleeper
// and logger modules: one `submit`, everything injectable, all parsing and
// provenance owned by the versioned endpoint contract.
//
// `FalQueueClient` above is the older, batteries-included surface (polling,
// download, health, spend counters) that `server.ts` still drives. The two
// coexist deliberately; unifying them is separate work, because the queue
// client provides operations this one does not.
// ---------------------------------------------------------------------------

import type { EndpointContract } from "./contracts/v1.js";
import type {
  Clock,
  FalAdapterConfig,
  GenerationInput,
  GenerationResult,
  Sleeper,
} from "./types.js";
import { SystemClock } from "./clock.js";
import { deprecationDiagnostic } from "./profiles.js";
import { createLogger, type Logger } from "./logger.js";
import {
  FalAdapterError,
  FalCancelledError,
  FalTimeoutError,
  FalUnavailableError,
} from "./errors.js";

/** The contract-driven client surface. */
export interface FalClient {
  submit(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult>;
}

export interface FalClientImplOptions {
  /**
   * Resolved configuration, or a `FalUnavailableError` when a required secret
   * is missing. Passing the error is how config resolution reports an
   * unavailable adapter without throwing at resolution time; constructing a
   * client from it fails immediately rather than at first use.
   */
  readonly config: FalAdapterConfig;
  /** Versioned contracts, selected per request by `binding.contractVersion`. */
  readonly contracts: readonly EndpointContract[];
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly logger?: Logger;
  readonly transport?: Transport;
}

export class FalClientImpl implements FalClient {
  private readonly config: FalAdapterConfig;
  private readonly contracts: Map<string, EndpointContract>;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly transport: Transport;

  constructor(options: FalClientImplOptions) {
    if (options.config instanceof FalUnavailableError) {
      throw options.config;
    }

    this.config = options.config;
    this.contracts = new Map(options.contracts.map((c) => [c.version, c]));
    this.clock = options.clock ?? new SystemClock();
    this.logger = options.logger ?? createLogger();
    // `sleeper` is accepted but unused: this client makes a single request and
    // does not yet retry. It stays in the options so callers can inject a
    // deterministic one now, rather than the signature changing when retry
    // lands (config.maxRetries is already carried for that).
    void options.sleeper;
    this.transport = options.transport ?? new FetchTransport();
  }

  async submit(
    input: GenerationInput,
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const startedMs = this.clock.nowMs();

    // Cancellation and the deadline are checked before anything is sent, so a
    // caller that has already given up never causes spend.
    if (signal?.aborted) {
      throw new FalCancelledError("cancelled before submit");
    }
    if (input.timeoutMs <= 0) {
      throw new FalTimeoutError(input.timeoutMs);
    }

    const contract = this.contracts.get(input.binding.contractVersion);
    if (!contract) {
      throw new FalAdapterError(
        `No contract registered for version "${input.binding.contractVersion}"`,
        "FAL_UNKNOWN_CONTRACT",
        false,
        {
          requested: input.binding.contractVersion,
          available: [...this.contracts.keys()],
        },
      );
    }

    // A deprecated profile still runs — refusing would break working
    // productions — but it is never silent, so a migration can be planned
    // before the sunset date arrives.
    const profile = contract.profile;
    if (profile) {
      const diagnostic = deprecationDiagnostic(profile);
      if (diagnostic) {
        this.logger.warn("fal deprecated profile", {
          profileId: profile.profileId,
          diagnostic,
        });
      }
    }

    const body = contract.buildRequestBody(input);
    const url = `${this.config.baseUrl}/${input.binding.endpointId}`;

    // falKey is passed so the logger's redaction is exercised on every call;
    // it is replaced with ***REDACTED*** before the entry is written.
    this.logger.info("fal submit", {
      endpointId: input.binding.endpointId,
      contractVersion: input.binding.contractVersion,
      idempotencyKey: input.idempotencyKey,
      falKey: this.config.falKey,
    });

    let response;
    try {
      response = await this.transport.request(
        {
          method: "POST",
          url,
          headers: {
            authorization: `Key ${this.config.falKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        signal,
      );
    } catch (err) {
      if (signal?.aborted) {
        throw new FalCancelledError("cancelled during request");
      }
      this.logError(err, input);
      throw err;
    }

    if (response.status < 200 || response.status >= 300) {
      const error = new FalHttpError(
        response.status,
        response.body,
        response.status >= 500 || response.status === 429,
      );
      this.logError(error, input);
      throw error;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      const error = new FalAdapterError(
        "fal returned a body that is not valid JSON",
        "FAL_CONTRACT_ERROR",
        false,
        { bodyPreview: response.body.slice(0, 200) },
      );
      this.logError(error, input);
      throw error;
    }

    let result: GenerationResult;
    try {
      result = contract.parseResponse(input, raw);
    } catch (err) {
      this.logError(err, input);
      throw err;
    }

    this.logger.info("fal completed", {
      endpointId: input.binding.endpointId,
      idempotencyKey: input.idempotencyKey,
      providerRequestId: result.providerRequestId,
      outputs: result.outputs.length,
      costAmount: result.cost?.amount ?? null,
      elapsedMs: this.clock.nowMs() - startedMs,
    });

    return result;
  }

  private logError(err: unknown, input: GenerationInput): void {
    this.logger.error("fal error", {
      endpointId: input.binding.endpointId,
      idempotencyKey: input.idempotencyKey,
      code: err instanceof FalAdapterError ? err.code : "FAL_UNKNOWN",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
