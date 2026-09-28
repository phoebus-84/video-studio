import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { canonicalJson, planHashOf, signReceipt, verifyReceipt, SIGNED_FIELDS } from "../src/receipt.mjs";

const KEY = "k".repeat(43);
const review = () => ({
  stageId: "script",
  decision: "approved",
  origin: "human",
  actor: "runtime",
  at: "2026-09-24T10:00:00.000Z",
  binding: { planHash: "a".repeat(64), inputs: [], outputs: [{ path: "artifacts/script.md", sha256: "b".repeat(64) }] },
  episode: "chan/series/ep1",
  note: "looks right",
  checks: [],
});

describe("canonicalJson", () => {
  it("does not depend on key order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("keeps array order, because order in a list means something", () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });
  it("drops undefined members the way JSON.stringify does", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  });
});

describe("planHashOf", () => {
  it("is the sha256 of the canonical JSON", () => {
    const def = { id: "script", gates: { review: "human", autopilot: false } };
    assert.equal(planHashOf(def), createHash("sha256").update(canonicalJson(def)).digest("hex"));
  });
  it("changes when the definition changes", () => {
    assert.notEqual(planHashOf({ id: "s", gates: { review: "human" } }), planHashOf({ id: "s", gates: { review: "none" } }));
  });
});

describe("signReceipt / verifyReceipt", () => {
  it("round-trips", () => {
    assert.equal(verifyReceipt(signReceipt(review(), KEY), KEY), true);
  });
  it("signs exactly the decision-bearing fields", () => {
    assert.deepEqual(SIGNED_FIELDS, ["stageId", "decision", "origin", "binding", "at", "episode", "note"]);
  });
  it("fails for every signed field that is tampered with", () => {
    const signed = signReceipt(review(), KEY);
    const tampered = [
      { ...signed, stageId: "compose" },
      { ...signed, decision: "rejected" },
      { ...signed, origin: "agent" },
      { ...signed, at: "2026-09-25T10:00:00.000Z" },
      { ...signed, binding: { ...signed.binding, planHash: "c".repeat(64) } },
      { ...signed, binding: { ...signed.binding, outputs: [] } },
      // avg-qr4.3 final review: the episode and the note were outside the
      // signature, so a receipt could be moved to another episode and a
      // rejection's reason rewritten without breaking it.
      { ...signed, episode: "chan/series/ep2" },
      { ...signed, note: "rewritten" },
    ];
    for (const t of tampered) assert.equal(verifyReceipt(t, KEY), false, JSON.stringify(t));
  });
  it("fails under another key", () => {
    assert.equal(verifyReceipt(signReceipt(review(), KEY), "x".repeat(43)), false);
  });
  it("fails with no signature, or a signature of the wrong length, without throwing", () => {
    assert.equal(verifyReceipt(review(), KEY), false);
    assert.equal(verifyReceipt({ ...review(), signature: "ab" }, KEY), false);
  });
  it("refuses to sign without a key rather than signing with an empty one", () => {
    assert.throws(() => signReceipt(review(), ""), /key/);
  });
});
