import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  fluxDevV1,
  fluxFillV1,
  deprecationExample,
  getProfile,
  listProfiles,
  validateParameters,
  requireValidParameters,
  deprecationDiagnostic,
  computeSchemaFingerprint,
} from "../src/profiles.js";
import { ProfileContract } from "../src/contracts/v1.js";
import { FalClientImpl } from "../src/client.js";
import { MockServer } from "./fixtures/mock-server.js";
import { ManualClock } from "../src/clock.js";
import { NoopSleeper } from "../src/sleeper.js";
import { createLogger } from "../src/logger.js";
import { FalValidationError } from "../src/errors.js";
import type { LogEntry } from "../src/logger.js";
import type {
  EndpointBinding,
  GenerationInput,
  FalAdapterConfig,
  EndpointProfile,
} from "../src/types.js";

// ─── Profile definitions ──────────────────────────────────────────────

describe("predefined profiles", () => {
  it("fluxDevV1 is a text-to-image profile", () => {
    expect(fluxDevV1.operation).toBe("text-to-image");
    expect(fluxDevV1.profileId).toBe("fal-ai/flux/dev@v1");
    expect(fluxDevV1.endpointId).toBe("fal-ai/flux/dev");
    expect(fluxDevV1.contractVersion).toBe("v1");
  });

  it("fluxFillV1 is an image-edit profile", () => {
    expect(fluxFillV1.operation).toBe("image-edit");
    expect(fluxFillV1.profileId).toBe("fal-ai/flux/fill@v1");
    expect(fluxFillV1.endpointId).toBe("fal-ai/flux/fill");
    expect(fluxFillV1.contractVersion).toBe("v1");
  });

  it("profiles are immutable (frozen)", () => {
    expect(Object.isFrozen(fluxDevV1)).toBe(true);
    expect(Object.isFrozen(fluxDevV1.parameterSchema)).toBe(true);
    expect(Object.isFrozen(fluxDevV1.capabilities)).toBe(true);
    expect(Object.isFrozen(fluxDevV1.pricing)).toBe(true);
  });

  it("schema fingerprint is non-empty and deterministic", () => {
    expect(fluxDevV1.schemaFingerprint).toBeTruthy();
    expect(fluxDevV1.schemaFingerprint.length).toBe(64); // SHA-256 hex

    // Re-computing should give the same result
    const recomputed = computeSchemaFingerprint(fluxDevV1.parameterSchema);
    expect(recomputed).toBe(fluxDevV1.schemaFingerprint);
  });

  it("different profiles have different fingerprints", () => {
    expect(fluxDevV1.schemaFingerprint).not.toBe(fluxFillV1.schemaFingerprint);
  });

  it("listProfiles returns all registered profiles", () => {
    const all = listProfiles();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("getProfile resolves profiles by id", () => {
    expect(getProfile("fal-ai/flux/dev@v1")).toBe(fluxDevV1);
    expect(getProfile("fal-ai/flux/fill@v1")).toBe(fluxFillV1);
    expect(getProfile("nonexistent")).toBeUndefined();
  });
});

// ─── Capabilities and pricing ─────────────────────────────────────────

describe("profile capabilities", () => {
  it("fluxDevV1 does not support reference images", () => {
    expect(fluxDevV1.capabilities.supportsReferenceImages).toBe(false);
    expect(fluxDevV1.capabilities.maxReferenceImages).toBe(0);
  });

  it("fluxFillV1 supports reference images (up to 2)", () => {
    expect(fluxFillV1.capabilities.supportsReferenceImages).toBe(true);
    expect(fluxFillV1.capabilities.maxReferenceImages).toBe(2);
  });

  it("both profiles support seed and negative prompt", () => {
    for (const p of [fluxDevV1, fluxFillV1]) {
      expect(p.capabilities.supportsSeed).toBe(true);
      expect(p.capabilities.supportsNegativePrompt).toBe(true);
    }
  });

  it("pricing metadata is present", () => {
    expect(fluxDevV1.pricing.unit).toBe("inference");
    expect(fluxDevV1.pricing.estimatedUnitCost).toBe(0.005);
    expect(fluxDevV1.pricing.currency).toBe("USD");

    expect(fluxFillV1.pricing.unit).toBe("inference");
    expect(fluxFillV1.pricing.estimatedUnitCost).toBe(0.006);
    expect(fluxFillV1.pricing.currency).toBe("USD");
  });
});

// ─── Parameter validation – success paths ─────────────────────────────

describe("validateParameters – success", () => {
  it("validates valid text-to-image parameters", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "a cat wearing a hat",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.params.prompt).toBe("a cat wearing a hat");
    // defaults applied
    expect(result.params.image_size).toBe("landscape_4_3");
    expect(result.params.num_images).toBe(1);
    expect(result.params.guidance_scale).toBe(3.5);
    expect(result.params.num_inference_steps).toBe(28);
    expect(result.params.enable_safety_checker).toBe(true);
  });

  it("validates valid image-edit parameters", () => {
    const result = validateParameters(fluxFillV1, {
      prompt: "replace with a dog",
      image_url: "https://example.com/source.png",
      mask_url: "https://example.com/mask.png",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.params.prompt).toBe("replace with a dog");
    expect(result.params.image_url).toBe("https://example.com/source.png");
    expect(result.params.mask_url).toBe("https://example.com/mask.png");
  });

  it("applies all defaults when only required params are given", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
    });

    expect(result.params.image_size).toBe("landscape_4_3");
    expect(result.params.num_images).toBe(1);
    expect(result.params.guidance_scale).toBe(3.5);
    expect(result.params.num_inference_steps).toBe(28);
    expect(result.params.enable_safety_checker).toBe(true);
  });

  it("accepts explicit overrides for defaults", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      image_size: "portrait_16_9",
      num_images: 2,
      seed: 42,
      guidance_scale: 7.0,
      num_inference_steps: 30,
      enable_safety_checker: false,
    });

    expect(result.errors).toHaveLength(0);
    expect(result.params.image_size).toBe("portrait_16_9");
    expect(result.params.num_images).toBe(2);
    expect(result.params.seed).toBe(42);
    expect(result.params.guidance_scale).toBe(7.0);
    expect(result.params.num_inference_steps).toBe(30);
    expect(result.params.enable_safety_checker).toBe(false);
  });

  it("accepts optional string parameters", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      negative_prompt: "blurry, low quality",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.params.negative_prompt).toBe("blurry, low quality");
  });
});

