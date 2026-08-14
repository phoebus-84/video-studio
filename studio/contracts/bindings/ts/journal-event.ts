/**
 * TypeScript bindings generated from journal-event.schema.json
 * Schema: https://video.studio/schemas/v1alpha1/journal-event.schema.json
 * Auto-generated — do not edit directly.
 */

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export type Actor = "pi" | "gateway" | "runtime" | "human" | "system";

export type EventType = "stage-leased" | "stage-started" | "stage-completed" | "stage-failed" | "attempt-recorded" | "approval-granted" | "approval-requested" | "comment-added" | "artifact-written" | "staleness-marked" | "supersession-recorded" | "deliverable-current-changed" | "episode.created" | "episode.status_changed" | "stage.started" | "stage.completed" | "stage.failed" | "artifact.created" | "artifact.updated" | "budget.updated" | "review.created" | "review.resolved" | "settings.changed" | "snapshot.created";

export type EventData = Record<string, unknown>;

export interface JournalEvent {
  apiVersion: "studio.video/v1alpha1";
  kind: "JournalEvent";
  id: string;
  episodeRef: EpisodeRef;
  at: string;
  actor: Actor;
  "type": EventType;
  data: EventData;
  /** Optional correlation ID linking causally related events. */
  correlationId?: string;
  /** Optional causation ID — the event that directly caused this one. */
  causationId?: string;
}
