// Golden references (avg-jao.6): every ADR-0037 check a descriptor must pass
// before it is trusted, each failing with its own code. A reference is built
// on disk from the contract example's release and signed with a test key.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { signReceipt, verifyReceipt } from "../src/receipt.mjs";
import {
  buildReferenceApproval,
  buildReferenceWithdrawal,
  proposalHash,
  REFERENCE_REVIEW_STAGE,
  verifySeriesReference,
} from "../src/series-references.mjs";
import { seriesReferencePath, seriesReferenceWithdrawalPath } from "../src/layout.mjs";

const KEY = "series-references-test-key-not-a-real-operator-key";
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "series-template", "example");
const REF = { channel: "sample", series: "poetry", episode: "morning" };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let root;
let seriesDir;
const episodeDir = () => join(seriesDir, "episodes", REF.episode);
const descriptorPath = () => seriesReferencePath(root, REF.channel, REF.series, "poetry-short", "morning-v1");
const verify = (key = KEY) => verifySeriesReference({ seriesDir, templateId: "poetry-short", referenceId: "morning-v1", key });

/** Write `content` at `relative` inside the episode; returns its sha256 hex. */
function put(relative, content) {
  const file = join(episodeDir(), relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return sha256(content);
}

/** A complete, signed reference: release in the series, snapshots, render, report, descriptor. */
function makeReference() {
  cpSync(join(FIXTURE, "templates", "poetry-short", "1.0.0"), join(seriesDir, "templates", "poetry-short", "1.0.0"), { recursive: true });
  const specText = readFileSync(join(FIXTURE, "episode-spec.json"));
  const specHash = put("reviews/references/morning-v1/episode-spec.json", specText);
  const timelineText = `${JSON.stringify({ apiVersion: "studio.video/v1alpha2", derivedFrom: { spec: { path: "episode-spec.json", hash: `sha256:${specHash}` } } }, null, 2)}\n`;
  const timelineHash = put("reviews/references/morning-v1/edit-timeline.json", timelineText);
  const renderHash = put("output/render-1-abc12345.mp4", "fake mp4 bytes");
  const reportHash = put("output/render-1-abc12345.report.json", JSON.stringify({ renderId: "render-1-abc12345", timeline: { path: "artifacts/edit-timeline.json", hash: `sha256:${timelineHash}` } }));
  const spec = JSON.parse(specText.toString("utf-8"));
  const proposal = {
    apiVersion: "studio.video/v1alpha1",
    kind: "SeriesReference",
    id: "morning-v1",
    episodeRef: REF,
    template: spec.template,
    spec: { path: "reviews/references/morning-v1/episode-spec.json", hash: `sha256:${specHash}` },
    timeline: { path: "reviews/references/morning-v1/edit-timeline.json", hash: `sha256:${timelineHash}` },
    render: { path: "output/render-1-abc12345.mp4", hash: `sha256:${renderHash}` },
    report: { path: "output/render-1-abc12345.report.json", hash: `sha256:${reportHash}` },
    metadata: { proposedAt: "2026-10-06T00:00:00.000Z" },
  };
  const approval = signReceipt(buildReferenceApproval({ reference: proposal, at: "2026-10-06T01:00:00.000Z" }), KEY);
  writeDescriptor({ ...proposal, approval });
  return { ...proposal, approval };
}

function writeDescriptor(reference) {
  mkdirSync(dirname(descriptorPath()), { recursive: true });
  writeFileSync(descriptorPath(), `${JSON.stringify(reference, null, 2)}\n`);
}

const codes = (verdict) => verdict.problems.map((p) => p.code);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-references-"));
  seriesDir = join(root, REF.channel, "series", REF.series);
  mkdirSync(episodeDir(), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("verifySeriesReference", () => {
  it("trusts a reference whose every check passes", () => {
    const reference = makeReference();
    const verdict = verify();
    assert.equal(verdict.state, "trusted", JSON.stringify(verdict.problems));
    assert.deepEqual(verdict.problems, []);
    assert.deepEqual(verdict.reference, reference);
  });

  it("verifies a descriptor's text in place of the file, before it is written", () => {
    const reference = makeReference();
    const text = readFileSync(descriptorPath(), "utf-8");
    unlinkSync(descriptorPath());
    const verdict = verifySeriesReference({ seriesDir, templateId: "poetry-short", referenceId: "morning-v1", key: KEY, descriptor: text });
    assert.equal(verdict.state, "trusted", JSON.stringify(verdict.problems));
    assert.deepEqual(verdict.reference, reference);
  });

  it("is unverifiable without the operator key", () => {
    makeReference();
    const verdict = verify(null);
    assert.equal(verdict.state, "unverifiable");
    assert.deepEqual(codes(verdict), ["no-operator-key"]);
  });

  it("missing-reference and bad-reference", () => {
    assert.deepEqual(codes(verify()), ["missing-reference"]);
    mkdirSync(dirname(descriptorPath()), { recursive: true });
    writeFileSync(descriptorPath(), "{ half");
    assert.deepEqual(codes(verify()), ["bad-reference"]);
  });

  it("refuses a descriptor whose shape the contract rejects", () => {
    const reference = makeReference();
    writeDescriptor({ ...reference, render: { ...reference.render, path: "output/current.json" } });
    assert.equal(verify().state, "invalid");
    assert.ok(codes(verify()).includes("reference-render"));
  });

  it("reference-identity: a descriptor filed under another id", () => {
    const reference = makeReference();
    const other = seriesReferencePath(root, REF.channel, REF.series, "poetry-short", "evening-v1");
    writeFileSync(other, JSON.stringify(reference));
    assert.deepEqual(codes(verifySeriesReference({ seriesDir, templateId: "poetry-short", referenceId: "evening-v1", key: KEY })), ["reference-identity"]);
  });

  it("bad-signature: the approval edited after signing, or signed with another key", () => {
    const reference = makeReference();
    writeDescriptor({ ...reference, approval: { ...reference.approval, note: "approved by someone else" } });
    assert.deepEqual(codes(verify()), ["bad-signature"]);
    makeReference();
    assert.deepEqual(codes(verify("another-key")), ["bad-signature"]);
  });

  it("not-an-approval: a signed receipt for something else", () => {
    const reference = makeReference();
    const { signature: _s, ...unsigned } = reference.approval;
    const other = signReceipt({ ...unsigned, stageId: "render" }, KEY);
    writeDescriptor({ ...reference, approval: other });
    assert.deepEqual(codes(verify()), ["not-an-approval"]);
  });

  it("proposal-mismatch: a descriptor changed anywhere the approval's proposal hash covers, metadata included", () => {
    const reference = makeReference();
    writeDescriptor({ ...reference, metadata: { proposedAt: reference.metadata.proposedAt, approvedFor: "something else" } });
    assert.deepEqual(codes(verify()), ["proposal-mismatch"]);
  });

  it("withdrawn: a signed withdrawal of this exact descriptor", () => {
    const reference = makeReference();
    const withdrawal = signReceipt(buildReferenceWithdrawal({ reference, descriptorHash: sha256(readFileSync(descriptorPath())), reason: "the voice was replaced" }), KEY);
    writeFileSync(seriesReferenceWithdrawalPath(root, REF.channel, REF.series, "poetry-short", "morning-v1"), JSON.stringify(withdrawal));
    const verdict = verify();
    assert.equal(verdict.state, "withdrawn");
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.withdrawal.note, "the voice was replaced");
  });

  it("bad-withdrawal: a forged withdrawal neither disables the reference quietly nor is ignored", () => {
    const reference = makeReference();
    const forged = signReceipt(buildReferenceWithdrawal({ reference, descriptorHash: sha256(readFileSync(descriptorPath())), reason: "forged" }), "not-the-operator-key");
    writeFileSync(seriesReferenceWithdrawalPath(root, REF.channel, REF.series, "poetry-short", "morning-v1"), JSON.stringify(forged));
    const verdict = verify();
    assert.equal(verdict.state, "invalid");
    assert.deepEqual(codes(verdict), ["bad-withdrawal"]);
  });

  it("bad-withdrawal: a withdrawal of another version of the descriptor", () => {
    const reference = makeReference();
    const withdrawal = signReceipt(buildReferenceWithdrawal({ reference, descriptorHash: "0".repeat(64), reason: "another file" }), KEY);
    writeFileSync(seriesReferenceWithdrawalPath(root, REF.channel, REF.series, "poetry-short", "morning-v1"), JSON.stringify(withdrawal));
    assert.deepEqual(codes(verify()), ["bad-withdrawal"]);
  });

  it("missing-file: the render is gone", () => {
    makeReference();
    unlinkSync(join(episodeDir(), "output/render-1-abc12345.mp4"));
    assert.deepEqual(codes(verify()), ["missing-file"]);
  });

  it("path-escape: a snapshot that is a link out of the episode", () => {
    makeReference();
    const outside = join(root, "elsewhere.mp4");
    writeFileSync(outside, "fake mp4 bytes");
    unlinkSync(join(episodeDir(), "output/render-1-abc12345.mp4"));
    symlinkSync(outside, join(episodeDir(), "output/render-1-abc12345.mp4"));
    assert.deepEqual(codes(verify()), ["path-escape"]);
  });

  it("hash-mismatch: a snapshot edited after approval", () => {
    makeReference();
    writeFileSync(join(episodeDir(), "reviews/references/morning-v1/edit-timeline.json"), "{}");
    assert.deepEqual(codes(verify()), ["hash-mismatch"]);
  });

  it("missing-release: the pinned release is gone, and today's is never used instead", () => {
    makeReference();
    rmSync(join(seriesDir, "templates", "poetry-short", "1.0.0"), { recursive: true });
    assert.deepEqual(codes(verify()), ["missing-release"]);
  });

  it("frozen-spec: a release edited in place no longer validates the snapshot", () => {
    makeReference();
    writeFileSync(join(seriesDir, "templates", "poetry-short", "1.0.0", "FORMAT.md"), "A quiet change of style.\n");
    const verdict = verify();
    assert.equal(verdict.state, "invalid");
    assert.ok(codes(verdict).every((c) => c === "frozen-spec"), JSON.stringify(verdict.problems));
  });

  it("provenance-mismatch: the report names another timeline", () => {
    const reference = makeReference();
    const report = JSON.stringify({ timeline: { hash: `sha256:${"1".repeat(64)}` } });
    const reportHash = put("output/render-1-abc12345.report.json", report);
    const updated = { ...reference, report: { ...reference.report, hash: `sha256:${reportHash}` } };
    const { approval: _a, ...proposal } = updated;
    writeDescriptor({ ...proposal, approval: signReceipt(buildReferenceApproval({ reference: proposal }), KEY) });
    assert.deepEqual(codes(verify()), ["provenance-mismatch"]);
  });
});

describe("reference receipts", () => {
  it("an approval commits to the exact proposal and binds the four files", () => {
    const reference = makeReference();
    const { approval, ...proposal } = reference;
    assert.equal(approval.stageId, REFERENCE_REVIEW_STAGE);
    assert.equal(approval.binding.planHash, proposalHash(proposal));
    assert.deepEqual(approval.binding.inputs.map((i) => i.path), [reference.spec.path, reference.timeline.path]);
    assert.deepEqual(approval.binding.outputs.map((o) => o.path), [reference.render.path, reference.report.path]);
    assert.equal(verifyReceipt(approval, KEY), true);
  });

  it("a withdrawal needs a reason", () => {
    const reference = makeReference();
    assert.throws(() => buildReferenceWithdrawal({ reference, descriptorHash: "0".repeat(64), reason: "" }), /note/);
  });
});