// ─── Parameter validation – unknown inputs ────────────────────────────

describe("validateParameters – unknown inputs fail before spend", () => {
  it("rejects unknown parameters with clear diagnostics", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      unknown_field: "value",
      another_strange: 123,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);

    // Should mention the unknown parameter names
    const errorText = result.errors.join(" ");
    expect(errorText).toContain("unknown_field");
    expect(errorText).toContain("another_strange");
    // Should mention the profile and accepted parameters
    expect(errorText).toContain(fluxDevV1.profileId);
    expect(errorText).toContain("prompt");
  });

  it("rejects unknown parameters on image-edit profile", () => {
    const result = validateParameters(fluxFillV1, {
      prompt: "test",
      image_url: "https://example.com/s.png",
      mask_url: "https://example.com/m.png",
      lora_weights: "some_lora", // not in schema
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.join(" ")).toContain("lora_weights");
  });

  it("returns empty params when there are unknown parameters", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      bad_param: true,
    });

    // Params should be empty – no partial results when there are errors
    expect(Object.keys(result.params)).toHaveLength(0);
  });

  it("requireValidParameters throws FalValidationError on unknown input", () => {
    expect(() =>
      requireValidParameters(fluxDevV1, {
        prompt: "test",
        bad_param: "nope",
      }),
    ).toThrow(FalValidationError);

    try {
      requireValidParameters(fluxDevV1, {
        prompt: "test",
        bad_param: "nope",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FalValidationError);
      const fe = err as FalValidationError;
      expect(fe.code).toBe("FAL_VALIDATION_ERROR");
      expect(fe.retryable).toBe(false);
      const details = fe.toJSON().details as Record<string, unknown>;
      expect(details.profileId).toBe("fal-ai/flux/dev@v1");
      expect(Array.isArray(details.errors)).toBe(true);
    }
  });
});

// ─── Parameter validation – type mismatches ───────────────────────────

describe("validateParameters – type mismatches", () => {
  it("rejects non-string prompt", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: 123,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("prompt");
    expect(result.errors[0]).toContain("string");
    expect(result.errors[0]).toContain("number");
  });

  it("rejects non-integer num_images", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      num_images: 2.5,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("num_images");
    expect(result.errors[0]).toContain("integer");
  });

  it("rejects non-boolean enable_safety_checker", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      enable_safety_checker: "yes",
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("enable_safety_checker");
    expect(result.errors[0]).toContain("boolean");
  });

  it("rejects non-enum image_size", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      image_size: "cinematic_21_9",
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("image_size");
    expect(result.errors[0]).toContain("cinematic_21_9");
    expect(result.errors[0]).toContain("Allowed values");
  });
});

// ─── Parameter validation – constraint violations ─────────────────────

