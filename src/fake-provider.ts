// ---------------------------------------------------------------------------
// Fake fal provider — contract-compliant test harness
// ---------------------------------------------------------------------------
// Simulates the fal.ai API without credentials.  All outputs are
// deterministic, minimal byte streams so tests never call the network.
// ---------------------------------------------------------------------------

import type {
  GenerationInput,
  GenerationResult,
  OutputAsset,
  CostBreakdown,
} from "../src/types.js";

/** Fake image dimensions for deterministic output. */
const FAKE_WIDTH = 1024;
const FAKE_HEIGHT = 1024;
const FAKE_CONTENT_TYPE = "image/png";
const FAKE_SHA256 = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/** Supported fake endpoints. */
export const FAKE_ENDPOINTS = new Set([
  "fal-ai/flux/dev",
  "fal-ai/flux/schnell",
  "fal-ai/stable-diffusion-v3",
]);

/** Options for the fake provider. */
export interface FakeFalOptions {
  /** Deterministic seed (default 42). */
  seed?: number;
  /** Simulated processing delay in ms (default 0). */
  processingDelayMs?: number;
  /** Whether submissions should fail (default false). */
  failMode?: boolean;
  /** Custom output dimensions. */
  width?: number;
  height?: number;
}

/** Pre-computed cost breakdown for fake outputs. */
const FAKE_COST: CostBreakdown = {
  amount: 0.004,
  currency: "USD",
  breakdown: { inference: 0.004 },
};

/**
 * Fake fal provider that returns deterministic outputs.
 *
 * Designed for contract tests, restart simulation, and CI.
 */
export class FakeFalProvider {
  private jobs = new Map<string, GenerationResult>();
  private options: Required<FakeFalOptions>;
  private requestCounter = 0;

  constructor(options: FakeFalOptions = {}) {
    this.options = {
      seed: options.seed ?? 42,
      processingDelayMs: options.processingDelayMs ?? 0,
      failMode: options.failMode ?? false,
      width: options.width ?? FAKE_WIDTH,
      height: options.height ?? FAKE_HEIGHT,
    };
  }

  /**
   * Submit a generation request.
   * Returns a completed result if !failMode, or a failed result.
   */
  async submit(input: GenerationInput): Promise<GenerationResult> {
    // Simulate processing delay
    if (this.options.processingDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.processingDelayMs));
    }

    this.requestCounter++;

    if (this.options.failMode) {
      throw new Error("FakeFalProvider: failMode enabled — simulated API failure");
    }

    const startedAt = new Date();
    const completedAt = new Date(startedAt.getTime() + this.options.processingDelayMs);

    const outputs: OutputAsset[] = [
      {
        url: `fake://fal/${input.binding.endpointId}/${input.idempotencyKey}/output-0.png`,
        contentType: FAKE_CONTENT_TYPE,
        contentLength: this.options.width * this.options.height * 4,
        sha256: FAKE_SHA256,
      },
    ];

    if (input.parameters.num_images && (input.parameters.num_images as number) > 1) {
      for (let i = 1; i < (input.parameters.num_images as number); i++) {
        outputs.push({
          url: `fake://fal/${input.binding.endpointId}/${input.idempotencyKey}/output-${i}.png`,
          contentType: FAKE_CONTENT_TYPE,
          contentLength: this.options.width * this.options.height * 4,
          sha256: FAKE_SHA256,
        });
      }
    }

    const result: GenerationResult = {
      idempotencyKey: input.idempotencyKey,
      status: "completed",
      outputs,
      providerRequestId: `fake-req-${this.requestCounter}`,
      profileId: input.binding.endpointId,
      schemaFingerprint: `fake-fingerprint-${input.binding.contractVersion}`,
      cost: FAKE_COST,
      startedAt,
      completedAt,
    };

    // Store for idempotency check
    this.jobs.set(input.idempotencyKey, result);

    return result;
  }

  /**
   * Simulate submitting a request and getting back a "processing" status,
   * then polling until completion.
   */
  async submitAndPoll(
    input: GenerationInput,
    pollIntervalMs = 100,
  ): Promise<GenerationResult> {
    // First call returns processing
    if (this.options.failMode) {
      throw new Error("FakeFalProvider: failMode enabled");
    }

    this.requestCounter++;

    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, this.options.processingDelayMs)));

    const result = await this.submit(input);
    return result;
  }

  /**
   * Check if a previous submission was idempotent.
   * Returns the stored result if the key was already used.
   */
  getPreviousResult(idempotencyKey: string): GenerationResult | null {
    return this.jobs.get(idempotencyKey) ?? null;
  }

  /**
   * Cancel a pending request. Does nothing in fake mode (no real state).
   */
  async cancelRequest(_idempotencyKey: string): Promise<void> {
    // No-op in fake mode
  }

  /** Return the number of submitted requests. */
  get requestCount(): number {
    return this.requestCounter;
  }

  /** Clear all stored results (simulates fresh restart). */
  reset(): void {
    this.jobs.clear();
    this.requestCounter = 0;
  }
}

/**
 * Create a default fake provider suitable for contract tests.
 */
export function createFakeFal(): FakeFalProvider {
  return new FakeFalProvider({
    seed: 42,
    processingDelayMs: 0,
    failMode: false,
  });
}

/**
 * Create a fake provider that simulates failures for error-path testing.
 */
export function createFailingFal(): FakeFalProvider {
  return new FakeFalProvider({
    seed: 42,
    processingDelayMs: 0,
    failMode: true,
  });
}

/**
 * Create a fake provider with slow processing for restart/resume testing.
 */
export function createSlowFal(delayMs = 5000): FakeFalProvider {
  return new FakeFalProvider({
    seed: 42,
    processingDelayMs: delayMs,
    failMode: false,
  });
}
