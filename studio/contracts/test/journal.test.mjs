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
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId: "s", leaseId: "L1", attemptNumber: 1 },
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
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId: "s", leaseId: "L1", attemptNumber: 1 },
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
    const event = buildJournalEvent({
      type: "stage-completed", actor: "runtime", episode: ref, at,
      data: { stageId: "s", leaseId: "L1", attemptNumber: 1, outputs: ["artifacts/s.txt"] },
    });
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
    // stageId stays at the top level here on purpose: the required-field check
    // runs after the fold-in, so a caller spelling it this way must satisfy
    // the requirement the same way one putting it in `data` does.
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: ref,
      stageId: "narration", data: { leaseId: "L1", attemptNumber: 1 } });
    await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: ref,
      stageId: "narration", data: { leaseId: "L1", attemptNumber: 1, outputs: ["artifacts/narration/s1.wav"] } });

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

  it("throws when the event is malformed", async () => {
    // Two faults used to return the same null: an event the caller built
    // wrong, and a journal the filesystem would not write. The first is a code
    // bug — deterministic, identical on every retry — and surfacing it as
    // "the write did not land" invites an operator to retry it forever.
    //
    // The never-throw promise below is unchanged, because it was always about
    // the write: a stage that RAN must not be reported failed because its
    // bookkeeping could not be written. A malformed event is not bookkeeping
    // that could not be written; it was never valid.
    await assert.rejects(
      appendJournalEvent(dir, { type: "nonsense", actor: "pi", episode: ref }),
      /Unknown journal event type/,
    );
  });

  it("throws when an execution event is missing the fields replay needs", async () => {
    await assert.rejects(
      appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: ref,
        data: { stageId: "s", leaseId: "L1", attemptNumber: 1 } }),
      /must carry outputs/,
    );
  });

  it("reports rather than throws when the journal cannot be written", async () => {
    const blocked = path.join(dir, "not-a-directory");
    await writeFile(blocked, "");
    assert.equal(
      await appendJournalEvent(blocked, { type: "stage-started", actor: "runtime", episode: ref,
        data: { stageId: "s", leaseId: "L1", attemptNumber: 1 } }),
      null,
    );
  });

  it("skips a corrupt record and keeps the rest", async () => {
    await mkdir(path.join(dir, "journal"), { recursive: true });
    await appendJournalEvent(dir, { type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId: "s", leaseId: "L1", attemptNumber: 1 } });
    await writeFile(path.join(dir, JOURNAL_RELATIVE_PATH), "not-json\n", { flag: "a" });
    await appendJournalEvent(dir, { type: "stage-completed", actor: "runtime", episode: ref,
      data: { stageId: "s", leaseId: "L1", attemptNumber: 1, outputs: ["a"] } });

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

  it("accepts approval-rejected as an event type", () => {
    const e = buildJournalEvent({
      type: "approval-rejected", actor: "runtime",
      episode: { channel: "c", series: "s", episode: "e" }, data: { stageId: "x" },
    });
    assert.equal(e.type, "approval-rejected");
  });
});

/**
 * execution-event.schema.json was `$ref`'d from nowhere, and
 * journal-event.schema.json's EventData is `additionalProperties: true` with
 * no per-type branch — so the schema was enforced only by hand-authored
 * fixtures written from it, which is the same "the fixtures conformed, the
 * writer never did" failure avg-i1x existed to end, one layer down. The
 * gateway's `{ stageId, durationMs }` stage-started passed every check here
 * and then made deriveExecutionState throw for the whole journal.
 *
 * Presence, not types: this module is imported at runtime by packages that
 * carry no ajv, so it cannot run the schema. What it can guarantee is the one
 * property replay depends on — every execution event names its stage, its
 * lease and its attempt.
 */
describe("execution event payloads", () => {
  const ref = { channel: "video-storici", series: "roma-pills", episode: "giulio-cesare" };

  /** A well-formed payload for each of the five execution events. */
  const WELL_FORMED = {
    "stage-leased": {
      stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
      ttlMs: 300000, expiresAt: "2026-09-16T12:05:00.000Z", holder: "runtime/1234",
    },
    "stage-started": { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 },
    "stage-completed": {
      stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
      outputs: ["artifacts/frames/s1.png"],
    },
    "stage-failed": {
      stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
      error: "boom", retryable: true,
    },
    "attempt-recorded": {
      stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
      outcome: "success", outputs: ["artifacts/frames/s1.png"],
    },
  };

  for (const [type, data] of Object.entries(WELL_FORMED)) {
    it(`accepts a well-formed ${type}`, () => {
      const event = buildJournalEvent({ type, actor: "runtime", episode: ref, data });
      assert.equal(event.type, type);
      assert.deepEqual(event.data, data);
    });

    for (const field of Object.keys(data)) {
      // Only the fields the schema marks required: retryable and the optional
      // outputs on attempt-recorded may legitimately be absent.
      const optional = { "stage-failed": ["retryable"], "attempt-recorded": ["outputs"] }[type] ?? [];
      if (optional.includes(field)) continue;

      it(`rejects a ${type} missing ${field}`, () => {
        const { [field]: _dropped, ...rest } = data;
        assert.throws(
          () => buildJournalEvent({ type, actor: "runtime", episode: ref, data: rest }),
          (e) => e.message.includes(type) && e.message.includes(field),
        );
      });
    }
  }

  it("accepts the optional fields being absent", () => {
    const { retryable: _r, ...failed } = WELL_FORMED["stage-failed"];
    assert.doesNotThrow(
      () => buildJournalEvent({ type: "stage-failed", actor: "runtime", episode: ref, data: failed }));
    const { outputs: _o, ...recorded } = WELL_FORMED["attempt-recorded"];
    assert.doesNotThrow(
      () => buildJournalEvent({ type: "attempt-recorded", actor: "runtime", episode: ref, data: recorded }));
  });

  it("names every missing field at once, not just the first", () => {
    // This is the gateway's old write, exactly: a stage name, a duration, and
    // nothing replay could match an attempt on.
    assert.throws(
      () => buildJournalEvent({
        type: "stage-started", actor: "runtime", episode: ref,
        data: { stageId: "captions", durationMs: 12 },
      }),
      (e) => e.message.includes("leaseId") && e.message.includes("attemptNumber"),
    );
  });

  it("leaves non-execution events alone", () => {
    // approval-requested, comment-added and the rest carry no lease and are
    // not replayed into execution state; their shapes are governed elsewhere.
    assert.doesNotThrow(() => buildJournalEvent({
      type: "approval-requested", actor: "gateway", episode: ref,
      data: { stageId: "narration", decision: "requested" },
    }));
    assert.doesNotThrow(() => buildJournalEvent({
      type: "comment-added", actor: "human", episode: ref, data: { body: "looks good" },
    }));
  });
});
