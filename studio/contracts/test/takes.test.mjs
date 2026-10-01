import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildTakeSelection, candidatePath, deriveTakes, ATTEMPTS_DIR } from "../src/takes.mjs";
import { signReceipt } from "../src/receipt.mjs";
import { deriveGateState } from "../src/gate-review.mjs";

const KEY = "k".repeat(43);
const EPISODE = "chan/series/ep1";
const A = "a".repeat(64);
const B = "b".repeat(64);

let seq = 0;
const event = (type, data) => ({ type, at: `2026-10-01T10:00:${String(seq++).padStart(2, "0")}.000Z`, actor: "runtime", data });
const completed = (attemptNumber, extra = {}) =>
  event("stage-completed", { stageId: "script", leaseId: `lease-${attemptNumber}`, attemptNumber, outputs: ["artifacts/script.md"], ...extra });
const digests = (sha256) => [{ path: "artifacts/script.md", sha256 }];
const selection = (attemptNumber, origin, sha256, extra = {}) => buildTakeSelection({
  stageId: "script", origin, actor: "runtime", attemptNumber, leaseId: `lease-${attemptNumber}`,
  outputs: digests(sha256), episode: EPISODE, ...extra,
});

describe("candidatePath", () => {
  it("keeps each attempt's copy under attempts/<stage>/<attempt>/", () => {
    assert.equal(ATTEMPTS_DIR, "attempts");
    assert.equal(candidatePath("script", 2, "artifacts/script.md"), "attempts/script/2/artifacts/script.md");
  });
});

describe("buildTakeSelection", () => {
  it("is shaped like a review, so the receipt signs what was selected", () => {
    const record = selection(1, "human", A, { previous: 2, at: "2026-10-01T10:00:00.000Z" });
    assert.equal(record.decision, "selected");
    assert.deepEqual(record.binding, { attemptNumber: 1, leaseId: "lease-1", outputs: digests(A) });
    assert.equal(record.previous, 2);
  });
  it("refuses a selection that names no files", () => {
    assert.throws(() => selection(1, "agent", A, { outputs: [] }), /selection of nothing/);
  });
  it("refuses a file without a sha256", () => {
    assert.throws(() => selection(1, "agent", "nope"), /path and a sha256/);
  });
  it("refuses a selection with no episode", () => {
    assert.throws(() => selection(1, "agent", A, { episode: "" }), /name its episode/);
  });
  it("refuses an unknown origin and a missing attempt", () => {
    assert.throws(() => selection(1, "robot", A), /Unknown take selection origin/);
    assert.throws(() => selection(0, "agent", A), /name the attempt/);
  });
});

describe("deriveTakes", () => {
  it("reads a completion from before candidates as the take, with nothing to restore", () => {
    const takes = deriveTakes([completed(1)], ["script"]).get("script");
    assert.deepEqual(takes.candidates, []);
    assert.equal(takes.selected.attemptNumber, 1);
    assert.equal(takes.selected.outputs, null);
    assert.deepEqual(takes.selected.paths, ["artifacts/script.md"]);
  });

  it("makes a completion with digests a candidate that selects itself", () => {
    const takes = deriveTakes([completed(1, { digests: digests(A) })], ["script"]).get("script");
    assert.equal(takes.candidates.length, 1);
    assert.equal(takes.selected.attemptNumber, 1);
    assert.equal(takes.selected.origin, "policy");
    assert.equal(takes.selected.locked, false);
  });

  it("keeps a selected: false completion as a candidate only", () => {
    const takes = deriveTakes([
      completed(1, { digests: digests(A) }),
      completed(2, { digests: digests(B), selected: false }),
    ], ["script"]).get("script");
    assert.equal(takes.candidates.length, 2);
    assert.equal(takes.selected.attemptNumber, 1);
  });

  it("lets take-selected pick an earlier candidate, and a later completion replace it", () => {
    const events = [
      completed(1, { digests: digests(A) }),
      completed(2, { digests: digests(B) }),
      event("take-selected", selection(1, "agent", A)),
    ];
    assert.equal(deriveTakes(events, ["script"]).get("script").selected.attemptNumber, 1);
    events.push(completed(3, { digests: digests(B) }));
    assert.equal(deriveTakes(events, ["script"]).get("script").selected.attemptNumber, 3);
  });

  it("locks an operator's selection that verifies", () => {
    const signed = signReceipt(selection(1, "human", A), KEY);
    const takes = deriveTakes([completed(1, { digests: digests(A) }), event("take-selected", signed)], ["script"],
      { key: KEY, episode: EPISODE }).get("script");
    assert.equal(takes.selected.locked, true);
    assert.equal(takes.selected.verified, true);
  });

  it("does not lock an operator selection whose signature does not verify", () => {
    const forged = { ...selection(1, "human", A), signature: "f".repeat(64) };
    const takes = deriveTakes([event("take-selected", forged)], ["script"], { key: KEY, episode: EPISODE }).get("script");
    assert.equal(takes.selected.locked, false);
    assert.equal(takes.selected.verified, false);
  });

  it("does not lock an operator selection signed for another episode", () => {
    const signed = signReceipt(selection(1, "human", A, { episode: "chan/series/ep2" }), KEY);
    const takes = deriveTakes([event("take-selected", signed)], ["script"], { key: KEY, episode: EPISODE }).get("script");
    assert.equal(takes.selected.locked, false);
  });

  it("treats an operator selection as locked when there is no key to check it — failing closed", () => {
    const takes = deriveTakes([event("take-selected", selection(1, "human", A))], ["script"]).get("script");
    assert.equal(takes.selected.locked, true);
    assert.equal(takes.selected.verified, null);
  });

  it("ignores stages the pipeline does not declare", () => {
    const takes = deriveTakes([completed(1, { digests: digests(A) })], ["brief"]);
    assert.equal(takes.has("script"), false);
    assert.equal(takes.get("brief").selected, null);
  });
});

describe("a signed selection is not an approval", () => {
  it("reads as tampered when retyped as approval-granted", async () => {
    const signed = signReceipt(selection(1, "human", A), KEY);
    const state = await deriveGateState([{ ...event("approval-granted", signed) }], "script", "/nowhere", { key: KEY, episode: EPISODE });
    assert.equal(state.state, "invalidated");
  });
});
