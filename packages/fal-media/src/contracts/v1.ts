// ─── Versioned endpoint contracts ─────────────────────────────────────
// Each endpoint profile defines input validation, parameter defaults, and
// response normalization for a specific fal.ai model/version binding.
//
// Contracts can be backed by an EndpointProfile for automatic parameter
// validation and profile identity recording, or extend V1BaseContract
// directly for custom validation logic.

import type {
  GenerationInput,
  GenerationResult,
  CostBreakdown,
  OutputAsset,
  EndpointProfile,
} from "../types.js";
import { FalContractError } from "../errors.js";
import { requireValidParameters } from "../profiles.js";

// ─── Contract interface ───────────────────────────────────────────────

/**
 * A versioned contract knows how to build the fal API request body and
 * how to normalise the API response into a `GenerationResult`.
 */
export interface EndpointContract {
  /** Contract identifier that must match the binding's contractVersion. */
  readonly version: string;

  /** The profile that backs this contract, if any. */
  readonly profile?: EndpointProfile;

  /** Validate & normalise caller-supplied parameters. */
  validateParameters(params: Record<string, unknown>): Record<string, unknown>;

  /** Build an API request body from the typed input. */
  buildRequestBody(input: GenerationInput): Record<string, unknown>;

  /**
   * Parse a raw fal API response into a `GenerationResult`.
   * Throws `FalContractError` on structural violations.
   */
  parseResponse(
    input: GenerationInput,
    raw: Record<string, unknown>,
  ): GenerationResult;
}

// ─── V1 base contract (fal queue REST API) ────────────────────────────

/**
 * V1 base for fal queue endpoints.  Extend this for custom parameter
 * validation or use {@link ProfileContract} for profile-backed validation.
 */
export abstract class V1BaseContract implements EndpointContract {
  abstract readonly version: string;
  abstract readonly endpointPath: string;
  readonly profile?: EndpointProfile;

  abstract validateParameters(
    params: Record<string, unknown>,
  ): Record<string, unknown>;

  buildRequestBody(input: GenerationInput): Record<string, unknown> {
    return {
      ...this.validateParameters(input.parameters),
    };
  }

  parseResponse(
    input: GenerationInput,
    raw: Record<string, unknown>,
  ): GenerationResult {
    const requestId = raw["request_id"];
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new FalContractError(
        "request_id",
        "non-empty string",
        String(requestId),
      );
    }

    const status = raw["status"];
    if (status !== "COMPLETED") {
      throw new FalContractError(
        "status",
        "COMPLETED",
        String(status),
      );
    }

    const rawResult = raw["result"];
    if (
      !rawResult ||
      typeof rawResult !== "object" ||
      Array.isArray(rawResult)
    ) {
      throw new FalContractError(
        "result",
        "object",
        typeof rawResult,
      );
    }
    const result = rawResult as Record<string, unknown>;

    const outputs = this.parseOutputs(result);

    const cost = this.parseCost(raw);

    return {
      idempotencyKey: input.idempotencyKey,
      status: "completed",
      outputs,
      providerRequestId: requestId,
      profileId: this.profile?.profileId ?? input.binding.endpointId,
      schemaFingerprint: this.profile?.schemaFingerprint ?? "",
      cost,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  /** Subclasses can override to parse model-specific output shapes. */
  protected parseOutputs(
    result: Record<string, unknown>,
  ): OutputAsset[] {
    const images = result["images"];
    if (!Array.isArray(images)) {
      return [];
    }

    return images.map((img: unknown) => {
      if (!img || typeof img !== "object") {
        throw new FalContractError(
          "images[]",
          "object",
          typeof img,
        );
      }
      const i = img as Record<string, unknown>;
      return {
        url: asString(i["url"], "url"),
        contentType: asString(i["content_type"] ?? "image/png", "content_type"),
        contentLength: optionalNumber(i["content_length"] ?? i["file_size"]),
        sha256: optionalString(i["sha256"] ?? i["hash"]),
      };
    });
  }

  protected parseCost(raw: Record<string, unknown>): CostBreakdown | null {
    const cost = raw["cost"];
    if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
      return null;
    }
    const c = cost as Record<string, unknown>;
    if (typeof c["amount"] !== "number") return null;
    return {
      amount: c["amount"] as number,
      currency: asString(c["currency"] ?? "USD", "currency"),
      breakdown:
        typeof c["breakdown"] === "object" && !Array.isArray(c["breakdown"])
          ? (c["breakdown"] as Record<string, number>)
          : {},
    };
  }
}

