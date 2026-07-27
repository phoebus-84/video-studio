// ─── Contract client ──────────────────────────────────────────────────
// The primary entry point for callers.  Wires together configuration,
// transport, clock, sleeper, and versioned contracts into a single
// `submit()` call that returns a typed `GenerationResult`.

import type {
  GenerationInput,
  GenerationResult,
  Transport,
  Clock,
  Sleeper,
  FalAdapterConfig,
} from "./types.js";
import type { EndpointContract } from "./contracts/v1.js";
import {
  FalUnavailableError,
  FalTimeoutError,
  FalCancelledError,
  FalAdapterError,
} from "./errors.js";
import { deprecationDiagnostic } from "./profiles.js";
import { resolveConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { createLogger } from "./logger.js";
import { FetchTransport } from "./transport.js";
import { SystemClock } from "./clock.js";

// ─── Client ───────────────────────────────────────────────────────────

export interface FalClient {
  /** Submit a generation and wait for completion. */
  submit(
    input: GenerationInput,
    signal?: AbortSignal,
  ): Promise<GenerationResult>;
}

export class FalClientImpl implements FalClient {
  private readonly config: FalAdapterConfig;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly contracts: Map<string, EndpointContract>;

  constructor(opts: {
    config: FalAdapterConfig;
    transport?: Transport;
    clock?: Clock;
    logger?: Logger;
    contracts: EndpointContract[];
  }) {
    if (opts.config instanceof FalUnavailableError) {
      throw opts.config;
    }
    this.config = opts.config;
    this.transport = opts.transport ?? new FetchTransport();
    this.clock = opts.clock ?? new SystemClock();
    this.logger = opts.logger ?? createLogger();
    this.contracts = new Map();
    for (const c of opts.contracts) {
      this.contracts.set(c.version, c);
    }
  }

  async submit(
    input: GenerationInput,
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const startMs = this.clock.nowMs();

    // Resolve the versioned contract
    const contract = this.contracts.get(input.binding.contractVersion);
    if (!contract) {
      throw new FalAdapterError(
        `No contract registered for version "${input.binding.contractVersion}"`,
        "FAL_UNKNOWN_CONTRACT",
        false,
        { contractVersion: input.binding.contractVersion },
      );
    }

    // Warn if the profile is deprecated
    if (contract.profile) {
      const diag = deprecationDiagnostic(contract.profile);
      if (diag) {
        this.logger.warn("fal deprecated profile", {
          profileId: contract.profile.profileId,
          diagnostic: diag,
        });
      }
    }

    // Build request – validation happens here, before any HTTP call
    const body = contract.buildRequestBody(input);
    const url = `${this.config.baseUrl}/${input.binding.endpointId}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Key ${this.config.falKey}`,
    };

    this.logger.info("fal submit", {
      endpointId: input.binding.endpointId,
      idempotencyKey: input.idempotencyKey,
      contractVersion: input.binding.contractVersion,
      baseUrl: this.config.baseUrl,
      falKey: this.config.falKey, // will be redacted by logger
    });

    // Check for cancellation before sending
    if (signal?.aborted) {
      throw new FalCancelledError("submit cancelled before request");
    }

    // Race the request against the caller's timeout
    const deadline = startMs + input.timeoutMs;

    // Check if deadline already passed
    if (this.clock.nowMs() >= deadline) {
      throw new FalTimeoutError(input.timeoutMs, "submit");
    }

    const internalSignal = createDeadlineSignal(signal, deadline, this.clock);

    try {
      const response = await this.transport.request(
        {
          method: "POST",
          url,
          headers,
          body: JSON.stringify(body),
        },
        internalSignal,
      );

      const raw = JSON.parse(response.body) as Record<string, unknown>;
      const result = contract.parseResponse(input, raw);

      this.logger.info("fal completed", {
        idempotencyKey: input.idempotencyKey,
        providerRequestId: result.providerRequestId,
        outputCount: result.outputs.length,
        elapsedMs: this.clock.nowMs() - startMs,
      });

      return result;
    } catch (err) {
      if (err instanceof FalAdapterError) {
        // Log and rethrow
        this.logger.error("fal error", (err as FalAdapterError).toJSON());
        throw err;
      }

      if (err instanceof DOMException && err.name === "AbortError") {
        throw new FalCancelledError("submit aborted");
      }

      throw err;
    }
  }
}

// ─── Convenience factory ──────────────────────────────────────────────

/**
 * Build a FalClient from the process environment and the given contracts.
 * Returns a {@link FalUnavailableError} when FAL_KEY is missing.
 */
export function createFalClient(
  contracts: EndpointContract[],
  opts?: {
    transport?: Transport;
    clock?: Clock;
    sleeper?: Sleeper;
    logger?: Logger;
  },
): FalClient | FalUnavailableError {
  const config = resolveConfig();
  if (config instanceof FalUnavailableError) {
    return config;
  }

  return new FalClientImpl({
    config,
    contracts,
    ...opts,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  deadlineMs: number,
  clock: Clock,
): AbortSignal | undefined {
  const remaining = deadlineMs - clock.nowMs();
  if (remaining <= 0) {
    // Already timed out – create an already-aborted signal.
    const ac = new AbortController();
    ac.abort(new FalTimeoutError(0, "submit"));
    return ac.signal;
  }

  if (!parentSignal) {
    // No parent signal, just a deadline.
    const ac = new AbortController();
    const timeoutId = setTimeout(() => {
      ac.abort(new FalTimeoutError(deadlineMs - clock.nowMs() + remaining, "submit"));
    }, remaining);
    // Clean up timeout if aborted early
    ac.signal.addEventListener(
      "abort",
      () => clearTimeout(timeoutId),
      { once: true },
    );
    return ac.signal;
  }

  // Combine parent signal with deadline
  const ac = new AbortController();
  const timeoutId = setTimeout(() => {
    ac.abort(new FalTimeoutError(deadlineMs - clock.nowMs() + remaining, "submit"));
  }, remaining);

  const onParentAbort = () => {
    clearTimeout(timeoutId);
    ac.abort(parentSignal.reason ?? new FalCancelledError("parent aborted"));
  };

  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  ac.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timeoutId);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
    { once: true },
  );

  // If parent is already aborted, trigger immediately
  if (parentSignal.aborted) {
    clearTimeout(timeoutId);
    ac.abort(parentSignal.reason ?? new FalCancelledError("parent aborted"));
  }

  return ac.signal;
}
