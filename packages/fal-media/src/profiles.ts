// ─── Versioned endpoint profiles ──────────────────────────────────────
// Each profile is pure data – no pipeline behavior is hardcoded here.
// The profile defines what parameters are accepted, what capabilities
// the endpoint has, and how it is priced.  Unknown parameters fail
// validation before any HTTP request (spend) is made.

import { createHash } from "node:crypto";
import type {
  EndpointProfile,
  ParameterField,
  EndpointCapabilities,
  PricingMetadata,
  DeprecationInfo,
  ProfileOperation,
} from "./types.js";
import { FalValidationError } from "./errors.js";

// ─── Profile registry ─────────────────────────────────────────────────

/** Look up a profile by its stable id. Returns undefined if not found. */
export function getProfile(
  profileId: string,
): EndpointProfile | undefined {
  return PROFILE_MAP.get(profileId);
}

/** Return all registered profiles. */
export function listProfiles(): readonly EndpointProfile[] {
  return PROFILES;
}

// ─── Schema fingerprinting ────────────────────────────────────────────

/**
 * Compute an immutable fingerprint for a parameter schema.
 * The fingerprint is a SHA-256 hex digest of the canonical JSON
 * representation with sorted keys, so it is stable across runs.
 */
export function computeSchemaFingerprint(
  schema: readonly ParameterField[],
): string {
  const canonical = schema.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required,
    defaultValue: f.defaultValue ?? null,
    enumValues: f.enumValues ?? null,
    min: f.min ?? null,
    max: f.max ?? null,
  }));
  // Sort by name for deterministic output
  canonical.sort((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

// ─── Parameter validation ─────────────────────────────────────────────

/** Result of validating parameters against a profile. */
export interface ValidationResult {
  /** Normalised parameter map (defaults applied). */
  readonly params: Record<string, unknown>;
  /** List of diagnostic messages (empty on success). */
  readonly errors: readonly string[];
}

/**
 * Validate user-supplied parameters against a profile's parameter schema.
 * Unknown parameters are rejected.  Missing required parameters are flagged.
 * Type/constraint violations are diagnosed individually.
 *
 * This runs **before** any HTTP request – no spend occurs on invalid input.
 */
export function validateParameters(
  profile: EndpointProfile,
  rawParams: Record<string, unknown>,
): ValidationResult {
  const schemaByName = new Map<string, ParameterField>();
  for (const field of profile.parameterSchema) {
    schemaByName.set(field.name, field);
  }

  const errors: string[] = [];
  const params: Record<string, unknown> = {};

  // Check for unknown parameters
  for (const key of Object.keys(rawParams)) {
    if (!schemaByName.has(key)) {
      errors.push(
        `Unknown parameter "${key}" is not accepted by profile "${profile.profileId}". ` +
          `Accepted parameters: ${profile.parameterSchema.map((f) => f.name).join(", ")}`,
      );
    }
  }

  // If there are unknown parameters, stop here – no point validating further
  if (errors.length > 0) {
    return { params: {}, errors };
  }

  // Validate each defined field
  for (const field of profile.parameterSchema) {
    const raw = rawParams[field.name];

    if (raw === undefined || raw === null) {
      if (field.required) {
        errors.push(
          `Required parameter "${field.name}" is missing.`,
        );
      } else if (field.defaultValue !== undefined) {
        params[field.name] = field.defaultValue;
      }
      continue;
    }

    const validated = validateField(field, raw);
    if (validated.error) {
      errors.push(validated.error);
    } else {
      params[field.name] = validated.value;
    }
  }

  return { params, errors };
}

function validateField(
  field: ParameterField,
  raw: unknown,
): { error?: string; value?: unknown } {
  switch (field.type) {
    case "string":
      if (typeof raw !== "string") {
        return {
          error: `Parameter "${field.name}" must be a string, got ${typeof raw}.`,
        };
      }
      return { value: raw };

    case "number":
      if (typeof raw !== "number" || Number.isNaN(raw)) {
        return {
          error: `Parameter "${field.name}" must be a number, got ${typeof raw}.`,
        };
      }
      if (field.min !== undefined && raw < field.min) {
        return {
          error: `Parameter "${field.name}" must be >= ${field.min}, got ${raw}.`,
        };
      }
      if (field.max !== undefined && raw > field.max) {
        return {
          error: `Parameter "${field.name}" must be <= ${field.max}, got ${raw}.`,
        };
      }
      return { value: raw };

    case "integer":
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        return {
          error: `Parameter "${field.name}" must be an integer, got ${typeof raw === "number" ? String(raw) : typeof raw}.`,
        };
      }
      if (field.min !== undefined && raw < field.min) {
        return {
          error: `Parameter "${field.name}" must be >= ${field.min}, got ${raw}.`,
        };
      }
      if (field.max !== undefined && raw > field.max) {
        return {
          error: `Parameter "${field.name}" must be <= ${field.max}, got ${raw}.`,
        };
      }
      return { value: raw };

    case "boolean":
      if (typeof raw !== "boolean") {
        return {
          error: `Parameter "${field.name}" must be a boolean, got ${typeof raw}.`,
        };
      }
      return { value: raw };

    case "enum":
      if (typeof raw !== "string") {
        return {
          error: `Parameter "${field.name}" must be a string (enum), got ${typeof raw}.`,
        };
      }
      if (field.enumValues && !field.enumValues.includes(raw)) {
        return {
          error: `Parameter "${field.name}" value "${raw}" is not allowed. ` +
            `Allowed values: ${field.enumValues.join(", ")}.`,
        };
      }
      return { value: raw };

    default:
      return {
        error: `Internal: unknown field type "${field.type}" for "${field.name}".`,
      };
  }
}

/**
 * Validate and throw a typed error on failure.
 * Returns the normalised parameter map on success.
 */
export function requireValidParameters(
  profile: EndpointProfile,
  rawParams: Record<string, unknown>,
): Record<string, unknown> {
  const result = validateParameters(profile, rawParams);
  if (result.errors.length > 0) {
    throw new FalValidationError(
      `Parameter validation failed for profile "${profile.profileId}"`,
      { errors: result.errors, profileId: profile.profileId },
    );
  }
  return result.params;
}

// ─── Deprecation diagnostics ──────────────────────────────────────────

/**
 * Check whether a profile is deprecated and return a human-readable
 * diagnostic message.  Returns `null` if the profile is current.
 */
export function deprecationDiagnostic(
  profile: EndpointProfile,
): string | null {
  if (!profile.deprecation) return null;

  let msg = `Profile "${profile.profileId}" is deprecated: ${profile.deprecation.message}`;
  if (profile.deprecation.migrationTarget) {
    msg += ` Migrate to "${profile.deprecation.migrationTarget}".`;
  }
  if (profile.deprecation.sunsetDate) {
    msg += ` Sunset date: ${profile.deprecation.sunsetDate}.`;
  }
  return msg;
}

// ─── Helper builders ──────────────────────────────────────────────────

function defineProfile(opts: {
  profileId: string;
  endpointId: string;
  operation: ProfileOperation;
  contractVersion: string;
  parameterSchema: ParameterField[];
  capabilities: EndpointCapabilities;
  pricing: PricingMetadata;
  deprecation?: DeprecationInfo;
}): EndpointProfile {
  // Freeze schema so it is truly immutable
  const frozenSchema: readonly ParameterField[] = Object.freeze(
    opts.parameterSchema.map((f) => Object.freeze({ ...f })),
  );

  return Object.freeze({
    profileId: opts.profileId,
    endpointId: opts.endpointId,
    operation: opts.operation,
    contractVersion: opts.contractVersion,
    schemaFingerprint: computeSchemaFingerprint(frozenSchema),
    parameterSchema: frozenSchema,
    capabilities: Object.freeze({ ...opts.capabilities }),
    pricing: Object.freeze({ ...opts.pricing }),
    deprecation: opts.deprecation
      ? Object.freeze({ ...opts.deprecation })
      : null,
  });
}

// ─── Predefined profiles ──────────────────────────────────────────────

/** FLUX.1 [dev] – text-to-image generation. */
export const fluxDevV1: EndpointProfile = defineProfile({
  profileId: "fal-ai/flux/dev@v1",
  endpointId: "fal-ai/flux/dev",
  operation: "text-to-image",
  contractVersion: "v1",
  parameterSchema: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Text prompt describing the desired image.",
    },
    {
      name: "image_size",
      type: "enum",
      required: false,
      defaultValue: "landscape_4_3",
      enumValues: [
        "square_hd",
        "square",
        "portrait_4_3",
        "portrait_16_9",
        "landscape_4_3",
        "landscape_16_9",
      ],
      description: "Output image dimensions.",
    },
    {
      name: "num_images",
      type: "integer",
      required: false,
      defaultValue: 1,
      min: 1,
      max: 4,
      description: "Number of images to generate.",
    },
    {
      name: "seed",
      type: "integer",
      required: false,
      min: 0,
      description: "Deterministic seed for reproducible outputs.",
    },
    {
      name: "guidance_scale",
      type: "number",
      required: false,
      defaultValue: 3.5,
      min: 0,
      max: 20,
      description: "Classifier-free guidance scale.",
    },
    {
      name: "num_inference_steps",
      type: "integer",
      required: false,
      defaultValue: 28,
      min: 1,
      max: 50,
      description: "Number of denoising steps.",
    },
    {
      name: "negative_prompt",
      type: "string",
      required: false,
      description: "Text prompt describing what to avoid.",
    },
    {
      name: "enable_safety_checker",
      type: "boolean",
      required: false,
      defaultValue: true,
      description: "Whether to run the safety checker on outputs.",
    },
  ],
  capabilities: {
    supportedAspectRatios: [
      "square_hd",
      "square",
      "portrait_4_3",
      "portrait_16_9",
      "landscape_4_3",
      "landscape_16_9",
    ],
    supportsSeed: true,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportsNegativePrompt: true,
    defaultImageSize: "landscape_4_3",
  },
  pricing: {
    unit: "inference",
    estimatedUnitCost: 0.005,
    currency: "USD",
  },
});

