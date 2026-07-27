// ─── Versioned endpoint contracts ─────────────────────────────────────
// Each endpoint profile defines input validation, parameter defaults, and
// response normalization for a specific fal.ai model/version binding.

import type {
  GenerationInput,
  GenerationResult,
  CostBreakdown,
  OutputAsset,
} from "../types.js";
import { FalContractError } from "../errors.js";

// ─── Contract interface ───────────────────────────────────────────────

/**
 * A versioned contract knows how to build the fal API request body and
 * how to normalise the API response into a `GenerationResult`.
 */
export interface EndpointContract {
  /** Contract identifier that must match the binding's contractVersion. */
  readonly version: string;

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
 * V1 base for fal queue endpoints.  Concrete profiles (flux, sdxl, etc.)
 * extend or compose this contract for parameter validation.
 */
export abstract class V1BaseContract implements EndpointContract {
  abstract readonly version: string;
  abstract readonly endpointPath: string;

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
