import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signReceipt } from "../src/receipt.mjs";
import { buildSheetReview, SHEET_REVIEW_STAGE, verifySheetReview } from "../src/sheet-reviews.mjs";

const KEY = "test-operator-key";
const H = (c) => `sha256:${c.repeat(64)}`;
const SHEET = { episode: "dentro-i-versi/short/san-martino", inputsHash: H("a"), sheet: { path: "sheet.jpg", hash: H("b") }, report: { path: "sheet.json", hash: H("c") } };
const NOW = { episode: SHEET.episode, inputsHash: H("a"), sheetHash: H("b"), reportHash: H("c") };
const approved = (extra = {}) => signReceipt(buildSheetReview({ ...SHEET, decision: "approved", at: "2026-10-09T10:00:00.000Z", ...extra }), KEY);

describe("buildSheetReview", () => {
  it("binds the sheet's inputs as its plan and the sheet and its report as its outputs", () => {
    const review = buildSheetReview({ ...SHEET, decision: "approved" });
    assert.equal(review.stageId, SHEET_REVIEW_STAGE);
    assert.deepEqual(review.binding, { planHash: "a".repeat(64), inputs: [], outputs: [{ path: "sheet.json", sha256: "c".repeat(64) }, { path: "sheet.jpg", sha256: "b".repeat(64) }] });
    assert.equal(review.origin, "human");
    assert.equal(review.episode, SHEET.episode);
  });

  it("refuses a rejection without a note", () => {
    assert.throws(() => buildSheetReview({ ...SHEET, decision: "rejected" }), /note/);
  });
});

describe("verifySheetReview", () => {
  it("approves a signed approval of exactly this sheet, verified with the key", () => {
    assert.deepEqual(verifySheetReview({ review: approved(), key: KEY, ...NOW }), { state: "approved", verified: true });
  });

  it("reads a rejection and its note", () => {
    const review = signReceipt(buildSheetReview({ ...SHEET, decision: "rejected", note: "the verse bar covers the hand" }), KEY);
    assert.equal(verifySheetReview({ review, key: KEY, ...NOW }).state, "rejected");
  });

  it("calls a review of another sheet stale", () => {
    for (const changed of [{ inputsHash: H("d") }, { sheetHash: H("d") }, { reportHash: H("d") }]) {
      assert.equal(verifySheetReview({ review: approved(), key: KEY, ...NOW, ...changed }).state, "stale", JSON.stringify(changed));
    }
  });

  it("refuses a tampered review with the key, and judges it by its binding alone without", () => {
    const tampered = { ...approved(), note: "added later" };
    assert.deepEqual(verifySheetReview({ review: tampered, key: KEY, ...NOW }).problem?.code, "bad-signature");
    assert.deepEqual(verifySheetReview({ review: tampered, key: null, ...NOW }), { state: "approved", verified: null });
  });

  it("counts the agent's reading, unsigned, only where the series sets sheet.approval: auto", () => {
    const read = buildSheetReview({ ...SHEET, decision: "approved", origin: "policy" });
    assert.equal(read.origin, "policy");
    assert.equal(read.actor, "pi");
    assert.deepEqual(verifySheetReview({ review: read, key: KEY, ...NOW, policy: "auto" }), { state: "approved", verified: null });
    assert.equal(verifySheetReview({ review: read, key: KEY, ...NOW }).problem?.code, "not-allowed");
    const found = buildSheetReview({ ...SHEET, decision: "rejected", note: "the title covers a face", origin: "policy" });
    assert.equal(verifySheetReview({ review: found, key: null, ...NOW, policy: "auto" }).state, "rejected");
    assert.equal(verifySheetReview({ review: read, key: null, ...NOW, inputsHash: H("d"), policy: "auto" }).state, "stale");
    assert.throws(() => buildSheetReview({ ...SHEET, decision: "approved", origin: "agent" }), /origin/);
  });

  it("refuses another episode's review, another stage's, and a policy decision", () => {
    assert.equal(verifySheetReview({ review: approved(), key: KEY, ...NOW, episode: "x/y/z" }).problem?.code, "wrong-episode");
    assert.equal(verifySheetReview({ review: { ...approved(), stageId: "render" }, key: null, ...NOW }).problem?.code, "wrong-stage");
    assert.equal(verifySheetReview({ review: { ...approved(), origin: "policy" }, key: null, ...NOW }).problem?.code, "not-allowed");
    assert.equal(verifySheetReview({ review: { ...approved(), origin: "agent" }, key: null, ...NOW, policy: "auto" }).problem?.code, "not-human");
    assert.equal(verifySheetReview({ review: null, key: null, ...NOW }).problem?.code, "malformed");
  });
});