/** FLUX.1 [fill] – inpainting / image editing. */
export const fluxFillV1: EndpointProfile = defineProfile({
  profileId: "fal-ai/flux/fill@v1",
  endpointId: "fal-ai/flux/fill",
  operation: "image-edit",
  contractVersion: "v1",
  parameterSchema: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Text prompt describing the desired edit.",
    },
    {
      name: "image_url",
      type: "string",
      required: true,
      description: "URL of the source image to edit.",
    },
    {
      name: "mask_url",
      type: "string",
      required: true,
      description: "URL of the mask image (white = editable area).",
    },
    {
      name: "image_size",
      type: "enum",
      required: false,
      defaultValue: "landscape_4_3",
      enumValues: [
        "square_hd",
        "square",
        "portrait_4_3",
        "portrait_16_9",
        "landscape_4_3",
        "landscape_16_9",
      ],
      description: "Output image dimensions.",
    },
    {
      name: "num_images",
      type: "integer",
      required: false,
      defaultValue: 1,
      min: 1,
      max: 4,
      description: "Number of edited variants to produce.",
    },
    {
      name: "seed",
      type: "integer",
      required: false,
      min: 0,
      description: "Deterministic seed for reproducible edits.",
    },
    {
      name: "guidance_scale",
      type: "number",
      required: false,
      defaultValue: 3.5,
      min: 0,
      max: 20,
      description: "Classifier-free guidance scale.",
    },
    {
      name: "num_inference_steps",
      type: "integer",
      required: false,
      defaultValue: 28,
      min: 1,
      max: 50,
      description: "Number of denoising steps.",
    },
    {
      name: "negative_prompt",
      type: "string",
      required: false,
      description: "Text prompt describing what to avoid.",
    },
    {
      name: "strength",
      type: "number",
      required: false,
      defaultValue: 0.85,
      min: 0,
      max: 1,
      description: "How strongly the edit is applied (0 = original, 1 = full regeneration).",
    },
  ],
  capabilities: {
    supportedAspectRatios: [
      "square_hd",
      "square",
      "portrait_4_3",
      "portrait_16_9",
      "landscape_4_3",
      "landscape_16_9",
    ],
    supportsSeed: true,
    supportsReferenceImages: true,
    maxReferenceImages: 2,
    supportsNegativePrompt: true,
    defaultImageSize: "landscape_4_3",
  },
  pricing: {
    unit: "inference",
    estimatedUnitCost: 0.006,
    currency: "USD",
  },
});

