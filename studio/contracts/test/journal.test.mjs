import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendJournalEvent,
  buildJournalEvent,
  parseJournal,
  JOURNAL_RELATIVE_PATH,
} from "../src/journal.mjs";

/**
 * The journal had a schema, a gateway route and a Pi tool, and no writer. A
 * complete eleven-scene production with four review gates left the file at
 * zero bytes, and `vpr approve` printed "Stage approved" while recording
 * nothing.
 */
describe("episode journal", () => {
  const ref = { channel: "video-storici", series: "roma-pills", episode: "giulio-cesare" };
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "journal-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const read = async () =>
    parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));

  it("stamps an id and a time", () => {
    const event = buildJournalEvent({ type: "stage-started", actor: "runtime", episode: ref });
    assert.match(event.eventId, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(event.at)));
    assert.deepEqual(event.episode, ref);
  });

  it("keeps the time it is given, for an event that already happened", () => {
    const at = "2026-08-23T00:57:00.000Z";
    const event = buildJournalEvent({ type: "stage-completed", actor: "runtime", episode: ref, at });
    assert.equal(event.at, at);
  });

  it("refuses a type or an actor the schema does not name", () => {
    assert.throws(
      () => buildJournalEvent({ type: "stage-vibed", actor: "runtime", episode: ref }),
      /Unknown journal event type/,
    );
    assert.throws(
      () => buildJournalEvent({ type: "stage-started", actor: "wizard", episode: ref }),
      /Unknown journal actor/,
    );
  });

  it("refuses an event that does not say which episode it is about", () => {
    assert.throws(
      () => buildJournalEvent({
        type: "stage-started", actor: "runtime", episode: { channel: "c", series: "s" },
      }),
      /must name its channel, series and episode/,
    );
  });

  it("writes one line per event, in the order they happened", async () => {
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: ref, stageId: "narration" });
    await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: ref, stageId: "narration" });

    const events = await read();
    assert.deepEqual(events.map((e) => e.type), ["stage-started", "stage-completed"]);
    assert.ok(events.every((e) => e.stageId === "narration"));
  });

  it("creates the journal directory when the episode has none", async () => {
    const event = await appendJournalEvent(dir, { type: "approval-granted", actor: "human", episode: ref });
    assert.notEqual(event, null);
    assert.equal((await read()).length, 1);
  });

  it("keeps every record when many are written at once", async () => {
    // Appending one whole line at a time is what lets concurrent writers
    // interleave records instead of corrupting each other.
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        appendJournalEvent(dir, {
          type: "artifact-written", actor: "pi", episode: ref, detail: { index: i },
        })),
    );
    assert.equal((await read()).length, 40);
  });

  it("reports rather than throws when the event is malformed", async () => {
    // A stage that ran must not be reported as failed because its bookkeeping
    // could not be written.
    assert.equal(
      await appendJournalEvent(dir, { type: "nonsense", actor: "pi", episode: ref }),
      null,
    );
  });

  it("reports rather than throws when the journal cannot be written", async () => {
    const blocked = path.join(dir, "not-a-directory");
    await writeFile(blocked, "");
    assert.equal(
      await appendJournalEvent(blocked, { type: "stage-started", actor: "runtime", episode: ref }),
      null,
    );
  });

  it("skips a corrupt record and keeps the rest", async () => {
    await mkdir(path.join(dir, "journal"), { recursive: true });
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: ref });
    await writeFile(path.join(dir, JOURNAL_RELATIVE_PATH), "not-json\n", { flag: "a" });
    await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: ref });

    assert.deepEqual((await read()).map((e) => e.type), ["stage-started", "stage-completed"]);
  });

  it("filters by type", () => {
    const contents = [
      JSON.stringify({ type: "stage-started" }),
      JSON.stringify({ type: "approval-granted" }),
      JSON.stringify({ type: "stage-started" }),
    ].join("\n");
    assert.equal(parseJournal(contents, { type: "stage-started" }).length, 2);
  });

  it("limits to the most recent, not the oldest", () => {
    const contents = [1, 2, 3, 4].map((n) => JSON.stringify({ type: "stage-started", n })).join("\n");
    assert.deepEqual(parseJournal(contents, { limit: 2 }).map((e) => e.n), [3, 4]);
  });

  it("reads an empty journal as no events", () => {
    assert.deepEqual(parseJournal(""), []);
    assert.deepEqual(parseJournal("\n\n"), []);
  });
});
