// ---------------------------------------------------------------------------
// fal.ai client
// ---------------------------------------------------------------------------
// One client, two paths to the same result. `submit` is a single request, for
// endpoints that answer immediately. `submitAndWait` goes through fal's queue,
// which anything video must, and polls until the job finishes.
//
// Both hand the completed payload to the same versioned contract, so an
// endpoint is understood the same way whichever path it took. A second client
// used to own the queue path and parsed `images` out of the poll response
// itself, which meant a video endpoint completed with no outputs at all.
// ---------------------------------------------------------------------------

import { FetchTransport } from "./transport.js";
import { listProfiles } from "./profiles.js";
import type { Transport } from "./types.js";
import { FalHttpError } from "./errors.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DownloadResult {
  data: Buffer;
  contentType: string;
  contentLength: number;
  url: string;
}

/**
 * A client for every registered profile, from the environment.
 *
 * Each profile gets a contract; video-producing profiles get one that knows to
 * read a `video` file rather than an `images` array.
 */
export function createFalClient(apiKey?: string): FalClientImpl {
  const key = apiKey ?? process.env["FAL_KEY"] ?? process.env["FAL_API_KEY"];
  if (!key) throw new Error("FAL_KEY or FAL_API_KEY required");

  return new FalClientImpl({
    config: {
      falKey: key,
      baseUrl: process.env["FAL_BASE_URL"] ?? "https://fal.run",
      defaultTimeoutMs: 600_000,
      maxRetries: 3,
    },
    contracts: listProfiles().map((profile) =>
      profile.operation.endsWith("-to-video")
        ? new VideoProfileContract(profile)
        : new ProfileContract(profile),
    ),
  });
}

// ---------------------------------------------------------------------------
// Contract-driven client
// ---------------------------------------------------------------------------
// The surface described by this package's contracts, profiles, clock, sleeper
// and logger modules: everything injectable, all parsing and provenance owned
// by the versioned endpoint contract.
// ---------------------------------------------------------------------------

import type { EndpointContract } from "./contracts/v1.js";
import { ProfileContract, VideoProfileContract } from "./contracts/v1.js";
import type {
  Clock,
  FalAdapterConfig,
  GenerationInput,
  GenerationResult,
  Sleeper,
} from "./types.js";
import { SystemClock } from "./clock.js";
import { SystemSleeper } from "./sleeper.js";
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

/** fal's queue host, where asynchronous jobs live. */
const DEFAULT_QUEUE_URL = "https://queue.fal.run";

export interface SubmitAndWaitOptions {
  /** First poll delay; backs off from here to at most 15s. */
  pollMs?: number;
  /** Give up after this long. Defaults to the input's own timeout. */
  maxWaitMs?: number;
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
  /** Queue host for asynchronous jobs. */
  readonly queueUrl?: string;
}

export class FalClientImpl implements FalClient {
  private readonly config: FalAdapterConfig;
  private readonly contracts: Map<string, EndpointContract>;
  private readonly clock: Clock;
  private readonly sleeper: Sleeper;
  private readonly logger: Logger;
  private readonly transport: Transport;
  private readonly queueUrl: string;

  private _totalSpendUsd = 0;
  private _submissionCount = 0;

  /** Recorded spend since this client was created, from profile pricing. */
  get totalSpendUsd(): number { return this._totalSpendUsd; }

  /** How many generations completed through this client. */
  get submissionCount(): number { return this._submissionCount; }

  constructor(options: FalClientImplOptions) {
    if (options.config instanceof FalUnavailableError) {
      throw options.config;
    }

    this.config = options.config;
    // Keyed by endpoint *and* version, not version alone. Every fal profile
    // declares contractVersion "v1", so keying by version meant registering a
    // second contract silently replaced the first — and a request for one
    // endpoint was answered by another endpoint's contract, with its schema,
    // its parser and its price.
    this.contracts = new Map();
    for (const contract of options.contracts) {
      const endpointId = contract.profile?.endpointId;
      this.contracts.set(endpointId ? `${endpointId}@${contract.version}` : contract.version, contract);
    }
    this.clock = options.clock ?? new SystemClock();
    // The sleeper paces queue polling, which is what it was always for: a test
    // must not wait real seconds to prove a job completed.
    this.sleeper = options.sleeper ?? new SystemSleeper();
    this.logger = options.logger ?? createLogger();
    this.queueUrl = options.queueUrl ?? DEFAULT_QUEUE_URL;
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

    const contract = this.contractFor(input);

    this.warnIfDeprecated(contract);

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

    return this.finish(contract, input, raw, startedMs);
  }

  /** The contract for a binding, or a typed refusal naming what is available. */
  private contractFor(input: GenerationInput): EndpointContract {
    // Prefer the contract registered for this exact endpoint; fall back to one
    // registered by version alone, which is how a hand-written contract with no
    // profile is still usable.
    const contract =
      this.contracts.get(`${input.binding.endpointId}@${input.binding.contractVersion}`) ??
      this.contracts.get(input.binding.contractVersion);
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
    return contract;
  }

  /** A deprecated profile still runs, but never silently. */
  private warnIfDeprecated(contract: EndpointContract): void {
    const profile = contract.profile;
    if (!profile) return;
    const diagnostic = deprecationDiagnostic(profile);
    if (diagnostic) {
      this.logger.warn("fal deprecated profile", { profileId: profile.profileId, diagnostic });
    }
  }

