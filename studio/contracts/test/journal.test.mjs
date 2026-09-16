import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendJournalEvent,
  buildJournalEvent,
  parseJournal,
  ulid,
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

  it("produces an event that validates against journal-event.schema.json", async () => {
    // This is the test whose absence caused avg-i1x. The fixtures always
    // conformed; the writer never did, and nothing compared them.
    const { readFileSync } = await import("node:fs");
    const Ajv2020 = (await import("ajv/dist/2020.js")).default;
    const addFormats = (await import("ajv-formats")).default;

    const schema = JSON.parse(
      readFileSync(new URL("../schemas/v1alpha1/journal-event.schema.json", import.meta.url), "utf-8"),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    const validate = ajv.getSchema(`${schema.$id}#/$defs/JournalEvent`);

    const event = buildJournalEvent({
      type: "stage-started",
      actor: "runtime",
      episode: ref,
      data: { stageId: "illustrations", leaseId: "lease-1", attemptNumber: 1 },
    });

    const valid = validate(event);
    assert.equal(valid, true, JSON.stringify(validate.errors));
  });

  it("stamps the envelope the schema requires", () => {
    const event = buildJournalEvent({
      type: "stage-started", actor: "runtime", episode: ref, data: { stageId: "s" },
    });
    assert.equal(event.apiVersion, "studio.video/v1alpha1");
    assert.equal(event.kind, "JournalEvent");
    assert.match(event.id, /^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.deepEqual(event.episodeRef, ref);
    assert.equal(event.data.stageId, "s");
    assert.equal(event.eventId, undefined);
    assert.equal(event.detail, undefined);
    assert.equal(event.episode, undefined);
  });

  it("generates ids that sort by creation time", () => {
    // Explicit timestamps, not three calls in a row: within a single
    // millisecond the time prefix is identical and the random suffix decides
    // the order, so a tight loop would make this assertion flap.
    const ids = [ulid(1_000), ulid(2_000), ulid(3_000)];
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(ulid(1_000).slice(0, 10), ulid(1_000).slice(0, 10));
  });

  it("rejects an event whose data is not an object", () => {
    assert.throws(
      () => buildJournalEvent({ type: "stage-started", actor: "runtime", episode: ref, data: "nope" }),
      /data/,
    );
  });

  it("still rejects an unknown type or actor", () => {
    assert.throws(() => buildJournalEvent({ type: "nope", actor: "runtime", episode: ref, data: {} }), /type/);
    assert.throws(() => buildJournalEvent({ type: "stage-started", actor: "nope", episode: ref, data: {} }), /actor/);
  });

  it("skips a malformed line by default, but surfaces it in strict mode", () => {
    const good = JSON.stringify(buildJournalEvent({
      type: "stage-started", actor: "runtime", episode: ref, data: { stageId: "s" },
    }));
    const contents = `${good}\n{ not json\n`;

    // The narrative route must not let one bad record hide the rest.
    assert.equal(parseJournal(contents).length, 1);
    // Execution state derived from the log must not silently lose an attempt.
    assert.throws(() => parseJournal(contents, { strict: true }), /line 2/);
  });

  // --- Restored from the pre-avg-i1x suite, adapted to the new envelope ----
  // (data instead of detail, episodeRef instead of episode, id instead of
  // eventId, stageId inside the payload). "stamps an id and a time" and
  // "refuses a type or an actor the schema does not name" are not restored:
  // they are superseded by "stamps the envelope the schema requires" and
  // "still rejects an unknown type or actor" above.

  it("keeps the time it is given, for an event that already happened", () => {
    const at = "2026-08-23T00:57:00.000Z";
    const event = buildJournalEvent({ type: "stage-completed", actor: "runtime", episode: ref, at });
    assert.equal(event.at, at);
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
    assert.ok(events.every((e) => e.data.stageId === "narration"));
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
          type: "artifact-written", actor: "pi", episode: ref, data: { index: i },
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
