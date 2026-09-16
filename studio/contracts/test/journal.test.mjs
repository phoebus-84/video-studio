import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
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
});
