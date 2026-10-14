// Type declarations for the episode journal contract.
// Kept alongside journal.mjs so TypeScript consumers get the same contract the
// runtime and gateway rely on at runtime.

export type JournalActor = "pi" | "gateway" | "runtime" | "human" | "system";

export type JournalEventType =
  | "stage-leased"
  | "stage-started"
  | "stage-completed"
  | "stage-failed"
  | "stage-retry-granted"
  | "attempt-recorded"
  | "approval-granted"
  | "approval-requested"
  | "approval-rejected"
  | "comment-added"
  | "artifact-written"
  | "staleness-marked"
  | "take-selected"
  | "spend-reserved"
  | "spend-settled"
  | "spend-released"
  | "supersession-recorded"
  | "deliverable-current-changed";

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface JournalEvent {
  apiVersion: "studio.video/v1alpha1";
  kind: "JournalEvent";
  /** `evt_` followed by a 26-character Crockford base32 ULID. */
  id: string;
  episodeRef: EpisodeRef;
  at: string;
  actor: JournalActor;
  type: JournalEventType;
  data: Record<string, unknown>;
}

export interface JournalEventInput {
  type: JournalEventType;
  actor: JournalActor;
  episode: EpisodeRef;
  stageId?: string;
  data?: Record<string, unknown>;
  /** Defaults to now. Supply only to record an event that already happened. */
  at?: string;
}

export declare const JOURNAL_ACTORS: readonly JournalActor[];
export declare const JOURNAL_EVENTS: readonly JournalEventType[];
export declare const JOURNAL_RELATIVE_PATH: string;

export declare function ulid(now?: number): string;

export declare function buildJournalEvent(input: JournalEventInput): JournalEvent;

/**
 * Returns the event that was written, or null when the filesystem refused it.
 *
 * Throws when `input` is malformed — that is a caller bug, not a failed write.
 */
export declare function appendJournalEvent(
  episodeDir: string,
  input: JournalEventInput,
): Promise<JournalEvent | null>;

export declare function parseJournal(
  contents: string,
  options?: { type?: JournalEventType; limit?: number; strict?: boolean },
): JournalEvent[];