describe("validateParameters – constraint violations", () => {
  it("rejects num_images below minimum", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      num_images: 0,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("num_images");
    expect(result.errors[0]).toContain(">= 1");
  });

  it("rejects num_images above maximum", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      num_images: 10,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("num_images");
    expect(result.errors[0]).toContain("<= 4");
  });

  it("rejects guidance_scale out of range", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      guidance_scale: 50,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("guidance_scale");
    expect(result.errors[0]).toContain("<= 20");
  });

  it("rejects negative guidance_scale", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      guidance_scale: -1,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("guidance_scale");
    expect(result.errors[0]).toContain(">= 0");
  });

  it("rejects num_inference_steps above max", () => {
    const result = validateParameters(fluxDevV1, {
      prompt: "test",
      num_inference_steps: 100,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("num_inference_steps");
    expect(result.errors[0]).toContain("<= 50");
  });

  it("rejects strength out of range for inpainting", () => {
    const result = validateParameters(fluxFillV1, {
      prompt: "test",
      image_url: "https://example.com/s.png",
      mask_url: "https://example.com/m.png",
      strength: 1.5,
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("strength");
    expect(result.errors[0]).toContain("<= 1");
  });
});

// ─── Parameter validation – missing required ──────────────────────────

describe("validateParameters – missing required", () => {
  it("rejects missing prompt for fluxDevV1", () => {
    const result = validateParameters(fluxDevV1, {});

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("prompt");
    expect(result.errors[0]).toContain("Required");
  });

  it("rejects missing image_url for fluxFillV1", () => {
    const result = validateParameters(fluxFillV1, {
      prompt: "test",
      mask_url: "https://example.com/m.png",
    });

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    // Should flag missing image_url
    const allErrors = result.errors.join("\n");
    expect(allErrors).toContain("image_url");
    expect(allErrors).toContain("Required");
  });
});

// ─── Deprecation diagnostics ──────────────────────────────────────────

describe("deprecation diagnostics", () => {
  it("returns null for non-deprecated profiles", () => {
    expect(deprecationDiagnostic(fluxDevV1)).toBeNull();
    expect(deprecationDiagnostic(fluxFillV1)).toBeNull();
  });

  it("returns diagnostic message for deprecated profiles", () => {
    const diag = deprecationDiagnostic(deprecationExample);
    expect(diag).not.toBeNull();
    expect(diag!).toContain(deprecationExample.profileId);
    expect(diag!).toContain("deprecated");
    expect(diag!).toContain("no longer maintained");
  });

  it("includes migration target in diagnostic", () => {
    const diag = deprecationDiagnostic(deprecationExample);
    expect(diag!).toContain("Migrate to");
    expect(diag!).toContain("fal-ai/flux/dev@v1");
  });

  it("includes sunset date in diagnostic", () => {
    const diag = deprecationDiagnostic(deprecationExample);
    expect(diag!).toContain("Sunset date");
    expect(diag!).toContain("2025-01-15");
  });

  it("diagnostic for profile without migration target works", () => {
    // Build a deprecated profile without migration target on the fly
    const noMigDiag = deprecationDiagnostic({
      ...deprecationExample,
      deprecation: {
        message: "end of life",
        // no migrationTarget
      },
    });
    expect(noMigDiag).not.toBeNull();
    expect(noMigDiag!).not.toContain("Migrate to");
  });

  it("deprecationExample profile is immutable", () => {
    expect(Object.isFrozen(deprecationExample)).toBe(true);
    expect(deprecationExample.deprecation).not.toBeNull();
    expect(Object.isFrozen(deprecationExample.deprecation!)).toBe(true);
  });
});

// ─── Profile Contract integration ─────────────────────────────────────

describe("ProfileContract", () => {
  it("wraps a profile for use as an EndpointContract", () => {
    const contract = new ProfileContract(fluxDevV1);
    expect(contract.version).toBe("v1");
    expect(contract.profile).toBe(fluxDevV1);
    expect(contract.endpointPath).toBe("fal-ai/flux/dev");
  });

  it("validateParameters rejects unknown fields via the contract", () => {
    const contract = new ProfileContract(fluxDevV1);

    expect(() =>
      contract.validateParameters({
        prompt: "test",
        bad_input: true,
      }),
    ).toThrow(FalValidationError);
  });

  it("validateParameters succeeds with valid params via the contract", () => {
    const contract = new ProfileContract(fluxDevV1);

    const params = contract.validateParameters({
      prompt: "a beautiful landscape",
      seed: 42,
    });

    expect(params.prompt).toBe("a beautiful landscape");
    expect(params.seed).toBe(42);
    expect(params.image_size).toBe("landscape_4_3"); // default
  });
});

// ─── End-to-end: profile identity in results ──────────────────────────

describe("profile identity in GenerationResult", () => {
  let server: MockServer;
  let logEntries: LogEntry[];

  const testConfig: FalAdapterConfig = {
    falKey: "fal-test-key-profile-identity",
    baseUrl: "",
    defaultTimeoutMs: 30_000,
    maxRetries: 3,
  };

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
  });

  function makeClient(profile: EndpointProfile): FalClientImpl {
    const logger = createLogger((entry) => logEntries.push(entry));
    const config = { ...testConfig, baseUrl: server.url };

    return new FalClientImpl({
      config,
      contracts: [new ProfileContract(profile)],
      clock: new ManualClock(1_000_000),
      sleeper: new NoopSleeper(),
      logger,
    });
  }

  function makeInput(
    endpointId: string,
    params: Record<string, unknown>,
  ): GenerationInput {
    return {
      idempotencyKey: "profile-test-key",
      binding: {
        endpointId,
        contractVersion: "v1",
        baseUrl: "",
      },
      parameters: params,
      timeoutMs: 10_000,
    };
  }

  it("text-to-image result contains profileId and schemaFingerprint", async () => {
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "prof-req-001",
      status: "COMPLETED",
      result: {
        images: [
          {
            url: "https://fal.media/output/img.png",
            content_type: "image/png",
            content_length: 51200,
            sha256: "feedface",
          },
        ],
      },
      cost: { amount: 0.005, currency: "USD", breakdown: { inference: 0.005 } },
    });

    const client = makeClient(fluxDevV1);
    const result = await client.submit(
      makeInput("fal-ai/flux/dev", { prompt: "a test" }),
    );

    expect(result.profileId).toBe("fal-ai/flux/dev@v1");
    expect(result.schemaFingerprint).toBe(fluxDevV1.schemaFingerprint);
    expect(result.schemaFingerprint.length).toBe(64);
  });

  it("image-edit result contains profileId and schemaFingerprint", async () => {
    server.expect("POST", "/fal-ai/flux/fill", 200, {
      request_id: "prof-req-002",
      status: "COMPLETED",
      result: {
        images: [
          {
            url: "https://fal.media/output/edit.png",
            content_type: "image/png",
            content_length: 102400,
            sha256: "abc12345",
          },
        ],
      },
    });

    const client = makeClient(fluxFillV1);
    const result = await client.submit(
      makeInput("fal-ai/flux/fill", {
        prompt: "remove background",
        image_url: "https://example.com/src.png",
        mask_url: "https://example.com/mask.png",
      }),
    );

    expect(result.profileId).toBe("fal-ai/flux/fill@v1");
    expect(result.schemaFingerprint).toBe(fluxFillV1.schemaFingerprint);
    expect(result.schemaFingerprint.length).toBe(64);
  });

  it("unknown parameters are rejected before any HTTP request", async () => {
    const client = makeClient(fluxDevV1);

    await expect(
      client.submit(
        makeInput("fal-ai/flux/dev", {
          prompt: "test",
          unknown_param: "boom",
        }),
      ),
    ).rejects.toThrow(FalValidationError);

    // Crucially: no request was made to the server
    expect(server.received.length).toBe(0);
  });

  it("deprecated profile produces a warning log entry", async () => {
    server.expect("POST", "/fal-ai/legacy/model", 200, {
      request_id: "prof-req-003",
      status: "COMPLETED",
      result: {
        images: [
          {
            url: "https://fal.media/output/old.png",
            content_type: "image/png",
          },
        ],
      },
    });

    const client = makeClient(deprecationExample);
    await client.submit(
      makeInput("fal-ai/legacy/model", { prompt: "test" }),
    );

    const warnLog = logEntries.find(
      (e) => e.msg === "fal deprecated profile",
    );
    expect(warnLog).toBeDefined();
    expect(warnLog!.level).toBe("warn");
    expect(warnLog!.profileId).toBe("fal-ai/legacy/model@v1");
    expect(warnLog!.diagnostic).toContain("no longer maintained");
    expect(warnLog!.diagnostic).toContain("fal-ai/flux/dev@v1");
  });
});

// ─── Schema fingerprint stability ─────────────────────────────────────

describe("schema fingerprint stability", () => {
  it("fingerprint is stable across recomputation", () => {
    const f1 = computeSchemaFingerprint(fluxDevV1.parameterSchema);
    const f2 = computeSchemaFingerprint(fluxDevV1.parameterSchema);
    expect(f1).toBe(f2);
  });

  it("adding a field changes fingerprint", () => {
    const original = computeSchemaFingerprint(fluxDevV1.parameterSchema);
    const extended = [
      ...fluxDevV1.parameterSchema,
      {
        name: "new_field",
        type: "string" as const,
        required: false,
        description: "A new field",
      },
    ];
    const modified = computeSchemaFingerprint(extended);
    expect(modified).not.toBe(original);
  });

  it("changing a default value changes fingerprint", () => {
    const original = computeSchemaFingerprint(fluxDevV1.parameterSchema);
    const modified = fluxDevV1.parameterSchema.map((f) =>
      f.name === "num_images"
        ? { ...f, defaultValue: 99 }
        : f,
    );
    expect(computeSchemaFingerprint(modified)).not.toBe(original);
  });

  it("fingerprint is hex-encoded", () => {
    expect(fluxDevV1.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
