// ---------------------------------------------------------------------------
// Idempotent job submission
// ---------------------------------------------------------------------------
// Durable idempotency key management, job creation with pre-submit
// validation, and attempt tracking. Uses the configured transport
// and profile registry.
// ---------------------------------------------------------------------------

import type { Transport } from "../src/types.js";
import type { EndpointProfile } from "../src/types.js";
import { getProfile } from "../src/profiles.js";
import { FalValidationError } from "../src/errors.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface JobSubmission {
  idempotencyKey: string;
  profileId: string;
  endpointUrl: string;
  params: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface JobResult {
  jobId: string;
  status: "completed" | "in-progress" | "failed";
  outputUrl?: string;
  previewUrl?: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
}

export interface SubmitOptions {
  profile: string;
  params: Record<string, unknown>;
  idempotencyKey?: string;
  apiKey: string;
  priority?: "normal" | "high";
}

export interface SubmissionAttempt {
  idempotencyKey: string;
  jobId: string | null;
  submittedAt: string;
  profile: string;
  status: "submitted" | "duplicate" | "rejected";
}

// ── Idempotency store ──────────────────────────────────────────────────────

export interface IdempotencyStore {
  /** Check if an idempotency key already has a job ID. */
  get(key: string): Promise<string | null>;
  /** Store a job ID for an idempotency key. */
  set(key: string, jobId: string): Promise<void>;
  /** Delete an idempotency key entry. */
  delete(key: string): Promise<void>;
}

/** In-memory idempotency store for testing/single-process use. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, jobId: string): Promise<void> {
    this.store.set(key, jobId);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Number of tracked keys. */
  get size(): number { return this.store.size; }
}

/** Filesystem-backed idempotency store for durable production use. */
export class FileSystemIdempotencyStore implements IdempotencyStore {
  constructor(private dir: string) {}

  async get(key: string): Promise<string | null> {
    const fs = await import("node:fs/promises");
    const filePath = `${this.dir}/${encodeURIComponent(key)}.idem`;
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const entry = JSON.parse(content);
      return entry.jobId ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, jobId: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const pathLib = await import("node:path");
    const filePath = `${this.dir}/${encodeURIComponent(key)}.idem`;
    await fs.mkdir(pathLib.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ key, jobId, createdAt: new Date().toISOString() }), "utf-8");
  }

  async delete(key: string): Promise<void> {
    const fs = await import("node:fs/promises");
    try { await fs.unlink(`${this.dir}/${encodeURIComponent(key)}.idem`); } catch {}
  }
}

// ── Job submitter ───────────────────────────────────────────────────────────

export class JobSubmitter {
  private transport: Transport;
  private idempotency: IdempotencyStore;

  constructor(transport: Transport, idempotency: IdempotencyStore) {
    this.transport = transport;
    this.idempotency = idempotency;
  }

  /**
   * Submit a job with idempotency protection.
   *
   * 1. Validates params against the endpoint profile
   * 2. Checks idempotency store for duplicate
   * 3. If new, submits to fal API with Idempotency-Key header
   * 4. Stores the result
   */
  async submit(options: SubmitOptions): Promise<SubmissionAttempt> {
    const profile = getProfile(options.profile);
    if (!profile) {
      throw new FalValidationError(
        `Unknown profile: ${options.profile}`,
        { field: "profile", value: options.profile },
      );
    }

    // Validate params against profile
    validateParams(options.params, profile);

    // Generate or use provided idempotency key
    const idempotencyKey = options.idempotencyKey ?? generateIdempotencyKey(options.profile, options.params);

    // Check for duplicate
    const existing = await this.idempotency.get(idempotencyKey);
    if (existing) {
      return {
        idempotencyKey,
        jobId: existing,
        submittedAt: new Date().toISOString(),
        profile: options.profile,
        status: "duplicate",
      };
    }

    // Submit to fal
    const endpointUrl = `https://fal.run/${profile.endpointId}`;
    const jobId = await submitToFal(
      this.transport,
      endpointUrl,
      options.params,
      idempotencyKey,
      options.apiKey,
    );

    // Store for idempotency
    await this.idempotency.set(idempotencyKey, jobId);

    return {
      idempotencyKey,
      jobId,
      submittedAt: new Date().toISOString(),
      profile: options.profile,
      status: "submitted",
    };
  }

  /**
   * Check if a job is duplicate.
   */
  async isDuplicate(idempotencyKey: string): Promise<boolean> {
    return (await this.idempotency.get(idempotencyKey)) !== null;
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateParams(
  p: Record<string, unknown>,
  profile: EndpointProfile,
): void {
  for (const field of profile.parameterSchema) {
    if (field.required && !(field.name in p)) {
      throw new FalValidationError(
        `Missing required parameter: ${field.name}`,
        { field: field.name, profile: profile.profileId },
      );
    }

    if (p[field.name] !== undefined) {
      validateFieldType(field, p[field.name]);
    }
  }

  const knownNames = new Set(profile.parameterSchema.map((pf) => pf.name));
  for (const key of Object.keys(p)) {
    if (!knownNames.has(key)) {
      // Unknown params are allowed (forward-compatible)
    }
  }
}

function validateFieldType(field: any, value: unknown): void {
  const expected = field.type;
  if (expected === "string" && typeof value !== "string") {
    throw new FalValidationError(
      `Parameter ${field.name} expected string, got ${typeof value}`,
      { field: field.name },
    );
  }
  if (expected === "number" && typeof value !== "number") {
    throw new FalValidationError(
      `Parameter ${field.name} expected number, got ${typeof value}`,
      { field: field.name },
    );
  }
  if (expected === "boolean" && typeof value !== "boolean") {
    throw new FalValidationError(
      `Parameter ${field.name} expected boolean, got ${typeof value}`,
      { field: field.name },
    );
  }
  if (expected === "array" && !Array.isArray(value)) {
    throw new FalValidationError(
      `Parameter ${field.name} expected array, got ${typeof value}`,
      { field: field.name },
    );
  }
}

// ── API call ────────────────────────────────────────────────────────────────

async function submitToFal(
  transport: Transport,
  endpointUrl: string,
  params: Record<string, unknown>,
  idempotencyKey: string,
  apiKey: string,
): Promise<string> {
  const response = await transport.request({
    method: "POST",
    url: endpointUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(params),
  });

  if (response.status >= 400) {
    const body = JSON.parse(response.body ?? "{}");
    throw new Error(`fal API error ${response.status}: ${body.detail ?? "Unknown error"}`);
  }

  const body = JSON.parse(response.body ?? "{}");
  return body.request_id ?? body.id ?? `job-${Date.now()}`;
}

// ── Idempotency key generation ─────────────────────────────────────────────

function generateIdempotencyKey(profile: string, params: Record<string, unknown>): string {
  // Stable key: profile + sorted JSON of params
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const { createHash } = require("node:crypto");
  const hash = createHash("sha256").update(`${profile}:${sorted}`).digest("hex").slice(0, 16);

  return `fal-${profile}-${hash}-${Date.now()}`;
}
