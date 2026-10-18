import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signReceipt } from "../src/receipt.mjs";
import { buildSheetReview, sheetApprovalPolicy, SHEET_REVIEW_STAGE, verifySheetReview } from "../src/sheet-reviews.mjs";

const KEY = "test-operator-key";
const H = (c) => `sha256:${c.repeat(64)}`;
const SHEET = { episode: "dentro-i-versi/short/san-martino", inputsHash: H("a"), sheet: { path: "sheet.jpg", hash: H("b") }, report: { path: "sheet.json", hash: H("c") } };
const NOW = { episode: SHEET.episode, inputsHash: H("a"), sheetHash: H("b"), reportHash: H("c") };
const approved = (extra = {}) => signReceipt(buildSheetReview({ ...SHEET, decision: "approved", at: "2026-10-09T10:00:00.000Z", ...extra }), KEY);

describe("sheetApprovalPolicy", () => {
  function withSettings(run) {
    const root = mkdtempSync(path.join(tmpdir(), "sheet-policy-"));
    const series = path.join(root, "series", "s");
    const episode = path.join(series, "episodes", "e");
    mkdirSync(episode, { recursive: true });
    const channelFile = path.join(root, "settings.yaml"), seriesFile = path.join(series, "settings.yaml");
    writeFileSync(channelFile, JSON.stringify({ sheet: { approval: "auto" } }));
    try { run({ episode, seriesFile, channelFile }); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }

  it("inherits only absent declarations, never the episode's own policy", () => withSettings(({ episode, seriesFile, channelFile }) => {
    writeFileSync(path.join(episode, "settings.yaml"), JSON.stringify({ sheet: { approval: "review" } }));
    for (const doc of [{}, { sheet: {} }]) {
      writeFileSync(seriesFile, JSON.stringify(doc));
      assert.deepEqual(sheetApprovalPolicy(episode, JSON.parse), { approval: "auto", from: channelFile });
    }
  }));

  it("inherits through a series settings.yaml that declares nothing: empty, blank or only comments", () => withSettings(({ episode, seriesFile, channelFile }) => {
    for (const text of ["", "  \n\n", "# Series settings for s\n", "﻿# only comments\r\n\r\n  # indented\r\n"]) {
      writeFileSync(seriesFile, text);
      assert.deepEqual(sheetApprovalPolicy(episode, JSON.parse), { approval: "auto", from: channelFile }, JSON.stringify(text));
    }
  }));

  it("requires human review on malformed settings or invalid policy values", () => withSettings(({ episode, seriesFile }) => {
    const invalid = ["{", "[]", "false", "null", JSON.stringify({ sheet: null }), JSON.stringify({ sheet: [] }),
      JSON.stringify({ sheet: { approval: null } }), JSON.stringify({ sheet: { approval: "typo" } })];
    for (const text of invalid) {
      writeFileSync(seriesFile, text);
      assert.deepEqual(sheetApprovalPolicy(episode, JSON.parse), { approval: "review", from: seriesFile }, text);
    }
  }));

  it("does not inherit auto when settings cannot be read", () => withSettings(({ episode, seriesFile }) => {
    mkdirSync(seriesFile);
    assert.deepEqual(sheetApprovalPolicy(episode, JSON.parse), { approval: "review", from: seriesFile });
  }));

  it("requires human review for a malformed channel policy too", () => withSettings(({ episode, channelFile }) => {
    writeFileSync(channelFile, "{");
    assert.deepEqual(sheetApprovalPolicy(episode, JSON.parse), { approval: "review", from: channelFile });
  }));
});

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