// ─── Profile-backed contract ──────────────────────────────────────────

/**
 * A concrete contract backed by an {@link EndpointProfile}.
 *
 * Parameter validation is delegated to the profile's schema so unknown
 * parameters are rejected before any HTTP request (spend) is made.
 * Profile identity and schema fingerprint are recorded in every result.
 */
export class ProfileContract implements EndpointContract {
  readonly version: string;
  readonly profile: EndpointProfile;
  /** The fal API path segment (e.g. "fal-ai/flux/dev"). */
  readonly endpointPath: string;

  constructor(profile: EndpointProfile) {
    this.profile = profile;
    this.version = profile.contractVersion;
    this.endpointPath = profile.endpointId;
  }

  validateParameters(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    return requireValidParameters(this.profile, params);
  }

  buildRequestBody(input: GenerationInput): Record<string, unknown> {
    return {
      ...this.validateParameters(input.parameters),
    };
  }

  parseResponse(
    input: GenerationInput,
    raw: Record<string, unknown>,
  ): GenerationResult {
    // Reuse the V1 base logic using a throwaway helper.
    const helper = new ProfileContractParseHelper(
      input,
      raw,
      this.profile,
      this.parseOutputs.bind(this),
    );
    return helper.parse();
  }

  /** Overridable output parsing – defaults to the V1 images array. */
  protected parseOutputs(
    result: Record<string, unknown>,
  ): OutputAsset[] {
    const images = result["images"];
    if (!Array.isArray(images)) {
      return [];
    }

    return images.map((img: unknown) => {
      if (!img || typeof img !== "object") {
        throw new FalContractError(
          "images[]",
          "object",
          typeof img,
        );
      }
      const i = img as Record<string, unknown>;
      return {
        url: asString(i["url"], "url"),
        contentType: asString(i["content_type"] ?? "image/png", "content_type"),
        contentLength: optionalNumber(i["content_length"] ?? i["file_size"]),
        sha256: optionalString(i["sha256"] ?? i["hash"]),
      };
    });
  }
}

// ─── Internal helper for response parsing ─────────────────────────────

class ProfileContractParseHelper {
  constructor(
    private readonly input: GenerationInput,
    private readonly raw: Record<string, unknown>,
    private readonly profile: EndpointProfile,
    private readonly parseOutputsFn: (
      result: Record<string, unknown>,
    ) => OutputAsset[],
  ) {}

  parse(): GenerationResult {
    const requestId = this.raw["request_id"];
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new FalContractError(
        "request_id",
        "non-empty string",
        String(requestId),
      );
    }

    const status = this.raw["status"];
    if (status !== "COMPLETED") {
      throw new FalContractError(
        "status",
        "COMPLETED",
        String(status),
      );
    }

    const rawResult = this.raw["result"];
    if (
      !rawResult ||
      typeof rawResult !== "object" ||
      Array.isArray(rawResult)
    ) {
      throw new FalContractError(
        "result",
        "object",
        typeof rawResult,
      );
    }

    const outputs = this.parseOutputsFn(
      rawResult as Record<string, unknown>,
    );

    const cost = this.parseCost();

    return {
      idempotencyKey: this.input.idempotencyKey,
      status: "completed",
      outputs,
      providerRequestId: requestId,
      profileId: this.profile.profileId,
      schemaFingerprint: this.profile.schemaFingerprint,
      cost,
      startedAt: new Date(),
      completedAt: new Date(),
    };
  }

  private parseCost(): CostBreakdown | null {
    const cost = this.raw["cost"];
    if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
      return null;
    }
    const c = cost as Record<string, unknown>;
    if (typeof c["amount"] !== "number") return null;
    return {
      amount: c["amount"] as number,
      currency: asString(c["currency"] ?? "USD", "currency"),
      breakdown:
        typeof c["breakdown"] === "object" &&
        !Array.isArray(c["breakdown"])
          ? (c["breakdown"] as Record<string, number>)
          : {},
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function asString(val: unknown, field: string): string {
  if (typeof val !== "string") {
    throw new FalContractError(field, "string", typeof val);
  }
  return val;
}

function optionalString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== "string") return null;
  return val;
}

function optionalNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== "number") return null;
  return val;
}
