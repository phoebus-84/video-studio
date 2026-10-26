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

    case "array":
      // Reference URL lists. The count limit matters before a request is made:
      // exceeding it is a paid failure, and the provider's own message would
      // arrive after the spend.
      if (!Array.isArray(raw)) {
        return {
          error: `Parameter "${field.name}" must be an array, got ${typeof raw}.`,
        };
      }
      if (raw.some((item) => typeof item !== "string")) {
        return {
          error: `Parameter "${field.name}" must contain only strings (URLs).`,
        };
      }
      if (field.max !== undefined && raw.length > field.max) {
        return {
          error: `Parameter "${field.name}" accepts at most ${field.max} item(s), got ${raw.length}.`,
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

const nanoBananaPro: EndpointProfile = defineProfile({
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
  capabilities: {
    // Declared with the aspect ratios this endpoint actually accepts, which
    // are ratio strings rather than the named sizes FLUX uses.
    supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    supportsSeed: false,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportsNegativePrompt: false,
    defaultImageSize: "16:9",
  },
  pricing: {
    unit: "inference",
    estimatedUnitCost: 0.003,
    currency: "USD",
  },
});


// ─── FLUX 3 Max ─────────────────────────────────────────────────────────

const FLUX3_MAX_COMMON: ParameterField[] = [
  { name: "prompt", type: "string", required: true, description: "The video scene, action, camera and audio to generate." },
  { name: "duration", type: "integer", required: false, defaultValue: 5, min: 5, max: 20, description: "Whole seconds of output video." },
  { name: "resolution", type: "enum", required: false, defaultValue: "720p", enumValues: ["720p", "1080p"], description: "Output resolution." },
  { name: "reasoning_level", type: "enum", required: false, defaultValue: "high", enumValues: ["low", "high"], description: "Prompt reasoning effort." },
  { name: "aspect_ratio", type: "enum", required: false, defaultValue: "auto", enumValues: ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"], description: "Frame shape; auto is 16:9 for text prompts." },
  { name: "generate_audio", type: "boolean", required: false, defaultValue: true, description: "Generate synchronized native audio." },
  { name: "seed", type: "integer", required: false, min: 0, description: "Random seed; omitted means provider-selected." },
];

const FLUX3_MAX_CAPABILITIES: EndpointCapabilities = {
  supportedAspectRatios: ["21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"],
  supportsSeed: true,
  supportsReferenceImages: false,
  maxReferenceImages: 0,
  supportsNegativePrompt: false,
  defaultImageSize: "16:9",
};

const FLUX3_MAX_PRICING = { unit: "inference" as const, estimatedUnitCost: 0.2125, currency: "USD" };

/** FLUX 3 Max — text to video with optional native audio. */
export const flux3MaxTextToVideo: EndpointProfile = defineProfile({
  profileId: "blackforestlabs/flux-3-max/text-to-video@v1",
  endpointId: "blackforestlabs/flux-3-max/text-to-video",
  operation: "text-to-video",
  contractVersion: "v1",
  parameterSchema: FLUX3_MAX_COMMON,
  capabilities: FLUX3_MAX_CAPABILITIES,
  // Public 720p price at profile authoring time: $0.0425/second; the studio
  // fetches the authenticated account's live unit price before reserving spend.
  pricing: FLUX3_MAX_PRICING,
});

/** FLUX 3 Max — image to video, optionally constrained by a closing frame. */
export const flux3MaxImageToVideo: EndpointProfile = defineProfile({
  profileId: "blackforestlabs/flux-3-max/image-to-video@v1",
  endpointId: "blackforestlabs/flux-3-max/image-to-video",
  operation: "image-to-video",
  contractVersion: "v1",
  parameterSchema: [
    { name: "image_url", type: "string", required: true, description: "Opening image (PNG, JPEG or WebP)." },
    { name: "end_image_url", type: "string", required: false, description: "Optional closing image (PNG, JPEG or WebP)." },
    ...FLUX3_MAX_COMMON,
  ],
  capabilities: { ...FLUX3_MAX_CAPABILITIES, supportsReferenceImages: true, maxReferenceImages: 2 },
  pricing: FLUX3_MAX_PRICING,
});

// ─── MiniMax H3 ──────────────────────────────────────────────────────────
//
// Three endpoints, one model. Parameters and enums are taken from the live
// fal API documentation rather than assumed; the skill in skills/studio tells
// Pi how to write for it, and reminds it to check the live interface, whose
// limits always win over any snapshot.

/** Shared across all three H3 endpoints. */
const H3_COMMON: ParameterField[] = [
  {
    name: "prompt",
    type: "string",
    required: true,
    description: "Scene description. Reference assets are addressed by modality and order (Image1, Video1, Audio1).",
  },
  {
    name: "duration",
    type: "integer",
    required: false,
    defaultValue: 5,
    min: 4,
    max: 15,
    description: "Seconds of video.",
  },
  {
    name: "resolution",
    type: "enum",
    required: false,
    defaultValue: "2K",
    enumValues: ["480P", "768P", "2K", "4K"],
    description: "Output resolution.",
  },
  {
    name: "seed",
    type: "integer",
    required: false,
    description: "Fixing this makes a generation reproducible.",
  },
  {
    name: "enable_prompt_expansion",
    type: "boolean",
    required: false,
    defaultValue: true,
    description: "Let a vision-language model expand the prompt. Turn off when the prompt is already exact and must not drift.",
  },
  {
    name: "enable_safety_checker",
    type: "boolean",
    required: false,
    defaultValue: true,
    description: "Provider-side safety filter.",
  },
];

const H3_CAPABILITIES: EndpointCapabilities = {
  supportedAspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  supportsSeed: true,
  supportsReferenceImages: false,
  maxReferenceImages: 0,
  supportsNegativePrompt: false,
  defaultImageSize: "16:9",
};

/** Pricing is per generation and varies with duration and resolution. */
const H3_PRICING = {
  unit: "inference" as const,
  estimatedUnitCost: 0.48,
  currency: "USD",
};

/** MiniMax H3 — text to video. */
export const minimaxH3TextToVideo: EndpointProfile = defineProfile({
  profileId: "minimax/h3/text-to-video@v1",
  endpointId: "minimax/h3/text-to-video",
  operation: "text-to-video",
  contractVersion: "v1",
  parameterSchema: [
    ...H3_COMMON,
    {
      name: "aspect_ratio",
      type: "enum",
      required: false,
      defaultValue: "16:9",
      enumValues: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      description: "Frame shape.",
    },
  ],
  capabilities: H3_CAPABILITIES,
  pricing: H3_PRICING,
});

/** MiniMax H3 — image to video, including first/last frame. */
export const minimaxH3ImageToVideo: EndpointProfile = defineProfile({
  profileId: "minimax/h3/image-to-video@v1",
  endpointId: "minimax/h3/image-to-video",
  operation: "image-to-video",
  contractVersion: "v1",
  parameterSchema: [
    ...H3_COMMON,
    {
      name: "image_url",
      type: "string",
      required: true,
      description: "Opening frame.",
    },
    {
      name: "last_image_url",
      type: "string",
      required: false,
      description: "Closing frame. Supplying it turns the generation into a transition between two exact boundary states.",
    },
  ],
  capabilities: { ...H3_CAPABILITIES, supportsReferenceImages: true, maxReferenceImages: 2 },
  pricing: H3_PRICING,
});

/** MiniMax H3 — reference to video, driven by multimodal references. */
export const minimaxH3ReferenceToVideo: EndpointProfile = defineProfile({
  profileId: "minimax/h3/reference-to-video@v1",
  endpointId: "minimax/h3/reference-to-video",
  operation: "reference-to-video",
  contractVersion: "v1",
  parameterSchema: [
    ...H3_COMMON,
    {
      name: "aspect_ratio",
      type: "enum",
      required: false,
      defaultValue: "adaptive",
      enumValues: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      description: "Frame shape. Adaptive follows the references.",
    },
    {
      name: "reference_image_urls",
      type: "array",
      required: false,
      max: 9,
      description: "Subject and style references, addressed in order as Image1, Image2, …",
    },
    {
      name: "reference_video_urls",
      type: "array",
      required: false,
      max: 3,
      description: "Motion and camera references, 2-15s each, addressed as Video1, …",
    },
    {
      name: "reference_audio_urls",
      type: "array",
      required: false,
      max: 3,
      description: "Voice references, 2-15s each, addressed as Audio1, … Requires at least one image or video.",
    },
  ],
  capabilities: { ...H3_CAPABILITIES, supportsReferenceImages: true, maxReferenceImages: 9 },
  pricing: H3_PRICING,
});

// ─── Wan 2.2 A14B (turbo) ──────────────────────────────────────────────
//
// Image to video, optionally toward an end frame (the same image twice makes
// a closed loop). Schema and prices from fal's live API page,
// https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo/api
// (read 2026-10-15): the turbo endpoint takes no frame count, frame rate or
// negative prompt — those belong to the non-turbo endpoint. Prices per video:
// 720p $0.10, 580p $0.075, 480p $0.05.

/** The turbo endpoint's price per video, by resolution (USD). */
export const WAN_22_TURBO_PRICES_USD: Readonly<Record<"480p" | "580p" | "720p", number>> = Object.freeze({
  "480p": 0.05,
  "580p": 0.075,
  "720p": 0.1,
});

/** Wan 2.2 A14B turbo — image to video, with an optional end frame. */
export const wan22TurboImageToVideo: EndpointProfile = defineProfile({
  profileId: "wan/v2.2-a14b/image-to-video/turbo@v1",
  endpointId: "fal-ai/wan/v2.2-a14b/image-to-video/turbo",
  operation: "image-to-video",
  contractVersion: "v1",
  parameterSchema: [
    { name: "image_url", type: "string", required: true, description: "Opening frame." },
    { name: "prompt", type: "string", required: true, description: "What moves, and how." },
    {
      name: "end_image_url",
      type: "string",
      required: false,
      description: "Closing frame. The opening frame again makes a seamless loop.",
    },
    { name: "seed", type: "integer", required: false, description: "Omitted: fal picks one at random." },
    {
      name: "resolution",
      type: "enum",
      required: false,
      defaultValue: "720p",
      enumValues: ["480p", "580p", "720p"],
      description: "Output resolution; it sets the price.",
    },
    {
      name: "aspect_ratio",
      type: "enum",
      required: false,
      defaultValue: "auto",
      enumValues: ["auto", "16:9", "9:16", "1:1"],
      description: "Frame shape; auto follows the input image.",
    },
    { name: "enable_safety_checker", type: "boolean", required: false, defaultValue: false, description: "Input safety check." },
    { name: "enable_output_safety_checker", type: "boolean", required: false, defaultValue: false, description: "Output safety check." },
    { name: "enable_prompt_expansion", type: "boolean", required: false, defaultValue: false, description: "Let an LLM expand the prompt." },
    {
      name: "acceleration",
      type: "enum",
      required: false,
      defaultValue: "regular",
      enumValues: ["none", "regular"],
      description: "Speed-up; none is slower and closer to the full model.",
    },
    {
      name: "video_quality",
      type: "enum",
      required: false,
      defaultValue: "high",
      enumValues: ["low", "medium", "high", "maximum"],
      description: "Encoder quality of the output.",
    },
    {
      name: "video_write_mode",
      type: "enum",
      required: false,
      defaultValue: "balanced",
      enumValues: ["fast", "balanced", "small"],
      description: "Encoder speed/size trade-off.",
    },
  ],
  capabilities: {
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportsSeed: true,
    supportsReferenceImages: true,
    maxReferenceImages: 2,
    supportsNegativePrompt: false,
    defaultImageSize: "16:9",
  },
  // The 720p price: the default, and the most a clip costs. The studio tool
  // reserves the price of the resolution it actually asks for.
  pricing: { unit: "inference", estimatedUnitCost: WAN_22_TURBO_PRICES_USD["720p"], currency: "USD" },
});

// ─── Registry ─────────────────────────────────────────────────────────

const PROFILES: readonly EndpointProfile[] = Object.freeze([
  fluxDevV1,
  fluxFillV1,
  nanoBananaPro,
  flux3MaxTextToVideo,
  flux3MaxImageToVideo,
  minimaxH3TextToVideo,
  minimaxH3ImageToVideo,
  minimaxH3ReferenceToVideo,
  wan22TurboImageToVideo,
  deprecationExample,
]);

const PROFILE_MAP = new Map<string, EndpointProfile>();
for (const p of PROFILES) {
  PROFILE_MAP.set(p.profileId, p);
}