  /**
   * Parse a completed payload, record the spend, and log the outcome.
   *
   * Cost comes from the profile's own pricing rather than a table kept beside
   * the client, which was the last place in this package where a number about
   * an endpoint lived somewhere other than its profile.
   */
  private finish(
    contract: EndpointContract,
    input: GenerationInput,
    raw: Record<string, unknown>,
    startedMs: number,
  ): GenerationResult {
    let result: GenerationResult;
    try {
      result = contract.parseResponse(input, raw);
    } catch (err) {
      this.logError(err, input);
      throw err;
    }

    const recorded = result.cost?.amount ?? contract.profile?.pricing.estimatedUnitCost ?? 0;
    this._totalSpendUsd += recorded;
    this._submissionCount++;

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

  /**
   * Submit through the queue and wait for the result.
   *
   * Long generations — anything video — cannot complete inside one request, so
   * they go through fal's queue. The legacy client did this too, but parsed
   * `images` out of the poll response itself, which meant a video endpoint
   * returned no outputs at all. Here the completed payload goes to the same
   * versioned contract that parses a synchronous response, so every endpoint
   * is understood the same way whichever path it took.
   */
  async submitAndWait(
    input: GenerationInput,
    signal?: AbortSignal,
    options: SubmitAndWaitOptions = {},
  ): Promise<GenerationResult> {
    const startedMs = this.clock.nowMs();
    let pollMs = options.pollMs ?? 2_000;
    const maxWaitMs = options.maxWaitMs ?? input.timeoutMs;

    if (signal?.aborted) throw new FalCancelledError("cancelled before submit");
    if (maxWaitMs <= 0) throw new FalTimeoutError(maxWaitMs);

    const contract = this.contractFor(input);
    const body = contract.buildRequestBody(input);
    this.warnIfDeprecated(contract);

    this.logger.info("fal submit", {
      endpointId: input.binding.endpointId,
      contractVersion: input.binding.contractVersion,
      idempotencyKey: input.idempotencyKey,
      queued: true,
      falKey: this.config.falKey,
    });

    const queued = await this.request(
      "POST",
      `${this.queueUrl}/${input.binding.endpointId}`,
      JSON.stringify(body),
      input,
      signal,
    );

    const requestId = queued["request_id"];
    if (typeof requestId !== "string" || !requestId) {
      const error = new FalAdapterError(
        "fal accepted the job but returned no request_id",
        "FAL_CONTRACT_ERROR",
        false,
        { endpointId: input.binding.endpointId },
      );
      this.logError(error, input);
      throw error;
    }

    const statusUrl = `${this.queueUrl}/${input.binding.endpointId}/requests/${requestId}`;

    let sleptMs = 0;
    // The deadline uses whichever has advanced further, the clock or the time
    // actually spent sleeping. A coarse or frozen clock would otherwise poll
    // forever, which is exactly what a stuck job looks like.
    while (Math.max(this.clock.nowMs() - startedMs, sleptMs) < maxWaitMs) {
      if (signal?.aborted) {
        // A cancelled wait leaves the job running at the provider; say so
        // rather than implying the spend was avoided.
        this.logger.warn("fal wait cancelled", { requestId, note: "job may still be running" });
        throw new FalCancelledError(`cancelled while waiting for ${requestId}`);
      }

      const status = await this.request("GET", statusUrl, undefined, input, signal);
      const state = String(status["status"] ?? "IN_PROGRESS").toUpperCase();

      if (state === "COMPLETED") {
        // The queue answers with the result inline, or points at it.
        const payload = status["result"] !== undefined
          ? status
          : { ...status, result: await this.fetchResult(status, statusUrl, input, signal) };

        const result = this.finish(contract, input, { ...payload, request_id: requestId, status: "COMPLETED" }, startedMs);
        return result;
      }

      if (state === "FAILED" || state === "ERROR") {
        const error = new FalAdapterError(
          `fal job ${requestId} failed`,
          "FAL_JOB_FAILED",
          false,
          { requestId, detail: status["error"] ?? null },
        );
        this.logError(error, input);
        throw error;
      }

      await this.sleeper.sleep(pollMs, signal);
      sleptMs += pollMs;
      // Back off, so a slow job does not generate hundreds of requests.
      pollMs = Math.min(pollMs * 1.5, 15_000);
    }

    const timeout = new FalTimeoutError(maxWaitMs);
    this.logError(timeout, input);
    throw timeout;
  }

  /** Fetch a completed job's payload when the queue points elsewhere. */
  async #fetchResultAt(url: string, input: GenerationInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request("GET", url, undefined, input, signal);
  }

  private async fetchResult(
    status: Record<string, unknown>,
    statusUrl: string,
    input: GenerationInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const pointer = status["response_url"] ?? status["result_url"];
    return this.#fetchResultAt(typeof pointer === "string" ? pointer : statusUrl, input, signal);
  }

  /** One HTTP round trip, with the adapter's error vocabulary. */
  private async request(
    method: string,
    url: string,
    body: string | undefined,
    input: GenerationInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let response;
    try {
      response = await this.transport.request(
        {
          method,
          url,
          headers: {
            authorization: `Key ${this.config.falKey}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body }),
        },
        signal,
      );
    } catch (err) {
      if (signal?.aborted) throw new FalCancelledError("cancelled during request");
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

    try {
      return JSON.parse(response.body) as Record<string, unknown>;
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
