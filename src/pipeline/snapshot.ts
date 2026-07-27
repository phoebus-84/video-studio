// ---------------------------------------------------------------------------
// Pipeline snapshot — frozen, content-addressed episode contract
// ---------------------------------------------------------------------------

import type { ResolvedPipeline } from "./types.js";
import type { ResolvedSettings } from "../settings/types.js";

// ── Snapshot types ──────────────────────────────────────────────────────────

/** A pinned reference to a source repository at a commit. */
export interface SourceSnapshotRef {
  /** Repository name (human-readable). */
  name: string;
  /** Git remote or filesystem path. */
  url: string;
  /** Pinned commit hash. */
  commit: string;
  /** When the snapshot was taken (ISO-8601). */
  capturedAt: string;
}

/** Provider binding: resolves a capability to a concrete provider. */
export interface ProviderBinding {
  /** The capability requested. */
  capability: string;
  /** The provider selected to fulfill it. */
  provider: string;
  /** Provider-specific configuration. */
  config?: Record<string, unknown>;
}

/** The frozen production contract for a single episode. */
export interface PipelineSnapshot {
  /** Schema identifier. */
  schema: "pipeline-snapshot/v1alpha1";
  /** Content-addressed hash of the snapshot. */
  snapshotId: string;
  /** Episode slug this snapshot belongs to. */
  episodeSlug: string;
  /** When this snapshot was created (ISO-8601). */
  createdAt: string;
  /** Version counter for superseding snapshots. */
  version: number;
  /** The resolved pipeline stages. */
  pipeline: ResolvedPipeline;
  /** The resolved settings for this episode. */
  settings: ResolvedSettings;
  /** Provider bindings for each capability. */
  providerBindings: ProviderBinding[];
  /** Source snapshot references. */
  sources: SourceSnapshotRef[];
  /** Skill identities used by the pipeline. */
  skillIds: string[];
  /** Human-readable label for this snapshot. */
  label?: string;
}

/** Error class for snapshot operations. */
export class SnapshotError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SnapshotError";
  }
}

// ── Content hash ─────────────────────────────────────────────────────────────

/**
 * Compute a deterministic content hash from the snapshot's mutable fields.
 * Uses a stable JSON serialization (sorted keys) and SHA-256.
 */
export async function computeSnapshotHash(
  snapshot: Omit<PipelineSnapshot, "snapshotId">,
): Promise<string> {
  const stable = stableStringify({
    schema: snapshot.schema,
    episodeSlug: snapshot.episodeSlug,
    version: snapshot.version,
    pipeline: snapshot.pipeline,
    settings: snapshot.settings,
    providerBindings: snapshot.providerBindings,
    sources: snapshot.sources,
    skillIds: snapshot.skillIds,
  });

  // Use Web Crypto or Node crypto
  const encoder = new TextEncoder();
  const data = encoder.encode(stable);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable JSON stringification: sorted keys, compact representation.
 */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = (value as Record<string, unknown>)[key];
            return acc;
          },
          {} as Record<string, unknown>,
        );
    }
    return value;
  });
}

// ── Snapshot factory ─────────────────────────────────────────────────────────

export interface SnapshotInput {
  episodeSlug: string;
  pipeline: ResolvedPipeline;
  settings: ResolvedSettings;
  providerBindings: ProviderBinding[];
  sources: SourceSnapshotRef[];
  skillIds: string[];
  label?: string;
  /** Previous snapshot version (0 for first). */
  previousVersion?: number;
}

/**
 * Create a new pipeline snapshot.
 */
export async function createSnapshot(
  input: SnapshotInput,
): Promise<PipelineSnapshot> {
  const version = (input.previousVersion ?? 0) + 1;
  const createdAt = new Date().toISOString();

  const snapshot: Omit<PipelineSnapshot, "snapshotId"> = {
    schema: "pipeline-snapshot/v1alpha1",
    episodeSlug: input.episodeSlug,
    createdAt,
    version,
    pipeline: input.pipeline,
    settings: input.settings,
    providerBindings: input.providerBindings,
    sources: input.sources,
    skillIds: input.skillIds,
    label: input.label,
  };

  const snapshotId = await computeSnapshotHash(snapshot);

  return { ...snapshot, snapshotId };
}

// ── Immutability guard ───────────────────────────────────────────────────────

/**
 * Check whether a snapshot can be superseded.
 * Once a snapshot has been used to create an attempt, it is immutable.
 */
export function isSnapshotMutable(
  snapshot: PipelineSnapshot,
): { mutable: boolean; reason?: string } {
  // Snapshots are immutable once created (version locking).
  // A new version must be created to supersede.
  return {
    mutable: false,
    reason: `Snapshot ${snapshot.snapshotId} (v${snapshot.version}) is immutable. Create a new snapshot to supersede.`,
  };
}

/**
 * Validate that a snapshot is structurally sound.
 */
export function validateSnapshot(
  snapshot: PipelineSnapshot,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!snapshot.snapshotId || snapshot.snapshotId.length === 0) {
    errors.push("Missing snapshotId");
  }
  if (!snapshot.episodeSlug) {
    errors.push("Missing episodeSlug");
  }
  if (!snapshot.pipeline || !snapshot.pipeline.stages) {
    errors.push("Missing or invalid pipeline");
  }
  if (snapshot.pipeline.stages.length === 0) {
    errors.push("Pipeline must have at least one stage");
  }
  if (!snapshot.settings) {
    errors.push("Missing settings");
  }

  return { valid: errors.length === 0, errors };
}

// ── Snapshot store port ──────────────────────────────────────────────────────

/** Interface for persisting and loading snapshots. */
export interface SnapshotStore {
  /** Save a snapshot for an episode. */
  save(snapshot: PipelineSnapshot): Promise<void>;
  /** Load the latest snapshot for an episode. */
  loadLatest(episodeSlug: string): Promise<PipelineSnapshot | null>;
  /** Load a specific version. */
  loadVersion(episodeSlug: string, version: number): Promise<PipelineSnapshot | null>;
  /** List all versions for an episode. */
  listVersions(episodeSlug: string): Promise<number[]>;
}
