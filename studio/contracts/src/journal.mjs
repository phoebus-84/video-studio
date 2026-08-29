// ---------------------------------------------------------------------------
// Episode journal
// ---------------------------------------------------------------------------
// `journal/events.jsonl` is the append-only record of what happened to an
// episode: which stages ran, which failed, what was approved and by whom.
// ADR-0028 puts the contract here, and there is a schema for it
// (schemas/v1alpha1/journal-event.schema.json), a gateway route that serves it
// and a Pi tool that reads it.
//
// Nothing ever wrote to it. The file is created empty when the workspace is
// authored and stays that way: a complete eleven-scene production with four
// review gates left zero bytes behind. `vpr approve` printed "Stage approved"
// and recorded nothing. The reader did not help either — it looked in
// `reviews/` for loose `.json` files and never opened the journal at all.
//
// This is the writer. Appending is the only mutation: a journal that can be
// rewritten is not a record of anything.
// ---------------------------------------------------------------------------

import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Who caused an event. Mirrors the Actor enum in the schema. */
export const JOURNAL_ACTORS = Object.freeze([
  "pi", "gateway", "runtime", "human", "system",
]);

/**
 * Event types this project writes.
 *
 * The schema's enum is broader — it also carries a dotted set kept for older
 * records. New events use the hyphenated names.
 */
export const JOURNAL_EVENTS = Object.freeze([
  "stage-leased",
  "stage-started",
  "stage-completed",
  "stage-failed",
  "attempt-recorded",
  "approval-granted",
  "approval-requested",
  "comment-added",
  "artifact-written",
  "staleness-marked",
  "supersession-recorded",
  "deliverable-current-changed",
]);

/** Where an episode's journal lives, relative to the episode directory. */
export const JOURNAL_RELATIVE_PATH = path.join("journal", "events.jsonl");

/**
 * Shape one event, without writing it.
 *
 * Separated from the append so callers can validate or batch, and so the shape
 * is testable without a filesystem.
 */
export function buildJournalEvent({
  type,
  actor,
  episode,
  stageId,
  detail,
  at,
}) {
  if (!JOURNAL_EVENTS.includes(type)) {
    throw new Error(`Unknown journal event type: ${type}`);
  }
  if (!JOURNAL_ACTORS.includes(actor)) {
    throw new Error(`Unknown journal actor: ${actor}`);
  }
  if (!episode?.channel || !episode?.series || !episode?.episode) {
    throw new Error("A journal event must name its channel, series and episode");
  }

  const event = {
    eventId: randomUUID(),
    type,
    actor,
    at: at ?? new Date().toISOString(),
    episode: {
      channel: episode.channel,
      series: episode.series,
      episode: episode.episode,
    },
  };
  if (stageId) event.stageId = stageId;
  if (detail !== undefined) event.detail = detail;
  return event;
}

/**
 * Append one event to an episode's journal.
 *
 * A single `appendFile` of one line: concurrent writers interleave whole
 * records rather than corrupting each other, which is the property that makes
 * JSONL worth using here.
 *
 * Never throws for a caller's benefit — a stage that ran must not be reported
 * as failed because its bookkeeping could not be written. The return value says
 * whether the record landed.
 */
export async function appendJournalEvent(episodeDir, input) {
  let event;
  try {
    event = buildJournalEvent(input);
  } catch {
    return null;
  }
  try {
    const target = path.join(episodeDir, JOURNAL_RELATIVE_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(event)}\n`, "utf-8");
    return event;
  } catch {
    return null;
  }
}

/**
 * Read an episode's journal, newest last.
 *
 * A malformed line is skipped rather than failing the read: the journal is
 * append-only evidence, and one bad record must not hide the rest.
 */
export function parseJournal(contents, { type, limit } = {}) {
  const events = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const event = JSON.parse(trimmed);
      if (type && event.type !== type) continue;
      events.push(event);
    } catch { /* skip a corrupt record, keep the rest */ }
  }
  // The most recent events are the interesting ones, and they are at the end.
  return typeof limit === "number" && limit >= 0 ? events.slice(-limit) : events;
}
