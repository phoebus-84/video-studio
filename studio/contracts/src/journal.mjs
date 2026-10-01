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
import { randomBytes } from "node:crypto";
import path from "node:path";

/** Crockford base32 — the schema's id pattern is exactly this alphabet. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A ULID: 48 bits of timestamp then 80 bits of randomness, Crockford base32.
 *
 * Written here rather than taken as a dependency: it is twenty lines, and
 * @studio/contracts is imported at runtime by packages that carry no ajv and
 * should not grow a dependency tree for an id.
 *
 * Time-ordered, so a journal sorts by id as well as by position — which is what
 * makes an id useful for ordering rather than only for identity.
 */
export function ulid(now = Date.now()) {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let random = "";
  for (let i = 0; i < 16; i++) {
    random += CROCKFORD[bytes[i] % 32];
  }
  return time + random;
}

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
  "approval-rejected",
  "comment-added",
  "artifact-written",
  "staleness-marked",
  "take-selected",
  "supersession-recorded",
  "deliverable-current-changed",
]);

/**
 * The fields each execution event's payload must carry, mirroring the
 * `required` lists in schemas/v1alpha1/execution-event.schema.json.
 *
 * This exists because nothing else enforces that schema. It is `$ref`'d from
 * nowhere, and journal-event.schema.json's EventData is
 * `additionalProperties: true` with no per-type branch — so the only things
 * ever checked against it are four hand-authored fixtures, which were written
 * from the schema and therefore always pass. That is precisely the failure
 * this package spent a branch ending: the fixtures conformed and the writer
 * never did. The gateway's `{ stageId, durationMs }` stage-started sailed
 * through every check in this file and then made replay throw for the whole
 * journal.
 *
 * Presence only, and deliberately: `@studio/contracts` carries ajv as a
 * devDependency, and the gateway imports this module at runtime without it,
 * so full schema validation cannot live here. What presence buys is the
 * property replay depends on — every execution event names its stage, its
 * lease and its attempt, so a terminal event can always be placed in the
 * history. A wrong-TYPED field still gets through; that is the boundary, and
 * execution-state.mjs says so where it trusts these payloads.
 */
const REQUIRED_EXECUTION_FIELDS = Object.freeze({
  "stage-leased": ["stageId", "leaseId", "attemptNumber", "ttlMs", "expiresAt", "holder"],
  "stage-started": ["stageId", "leaseId", "attemptNumber"],
  "stage-completed": ["stageId", "leaseId", "attemptNumber", "outputs"],
  "stage-failed": ["stageId", "leaseId", "attemptNumber", "error"],
  "attempt-recorded": ["stageId", "leaseId", "attemptNumber", "outcome"],
  // Not replayed by execution state, but a selection that names no attempt
  // or no hashes cannot be checked against the candidate it claims to pick
  // (avg-qr4.6) — the same reason the five above must name their lease.
  "take-selected": ["stageId", "decision", "origin", "binding"],
});

/** Where an episode's journal lives, relative to the episode directory. */
export const JOURNAL_RELATIVE_PATH = path.join("journal", "events.jsonl");

/**
 * Shape one event, without writing it.
 *
 * Separated from the append so callers can validate or batch, and so the shape
 * is testable without a filesystem.
 */

/** The envelope every schema in this package stamps on a top-level document. */
const API_VERSION = "studio.video/v1alpha1";

export function buildJournalEvent({ type, actor, episode, stageId, data, at }) {
  if (!JOURNAL_EVENTS.includes(type)) {
    throw new Error(`Unknown journal event type: ${type}`);
  }
  if (!JOURNAL_ACTORS.includes(actor)) {
    throw new Error(`Unknown journal actor: ${actor}`);
  }
  if (!episode?.channel || !episode?.series || !episode?.episode) {
    throw new Error("A journal event must name its channel, series and episode");
  }
  if (data !== undefined && (typeof data !== "object" || data === null || Array.isArray(data))) {
    throw new Error("A journal event's data must be an object");
  }

  // stageId used to sit at the top level, which additionalProperties: false
  // rejects. It belongs in the payload, where every reader now looks for it.
  const payload = { ...(data ?? {}) };
  if (stageId !== undefined && payload.stageId === undefined) payload.stageId = stageId;

  // Checked after the stageId fold-in, so a caller that passes stageId at the
  // top level (as most still do) satisfies the requirement the same way one
  // that puts it in `data` does.
  const required = REQUIRED_EXECUTION_FIELDS[type];
  if (required) {
    const missing = required.filter((field) => payload[field] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `A ${type} event must carry ${missing.join(", ")} in its data: ` +
        `execution state is replayed by matching events to the attempt their ` +
        `leaseId names, and an event missing that cannot be placed in the history`,
      );
    }
  }

  return {
    apiVersion: API_VERSION,
    kind: "JournalEvent",
    id: `evt_${ulid()}`,
    episodeRef: {
      channel: episode.channel,
      series: episode.series,
      episode: episode.episode,
    },
    at: at ?? new Date().toISOString(),
    actor,
    type,
    data: payload,
  };
}

/**
 * Append one event to an episode's journal.
 *
 * A single `appendFile` of one line: concurrent writers interleave whole
 * records rather than corrupting each other, which is the property that makes
 * JSONL worth using here.
 *
 * Two different faults, deliberately reported two different ways.
 *
 * A malformed event THROWS. The caller built something invalid — an unknown
 * type or actor, a missing episode field, an execution event without the ids
 * replay needs — and that is a code bug: deterministic, identical on retry,
 * and fixable only by changing the caller. Reporting it as a failed write
 * would dress a bug as a full disk and invite retrying it forever.
 *
 * A failed WRITE returns null. This is the promise that has always been here
 * and still holds: a stage that ran must not be reported as failed because its
 * bookkeeping could not be written. The return value says whether the record
 * landed, and every execution caller checks it.
 */
export async function appendJournalEvent(episodeDir, input) {
  // Not wrapped: see above. A malformed event is the caller's bug to fix.
  const event = buildJournalEvent(input);
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
export function parseJournal(contents, { type, limit, strict = false } = {}) {
  const events = [];
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Lenient by default: the journal is a narrative, and one bad record must
      // not hide the rest. Strict for callers deriving state from it, where a
      // skipped line is a silently forgotten attempt rather than a missing note.
      if (strict) {
        throw new Error(`Malformed journal record at line ${i + 1}`);
      }
      continue;
    }
    if (type && event.type !== type) continue;
    events.push(event);
  }
  return typeof limit === "number" && limit >= 0 ? events.slice(-limit) : events;
}
