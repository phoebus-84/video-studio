import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { hashArtifacts, buildGateReview, deriveGateState, GATE_DECISIONS } from "../src/gate-review.mjs";
import { signReceipt, planHashOf } from "../src/receipt.mjs";

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
    const binding = { planHash: "p".repeat(64), outputs: [{ path: "artifacts/x.md", sha256: hash }] };

    it("carries origin and binding, with inputs defaulted", () => {
      const r = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", binding });
      assert.equal(r.origin, "agent");
      assert.deepEqual(r.binding.inputs, []);
      assert.equal(r.binding.planHash, "p".repeat(64));
    });

    it("refuses an unknown origin", () => {
      assert.throws(
        () => buildGateReview({ stageId: "s", decision: "approved", origin: "robot", actor: "runtime", binding }),
        /origin/,
      );
    });

    it("refuses an approval with no planHash: it could not be invalidated by a changed plan", () => {
      assert.throws(
        () => buildGateReview({
          stageId: "s", decision: "approved", origin: "agent", actor: "runtime",
          binding: { outputs: binding.outputs },
        }),
        /planHash/,
      );
    });

    it("refuses an approval that names no outputs", () => {
      assert.throws(
        () => buildGateReview({
          stageId: "s", decision: "approved", origin: "agent", actor: "runtime",
          binding: { planHash: "p".repeat(64), outputs: [] },
        }),
        /at least one output/,
      );
    });

    it("accepts a rejection, and requires it to say why", () => {
      assert.throws(
        () => buildGateReview({ stageId: "s", decision: "rejected", origin: "agent", actor: "runtime", binding }),
        /note/,
      );
      const r = buildGateReview({
        stageId: "s", decision: "rejected", origin: "agent", actor: "runtime", binding, note: "too dark",
      });
      assert.equal(r.decision, "rejected");
    });

    it("lists three decisions", () => {
      assert.deepEqual([...GATE_DECISIONS], ["requested", "approved", "rejected"]);
    });

    it("rejects an actor the journal does not know", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "requested", origin: "agent", actor: "robot" }),
        /actor/,
      );
    });

    it("requires a stage", () => {
      assert.throws(
        () => buildGateReview({ decision: "requested", origin: "agent", actor: "gateway" }),
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
      const events = [evt("approval-requested", { stageId: "qa", origin: "agent", binding: { inputs: [], outputs: [] } }, "gateway")];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "requested");
    });

    it("reads the latest of requested, granted and rejected", async () => {
      await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
      const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
      const binding = { planHash: "p".repeat(64), outputs };
      const ev = (type, decision, extra = {}) => ({
        type, at: "2026-09-24T00:00:00Z", actor: "runtime",
        data: buildGateReview({ stageId: "s", decision, origin: "agent", actor: "runtime", binding, ...extra }),
      });

      assert.equal((await deriveGateState([ev("approval-requested", "requested")], "s", dir)).state, "requested");
      assert.equal((await deriveGateState([ev("approval-granted", "approved")], "s", dir)).state, "approved");
      const rejected = await deriveGateState(
        [ev("approval-granted", "approved"), ev("approval-rejected", "rejected", { note: "too dark" })], "s", dir);
      assert.equal(rejected.state, "rejected");
      assert.equal(rejected.note, "too dark");
    });

    it("still invalidates a grant whose artifact changed", async () => {
      await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
      const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
      const data = buildGateReview({
        stageId: "s", decision: "approved", origin: "agent", actor: "runtime",
        binding: { planHash: "p".repeat(64), outputs },
      });
      await writeFile(path.join(dir, "artifacts", "x.md"), "v2");
      const state = await deriveGateState([{ type: "approval-granted", data }], "s", dir);
      assert.equal(state.state, "invalidated");
      assert.match(state.reason, /changed since it was approved/);
    });

    it("invalidates the review when a reviewed artifact is gone", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", buildGateReview({
        stageId: "qa", decision: "approved", origin: "agent", actor: "runtime",
        binding: { planHash: "p".repeat(64), outputs },
      }), "runtime")];

      await rm(file);

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
    });

    it("ignores another stage's approval", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", buildGateReview({
        stageId: "illustrations", decision: "approved", origin: "human", actor: "human",
        binding: { planHash: "p".repeat(64), outputs },
      }))];

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "none");
    });

    it("invalidates an approval that names nothing", async () => {
      // Belt and braces: buildGateReview refuses to make one, but a record
      // written by something else must not be trusted either.
      const events = [evt("approval-granted", { stageId: "qa", origin: "agent", binding: { inputs: [], outputs: [] } }, "runtime")];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
    });
    describe("human decisions and the plan they were bound to (avg-qr4.3)", () => {
      const KEY = "test-operator-key";
      const PLAN = planHashOf({ id: "s" });

      async function humanGrant(sign = true, planHash = PLAN) {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = buildGateReview({ stageId: "s", decision: "approved", origin: "human", actor: "runtime", binding: { planHash, outputs } });
        return { type: "approval-granted", actor: "runtime", at: data.at, data: sign ? signReceipt(data, KEY) : data };
      }

      it("approves a signed human grant for the same plan", async () => {
        const s = await deriveGateState([await humanGrant()], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved"); assert.equal(s.origin, "human");
      });

      it("reads an unsigned human grant as invalidated: unsigned", async () => {
        const s = await deriveGateState([await humanGrant(false)], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /unsigned/);
      });

      it("reads a tampered human grant as invalidated", async () => {
        const e = await humanGrant(); e.data = { ...e.data, stageId: "s", note: "x", origin: "human", at: "2030-01-01T00:00:00Z" };
        const s = await deriveGateState([e], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /does not verify/);
      });

      it("reads a human grant as unverifiable without a key", async () => {
        const s = await deriveGateState([await humanGrant()], "s", dir, { planHash: PLAN });
        assert.equal(s.state, "unverifiable");
        assert.match(s.reason, /no operator key/);
      });

      it("invalidates when the stage definition changed", async () => {
        const s = await deriveGateState([await humanGrant(true, planHashOf({ id: "s", old: true }))], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /stage definition changed/);
      });

      it("reads a legacy actor:human record with no origin as invalidated: unsigned", async () => {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const legacy = { type: "approval-granted", actor: "human", data: { stageId: "s", decision: "approved", actor: "human", at: "t", inputs: [], outputs, checks: [] } };
        const s = await deriveGateState([legacy], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /unsigned/);
      });

      it("an unsigned human rejection is invalidated too — one rule both ways", async () => {
        const data = buildGateReview({ stageId: "s", decision: "rejected", origin: "human", actor: "runtime", binding: { planHash: PLAN }, note: "too dark" });
        const s = await deriveGateState([{ type: "approval-rejected", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /unsigned/);
      });

      it("a signed human rejection reads as rejected", async () => {
        const data = signReceipt(buildGateReview({ stageId: "s", decision: "rejected", origin: "human", actor: "runtime", binding: { planHash: PLAN }, note: "too dark" }), KEY);
        const s = await deriveGateState([{ type: "approval-rejected", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "rejected"); assert.equal(s.note, "too dark"); assert.equal(s.origin, "human");
      });

      it("an agent grant needs no signature", async () => {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", binding: { planHash: PLAN, outputs } });
        const s = await deriveGateState([{ type: "approval-granted", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved"); assert.equal(s.origin, "agent");
      });

      it("an agent grant for another plan is invalidated too", async () => {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", binding: { planHash: planHashOf({ id: "s", old: true }), outputs } });
        const s = await deriveGateState([{ type: "approval-granted", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /stage definition changed/);
      });
    });
  });
});
