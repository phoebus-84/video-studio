import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { hashArtifacts, buildGateReview, GATE_DECISIONS } from "../src/gate-review.mjs";

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
});
