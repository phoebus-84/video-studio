import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalClientImpl } from "../src/client.js";
import { V1BaseContract } from "../src/contracts/v1.js";
import { MockServer } from "./fixtures/mock-server.js";
import { ManualClock } from "../src/clock.js";
import { NoopSleeper } from "../src/sleeper.js";
import { createLogger } from "../src/logger.js";
import { FalContractError, FalHttpError, FalCancelledError } from "../src/errors.js";
import type { LogEntry, Logger } from "../src/logger.js";
import type {
  EndpointBinding,
  GenerationInput,
  FalAdapterConfig,
} from "../src/types.js";

// ─── Contracts for testing ────────────────────────────────────────────

class FluxContract extends V1BaseContract {
  readonly version = "v1";
  readonly endpointPath = "fal-ai/flux/dev";

  validateParameters(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      prompt: params.prompt ?? "default",
      image_size: params.image_size ?? "square",
    };
  }
}

const testBinding: EndpointBinding = {
  endpointId: "fal-ai/flux/dev",
  contractVersion: "v1",
  baseUrl: "",
};

function makeInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    idempotencyKey: "test-key",
    binding: testBinding,
    parameters: { prompt: "a beautiful sunset" },
    timeoutMs: 30_000,
    ...overrides,
  };
}

// ─── Integration tests ────────────────────────────────────────────────

describe("fal-media-adapter integration", () => {
  let server: MockServer;
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
  });

  function makeClient(): FalClientImpl {
    logEntries = [];
    const logger = createLogger((entry) => logEntries.push(entry));

    return new FalClientImpl({
      config: {
        falKey: "fal-integration-key-abcdefgh",
        baseUrl: server.url,
        defaultTimeoutMs: 30_000,
        maxRetries: 3,
      },
      contracts: [new FluxContract()],
      clock: new ManualClock(1_000_000),
      sleeper: new NoopSleeper(),
      logger,
    });
  }

  // ─── Success paths ──────────────────────────────────────────────────

  it("end-to-end success with single image output", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "int-req-001",
      status: "COMPLETED",
      result: {
        images: [
          {
            url: "https://fal.media/output/img1.png",
            content_type: "image/png",
            content_length: 102400,
            sha256: "abc123",
          },
          {
            url: "https://fal.media/output/img2.png",
            content_type: "image/png",
            content_length: 204800,
            sha256: "def456",
          },
        ],
      },
      cost: {
        amount: 0.01,
        currency: "USD",
        breakdown: { inference: 0.01 },
      },
    });

    const client = makeClient();
    const result = await client.submit(makeInput());

    expect(result.status).toBe("completed");
    expect(result.idempotencyKey).toBe("test-key");
    expect(result.providerRequestId).toBe("int-req-001");
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs[0].contentType).toBe("image/png");
    expect(result.outputs[0].contentLength).toBe(102400);
    expect(result.outputs[0].sha256).toBe("abc123");
    expect(result.cost!.amount).toBe(0.01);
    expect(result.cost!.currency).toBe("USD");
  });

  it("end-to-end success with no cost information", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "int-req-002",
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    const client = makeClient();
    const result = await client.submit(makeInput());

    expect(result.cost).toBeNull();
    expect(result.outputs).toHaveLength(1);
  });

  // ─── Failure paths ──────────────────────────────────────────────────

  it("HTTP 401 unauthorized", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 401, {
      error: "Invalid key",
    });

    const client = makeClient();
    await expect(client.submit(makeInput())).rejects.toMatchObject({
      code: "FAL_HTTP_ERROR",
      status: 401,
    });
  });

  it("HTTP 500 internal server error", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 500, {
      error: "internal error",
    });

    const client = makeClient();
    await expect(client.submit(makeInput())).rejects.toMatchObject({
      code: "FAL_HTTP_ERROR",
      status: 500,
    });
  });

  it("contract violation: missing request_id", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      // request_id is missing
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    const client = makeClient();
    await expect(client.submit(makeInput())).rejects.toThrow(FalContractError);
  });

  it("contract violation: non-COMPLETED status", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "int-req-004",
      status: "FAILED",
      result: {},
    });

    const client = makeClient();
    await expect(client.submit(makeInput())).rejects.toThrow(FalContractError);
  });

  it("contract violation: missing result object", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "int-req-005",
      status: "COMPLETED",
      // result is missing
    });

    const client = makeClient();
    await expect(client.submit(makeInput())).rejects.toThrow(FalContractError);
  });

  it("cancel before request", async () => {
    const ac = new AbortController();
    ac.abort();

    const client = makeClient();
    await expect(
      client.submit(makeInput(), ac.signal),
    ).rejects.toThrow(FalCancelledError);
  });

  it("timeout: submit exceeds deadline immediately", async () => {
    // A timeoutMs of 0 with a clock that won't advance means immediate timeout
    const client = makeClient();
    const input = makeInput({ timeoutMs: 0 });

    await expect(client.submit(input)).rejects.toMatchObject({
      code: "FAL_TIMEOUT",
    });
  });

  // ─── Logging safety ─────────────────────────────────────────────────

  it("no authorization header value appears in any log entry", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "int-req-006",
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    const client = makeClient();
    await client.submit(makeInput());

    const allLogJson = logEntries.map((e) => JSON.stringify(e)).join("\n");
    expect(allLogJson).not.toContain("fal-integration-key-abcdefgh");
  });

  it("falKey in log is redacted", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "int-req-007",
      status: "COMPLETED",
      result: {
        images: [{ url: "https://example.com/o.png", content_type: "image/png" }],
      },
    });

    const client = makeClient();
    await client.submit(makeInput());

    const submitLog = logEntries.find((e) => e.msg === "fal submit");
    expect(submitLog).toBeDefined();
    const falKey = submitLog!.falKey as string;
    expect(falKey).toBe("***REDACTED***");
    expect(falKey).not.toBe("fal-integration-key-abcdefgh");
  });
});
