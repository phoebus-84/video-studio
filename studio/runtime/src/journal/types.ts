// ---------------------------------------------------------------------------
// Event journal types
// ---------------------------------------------------------------------------

/** Monotonic sequence number (per episode). */
export type EventSequence = number;

/** Stable cursor for resuming reads. */
export interface EventCursor {
  /** Last sequence number consumed. */
  sequence: EventSequence;
  /** Content hash of the journal line at that sequence. */
  hash: string;
}

/** Unique correlation ID that links related events. */
export type CorrelationId = string;

/** Unique causation ID (the event that caused this one). */
export type CausationId = string;

// ── Base event ──────────────────────────────────────────────────────────────

export interface BaseJournalEvent {
  /** Monotonic per-episode sequence. */
  sequence: EventSequence;
  /** Event type discriminator. */
  type: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Episode slug this event belongs to. */
  episodeSlug: string;
  /** Correlation ID (links causally related events). */
  correlationId?: CorrelationId;
  /** Causation ID (the event that directly caused this one). */
  causationId?: CausationId;
}

// ── Episode events ─────────────────────────────────────────────────────────

export interface EpisodeCreatedEvent extends BaseJournalEvent {
  type: "episode.created";
  payload: {
    channelSlug: string;
    seriesSlug: string;
    title: string;
  };
}

export interface EpisodeStatusChangedEvent extends BaseJournalEvent {
  type: "episode.status_changed";
  payload: {
    previousStatus: string;
    newStatus: string;
    reason?: string;
  };
}

// ── Stage events ───────────────────────────────────────────────────────────

export interface StageStartedEvent extends BaseJournalEvent {
  type: "stage.started";
  payload: {
    stageId: string;
    attemptNumber: number;
    leaseId: string;
  };
}

export interface StageCompletedEvent extends BaseJournalEvent {
  type: "stage.completed";
  payload: {
    stageId: string;
    attemptNumber: number;
    leaseId: string;
    artifactRefs: string[];
  };
}

export interface StageFailedEvent extends BaseJournalEvent {
  type: "stage.failed";
  payload: {
    stageId: string;
    attemptNumber: number;
    leaseId: string;
    error: string;
    retryable: boolean;
  };
}

// ── Artifact events ────────────────────────────────────────────────────────

export interface ArtifactCreatedEvent extends BaseJournalEvent {
  type: "artifact.created";
  payload: {
    path: string;
    revisionId: string;
    size: number;
  };
}

export interface ArtifactUpdatedEvent extends BaseJournalEvent {
  type: "artifact.updated";
  payload: {
    path: string;
    previousRevisionId: string;
    newRevisionId: string;
    author: string;
  };
}

// ── Budget events ──────────────────────────────────────────────────────────

export interface BudgetUpdatedEvent extends BaseJournalEvent {
  type: "budget.updated";
  payload: {
    spent: number;
    limit: number;
    stageId?: string;
  };
}

// ── Review events ──────────────────────────────────────────────────────────

export interface ReviewCreatedEvent extends BaseJournalEvent {
  type: "review.created";
  payload: {
    reviewId: string;
    threadId: string;
    author: string;
    location: string; // e.g. "stage:script", "artifact:brief.md"
    message: string;
  };
}

export interface ReviewResolvedEvent extends BaseJournalEvent {
  type: "review.resolved";
  payload: {
    reviewId: string;
    resolvedBy: string;
    resolution: string;
  };
}

// ── Settings events ────────────────────────────────────────────────────────

export interface SettingsChangedEvent extends BaseJournalEvent {
  type: "settings.changed";
  payload: {
    changes: Record<string, { from: unknown; to: unknown }>;
  };
}

// ── Snapshot events ────────────────────────────────────────────────────────

export interface SnapshotCreatedEvent extends BaseJournalEvent {
  type: "snapshot.created";
  payload: {
    snapshotId: string;
    version: number;
  };
}

// ── Union type ─────────────────────────────────────────────────────────────

export type JournalEvent =
  | EpisodeCreatedEvent
  | EpisodeStatusChangedEvent
  | StageStartedEvent
  | StageCompletedEvent
  | StageFailedEvent
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | BudgetUpdatedEvent
  | ReviewCreatedEvent
  | ReviewResolvedEvent
  | SettingsChangedEvent
  | SnapshotCreatedEvent;

/** Type guard: check if an object is a valid journal event. */
export function isJournalEvent(obj: unknown): obj is JournalEvent {
  if (typeof obj !== "object" || obj === null) return false;
  const event = obj as Record<string, unknown>;
  return (
    typeof event.type === "string" &&
    typeof event.sequence === "number" &&
    typeof event.timestamp === "string" &&
    typeof event.episodeSlug === "string"
  );
}
