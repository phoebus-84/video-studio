// ---------------------------------------------------------------------------
// Journal projections — rebuild current state from event stream
// ---------------------------------------------------------------------------

import type {
  JournalEvent,
} from "./types.js";

// ── Projection state types ──────────────────────────────────────────────────

export interface StageState {
  stageId: string;
  status: "pending" | "running" | "completed" | "failed";
  currentAttempt: number;
  leaseId: string | null;
  artifactRefs: string[];
  lastError: string | null;
}

export interface ArtifactState {
  path: string;
  currentRevisionId: string;
  totalUpdates: number;
}

export interface BudgetState {
  spent: number;
  limit: number;
}

export interface ReviewState {
  reviewId: string;
  threadId: string;
  author: string;
  location: string;
  message: string;
  resolved: boolean;
  resolvedBy?: string;
  resolution?: string;
}

export interface EpisodeProjection {
  episodeSlug: string;
  status: string;
  stages: Map<string, StageState>;
  artifacts: Map<string, ArtifactState>;
  budget: BudgetState;
  reviews: Map<string, ReviewState>;
  currentSnapshotId: string | null;
  totalEvents: number;
}

// ── Projection builder ──────────────────────────────────────────────────────

/**
 * Build a complete projection from an ordered list of events.
 * Events should be in sequence order (oldest first).
 */
export function buildProjection(events: JournalEvent[]): EpisodeProjection {
  const projection: EpisodeProjection = {
    episodeSlug: events[0]?.episodeSlug ?? "",
    status: "idle",
    stages: new Map(),
    artifacts: new Map(),
    budget: { spent: 0, limit: 0 },
    reviews: new Map(),
    currentSnapshotId: null,
    totalEvents: events.length,
  };

  for (const event of events) {
    applyEvent(projection, event);
  }

  return projection;
}

/**
 * Apply a single event to a projection.
 */
export function applyEvent(projection: EpisodeProjection, event: JournalEvent): void {
  projection.episodeSlug = event.episodeSlug;

  switch (event.type) {
    case "episode.created":
      projection.status = "created";
      break;

    case "episode.status_changed":
      projection.status = event.payload.newStatus;
      break;

    case "stage.started":
      projection.stages.set(event.payload.stageId, {
        stageId: event.payload.stageId,
        status: "running",
        currentAttempt: event.payload.attemptNumber,
        leaseId: event.payload.leaseId,
        artifactRefs: [],
        lastError: null,
      });
      break;

    case "stage.completed":
      projection.stages.set(event.payload.stageId, {
        stageId: event.payload.stageId,
        status: "completed",
        currentAttempt: event.payload.attemptNumber,
        leaseId: null,
        artifactRefs: event.payload.artifactRefs,
        lastError: null,
      });
      break;

    case "stage.failed":
      projection.stages.set(event.payload.stageId, {
        stageId: event.payload.stageId,
        status: "failed",
        currentAttempt: event.payload.attemptNumber,
        leaseId: null,
        artifactRefs: [],
        lastError: event.payload.error,
      });
      break;

    case "artifact.created":
      projection.artifacts.set(event.payload.path, {
        path: event.payload.path,
        currentRevisionId: event.payload.revisionId,
        totalUpdates: 1,
      });
      break;

    case "artifact.updated":
      projection.artifacts.set(event.payload.path, {
        path: event.payload.path,
        currentRevisionId: event.payload.newRevisionId,
        totalUpdates:
          (projection.artifacts.get(event.payload.path)?.totalUpdates ?? 0) + 1,
      });
      break;

    case "budget.updated":
      projection.budget = {
        spent: event.payload.spent,
        limit: event.payload.limit,
      };
      break;

    case "review.created":
      projection.reviews.set(event.payload.reviewId, {
        reviewId: event.payload.reviewId,
        threadId: event.payload.threadId,
        author: event.payload.author,
        location: event.payload.location,
        message: event.payload.message,
        resolved: false,
      });
      break;

    case "review.resolved":
      {
        const existing = projection.reviews.get(event.payload.reviewId);
        if (existing) {
          existing.resolved = true;
          existing.resolvedBy = event.payload.resolvedBy;
          existing.resolution = event.payload.resolution;
        }
      }
      break;

    case "snapshot.created":
      projection.currentSnapshotId = event.payload.snapshotId;
      break;

    default:
      // Unknown event types are silently ignored
      break;
  }
}

/**
 * Merge two projections (e.g., replay from cursor into existing state).
 */
export function mergeProjections(
  base: EpisodeProjection,
  delta: EpisodeProjection,
): EpisodeProjection {
  const merged: EpisodeProjection = {
    episodeSlug: delta.episodeSlug || base.episodeSlug,
    status: delta.status !== "idle" ? delta.status : base.status,
    stages: new Map([...base.stages, ...delta.stages]),
    artifacts: new Map([...base.artifacts, ...delta.artifacts]),
    budget: delta.budget.limit > 0 ? delta.budget : base.budget,
    reviews: new Map([...base.reviews, ...delta.reviews]),
    currentSnapshotId: delta.currentSnapshotId ?? base.currentSnapshotId,
    totalEvents: base.totalEvents + delta.totalEvents,
  };
  return merged;
}
