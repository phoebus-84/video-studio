import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { hashArtifacts, buildGateReview, deriveGateState, GATE_DECISIONS } from "../src/gate-review.mjs";

/**
 * The gateway executor used to write a safety report about a wolf for every
 * episode, having opened none of them. These records exist so that a review
 * has to name what it looked at.
 */
describe("gate review records", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gate-review-"));
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("hashArtifacts", () => {
    it("hashes a file's bytes and names it relatively", async () => {
      await writeFile(path.join(dir, "artifacts", "qa-report.json"), "{}");
      const expected = createHash("sha256").update("{}").digest("hex");

      const hashes = await hashArtifacts(dir, ["artifacts/qa-report.json"]);

      assert.equal(hashes.length, 1);
      assert.equal(hashes[0].path, "artifacts/qa-report.json");
      assert.equal(hashes[0].sha256, expected);
    });

    it("refuses to hash a file that is not there", async () => {
      await assert.rejects(
        () => hashArtifacts(dir, ["artifacts/never-written.json"]),
        /never-written\.json/,
      );
    });

    it("refuses to hash an empty file", async () => {
      await writeFile(path.join(dir, "artifacts", "empty.json"), "");
      await assert.rejects(
        () => hashArtifacts(dir, ["artifacts/empty.json"]),
        /empty/,
      );
    });

    it("refuses an absolute path", async () => {
      // A record naming /Users/someone/.../qa-report.json can only be checked
      // on the machine that wrote it.
      const absolute = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(absolute, "{}");
      await assert.rejects(
        () => hashArtifacts(dir, [absolute]),
        /relative to the episode/,
      );
    });

    it("refuses a relative path that climbs out of the episode", async () => {
      // The file exists and is readable — the point is that it is not this
      // episode's, so no review of this episode could have examined it.
      await writeFile(path.join(dir, "outside.json"), "{}");
      await assert.rejects(
        () => hashArtifacts(path.join(dir, "artifacts"), ["../outside.json"]),
        /climbs out of it/,
      );
      await assert.rejects(
        () => hashArtifacts(dir, ["artifacts/../../outside.json"]),
        /climbs out of it/,
      );
    });
  });

  describe("buildGateReview", () => {
    const hash = "a".repeat(64);

    it("shapes a request", () => {
      const review = buildGateReview({
        stageId: "safety-review",
        decision: "requested",
        actor: "gateway",
        inputs: [{ path: "artifacts/script.md", sha256: hash }],
      });

      assert.equal(review.stageId, "safety-review");
      assert.equal(review.decision, "requested");
      assert.equal(review.actor, "gateway");
      assert.deepEqual(review.outputs, []);
      assert.deepEqual(review.checks, []);
      assert.match(review.at, /^\d{4}-\d{2}-\d{2}T/);
    });

    it("rejects a decision it does not define", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "rejected", actor: "human" }),
        /decision/,
      );
      assert.deepEqual([...GATE_DECISIONS], ["requested", "approved"]);
    });

    it("rejects an actor the journal does not know", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "requested", actor: "robot" }),
        /actor/,
      );
    });

    it("refuses an approval that names no artifact", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "approved", actor: "human", outputs: [] }),
        /at least one/,
      );
    });

    it("requires a stage", () => {
      assert.throws(
        () => buildGateReview({ decision: "requested", actor: "gateway" }),
        /stage/,
      );
    });
  });

  describe("deriveGateState", () => {
    const evt = (type, data, actor = "human") => ({
      apiVersion: "studio.video/v1alpha1",
      kind: "JournalEvent",
      id: `evt_${"0".repeat(26)}`,
      episodeRef: { channel: "c", series: "s", episode: "e" },
      at: new Date().toISOString(),
      actor,
      type,
      data,
    });

    it("reports none when no one has asked for a review", async () => {
      const state = await deriveGateState([], "qa", dir);
      assert.equal(state.state, "none");
    });

    it("reports requested when a review was asked for but not granted", async () => {
      const events = [evt("approval-requested", { stageId: "qa", inputs: [], outputs: [] }, "gateway")];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "requested");
    });

    it("reports approved while the reviewed bytes are unchanged", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs })];

      const state = await deriveGateState(events, "qa", dir);

      assert.equal(state.state, "approved");
      assert.equal(state.actor, "human");
    });

    it("invalidates the review when a reviewed artifact changes", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs })];

      // The render was redone after approval; the report is no longer the one
      // that was reviewed.
      await writeFile(file, '{"verdict":"fail"}');

      const state = await deriveGateState(events, "qa", dir);

      assert.equal(state.state, "invalidated");
      assert.match(state.reason, /changed/);
    });

    it("invalidates the review when a reviewed artifact is gone", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs })];

      await rm(file);

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
    });

    it("reads the latest decision, not the first", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [
        evt("approval-requested", { stageId: "qa", inputs: [], outputs: [] }, "gateway"),
        evt("approval-granted", { stageId: "qa", inputs: [], outputs }),
      ];

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "approved");
    });

    it("ignores another stage's approval", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "illustrations", inputs: [], outputs })];

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "none");
    });

    it("invalidates an approval that names nothing", async () => {
      // Belt and braces: buildGateReview refuses to make one, but a record
      // written by something else must not be trusted either.
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs: [] })];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
    });
  });
});