/**
 * Example deprecated profile for testing deprecation diagnostics.
 * This profile is known-deprecated and should trigger clear diagnostics.
 */
export const deprecationExample: EndpointProfile = defineProfile({
  profileId: "fal-ai/legacy/model@v1",
  endpointId: "fal-ai/legacy/model",
  operation: "text-to-image",
  contractVersion: "v1",
  parameterSchema: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Text prompt.",
    },
    {
      name: "image_size",
      type: "enum",
      required: false,
      defaultValue: "square",
      enumValues: ["square", "landscape", "portrait"],
      description: "Output size.",
    },
  ],
  capabilities: {
    supportedAspectRatios: ["square", "landscape", "portrait"],
    supportsSeed: false,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportsNegativePrompt: false,
    defaultImageSize: "square",
  },
  pricing: {
    unit: "inference",
    estimatedUnitCost: 0.01,
    currency: "USD",
  },
  deprecation: {
    message:
      "This model is no longer maintained and produces sub-par results.",
    migrationTarget: "fal-ai/flux/dev@v1",
    sunsetDate: "2025-01-15T00:00:00Z",
  },
});

// ─── Nano Banana Pro ─────────────────────────────────────────────────

const nanoBananaPro: EndpointProfile = Object.freeze({
  profileId: "fal-ai/nano-banana-pro@v1",
  endpointId: "fal-ai/nano-banana-pro",
  operation: "text-to-image",
  contractVersion: "v1",
  parameterSchema: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Text prompt describing the desired image. Supports multi-language text rendering.",
    },
    {
      name: "aspect_ratio",
      type: "enum",
      required: false,
      defaultValue: "16:9",
      enumValues: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      description: "Aspect ratio of the output image.",
    },
    {
      name: "resolution",
      type: "enum",
      required: false,
      defaultValue: "1K",
      enumValues: ["1K", "2K", "4K"],
      description: "Resolution of the output image. 1K ≈ 1080p, 2K ≈ 1440p, 4K ≈ 2160p.",
    },
    {
      name: "output_format",
      type: "enum",
      required: false,
      defaultValue: "jpeg",
      enumValues: ["jpeg", "png"],
      description: "Output image format.",
    },
    {
      name: "num_images",
      type: "integer",
      required: false,
      defaultValue: 1,
      min: 1,
      max: 4,
      description: "Number of images to generate.",
    },
  ],
  capabilities: ["illustration", "diagram", "text-rendering"],
  tags: ["fast", "text-capable"],
});

// ─── Registry ─────────────────────────────────────────────────────────

const PROFILES: readonly EndpointProfile[] = Object.freeze([
  fluxDevV1,
  fluxFillV1,
  nanoBananaPro,
  deprecationExample,
]);

const PROFILE_MAP = new Map<string, EndpointProfile>();
for (const p of PROFILES) {
  PROFILE_MAP.set(p.profileId, p);
}
