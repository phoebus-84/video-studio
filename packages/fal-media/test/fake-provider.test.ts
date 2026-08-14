// ---------------------------------------------------------------------------
// Fake provider contract tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  FakeFalProvider,
  createFakeFal,
  createFailingFal,
  createSlowFal,
  FAKE_ENDPOINTS,
} from "../src/fake-provider.js";
import type { GenerationInput, EndpointBinding } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(
  idempotencyKey: string,
  endpoint: string = "fal-ai/flux/dev",
  params: Record<string, unknown> = {},
): GenerationInput {
  const binding: EndpointBinding = {
    endpointId: endpoint,
    contractVersion: "1.0.0",
    baseUrl: "https://fal.run",
  };
  return {
    idempotencyKey,
    binding,
    parameters: params,
    timeoutMs: 30000,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FakeFalProvider", () => {
  describe("basic submission", () => {
    it("returns a completed result for a valid request", async () => {
      const fal = createFakeFal();
      const result = await fal.submit(makeInput("req-1"));

      expect(result.status).toBe("completed");
      expect(result.idempotencyKey).toBe("req-1");
      expect(result.outputs.length).toBe(1);
      expect(result.outputs[0]!.contentType).toBe("image/png");
      expect(result.providerRequestId).toBe("fake-req-1");
      expect(result.cost!.amount).toBe(0.004);
    });

    it("generates multiple outputs when num_images > 1", async () => {
      const fal = createFakeFal();
      const result = await fal.submit(
        makeInput("req-2", "fal-ai/flux/dev", { num_images: 3 }),
      );

      expect(result.outputs.length).toBe(3);
    });

    it("tracks request count", async () => {
      const fal = createFakeFal();
      await fal.submit(makeInput("a"));
      await fal.submit(makeInput("b"));
      await fal.submit(makeInput("c"));

      expect(fal.requestCount).toBe(3);
    });

    it("stores results for idempotency check", async () => {
      const fal = createFakeFal();
      await fal.submit(makeInput("idem-1"));

      const prev = fal.getPreviousResult("idem-1");
      expect(prev).not.toBeNull();
      expect(prev!.idempotencyKey).toBe("idem-1");
    });
  });

  describe("failure mode", () => {
    it("throws on submit when failMode is enabled", async () => {
      const fal = createFailingFal();
      await expect(
        fal.submit(makeInput("fail-1")),
      ).rejects.toThrow("failMode enabled");
    });

    it("throws on submitAndPoll when failMode is enabled", async () => {
      const fal = createFailingFal();
      await expect(
        fal.submitAndPoll(makeInput("fail-2")),
      ).rejects.toThrow("failMode enabled");
    });
  });

  describe("restart simulation", () => {
    it("preserves previous results across simulated restart", async () => {
      const fal = createFakeFal();
      await fal.submit(makeInput("restart-1"));

      // Simulate crash/restart by checking stored results
      const prev = fal.getPreviousResult("restart-1");
      expect(prev).not.toBeNull();

      // After reset, no previous results
      fal.reset();
      expect(fal.getPreviousResult("restart-1")).toBeNull();
      expect(fal.requestCount).toBe(0);
    });
  });

  describe("slow processing", () => {
    it("creates provider with configurable delay", () => {
      const fal = createSlowFal(100);
      expect(fal).toBeDefined();
    });
  });

  describe("fake endpoints", () => {
    it("supports known fal endpoints", () => {
      expect(FAKE_ENDPOINTS.has("fal-ai/flux/dev")).toBe(true);
      expect(FAKE_ENDPOINTS.has("fal-ai/flux/schnell")).toBe(true);
      expect(FAKE_ENDPOINTS.has("fal-ai/stable-diffusion-v3")).toBe(true);
    });
  });
});
