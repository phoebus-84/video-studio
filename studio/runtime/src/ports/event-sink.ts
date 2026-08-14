// ---------------------------------------------------------------------------
// Event sink port
//
// The journal is append-only.  This port decouples the runtime's event
// emission from the concrete storage mechanism (JSONL file, in-memory
// buffer, or future streaming sink).
// ---------------------------------------------------------------------------

import type { Result } from "../result.js";

/** Error shape for event-sink failures. */
export interface EventSinkError {
  code: string;
  message: string;
}

/**
 * Every event written to the journal carries at least these fields.
 * Callers may extend with domain-specific keys.
 */
export interface BaseEvent {
  /** ISO-8601 timestamp set by the sink at append time. */
  timestamp: string;
  /** Unique event identifier set by the sink. */
  eventId: string;
  /** Discriminator for consumers (e.g. "stage.attempted", "approval.paused"). */
  type: string;
}

export type Event = BaseEvent & Record<string, unknown>;

export interface EventSink {
  /**
   * Append a single event.
   *
   * The sink assigns `timestamp` and `eventId`; callers provide the
   * `type` and any additional domain fields.
   */
  append(
    event: Omit<Event, "timestamp" | "eventId">,
  ): Promise<Result<Event, EventSinkError>>;

  /**
   * Append multiple events atomically (best-effort).
   * Implementations that cannot guarantee atomicity SHOULD document the
   * partial-write behaviour.
   */
  appendAll(
    events: Omit<Event, "timestamp" | "eventId">[],
  ): Promise<Result<Event[], EventSinkError>>;
}
