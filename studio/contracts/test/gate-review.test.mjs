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
      const r = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e", binding });
      assert.equal(r.origin, "agent");
      assert.deepEqual(r.binding.inputs, []);
      assert.equal(r.binding.planHash, "p".repeat(64));
    });

    it("refuses an unknown origin", () => {
      assert.throws(
        () => buildGateReview({ stageId: "s", decision: "approved", origin: "robot", actor: "runtime", episode: "c/s/e", binding }),
        /origin/,
      );
    });

    it("refuses an approval with no planHash: it could not be invalidated by a changed plan", () => {
      assert.throws(
        () => buildGateReview({
          stageId: "s", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e",
          binding: { outputs: binding.outputs },
        }),
        /planHash/,
      );
    });

    it("refuses an approval that names no outputs", () => {
      assert.throws(
        () => buildGateReview({
          stageId: "s", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e",
          binding: { planHash: "p".repeat(64), outputs: [] },
        }),
        /at least one output/,
      );
    });

    it("accepts a rejection, and requires it to say why", () => {
      assert.throws(
        () => buildGateReview({ stageId: "s", decision: "rejected", origin: "agent", actor: "runtime", episode: "c/s/e", binding }),
        /note/,
      );
      const r = buildGateReview({
        stageId: "s", decision: "rejected", origin: "agent", actor: "runtime", episode: "c/s/e", binding, note: "too dark",
      });
      assert.equal(r.decision, "rejected");
    });

    it("requires an episode on approvals and rejections, so the signature can bind one", () => {
      assert.throws(
        () => buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", binding }),
        /episode/,
      );
      assert.throws(
        () => buildGateReview({ stageId: "s", decision: "rejected", origin: "human", actor: "runtime", binding, note: "x" }),
        /episode/,
      );
      const asked = buildGateReview({ stageId: "s", decision: "requested", origin: "agent", actor: "runtime", binding: {} });
      assert.equal(asked.episode, undefined);
      const carried = buildGateReview({ stageId: "s", decision: "requested", origin: "agent", actor: "runtime", binding: {}, episode: "c/s/e" });
      assert.equal(carried.episode, "c/s/e");
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
      const events = [evt("approval-requested", { stageId: "qa", decision: "requested", origin: "agent", binding: { inputs: [], outputs: [] } }, "gateway")];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "requested");
    });

    it("reads the latest of requested, granted and rejected", async () => {
      await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
      const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
      const binding = { planHash: "p".repeat(64), outputs };
      const ev = (type, decision, extra = {}) => ({
        type, at: "2026-09-24T00:00:00Z", actor: "runtime",
        data: buildGateReview({ stageId: "s", decision, origin: "agent", actor: "runtime", episode: "c/s/e", binding, ...extra }),
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
        stageId: "s", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e",
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
        stageId: "qa", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e",
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
        stageId: "illustrations", decision: "approved", origin: "human", actor: "human", episode: "c/s/e",
        binding: { planHash: "p".repeat(64), outputs },
      }))];

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "none");
    });

    it("invalidates an approval that names nothing", async () => {
      // Belt and braces: buildGateReview refuses to make one, but a record
      // written by something else must not be trusted either.
      const events = [evt("approval-granted", { stageId: "qa", decision: "approved", origin: "agent", binding: { inputs: [], outputs: [] } }, "runtime")];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
      assert.match(state.reason, /named no artifacts/);
    });

    it("invalidates an approval that names nothing even without a decision field", async () => {
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
        const data = buildGateReview({ stageId: "s", decision: "approved", origin: "human", actor: "runtime", episode: "c/s/e", binding: { planHash, outputs } });
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
        const data = buildGateReview({ stageId: "s", decision: "rejected", origin: "human", actor: "runtime", episode: "c/s/e", binding: { planHash: PLAN }, note: "too dark" });
        const s = await deriveGateState([{ type: "approval-rejected", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /unsigned/);
      });

      it("a signed human rejection reads as rejected", async () => {
        const data = signReceipt(buildGateReview({ stageId: "s", decision: "rejected", origin: "human", actor: "runtime", episode: "c/s/e", binding: { planHash: PLAN }, note: "too dark" }), KEY);
        const s = await deriveGateState([{ type: "approval-rejected", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "rejected"); assert.equal(s.note, "too dark"); assert.equal(s.origin, "human");
      });

      /** A signed human rejection bound, as review() binds one, to the current plan and outputs. */
      async function humanRejection(at) {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = signReceipt(buildGateReview({
          stageId: "s", decision: "rejected", origin: "human", actor: "runtime", episode: "c/s/e",
          binding: { planHash: PLAN, outputs }, note: "too dark", ...(at ? { at } : {}),
        }), KEY);
        return { type: "approval-rejected", actor: "runtime", at: data.at, data };
      }

      async function signedGrantAt(at) {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = signReceipt(buildGateReview({
          stageId: "s", decision: "approved", origin: "human", actor: "runtime", episode: "c/s/e", binding: { planHash: PLAN, outputs }, at,
        }), KEY);
        return { type: "approval-granted", actor: "runtime", at, data };
      }

      it("invalidates a signed rejection re-typed as a grant: the event type must match the signed decision", async () => {
        // The type is not signed; the decision is. Copying the operator's
        // rejection line and changing its type used to read as approved.
        const flipped = { ...(await humanRejection()), type: "approval-granted" };
        const s = await deriveGateState([flipped], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /event type .* disagrees/);
      });

      it("applies the type/decision rule to agent records too", async () => {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = buildGateReview({ stageId: "s", decision: "requested", origin: "agent", actor: "runtime", episode: "c/s/e", binding: { planHash: PLAN, outputs } });
        const s = await deriveGateState([{ type: "approval-granted", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /disagrees/);
        const asked = await deriveGateState([{ type: "approval-rejected", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(asked.state, "invalidated");
      });

      it("a re-appended older approval is superseded by the later rejection", async () => {
        const approve = await signedGrantAt("2026-09-24T10:00:00.000Z");
        const reject = await humanRejection("2026-09-24T11:00:00.000Z");
        const s = await deriveGateState([approve, reject, approve], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated");
        assert.match(s.reason, /superseded by a later decision recorded at 2026-09-24T11:00:00.000Z/);
      });

      it("the operator's next real decision governs again after a replay", async () => {
        const approve = await signedGrantAt("2026-09-24T10:00:00.000Z");
        const reject = await humanRejection("2026-09-24T11:00:00.000Z");
        const fresh = await signedGrantAt("2026-09-24T12:00:00.000Z");
        const s = await deriveGateState([approve, reject, approve, fresh], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved");
      });

      it("a later approval supersedes an earlier rejection", async () => {
        const reject = await humanRejection("2026-09-24T10:00:00.000Z");
        const approve = await signedGrantAt("2026-09-24T11:00:00.000Z");
        const s = await deriveGateState([reject, approve], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved");
      });

      it("a far-future-dated unsigned line cannot lock the stage away from its operator", async () => {
        // Anything that can append a line can date it 2099. Its `at` is not
        // signed, so it orders by file position only: the operator's next
        // genuine decision, appended after it, governs.
        const forged = {
          type: "approval-requested", actor: "runtime", at: "2099-01-01T00:00:00.000Z",
          data: buildGateReview({ stageId: "s", decision: "requested", origin: "agent", actor: "runtime", episode: "c/s/e",
            binding: { planHash: PLAN }, at: "2099-01-01T00:00:00.000Z" }),
        };
        const approve = await signedGrantAt(new Date().toISOString());
        const s = await deriveGateState([forged, approve], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved");
      });

      it("a far-future-dated unsigned human line does not supersede a signed one", async () => {
        const approve = await signedGrantAt("2026-09-24T10:00:00.000Z");
        const { signature: _s, ...unsigned } = (await humanRejection("2099-01-01T00:00:00.000Z")).data;
        const forged = { type: "approval-rejected", actor: "runtime", at: unsigned.at, data: unsigned };
        const s = await deriveGateState([forged, approve], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved");
      });

      describe("the episode and the note are signed (avg-qr4.3 final review)", () => {
        const EP = "chan/series/ep1";

        it("a receipt copied into another episode, same bytes and plan, reads invalidated", async () => {
          // Two episodes of one series share the stage definition, and a
          // re-used asset can hash identically. Without the episode in the
          // signature, the operator's approval of ep1 approved ep2 as well.
          await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
          const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
          const data = signReceipt(buildGateReview({
            stageId: "s", decision: "approved", origin: "human", actor: "runtime", episode: EP,
            binding: { planHash: PLAN, outputs },
          }), KEY);
          const event = { type: "approval-granted", actor: "runtime", at: data.at, data };

          const home = await deriveGateState([event], "s", dir, { key: KEY, planHash: PLAN, episode: EP });
          assert.equal(home.state, "approved");

          const copied = await deriveGateState([event], "s", dir, { key: KEY, planHash: PLAN, episode: "chan/series/ep2" });
          assert.equal(copied.state, "invalidated");
          assert.match(copied.reason, /chan\/series\/ep1.*chan\/series\/ep2|another episode/);
        });

        it("a human decision that names no episode reads invalidated when the reader knows its episode", async () => {
          await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
          const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
          const { episode: _e, ...noEpisode } = buildGateReview({
            stageId: "s", decision: "approved", origin: "human", actor: "runtime", episode: EP,
            binding: { planHash: PLAN, outputs },
          });
          const data = signReceipt(noEpisode, KEY);
          const s = await deriveGateState([{ type: "approval-granted", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN, episode: EP });
          assert.equal(s.state, "invalidated");
          assert.match(s.reason, /episode/);
        });

        it("a signed rejection whose note was rewritten fails verification", async () => {
          const data = signReceipt(buildGateReview({
            stageId: "s", decision: "rejected", origin: "human", actor: "runtime", episode: EP,
            binding: { planHash: PLAN }, note: "too dark",
          }), KEY);
          const rewritten = { ...data, note: "approved really, ship it" };
          const s = await deriveGateState([{ type: "approval-rejected", actor: "runtime", at: data.at, data: rewritten }], "s", dir, { key: KEY, planHash: PLAN, episode: EP });
          assert.equal(s.state, "invalidated");
          assert.match(s.reason, /does not verify/);
        });

        it("a copied later receipt from another episode does not supersede this episode's decision", async () => {
          await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
          const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
          const mine = signReceipt(buildGateReview({
            stageId: "s", decision: "approved", origin: "human", actor: "runtime", episode: EP,
            binding: { planHash: PLAN, outputs }, at: "2026-09-24T10:00:00.000Z",
          }), KEY);
          const theirs = signReceipt(buildGateReview({
            stageId: "s", decision: "rejected", origin: "human", actor: "runtime", episode: "chan/series/ep2",
            binding: { planHash: PLAN, outputs }, note: "no", at: "2026-09-24T11:00:00.000Z",
          }), KEY);
          const events = [
            { type: "approval-rejected", actor: "runtime", at: theirs.at, data: theirs },
            { type: "approval-granted", actor: "runtime", at: mine.at, data: mine },
          ];
          const s = await deriveGateState(events, "s", dir, { key: KEY, planHash: PLAN, episode: EP });
          assert.equal(s.state, "approved");
        });
      });

      it("an agent grant needs no signature", async () => {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e", binding: { planHash: PLAN, outputs } });
        const s = await deriveGateState([{ type: "approval-granted", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "approved"); assert.equal(s.origin, "agent");
      });

      it("an agent grant for another plan is invalidated too", async () => {
        await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
        const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
        const data = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", episode: "c/s/e", binding: { planHash: planHashOf({ id: "s", old: true }), outputs } });
        const s = await deriveGateState([{ type: "approval-granted", actor: "runtime", at: data.at, data }], "s", dir, { key: KEY, planHash: PLAN });
        assert.equal(s.state, "invalidated"); assert.match(s.reason, /stage definition changed/);
      });
    });
  });
});
