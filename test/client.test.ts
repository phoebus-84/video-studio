import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalClientImpl } from "../src/client.js";
import { V1BaseContract } from "../src/contracts/v1.js";
import { MockServer } from "./fixtures/mock-server.js";
import { ManualClock } from "../src/clock.js";
import { NoopSleeper } from "../src/sleeper.js";
import { createLogger, redactRecord } from "../src/logger.js";
import { FalUnavailableError } from "../src/errors.js";
import type { LogEntry, Logger } from "../src/logger.js";
import type {
  EndpointBinding,
  GenerationInput,
  GenerationResult,
  FalAdapterConfig,
} from "../src/types.js";

// ─── Test contract ────────────────────────────────────────────────────

class TestFluxContract extends V1BaseContract {
  readonly version = "v1";
  readonly endpointPath = "fal-ai/flux/dev";

  validateParameters(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!params.prompt || typeof params.prompt !== "string") {
      throw new Error("prompt must be a non-empty string");
    }
    return {
      prompt: params.prompt,
      image_size: params.image_size ?? "landscape_4_3",
      num_images: params.num_images ?? 1,
    };
  }

  buildRequestBody(input: GenerationInput): Record<string, unknown> {
    return this.validateParameters(input.parameters);
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────

const testConfig: FalAdapterConfig = {
  falKey: "fal-test-key-12345678",
  baseUrl: "",
  defaultTimeoutMs: 30_000,
  maxRetries: 3,
};

const testBinding: EndpointBinding = {
  endpointId: "fal-ai/flux/dev",
  contractVersion: "v1",
  baseUrl: "",
};

function makeInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    idempotencyKey: `test-${Math.random().toString(36).slice(2, 10)}`,
    binding: testBinding,
    parameters: { prompt: "a test image" },
    timeoutMs: 10_000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("FalClientImpl", () => {
  let server: MockServer;
  let client: FalClientImpl;
  let logEntries: LogEntry[];

  beforeAll(async () => {
    server = new MockServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    server.reset();

    logEntries = [];
    const logger = createLogger((entry) => logEntries.push(entry));

    // Point baseUrl at the mock server
    const config = { ...testConfig, baseUrl: server.url };

    client = new FalClientImpl({
      config,
      contracts: [new TestFluxContract()],
      clock: new ManualClock(1_000_000),
      sleeper: new NoopSleeper(),
      logger,
    });
  });

  it("throws FalUnavailableError when config is the error type", () => {
    expect(
      () =>
        new FalClientImpl({
          config: new FalUnavailableError("nope") as unknown as FalAdapterConfig,
          contracts: [],
        }),
    ).toThrow(FalUnavailableError);
  });

  it("succeeds on a valid generation response", async () => {
    const expectedResult = {
      images: [
        {
          url: "https://fal.media/output/test.png",
          content_type: "image/png",
          content_length: 12345,
          sha256: "abcdef1234567890",
        },
      ],
    };

    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "req-test-001",
      status: "COMPLETED",
      result: expectedResult,
      cost: {
        amount: 0.005,
        currency: "USD",
        breakdown: { inference: 0.005 },
      },
    });

    const result = await client.submit(makeInput());

    expect(result.status).toBe("completed");
    expect(result.providerRequestId).toBe("req-test-001");
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].url).toBe("https://fal.media/output/test.png");
    expect(result.cost?.amount).toBe(0.005);
  });

  it("throws for unknown contract version", async () => {
    const input = makeInput({
      binding: { ...testBinding, contractVersion: "v99" },
    });

    await expect(client.submit(input)).rejects.toMatchObject({
      code: "FAL_UNKNOWN_CONTRACT",
    });
  });

  it("throws on HTTP error from server", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 500, { error: "internal" });

    await expect(client.submit(makeInput())).rejects.toMatchObject({
      code: "FAL_HTTP_ERROR",
    });
  });

  it("log entries redact falKey", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "req-test-002",
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    await client.submit(makeInput());

    // Find the "fal submit" info log
    const submitLog = logEntries.find((e) => e.msg === "fal submit");
    expect(submitLog).toBeDefined();

    // falKey in the log MUST be redacted
    const falKey = submitLog!.falKey as string;
    expect(falKey).not.toBe("fal-test-key-12345678");
    // Credentials are fully redacted rather than fingerprinted.
    expect(falKey).toBe("***REDACTED***");
  });

  it("completion log contains elapsedMs", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "req-test-003",
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    await client.submit(makeInput());

    const completeLog = logEntries.find((e) => e.msg === "fal completed");
    expect(completeLog).toBeDefined();
    expect(typeof completeLog!.elapsedMs).toBe("number");
    expect(typeof completeLog!.providerRequestId).toBe("string");
  });

  it("error log contains structured error info", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 401, {
      error: "unauthorized",
    });

    await expect(client.submit(makeInput())).rejects.toThrow();

    const errorLog = logEntries.find((e) => e.msg === "fal error");
    expect(errorLog).toBeDefined();
    expect(errorLog!.code).toBe("FAL_HTTP_ERROR");
  });

  it("handles cancellation before submit", async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(
      client.submit(makeInput(), ac.signal),
    ).rejects.toMatchObject({ code: "FAL_CANCELLED" });
  });

  it("handles empty images array in response", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "req-test-004",
      status: "COMPLETED",
      result: { images: [] },
    });

    const result = await client.submit(makeInput());
    expect(result.outputs).toHaveLength(0);
  });

  it("handles response with no cost field", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "req-test-005",
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    const result = await client.submit(makeInput());
    expect(result.cost).toBeNull();
  });
});
