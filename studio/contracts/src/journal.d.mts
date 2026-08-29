// Type declarations for the episode journal contract.
// Kept alongside journal.mjs so TypeScript consumers get the same contract the
// runtime and gateway rely on at runtime.

export type JournalActor = "pi" | "gateway" | "runtime" | "human" | "system";

export type JournalEventType =
  | "stage-leased"
  | "stage-started"
  | "stage-completed"
  | "stage-failed"
  | "attempt-recorded"
  | "approval-granted"
  | "approval-requested"
  | "comment-added"
  | "artifact-written"
  | "staleness-marked"
  | "supersession-recorded"
  | "deliverable-current-changed";

export interface JournalEpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface JournalEventInput {
  type: JournalEventType;
  actor: JournalActor;
  episode: JournalEpisodeRef;
  stageId?: string;
  detail?: unknown;
  /** Defaults to now. Supply only to record an event that already happened. */
  at?: string;
}

export interface JournalEvent {
  eventId: string;
  type: JournalEventType;
  actor: JournalActor;
  at: string;
  episode: JournalEpisodeRef;
  stageId?: string;
  detail?: unknown;
}

export declare const JOURNAL_ACTORS: readonly JournalActor[];
export declare const JOURNAL_EVENTS: readonly JournalEventType[];
export declare const JOURNAL_RELATIVE_PATH: string;

export declare function buildJournalEvent(input: JournalEventInput): JournalEvent;

/** Returns the event that was written, or null when it could not be. */
export declare function appendJournalEvent(
  episodeDir: string,
  input: JournalEventInput,
): Promise<JournalEvent | null>;

export declare function parseJournal(
  contents: string,
  options?: { type?: string; limit?: number },
): JournalEvent[];
