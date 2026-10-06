# Golden References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Golden references (avg-jao.6): `verifySeriesReference` and the reference receipts in `@studio/contracts`, `proposeReference` in `@studio/episode` with the agent tool `pva_propose_reference`, the operator's `vpr reference approve | withdraw | verify | list`, the `propose-reference` skill and the docs.

**Architecture:** Verification is one ordered function over files (descriptor, signature, withdrawal, files, frozen spec against its pinned release, provenance) returning `trusted | withdrawn | invalid | unverifiable`. Pi only proposes (freezes snapshots, unsigned); the operator's CLI signs with the operator key, verifies the descriptor's text before writing, and creates descriptors and withdrawals exclusively. No journal events: review events are the execution service's alone (avg-qr4.3).

**Tech Stack:** Node ESM `.mjs` + `.d.mts` (contracts, `node:test`), TypeScript (episode, runtime, agent; vitest), HMAC receipts (`signReceipt`/`verifyReceipt`).

**Spec:** `docs/superpowers/specs/2026-10-06-series-references-design.md`

## Global Constraints

- Branch `feat/series-references` (holds the spec commit). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit paths only; never stage `.beads/`; never run `bd`.
- Nothing in `studio/agent/src` may name the operator key or its env var (`no-operator-key` test). Pi never signs.
- Descriptors (`templates/<tid>/references/<id>.json`) and withdrawals (`<id>.withdrawal.json`) are created exclusively and never rewritten.
- No journal writes from the reference code.
- Rebuild after changing sources consumed through `dist/`: `npm run build --workspace @studio/episode`, `npm run build --workspace @studio/runtime` (the CLI tests spawn `dist/src/cli.js`).
- No dependency changes (no `bun install`).
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.

## Review Focus

- A spec edited after the render but still compiling → proposing refuses `spec-changed` (Task 2 test), so a frozen spec always matches its frozen timeline.
- A forged withdrawal file → the reference is `invalid` (`bad-withdrawal`), never quietly withdrawn nor ignored (Task 1 test).
- Pi's shell running `vpr reference approve` with the key file reachable → refused, because a headless caller is never the operator (Task 3 test).
- A proposal whose render was replaced after proposing → `approve` refuses `proposal-changed`, nothing written (Task 3 test).
- The pinned release removed before approval → `approve` refuses `not-trusted` with `missing-release`, nothing written (Task 3 test).

---

### Task 1: Contracts — `verifySeriesReference` and the reference receipts

**Files:**
- Create: `studio/contracts/src/series-references.mjs`, `studio/contracts/src/series-references.d.mts`, `studio/contracts/test/series-references.test.mjs`
- Modify: `studio/contracts/src/layout.mjs`, `studio/contracts/src/layout.d.mts`, `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md`

**Interfaces:**
- Consumes: `buildGateReview` (gate-review.mjs), `canonicalJson`, `verifyReceipt` (receipt.mjs), `validateEpisodeSpec`, `validateSeriesReference`, `SERIES_TEMPLATE_FILES` (series-templates.mjs), `EPISODES_CONTAINER` (layout.mjs).
- Produces: `REFERENCE_REVIEW_STAGE = "reference-review"`, `REFERENCE_SNAPSHOT_DIR = "reviews/references"`, `proposalHash(proposal) → hex`, `buildReferenceApproval({reference, at?, note?}) → GateReview` (unsigned), `buildReferenceWithdrawal({reference, descriptorHash, reason, at?}) → GateReview` (unsigned), `verifySeriesReference({seriesDir, templateId, referenceId, key, descriptor?}) → {state: "trusted"|"withdrawn"|"invalid"|"unverifiable", reference, problems: {code, message, path}[], withdrawal?}`; types `ReferenceProposal`, `ReferenceVerdict`, `ReferenceProblem`; `seriesReferenceWithdrawalPath(root, channel, series, templateId, referenceId)`.

- [ ] **Step 1: Write the failing tests**

`studio/contracts/test/series-references.test.mjs`:

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/contracts && node --test test/series-references.test.mjs`
Expected: FAIL — cannot find `../src/series-references.mjs`.

- [ ] **Step 3: Implement**

Apply to `studio/contracts/src/layout.mjs` and `studio/contracts/src/layout.d.mts`:

```diff
diff --git a/studio/contracts/src/layout.mjs b/studio/contracts/src/layout.mjs
index 977c45b..52d5a1e 100644
--- a/studio/contracts/src/layout.mjs
+++ b/studio/contracts/src/layout.mjs
@@ -117,6 +117,11 @@ export function seriesReferencePath(root, channel, series, templateId, reference
   return join(seriesPath(root, channel, series), "templates", templateId, "references", `${referenceId}.json`);
 }
 
+/** A reference's withdrawal: beside its descriptor, append-only like it (avg-jao.6). */
+export function seriesReferenceWithdrawalPath(root, channel, series, templateId, referenceId) {
+  return seriesReferencePath(root, channel, series, templateId, referenceId).replace(/\.json$/, ".withdrawal.json");
+}
+
 /** Path to a channel source: shared material episodes pin, never copy (ADR-0035). */
 export function sourcePath(root, channel, name) {
   return join(channelPath(root, channel), "sources", name);
diff --git a/studio/contracts/src/layout.d.mts b/studio/contracts/src/layout.d.mts
index 5ecfd6f..6b4ab19 100644
--- a/studio/contracts/src/layout.d.mts
+++ b/studio/contracts/src/layout.d.mts
@@ -19,6 +19,7 @@ export declare function episodesContainerPath(root: string, channel: string, ser
 export declare function episodePath(root: string, channel: string, series: string, episode: string): string;
 export declare function seriesTemplatePath(root: string, channel: string, series: string, id: string, version: string): string;
 export declare function seriesReferencePath(root: string, channel: string, series: string, templateId: string, referenceId: string): string;
+export declare function seriesReferenceWithdrawalPath(root: string, channel: string, series: string, templateId: string, referenceId: string): string;
 export declare function sourcePath(root: string, channel: string, name: string): string;
 export declare function workspacePath(
   root: string,
```

`studio/contracts/src/series-references.mjs`:

```js
// ---------------------------------------------------------------------------
// Golden references: trust, approval and withdrawal (avg-jao.6, ADR-0037)
// ---------------------------------------------------------------------------
// A SeriesReference is evidence that a person approved one episode as the
// series' standard. Its shape (validateSeriesReference) proves nothing; this
// module is what turns a descriptor on disk into a verdict: the operator's
// signature, the files it binds, the release its spec was pinned to, and
// whether it has since been withdrawn. It reads files and never writes them.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { buildGateReview } from "./gate-review.mjs";
import { EPISODES_CONTAINER } from "./layout.mjs";
import { canonicalJson, verifyReceipt } from "./receipt.mjs";
import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateSeriesReference } from "./series-templates.mjs";

/** The stage id every reference approval and withdrawal carries. */
export const REFERENCE_REVIEW_STAGE = "reference-review";
/** Where an episode keeps the frozen snapshots of its proposed references. */
export const REFERENCE_SNAPSHOT_DIR = "reviews/references";

const issue = (code, path, message) => ({ code, path, message });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const episodeSlug = (ref) => `${ref.channel}/${ref.series}/${ref.episode}`;

/** sha256 hex of a proposal: what an approval's planHash commits to. */
export function proposalHash(proposal) {
  return sha256(canonicalJson(proposal));
}

/**
 * The approval a reference carries, unsigned: a human approved these four
 * files as the series' standard. The caller signs it with the operator key.
 */
export function buildReferenceApproval({ reference, at, note }) {
  const bare = (field) => ({ path: reference[field].path, sha256: reference[field].hash.slice("sha256:".length) });
  const { approval: _ignored, ...proposal } = reference;
  return buildGateReview({
    stageId: REFERENCE_REVIEW_STAGE,
    decision: "approved",
    origin: "human",
    actor: "human",
    binding: {
      planHash: proposalHash(proposal),
      inputs: [bare("spec"), bare("timeline")],
      outputs: [bare("render"), bare("report")],
    },
    episode: episodeSlug(reference.episodeRef),
    ...(at !== undefined ? { at } : {}),
    ...(note !== undefined ? { note } : {}),
  });
}

/**
 * A withdrawal, unsigned: a human rejected this exact descriptor (its file's
 * hash) as a reference, for `reason`. The caller signs it.
 */
export function buildReferenceWithdrawal({ reference, descriptorHash, reason, at }) {
  return buildGateReview({
    stageId: REFERENCE_REVIEW_STAGE,
    decision: "rejected",
    origin: "human",
    actor: "human",
    binding: { planHash: descriptorHash, inputs: [{ path: `${reference.id}.json`, sha256: descriptorHash }], outputs: [] },
    episode: episodeSlug(reference.episodeRef),
    note: reason,
    ...(at !== undefined ? { at } : {}),
  });
}

/**
 * Every check ADR-0037 requires before a reference is trusted, in order,
 * stopping at the first that fails. `seriesDir` is
 * `<library>/<channel>/series/<series>`; `key` the operator key, or null.
 * `descriptor`, when given, is the descriptor's text to verify in place of
 * the file — what `vpr reference approve` checks before writing it.
 */
export function verifySeriesReference({ seriesDir, templateId, referenceId, key, descriptor }) {
  const refsDir = join(seriesDir, "templates", templateId, "references");
  const descriptorPath = join(refsDir, `${referenceId}.json`);
  const at = `templates/${templateId}/references/${referenceId}.json`;
  const verdict = (state, problems = [], reference = null, extra = {}) => ({ state, reference, problems, ...extra });

  // 1. The descriptor.
  if (descriptor === undefined && !existsSync(descriptorPath)) return verdict("invalid", [issue("missing-reference", at, `${at} does not exist`)]);
  const descriptorBytes = descriptor === undefined ? readFileSync(descriptorPath) : Buffer.from(descriptor, "utf-8");
  let reference;
  try {
    reference = JSON.parse(descriptorBytes.toString("utf-8"));
  } catch (error) {
    return verdict("invalid", [issue("bad-reference", at, `not JSON: ${error.message}`)]);
  }
  const shape = validateSeriesReference(reference);
  if (shape.length > 0) return verdict("invalid", shape.map((p) => issue(p.code, `${at}#${p.path}`, p.message)), reference);
  const series = basename(seriesDir);
  const channel = basename(dirname(dirname(seriesDir)));
  if (reference.id !== referenceId || reference.template.id !== templateId
    || reference.episodeRef.series !== series || reference.episodeRef.channel !== channel) {
    return verdict("invalid", [issue("reference-identity", at,
      `${reference.id} (${reference.episodeRef.channel}/${reference.episodeRef.series}, template ${reference.template.id}) is not ${referenceId} of ${channel}/${series}, template ${templateId}`)], reference);
  }

  // 2. The operator's signature.
  if (!key) return verdict("unverifiable", [issue("no-operator-key", at, "no operator key to verify the approval with")], reference);
  const approval = reference.approval;
  if (!verifyReceipt(approval, key)) {
    return verdict("invalid", [issue("bad-signature", `${at}#$.approval`, "the approval's signature does not verify with the operator key")], reference);
  }
  if (approval.origin !== "human" || approval.decision !== "approved" || approval.stageId !== REFERENCE_REVIEW_STAGE
    || approval.episode !== episodeSlug(reference.episodeRef)) {
    return verdict("invalid", [issue("not-an-approval", `${at}#$.approval`,
      `the receipt is a ${approval.origin} ${approval.decision} of "${approval.stageId}" for ${approval.episode}, not a human approval of this reference`)], reference);
  }

  // 3. A withdrawal, if any: valid → withdrawn; forged → invalid, never ignored.
  const withdrawalPath = join(refsDir, `${referenceId}.withdrawal.json`);
  if (existsSync(withdrawalPath)) {
    const wat = `templates/${templateId}/references/${referenceId}.withdrawal.json`;
    let withdrawal;
    try {
      withdrawal = JSON.parse(readFileSync(withdrawalPath, "utf-8"));
    } catch {
      withdrawal = null;
    }
    const descriptorHash = sha256(descriptorBytes);
    const valid = withdrawal && verifyReceipt(withdrawal, key) && withdrawal.origin === "human" && withdrawal.decision === "rejected"
      && withdrawal.stageId === REFERENCE_REVIEW_STAGE && withdrawal.episode === approval.episode
      && Array.isArray(withdrawal.binding?.inputs)
      && withdrawal.binding.inputs.some((i) => i.path === `${referenceId}.json` && i.sha256 === descriptorHash);
    if (!valid) {
      return verdict("invalid", [issue("bad-withdrawal", wat, "a withdrawal is present but is not a signed human withdrawal of this descriptor")], reference);
    }
    return verdict("withdrawn", [], reference, { withdrawal });
  }

  // 4. The files, inside the source episode, as declared.
  const episodeDir = join(seriesDir, EPISODES_CONTAINER, reference.episodeRef.episode);
  const ep = `${EPISODES_CONTAINER}/${reference.episodeRef.episode}`;
  if (!existsSync(episodeDir)) return verdict("invalid", [issue("missing-file", ep, `the source episode ${ep} is missing`)], reference);
  const root = realpathSync(episodeDir);
  const bytes = {};
  for (const field of ["spec", "timeline", "render", "report"]) {
    const { path, hash } = reference[field];
    const where = `${ep}/${path}`;
    const file = join(episodeDir, path);
    if (!existsSync(file)) return verdict("invalid", [issue("missing-file", where, `${where} is missing`)], reference);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) {
      return verdict("invalid", [issue("path-escape", where, `${where} is not a file inside the source episode`)], reference);
    }
    bytes[field] = readFileSync(real);
    if (`sha256:${sha256(bytes[field])}` !== hash) {
      return verdict("invalid", [issue("hash-mismatch", where, `${where} is not the file the reference recorded`)], reference);
    }
  }

  // 5. The frozen spec, against the release it is pinned to — never today's.
  const releaseDir = join(seriesDir, "templates", reference.template.id, reference.template.version);
  const rel = `templates/${reference.template.id}/${reference.template.version}`;
  const names = ["series-template.json", ...Object.values(SERIES_TEMPLATE_FILES)];
  if (!names.every((name) => existsSync(join(releaseDir, name)))) {
    return verdict("invalid", [issue("missing-release", rel, `the pinned release ${rel} is not in the series`)], reference);
  }
  const text = (name) => readFileSync(join(releaseDir, name), "utf-8");
  const bundle = { manifest: text("series-template.json"), files: Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((n) => [n, text(n)])) };
  let spec;
  try {
    spec = JSON.parse(bytes.spec.toString("utf-8"));
  } catch {
    spec = null;
  }
  const specProblems = spec ? validateEpisodeSpec(spec, bundle) : [issue("frozen-spec", "$", "not JSON")];
  if (specProblems.length > 0) {
    return verdict("invalid", specProblems.map((p) => issue("frozen-spec", `${ep}/${reference.spec.path}#${p.path}`, `${p.code}: ${p.message}`)), reference);
  }
  if (episodeSlug(spec.episodeRef) !== episodeSlug(reference.episodeRef)) {
    return verdict("invalid", [issue("reference-identity", `${ep}/${reference.spec.path}#$.episodeRef`, "the frozen spec belongs to another episode")], reference);
  }
  if (spec.template.id !== reference.template.id || spec.template.version !== reference.template.version || spec.template.hash !== reference.template.hash) {
    return verdict("invalid", [issue("reference-identity", `${ep}/${reference.spec.path}#$.template`, "the frozen spec pins another release than the reference")], reference);
  }

  // 6. Provenance: the timeline was compiled from that spec, and the render from that timeline.
  let timeline;
  let report;
  try {
    timeline = JSON.parse(bytes.timeline.toString("utf-8"));
    report = JSON.parse(bytes.report.toString("utf-8"));
  } catch {
    return verdict("invalid", [issue("provenance-mismatch", ep, "the timeline snapshot or the report is not JSON")], reference);
  }
  if (timeline?.derivedFrom?.spec?.hash !== reference.spec.hash) {
    return verdict("invalid", [issue("provenance-mismatch", `${ep}/${reference.timeline.path}#$.derivedFrom.spec.hash`, "the timeline was not compiled from the frozen spec")], reference);
  }
  if (report?.timeline?.hash !== reference.timeline.hash) {
    return verdict("invalid", [issue("provenance-mismatch", `${ep}/${reference.report.path}#$.timeline.hash`, "the render was not made from the frozen timeline")], reference);
  }

  return verdict("trusted", [], reference);
}
```

`studio/contracts/src/series-references.d.mts`:

```ts
// Type declarations for golden-reference verification (avg-jao.6).

import type { GateReview } from "./gate-review.mjs";
import type { SeriesReference } from "./series-templates.mjs";

export declare const REFERENCE_REVIEW_STAGE: "reference-review";
export declare const REFERENCE_SNAPSHOT_DIR: "reviews/references";

export type ReferenceState = "trusted" | "withdrawn" | "invalid" | "unverifiable";

export interface ReferenceProblem {
  code: string;
  message: string;
  /** Relative to the series directory, with `#<JSON path>` when inside a document. */
  path: string;
}

export interface ReferenceVerdict {
  state: ReferenceState;
  /** The parsed descriptor, when it could be read. */
  reference: SeriesReference | null;
  /** Empty when trusted or withdrawn. */
  problems: ReferenceProblem[];
  /** Present when withdrawn. */
  withdrawal?: GateReview;
}

/** A SeriesReference without its approval: what is proposed, and what an approval commits to. */
export type ReferenceProposal = Omit<SeriesReference, "approval">;

/** sha256 hex of the canonical proposal. */
export declare function proposalHash(proposal: ReferenceProposal): string;

/** The unsigned approval a reference carries. */
export declare function buildReferenceApproval(input: {
  reference: ReferenceProposal | SeriesReference;
  at?: string;
  note?: string;
}): GateReview;

/** The unsigned withdrawal of a descriptor whose file hashes to `descriptorHash` (hex). */
export declare function buildReferenceWithdrawal(input: {
  reference: SeriesReference;
  descriptorHash: string;
  reason: string;
  at?: string;
}): GateReview;

/** Every ADR-0037 check, in order; reads files, writes nothing. */
export declare function verifySeriesReference(input: {
  seriesDir: string;
  templateId: string;
  referenceId: string;
  key: string | null;
  /** The descriptor's text, verified in place of the file when given. */
  descriptor?: string;
}): ReferenceVerdict;
```

Docs:

```diff
diff --git a/studio/contracts/README.md b/studio/contracts/README.md
index b03e62e..676621d 100644
--- a/studio/contracts/README.md
+++ b/studio/contracts/README.md
@@ -53,6 +53,13 @@ Filesystem mutation, pipeline execution, creative skills, provider calls, render
   bindings, **not** a signature/file trust check or approval operation.
 - `placeholderPaths(data)`: JSON paths of unresolved content.
 
+`src/series-references.mjs` (`avg-jao.6`) is where a descriptor becomes a
+verdict: `verifySeriesReference({seriesDir, templateId, referenceId, key})`
+reads the descriptor, its signature, a withdrawal, the files, the pinned
+release and the provenance, and answers `trusted`, `withdrawn`, `invalid` or
+`unverifiable`; `buildReferenceApproval` and `buildReferenceWithdrawal` build
+the receipts the operator's CLI signs. It reads files and never writes them.
+
 Validators return `{code, path, message}[]`. Instantiation throws on invalid
 bundles or episode identities. Bundle validity alone does not prove its unfilled
 defaults can form a valid episode: validate a filled example before release.
diff --git a/studio/contracts/docs/contract-catalog.md b/studio/contracts/docs/contract-catalog.md
index e014cee..27ddff4 100644
--- a/studio/contracts/docs/contract-catalog.md
+++ b/studio/contracts/docs/contract-catalog.md
@@ -20,7 +20,7 @@ This catalog assigns every durable wire or workspace concept to one contract fam
 | `cue` | Cue grammar for series specs (word, prefix, seconds, word/line/take/mark objects) and its resolution to frames against a take's Word Timing | series spec authors (Pi, editors) | series compilers | `avg-7zp.2` |
 | `narration-takes` | Narration Takes: provider-neutral take registry (text, spoken text as sent, voice provenance, word timing ref, narration-manifest source) and unit sequences with pauses and scene pauses; unit layout; Qwen manifest mapping | TTS provider adapters, Qwen worker via mapping | series compilers, cue resolver, composer | `avg-7zp.4` |
 | `source-pin` | Source Pin: shared material an episode reads without copying (channel source or episode), its file inventory and the stages that read it | `vpr pin add`, series compilers | runtime status, `vpr pin renew` | `avg-7zp.5` |
-| `series-template` | Immutable SeriesTemplate release manifest, hash-pinned editorial EpisodeSpec, SeriesReference golden snapshot/approval descriptor (ADR-0037) | series authors, future runtime compiler/reference services | Pi/editors, series compiler and QA | `avg-jao.1` |
+| `series-template` | Immutable SeriesTemplate release manifest, hash-pinned editorial EpisodeSpec, SeriesReference golden snapshot/approval descriptor (ADR-0037) | series authors, the operator's `vpr reference` (approve, withdraw) | Pi/editors, series compiler and QA, `verifySeriesReference` | `avg-jao.1`, `avg-jao.6` |
 | `event` | Journal Event envelope, correlation and causation, typed lifecycle payloads, cursor | runtime and services | gateway, projections, web, Pi | `vwc-5q0.7` |
 | `review` | Review Thread, anchor, reply, resolution, stale anchor, approval decision | users, Pi, gateway | runtime, gateway, web, Pi | `vwc-5q0.7` |
 | `policy` | Approval Policy, Budget Envelope, reservation/reconciliation, material downgrade, stale acceptance | channel/series owners and runtime | runtime, Pi, gateway, web, adapters | `vwc-5q0.3`, `vwc-5q0.7` |
```

- [ ] **Step 4: Run the tests and the contracts check**

Run: `cd studio/contracts && node --test test/series-references.test.mjs && npm run check`
Expected: `# pass 19`; then the whole contracts check passes (`# pass 373`).

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/src/series-references.mjs studio/contracts/src/series-references.d.mts studio/contracts/test/series-references.test.mjs studio/contracts/src/layout.mjs studio/contracts/src/layout.d.mts studio/contracts/README.md studio/contracts/docs/contract-catalog.md
git commit -m "feat(contracts): verify, approve and withdraw golden references (avg-jao.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `proposeReference` and `pva_propose_reference`

**Files:**
- Create: `studio/episode/src/references.ts`, `studio/episode/tests/references.test.ts`, `studio/agent/tests/propose-reference.test.ts`
- Modify: `studio/episode/src/index.ts`, `studio/agent/src/capability-tools.ts`, `studio/agent/tests/extension.test.ts`, `studio/agent/tests/e2e-scenarios.test.ts`

**Interfaces:**
- Consumes: `REFERENCE_SNAPSHOT_DIR`, `ReferenceProposal` (Task 1); `checkEpisode`, `isSpecDriven`, `EDIT_TIMELINE_PATH`, `writeEditTimeline` (`@studio/episode`).
- Produces: `proposeReference(episodeDir, {episodeRef, referenceId}) → {ok: true, proposal, paths: string[]} | {ok: false, problems}` with codes `bad-id`, `no-spec`, `reference-exists`, `no-render`, `timeline-changed`, `spec-changed`, `series-rules` and the loader's own; tool `pva_propose_reference {channel, series, episode, referenceId}`.

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/references.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeEditTimeline } from "../src/episode-render.js";
import { proposeReference } from "../src/references.js";
import { editSpec, specEpisode } from "../src/testing.js";

/**
 * proposeReference (avg-jao.6): what a person would approve, frozen; nothing
 * signed. A render is faked: the file, its report naming the timeline it was
 * made from, and output/current.json.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Compile the timeline and fake its render, as renderEpisode would leave it. */
function rendered(): void {
  writeEditTimeline(dir(), { episodeRef: REF });
  mkdirSync(at("output"), { recursive: true });
  writeFileSync(at("output/render-1-abcd1234.mp4"), "fake mp4");
  const timelineHash = sha256(readFileSync(at("artifacts/edit-timeline.json")));
  writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify({ renderId: "render-1-abcd1234", timeline: { path: "artifacts/edit-timeline.json", hash: timelineHash } }));
  writeFileSync(at("output/current.json"), JSON.stringify({ renderId: "render-1-abcd1234", path: "render-1-abcd1234.mp4" }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "propose-reference-"));
  specEpisode(dir(), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const codes = (result: ReturnType<typeof proposeReference>) => (result.ok ? [] : result.problems.map((p) => p.code));

describe("proposeReference", () => {
  it("freezes the spec and the timeline and writes the proposal with every hash", () => {
    rendered();
    const result = proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.paths).toEqual([
      "reviews/references/morning-v1/episode-spec.json",
      "reviews/references/morning-v1/edit-timeline.json",
      "reviews/references/morning-v1/proposal.json",
    ]);
    const { proposal } = result;
    expect(readFileSync(at(proposal.spec.path))).toEqual(readFileSync(at("episode-spec.json")));
    expect(readFileSync(at(proposal.timeline.path))).toEqual(readFileSync(at("artifacts/edit-timeline.json")));
    for (const field of ["spec", "timeline", "render", "report"] as const) {
      expect(proposal[field].hash).toBe(sha256(readFileSync(at(proposal[field].path))));
    }
    expect(proposal.render.path).toBe("output/render-1-abcd1234.mp4");
    expect(proposal.report.path).toBe("output/render-1-abcd1234.report.json");
    expect(proposal.template.id).toBe("poetry-short");
    expect(JSON.parse(readFileSync(at("reviews/references/morning-v1/proposal.json"), "utf-8"))).toEqual(proposal);
    expect("approval" in proposal).toBe(false);
  });

  it("writes nothing outside reviews/references/<id>/", () => {
    rendered();
    const before = readdirSync(dir(), { recursive: true }).map(String).sort();
    proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
    const added = readdirSync(dir(), { recursive: true }).map(String).filter((f) => !before.includes(f));
    expect(added.every((f) => f.startsWith("reviews"))).toBe(true);
  });

  it("refuses an id already proposed, or already promoted in the series", () => {
    rendered();
    proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["reference-exists"]);
    const promoted = join(dirname(dirname(dir())), "templates/poetry-short/references/evening-v1.json");
    mkdirSync(dirname(promoted), { recursive: true });
    writeFileSync(promoted, "{}");
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "evening-v1" }))).toEqual(["reference-exists"]);
    expect(existsSync(at("reviews/references/evening-v1"))).toBe(false);
  });

  it("bad-id, no-spec, no-render", () => {
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "Morning V1" }))).toEqual(["bad-id"]);
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["no-render"]);
    unlinkSync(at("episode-spec.json"));
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["no-spec"]);
  });

  it("timeline-changed: the timeline is no longer the one the render was made from", () => {
    rendered();
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[0].items[0].duration = 113;
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["timeline-changed"]);
    expect(existsSync(at("reviews/references/morning-v1"))).toBe(false);
  });

  it("series-rules: a rendered timeline that breaks the series' rules is no standard", () => {
    rendered();
    // A caption rewritten by hand, then "rendered" as it stands.
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    const report = JSON.parse(readFileSync(at("output/render-1-abcd1234.report.json"), "utf-8"));
    report.timeline.hash = sha256(readFileSync(at("artifacts/edit-timeline.json")));
    writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify(report));
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["series-rules"]);
  });

  it("spec-changed: the spec was edited after the timeline was compiled", () => {
    rendered();
    editSpec(dir(), (spec) => { spec.data.title = "Morning, again"; spec.revision = 3; });
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["spec-changed"]);
    expect(existsSync(at("reviews/references/morning-v1"))).toBe(false);
  });

  it("an episode whose release was edited in place cannot be proposed", () => {
    rendered();
    writeFileSync(join(dirname(dirname(dir())), "templates/poetry-short/1.0.0/FORMAT.md"), "A quiet change of style.\n");
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["hash-mismatch"]);
  });
});
```

`studio/agent/tests/propose-reference.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditTimeline } from "@studio/episode";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_propose_reference (avg-jao.6): Pi proposes, a person approves. What a
 * proposal freezes is @studio/episode's proposeReference; here, what the tool
 * says, and that it signs nothing.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-propose-reference-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  specEpisode(dir(), REF);
  writeEditTimeline(dir(), { episodeRef: REF });
  mkdirSync(at("output"), { recursive: true });
  writeFileSync(at("output/render-1-abcd1234.mp4"), "fake mp4");
  const hash = `sha256:${createHash("sha256").update(readFileSync(at("artifacts/edit-timeline.json"))).digest("hex")}`;
  writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify({ timeline: { path: "artifacts/edit-timeline.json", hash } }));
  writeFileSync(at("output/current.json"), JSON.stringify({ renderId: "render-1-abcd1234", path: "render-1-abcd1234.mp4" }));
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_propose_reference")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_propose_reference", () => {
  it("freezes the proposal and tells the person the command that approves it", async () => {
    const result = await tool({ referenceId: "morning-v1" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/^✅ proposed morning-v1 for sample\/poetry \(template poetry-short@1\.0\.0\)/);
    expect(text).toContain("  - reviews/references/morning-v1/proposal.json");
    expect(text).toContain("Only a person can make it a reference");
    expect(text).toContain("  vpr reference approve sample/poetry/morning morning-v1");
    const proposal = JSON.parse(readFileSync(at("reviews/references/morning-v1/proposal.json"), "utf-8"));
    expect(proposal.approval).toBeUndefined();
    expect(existsSync(join(root, REF.channel, "series", REF.series, "templates/poetry-short/references/morning-v1.json"))).toBe(false);
  });

  it("says why nothing was proposed", async () => {
    await tool({ referenceId: "morning-v1" });
    const again = await tool({ referenceId: "morning-v1" });
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toMatch(/reference-exists at reviews\/references\/morning-v1/);
  });
});
```

Apply to the agent's tool-list tests:

```diff
diff --git a/studio/agent/tests/extension.test.ts b/studio/agent/tests/extension.test.ts
index 24a23c0..fa156e3 100644
--- a/studio/agent/tests/extension.test.ts
+++ b/studio/agent/tests/extension.test.ts
@@ -129,7 +129,7 @@ describe("extensions/index.ts — tool registration", () => {
   });
 
   it("registers the expected suite of production tools", () => {
-    expect(mockPi.tools.length).toBe(45);
+    expect(mockPi.tools.length).toBe(46);
     const names = mockPi.tools.map((t) => t.name).sort();
     expect(names).toEqual([
       "pva_blender_create_scene",
@@ -163,6 +163,7 @@ describe("extensions/index.ts — tool registration", () => {
       "pva_plan_rerun",
       "pva_poly_haven",
       "pva_probe_media",
+      "pva_propose_reference",
       "pva_render_graphics",
       "pva_render_terminal",
       "pva_render_vector_animation",
diff --git a/studio/agent/tests/e2e-scenarios.test.ts b/studio/agent/tests/e2e-scenarios.test.ts
index 7f395e3..04ac179 100644
--- a/studio/agent/tests/e2e-scenarios.test.ts
+++ b/studio/agent/tests/e2e-scenarios.test.ts
@@ -172,7 +172,7 @@ describe("Package release checks", () => {
       "pva_budget_status", "pva_journal",
       "pva_generate_image", "pva_synthesize_speech", "pva_synthesize_nonverbal_audio",
       "pva_render_graphics", "pva_render_terminal", "pva_render_vector_animation",
-      "pva_init_spec", "pva_build_timeline", "pva_check_episode", "pva_compose_video", "pva_compose_multitrack_video", "pva_probe_media", "pva_capability_status",
+      "pva_init_spec", "pva_propose_reference", "pva_build_timeline", "pva_check_episode", "pva_compose_video", "pva_compose_multitrack_video", "pva_probe_media", "pva_capability_status",
       "pva_list_skills", "pva_load_skill", "pva_gather_context",
       "pva_rpc_health",
     ];
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/references.test.ts`
Expected: FAIL — cannot resolve `../src/references.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/references.ts`:

```ts
// ---------------------------------------------------------------------------
// Proposing an episode as one of its series' golden references (avg-jao.6)
// ---------------------------------------------------------------------------
// A proposal freezes what a person would approve: the episode's spec and
// timeline, copied into reviews/references/<id>/, and the render they made,
// referenced in place. Nothing here signs; only the operator's
// `vpr reference approve` turns a proposal into a reference (ADR-0037).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EPISODE_SPEC_PATH } from "@studio/contracts/src/layout.mjs";
import { REFERENCE_SNAPSHOT_DIR, type ReferenceProposal } from "@studio/contracts/src/series-references.mjs";
import { EDIT_TIMELINE_PATH } from "./edit-timeline-builder.js";
import { checkEpisode, isSpecDriven } from "./series-compile.js";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export interface ReferenceProblem {
  code: string;
  message: string;
  path: string;
}

export type ProposeResult =
  | {
    ok: true;
    proposal: ReferenceProposal;
    /** Files written, relative to the episode. */
    paths: string[];
  }
  | { ok: false; problems: ReferenceProblem[] };

const fail = (code: string, path: string, message: string): ProposeResult => ({ ok: false, problems: [{ code, path, message }] });

/** Freeze the episode's current render, spec and timeline as a proposed reference `referenceId`. */
export function proposeReference(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string }; referenceId: string },
): ProposeResult {
  const { referenceId, episodeRef } = options;
  if (!SLUG.test(referenceId)) return fail("bad-id", "referenceId", `"${referenceId}" is not a lowercase kebab-case id`);
  if (!isSpecDriven(episodeDir)) return fail("no-spec", EPISODE_SPEC_PATH, "only an episode with a spec can be a series reference");

  const snapshotDir = `${REFERENCE_SNAPSHOT_DIR}/${referenceId}`;
  const spec = JSON.parse(readFileSync(join(episodeDir, EPISODE_SPEC_PATH), "utf-8"));
  const promoted = join(dirname(dirname(episodeDir)), "templates", String(spec?.template?.id), "references", `${referenceId}.json`);
  if (existsSync(join(episodeDir, snapshotDir)) || existsSync(promoted)) {
    return fail("reference-exists", snapshotDir, `the reference id "${referenceId}" is already proposed or promoted in this series: choose another`);
  }

  // The render to freeze, its report, and the timeline it was made from.
  const currentPath = join(episodeDir, "output", "current.json");
  let render: string;
  try {
    render = String(JSON.parse(readFileSync(currentPath, "utf-8")).path);
  } catch {
    return fail("no-render", "output/current.json", "the episode has no current render: render it first");
  }
  const renderPath = `output/${render}`;
  const reportPath = renderPath.replace(/\.mp4$/, ".report.json");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.mp4$/.test(render) || !existsSync(join(episodeDir, renderPath)) || !existsSync(join(episodeDir, reportPath))) {
    return fail("no-render", renderPath, `${renderPath} or its report is missing`);
  }
  let report: { timeline?: { hash?: unknown } } | null;
  try {
    report = JSON.parse(readFileSync(join(episodeDir, reportPath), "utf-8"));
  } catch {
    report = null;
  }
  const timelineFile = join(episodeDir, EDIT_TIMELINE_PATH);
  const timelineBytes = existsSync(timelineFile) ? readFileSync(timelineFile) : Buffer.alloc(0);
  if (report?.timeline?.hash !== sha256(timelineBytes)) {
    return fail("timeline-changed", EDIT_TIMELINE_PATH,
      `${EDIT_TIMELINE_PATH} is not the timeline ${render} was made from: render it again, or restore the timeline`);
  }

  // The spec frozen must be the one that timeline was compiled from.
  const timelineDoc = JSON.parse(timelineBytes.toString("utf-8"));
  if (timelineDoc?.derivedFrom?.spec?.hash !== sha256(readFileSync(join(episodeDir, EPISODE_SPEC_PATH)))) {
    return fail("spec-changed", EPISODE_SPEC_PATH,
      `${EPISODE_SPEC_PATH} changed after ${EDIT_TIMELINE_PATH} was compiled: render the episode again before proposing it`);
  }

  // A reference is the series' standard: it cannot break the series' rules.
  const checked = checkEpisode(episodeDir, { episodeRef, timeline: timelineDoc });
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const errors = checked.findings.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    return { ok: false, problems: errors.map((f) => ({ code: "series-rules", path: f.path, message: `${f.code}: ${f.message}` })) };
  }

  // Freeze. The directory is created exclusively: a concurrent proposal of the same id fails.
  mkdirSync(join(episodeDir, REFERENCE_SNAPSHOT_DIR), { recursive: true });
  try {
    mkdirSync(join(episodeDir, snapshotDir));
  } catch {
    return fail("reference-exists", snapshotDir, `the reference id "${referenceId}" was just proposed by someone else`);
  }
  copyFileSync(join(episodeDir, EPISODE_SPEC_PATH), join(episodeDir, snapshotDir, "episode-spec.json"));
  copyFileSync(join(episodeDir, EDIT_TIMELINE_PATH), join(episodeDir, snapshotDir, "edit-timeline.json"));
  const hashOf = (relative: string) => sha256(readFileSync(join(episodeDir, relative)));
  const proposal: ReferenceProposal = {
    apiVersion: "studio.video/v1alpha1",
    kind: "SeriesReference",
    id: referenceId,
    episodeRef: { channel: episodeRef.channel, series: episodeRef.series, episode: episodeRef.episode },
    template: { id: spec.template.id, version: spec.template.version, hash: spec.template.hash },
    spec: { path: `${snapshotDir}/episode-spec.json`, hash: hashOf(`${snapshotDir}/episode-spec.json`) },
    timeline: { path: `${snapshotDir}/edit-timeline.json`, hash: hashOf(`${snapshotDir}/edit-timeline.json`) },
    render: { path: renderPath, hash: hashOf(renderPath) },
    report: { path: reportPath, hash: hashOf(reportPath) },
    metadata: { proposedAt: new Date().toISOString() },
  };
  writeFileSync(join(episodeDir, snapshotDir, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`, { flag: "wx" });
  return {
    ok: true,
    proposal,
    paths: ["episode-spec.json", "edit-timeline.json", "proposal.json"].map((name) => `${snapshotDir}/${name}`),
  };
}
```

Apply to `studio/episode/src/index.ts` and `studio/agent/src/capability-tools.ts`:

```diff
diff --git a/studio/episode/src/index.ts b/studio/episode/src/index.ts
index 5e7ff74..15a7edb 100644
--- a/studio/episode/src/index.ts
+++ b/studio/episode/src/index.ts
@@ -7,3 +7,4 @@ export * from "./edit-timeline-builder.js";
 export * from "./series-compile.js";
 export * from "./episode-render.js";
 export * from "./spec-init.js";
+export * from "./references.js";
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index 1115f75..3af94aa 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -46,6 +46,7 @@ import {
   decideEditTimeline,
   EDIT_TIMELINE_PATH,
   initEpisodeSpec,
+  proposeReference,
   renderEpisode,
   writeEditTimeline,
   type Validation,
@@ -937,6 +938,40 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
+  pi.registerTool({
+    name: "pva_propose_reference",
+    label: "Propose Series Reference",
+    description: "Propose the episode's current render as one of its series' golden references: freezes its spec and timeline into reviews/references/<id>/ and writes the proposal. Only the operator can approve it (vpr reference approve); nothing here signs. Use it only when the person says this episode is exemplary of the series.",
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+      referenceId: Type.String({ description: "Lowercase kebab-case id, new in the series, e.g. san-martino-v1" }),
+    }),
+    async execute(_toolCallId, params) {
+      const dir = episodeDir(params.channel, params.series, params.episode);
+      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
+      const result = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
+        proposeReference(dir, { episodeRef, referenceId: params.referenceId }));
+      if (!result.ok) {
+        return {
+          content: [{ type: "text" as const, text: ["❌ Nothing proposed", ...result.problems.map((p) => `  - ${p.code} at ${p.path}: ${p.message}`)].join("\n") }],
+          details: { problems: result.problems } as Record<string, unknown>,
+          isError: true as unknown as boolean,
+        };
+      }
+      const { proposal } = result;
+      const lines = [
+        `✅ proposed ${proposal.id} for ${params.channel}/${params.series} (template ${proposal.template.id}@${proposal.template.version})`,
+        ...result.paths.map((p) => `  - ${p}`),
+        `render: ${proposal.render.path}`,
+        "Only a person can make it a reference. Ask them to run:",
+        `  vpr reference approve ${params.channel}/${params.series}/${params.episode} ${proposal.id}`,
+      ];
+      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
+    },
+  });
+
   pi.registerTool({
     name: "pva_build_timeline",
     label: "Build Edit Timeline",
```

Rebuild: `npm run build --workspace @studio/episode`.

- [ ] **Step 4: Run the tests and the typechecks**

Run: `cd studio/episode && npx tsc --noEmit && npx vitest run && cd ../agent && npx tsc --noEmit && npx vitest run tests/propose-reference.test.ts tests/extension.test.ts tests/e2e-scenarios.test.ts tests/no-operator-key.test.ts`
Expected: episode `Tests 98 passed`; agent `Tests 41 passed`.

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/references.ts studio/episode/src/index.ts studio/episode/tests/references.test.ts studio/agent/src/capability-tools.ts studio/agent/tests/propose-reference.test.ts studio/agent/tests/extension.test.ts studio/agent/tests/e2e-scenarios.test.ts
git commit -m "feat(episode): propose an episode as a golden reference; pva_propose_reference (avg-jao.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `vpr reference approve | withdraw | verify | list`

**Files:**
- Create: `studio/runtime/src/references.ts`, `studio/runtime/test/helpers/reference-proposal.ts`, `studio/runtime/test/unit/references.test.ts`, `studio/runtime/test/integration/cli-reference.test.ts`
- Modify: `studio/runtime/src/cli.ts`

**Interfaces:**
- Consumes: Task 1's contracts; `resolveCliCredential` (runtime), `episodePath`, `seriesPath`, `seriesReferencePath`, `seriesReferenceWithdrawalPath` (layout), `signReceipt`.
- Produces: `approveReference({libraryRoot, ref, referenceId, key, note?, dryRun?, at?})`, `withdrawReference({libraryRoot, channel, series, templateId, referenceId, key, reason, at?})`, `listReferences({libraryRoot, channel, series, key})`; outcomes `{ok: true, value} | {ok: false, code, message, problems?}` with codes `no-proposal`, `bad-proposal`, `proposal-changed`, `reference-exists`, `no-operator-key`, `not-trusted`, `no-reason`, `bad-id`, `missing-reference`, `already-withdrawn`, `bad-reference`; CLI exit codes 0 (ok / trusted), 1 (usage), 2 (refused / not trusted).

- [ ] **Step 1: Write the failing tests**

`studio/runtime/test/helpers/reference-proposal.ts`:

```ts
// A proposed golden reference on disk, as @studio/episode's proposeReference
// leaves it (avg-jao.6): the release in the series, the frozen spec and
// timeline, the render and its report, proposal.json. For the runtime's tests,
// which cannot depend on @studio/episode.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { seriesPath } from "@studio/contracts/src/layout.mjs";

export const KEY = "references-test-key-not-a-real-operator-key";
export const REF = { channel: "sample", series: "poetry", episode: "morning" };
const require = createRequire(import.meta.url);
const EXAMPLE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/episode-spec.json"));
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export const episodeDirOf = (root: string) => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

/** A proposal of `id` in the library at `root`; returns it. */
export function propose(root: string, id = "morning-v1"): Record<string, any> {
  const put = (relative: string, content: string | Buffer): string => {
    const file = join(episodeDirOf(root), relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return `sha256:${sha(content)}`;
  };
  cpSync(join(EXAMPLE, "templates/poetry-short/1.0.0"), join(seriesPath(root, REF.channel, REF.series), "templates/poetry-short/1.0.0"), { recursive: true });
  const specText = readFileSync(join(EXAMPLE, "episode-spec.json"));
  const dir = `reviews/references/${id}`;
  const specHash = put(`${dir}/episode-spec.json`, specText);
  const timelineHash = put(`${dir}/edit-timeline.json`, JSON.stringify({ derivedFrom: { spec: { path: "episode-spec.json", hash: specHash } } }));
  const renderHash = put("output/render-1-abcd1234.mp4", "fake mp4");
  const reportHash = put("output/render-1-abcd1234.report.json", JSON.stringify({ timeline: { path: "artifacts/edit-timeline.json", hash: timelineHash } }));
  const proposal = {
    apiVersion: "studio.video/v1alpha1",
    kind: "SeriesReference",
    id,
    episodeRef: REF,
    template: JSON.parse(specText.toString("utf-8")).template,
    spec: { path: `${dir}/episode-spec.json`, hash: specHash },
    timeline: { path: `${dir}/edit-timeline.json`, hash: timelineHash },
    render: { path: "output/render-1-abcd1234.mp4", hash: renderHash },
    report: { path: "output/render-1-abcd1234.report.json", hash: reportHash },
    metadata: { proposedAt: "2026-10-06T00:00:00.000Z" },
  };
  put(`${dir}/proposal.json`, `${JSON.stringify(proposal, null, 2)}\n`);
  return proposal;
}
```

`studio/runtime/test/unit/references.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seriesPath, seriesReferencePath, seriesReferenceWithdrawalPath } from "@studio/contracts/src/layout.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";
import { verifySeriesReference } from "@studio/contracts/src/series-references.mjs";
import { approveReference, listReferences, withdrawReference } from "../../src/references.js";
import { episodeDirOf, KEY, propose as proposeIn, REF } from "../helpers/reference-proposal.js";

/**
 * The operator's side of golden references (avg-jao.6), on a proposal laid
 * out as @studio/episode's proposeReference leaves it.
 */

let root: string;
const at = (relative: string) => join(episodeDirOf(root), relative);
const descriptor = (id = "morning-v1") => seriesReferencePath(root, REF.channel, REF.series, "poetry-short", id);
const propose = (id = "morning-v1") => proposeIn(root, id);

const verify = (key: string | null = KEY) =>
  verifySeriesReference({ seriesDir: seriesPath(root, REF.channel, REF.series), templateId: "poetry-short", referenceId: "morning-v1", key });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vpr-references-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("approveReference", () => {
  it("signs the proposal and promotes it: the descriptor is the proposal plus a verifiable approval", () => {
    const proposal = propose();
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY, note: "the series' first standard" });
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.value.written).toBe(true);
    expect(out.value.path).toBe(descriptor());
    const written = JSON.parse(readFileSync(descriptor(), "utf-8"));
    const { approval, ...rest } = written;
    expect(rest).toEqual(proposal);
    expect(verifyReceipt(approval, KEY)).toBe(true);
    expect(approval.note).toBe("the series' first standard");
    expect(verify().state).toBe("trusted");
  });

  it("--dry-run verifies and writes nothing", () => {
    propose();
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY, dryRun: true });
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.value.written).toBe(false);
    expect(out.value.verdict.state).toBe("trusted");
    expect(existsSync(descriptor())).toBe(false);
  });

  it("proposal-changed: what is approved is exactly what was proposed", () => {
    propose();
    writeFileSync(at("output/render-1-abcd1234.mp4"), "another render");
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect(out.ok ? null : out.code).toBe("proposal-changed");
    expect(existsSync(descriptor())).toBe(false);
  });

  it("reference-exists: a promoted reference is never rewritten", () => {
    propose();
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    const before = readFileSync(descriptor());
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY, note: "again" });
    expect(out.ok ? null : out.code).toBe("reference-exists");
    expect(readFileSync(descriptor())).toEqual(before);
  });

  it("no-operator-key: only the operator approves", () => {
    propose();
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: null });
    expect(out.ok ? null : out.code).toBe("no-operator-key");
    expect(existsSync(descriptor())).toBe(false);
  });

  it("no-proposal", () => {
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect(out.ok ? null : out.code).toBe("no-proposal");
  });

  it("not-trusted: a proposal that would not verify is not written", () => {
    propose();
    // The release the frozen spec is pinned to disappears before approval.
    rmSync(join(seriesPath(root, REF.channel, REF.series), "templates/poetry-short/1.0.0"), { recursive: true });
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect(out.ok ? null : out.code).toBe("not-trusted");
    expect(out.ok ? [] : out.problems?.map((p) => p.code)).toEqual(["missing-release"]);
    expect(existsSync(descriptor())).toBe(false);
  });
});

describe("withdrawReference", () => {
  const withdraw = (key: string | null = KEY, reason = "the recital was re-recorded") =>
    withdrawReference({ libraryRoot: root, channel: REF.channel, series: REF.series, templateId: "poetry-short", referenceId: "morning-v1", key, reason });

  it("writes a signed withdrawal; the reference then verifies as withdrawn, its evidence kept", () => {
    propose();
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    const out = withdraw();
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.value.path).toBe(seriesReferenceWithdrawalPath(root, REF.channel, REF.series, "poetry-short", "morning-v1"));
    expect(verify().state).toBe("withdrawn");
    expect(existsSync(descriptor())).toBe(true);
    expect(existsSync(at("reviews/references/morning-v1/episode-spec.json"))).toBe(true);
  });

  it("refuses a second withdrawal, a missing reason, a missing reference, no key", () => {
    expect((withdraw() as { code: string }).code).toBe("missing-reference");
    propose();
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect((withdraw(KEY, " ") as { code: string }).code).toBe("no-reason");
    expect((withdraw(null) as { code: string }).code).toBe("no-operator-key");
    expect(withdraw().ok).toBe(true);
    expect((withdraw() as { code: string }).code).toBe("already-withdrawn");
  });
});

describe("listReferences", () => {
  it("lists every reference of the series with its state", () => {
    propose("morning-v1");
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    propose("morning-v2");
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v2", key: KEY });
    withdrawReference({ libraryRoot: root, channel: REF.channel, series: REF.series, templateId: "poetry-short", referenceId: "morning-v1", key: KEY, reason: "superseded by v2" });
    const listed = listReferences({ libraryRoot: root, channel: REF.channel, series: REF.series, key: KEY });
    expect(listed.map((r) => [r.templateId, r.referenceId, r.verdict.state])).toEqual([
      ["poetry-short", "morning-v1", "withdrawn"],
      ["poetry-short", "morning-v2", "trusted"],
    ]);
    expect(listReferences({ libraryRoot: root, channel: REF.channel, series: REF.series, key: null }).map((r) => r.verdict.state))
      .toEqual(["unverifiable", "unverifiable"]);
  });
});
```

`studio/runtime/test/integration/cli-reference.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seriesReferencePath } from "@studio/contracts/src/layout.mjs";
import { KEY, propose, REF } from "../helpers/reference-proposal.js";

/**
 * `vpr reference` (avg-jao.6), through the compiled CLI as the operator runs
 * it. Like cli.test.ts it spawns dist/: run it through `npm test -w
 * @studio/runtime`, whose pretest rebuilds.
 */

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
let root: string;
let keyFile: string;

function vpr(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", [cliPath, ...args, "--library", root, "--json"], {
    encoding: "utf-8",
    env: { ...process.env, AVG_HEADLESS: "", ...env },
  });
  return { status: result.status ?? 1, out: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}
const asOperator = () => ({ AVG_OPERATOR_KEY_FILE: keyFile });
const asAgent = () => ({ AVG_OPERATOR_KEY_FILE: path.join(root, "no-such-key") });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "vpr-reference-cli-"));
  keyFile = path.join(root, ".operator-key");
  writeFileSync(keyFile, KEY, { mode: 0o600 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("vpr reference", () => {
  it("approve promotes a proposal; verify then exits 0 with trusted", () => {
    propose(root);
    const approved = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1", "--note", "the first standard"], asOperator());
    expect(approved.status, approved.stderr).toBe(0);
    expect(existsSync(seriesReferencePath(root, REF.channel, REF.series, "poetry-short", "morning-v1"))).toBe(true);
    const verified = vpr(["reference", "verify", "sample/poetry", "poetry-short", "morning-v1"], asOperator());
    expect(verified.status).toBe(0);
    expect(verified.out.state).toBe("trusted");
  });

  it("approve --dry-run writes nothing", () => {
    propose(root);
    const dry = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1", "--dry-run"], asOperator());
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.out.dryRun).toBe(true);
    expect(existsSync(seriesReferencePath(root, REF.channel, REF.series, "poetry-short", "morning-v1"))).toBe(false);
  });

  it("without the operator key, approve refuses and verify is unverifiable (exit 2)", () => {
    propose(root);
    const approved = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], asAgent());
    expect(approved.status).toBe(2);
    expect(approved.out.code).toBe("no-operator-key");
    vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], asOperator());
    const verified = vpr(["reference", "verify", "sample/poetry", "poetry-short", "morning-v1"], asAgent());
    expect(verified.status).toBe(2);
    expect(verified.out.state).toBe("unverifiable");
  });

  it("a headless caller is never the operator, whatever key file it points at", () => {
    propose(root);
    const approved = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], { ...asOperator(), AVG_HEADLESS: "1" });
    expect(approved.status).toBe(2);
    expect(approved.out.code).toBe("no-operator-key");
  });

  it("withdraw needs a reason, then verify says withdrawn and list shows it", () => {
    propose(root);
    vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], asOperator());
    expect(vpr(["reference", "withdraw", "sample/poetry", "poetry-short", "morning-v1"], asOperator()).status).toBe(1);
    const withdrawn = vpr(["reference", "withdraw", "sample/poetry", "poetry-short", "morning-v1", "--reason", "the recital was re-recorded"], asOperator());
    expect(withdrawn.status, withdrawn.stderr).toBe(0);
    expect(vpr(["reference", "verify", "sample/poetry", "poetry-short", "morning-v1"], asOperator()).out.state).toBe("withdrawn");
    const listed = vpr(["reference", "list", "sample/poetry"], asOperator());
    expect(listed.status).toBe(0);
    expect(listed.out.references).toEqual([{ templateId: "poetry-short", referenceId: "morning-v1", state: "withdrawn" }]);
  });

  it("a malformed command prints the usage and exits 1", () => {
    const bad = vpr(["reference", "approve", "sample/poetry", "morning-v1"], asOperator());
    expect(bad.status).toBe(1);
    expect(bad.out.error).toMatch(/Usage: vpr reference approve/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/runtime && npx vitest run test/unit/references.test.ts`
Expected: FAIL — cannot resolve `../../src/references.js`.

- [ ] **Step 3: Implement**

`studio/runtime/src/references.ts`:

```ts
// ---------------------------------------------------------------------------
// The operator's side of golden references (avg-jao.6, ADR-0037)
// ---------------------------------------------------------------------------
// What `vpr reference approve | withdraw | verify | list` do. Approving and
// withdrawing sign with the operator key, so they belong to the operator's
// CLI, never to Pi. The record of a reference is its signed descriptor (and,
// once withdrawn, its signed withdrawal) — append-only files in the series,
// not journal review events: those are written only by ExecutionService.review
// (avg-qr4.3), and a reference is not a pipeline stage.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { episodePath, seriesPath, seriesReferencePath, seriesReferenceWithdrawalPath } from "@studio/contracts/src/layout.mjs";
import type { GateReview } from "@studio/contracts/src/gate-review.mjs";
import { signReceipt } from "@studio/contracts/src/receipt.mjs";
import {
  buildReferenceApproval,
  buildReferenceWithdrawal,
  REFERENCE_SNAPSHOT_DIR,
  verifySeriesReference,
  type ReferenceProblem,
  type ReferenceVerdict,
} from "@studio/contracts/src/series-references.mjs";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export type ReferenceOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; problems?: ReferenceProblem[] };
const refuse = <T>(code: string, message: string, problems?: ReferenceProblem[]): ReferenceOutcome<T> =>
  ({ ok: false, code, message, ...(problems ? { problems } : {}) });

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/**
 * Sign and promote an episode's proposed reference. Verifies everything the
 * descriptor will claim before writing it; writes it with an exclusive
 * create, so a promoted reference is never rewritten.
 */
export function approveReference(input: {
  libraryRoot: string;
  ref: EpisodeRef;
  referenceId: string;
  key: string | null;
  note?: string;
  dryRun?: boolean;
  at?: string;
}): ReferenceOutcome<{ path: string; descriptor: Record<string, unknown>; verdict: ReferenceVerdict; written: boolean }> {
  const { libraryRoot, ref, referenceId, key } = input;
  const episodeDir = episodePath(libraryRoot, ref.channel, ref.series, ref.episode);
  const proposalPath = join(episodeDir, REFERENCE_SNAPSHOT_DIR, referenceId, "proposal.json");
  if (!existsSync(proposalPath)) {
    return refuse("no-proposal", `${REFERENCE_SNAPSHOT_DIR}/${referenceId}/proposal.json does not exist: propose the reference first`);
  }
  let proposal: Record<string, any>;
  try {
    proposal = JSON.parse(readFileSync(proposalPath, "utf-8"));
  } catch (error) {
    return refuse("bad-proposal", `the proposal is not JSON: ${(error as Error).message}`);
  }

  // What is approved is exactly what was proposed.
  const changed = ["spec", "timeline", "render", "report"].filter((field) => {
    const file = join(episodeDir, String(proposal[field]?.path));
    return !existsSync(file) || `sha256:${sha256(readFileSync(file))}` !== proposal[field]?.hash;
  });
  if (changed.length > 0) {
    return refuse("proposal-changed", `${changed.map((f) => proposal[f]?.path).join(", ")} changed or disappeared since the proposal: propose again`);
  }

  const templateId = String(proposal.template?.id);
  let target: string;
  try {
    target = seriesReferencePath(libraryRoot, ref.channel, ref.series, templateId, referenceId);
  } catch (error) {
    return refuse("bad-proposal", (error as Error).message);
  }
  if (existsSync(target)) return refuse("reference-exists", `${referenceId} is already a reference of this series: a promoted reference is never rewritten`);
  if (!key) return refuse("no-operator-key", "only the operator can approve a reference, and no operator key was found");

  const approval = signReceipt(buildReferenceApproval({
    reference: proposal as never,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
  }), key);
  const descriptor = { ...proposal, approval };
  const text = `${JSON.stringify(descriptor, null, 2)}\n`;
  const verdict = verifySeriesReference({
    seriesDir: seriesPath(libraryRoot, ref.channel, ref.series),
    templateId,
    referenceId,
    key,
    descriptor: text,
  });
  if (verdict.state !== "trusted") {
    return refuse("not-trusted", `the reference would not verify (${verdict.state}): nothing was written`, verdict.problems);
  }
  if (input.dryRun) return { ok: true, value: { path: target, descriptor, verdict, written: false } };

  mkdirSync(join(target, ".."), { recursive: true });
  try {
    writeFileSync(target, text, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return refuse("reference-exists", `${referenceId} was just promoted by someone else`);
    throw error;
  }
  return { ok: true, value: { path: target, descriptor, verdict, written: true } };
}

/** Withdraw a promoted reference: a signed, append-only record; the evidence stays. */
export function withdrawReference(input: {
  libraryRoot: string;
  channel: string;
  series: string;
  templateId: string;
  referenceId: string;
  key: string | null;
  reason: string;
  at?: string;
}): ReferenceOutcome<{ path: string; withdrawal: GateReview }> {
  const { libraryRoot, channel, series, templateId, referenceId, key, reason } = input;
  if (!reason || !reason.trim()) return refuse("no-reason", "a withdrawal needs --reason: one nobody can act on is noise");
  let descriptorPath: string;
  try {
    descriptorPath = seriesReferencePath(libraryRoot, channel, series, templateId, referenceId);
  } catch (error) {
    return refuse("bad-id", (error as Error).message);
  }
  if (!existsSync(descriptorPath)) return refuse("missing-reference", `${templateId}/${referenceId} is not a reference of ${channel}/${series}`);
  const target = seriesReferenceWithdrawalPath(libraryRoot, channel, series, templateId, referenceId);
  if (existsSync(target)) return refuse("already-withdrawn", `${referenceId} is already withdrawn; a withdrawal is never undone or repeated`);
  if (!key) return refuse("no-operator-key", "only the operator can withdraw a reference, and no operator key was found");

  const bytes = readFileSync(descriptorPath);
  let reference: Record<string, any>;
  try {
    reference = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    return refuse("bad-reference", `the descriptor is not JSON: ${(error as Error).message}`);
  }
  const withdrawal = signReceipt(buildReferenceWithdrawal({
    reference: reference as never,
    descriptorHash: sha256(bytes),
    reason,
    ...(input.at !== undefined ? { at: input.at } : {}),
  }), key);
  try {
    writeFileSync(target, `${JSON.stringify(withdrawal, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return refuse("already-withdrawn", `${referenceId} was just withdrawn by someone else`);
    throw error;
  }
  return { ok: true, value: { path: target, withdrawal } };
}

/** Every reference of a series, with its verdict. */
export function listReferences(input: { libraryRoot: string; channel: string; series: string; key: string | null }): {
  templateId: string;
  referenceId: string;
  verdict: ReferenceVerdict;
}[] {
  const seriesDir = seriesPath(input.libraryRoot, input.channel, input.series);
  const templates = join(seriesDir, "templates");
  if (!existsSync(templates)) return [];
  const out = [];
  for (const templateId of readdirSync(templates).sort()) {
    const refs = join(templates, templateId, "references");
    if (!existsSync(refs)) continue;
    for (const file of readdirSync(refs).sort()) {
      if (!file.endsWith(".json") || file.endsWith(".withdrawal.json")) continue;
      const referenceId = file.slice(0, -".json".length);
      out.push({ templateId, referenceId, verdict: verifySeriesReference({ seriesDir, templateId, referenceId, key: input.key }) });
    }
  }
  return out;
}
```

Apply to `studio/runtime/src/cli.ts`:

```diff
diff --git a/studio/runtime/src/cli.ts b/studio/runtime/src/cli.ts
index 52da7e8..12f0c57 100644
--- a/studio/runtime/src/cli.ts
+++ b/studio/runtime/src/cli.ts
@@ -29,6 +29,9 @@ import { releaseSpend } from "@studio/contracts/src/budget.mjs";
 import type { SourceRef } from "@studio/contracts/src/source-pins.mjs";
 import type { ExecutionError, StageOutcome } from "./execution/index.js";
 import { resolveCliCredential } from "./execution/principal.js";
+import { approveReference, listReferences, withdrawReference } from "./references.js";
+import { verifySeriesReference } from "@studio/contracts/src/series-references.mjs";
+import { seriesPath } from "@studio/contracts/src/layout.mjs";
 import type { RerunMode } from "./rerun/index.js";
 import { err, ok } from "./result.js";
 import type { Result } from "./result.js";
@@ -751,6 +754,120 @@ async function cmdReject(ctx: CliContext, args: string[]): Promise<number> {
   return cmdReview(ctx, args, "rejected");
 }
 
+// ── reference (avg-jao.6) ───────────────────────────────────────────────────
+
+/**
+ * `vpr reference approve | withdraw | verify | list`: golden references
+ * (ADR-0037). Approving and withdrawing sign with the operator key, resolved
+ * as `vpr approve` resolves it; Pi only ever proposes.
+ */
+async function cmdReference(ctx: CliContext, args: string[]): Promise<number> {
+  const usage =
+    "Usage: vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | " +
+    "vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | " +
+    "vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--library <path>] [--json]";
+  const libraryRoot = libraryFrom(args);
+  const [sub, target, a, b] = positionalArgs(args);
+  if (!libraryRoot) {
+    emit(ctx, { error: "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
+    return EX_USAGE;
+  }
+  const seriesOf = (value: string | undefined) => {
+    const parts = (value ?? "").split("/");
+    return parts.length === 2 && parts.every(Boolean) ? { channel: parts[0]!, series: parts[1]! } : null;
+  };
+  let credential;
+  try {
+    credential = resolveCliCredential();
+  } catch (e) {
+    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
+    return EX_RUNTIME;
+  }
+  const key = credential.operatorKey;
+  const refused = (out: { code: string; message: string; problems?: unknown[] }) => {
+    emit(ctx, { error: out.message, code: out.code, ...(out.problems ? { problems: out.problems } : {}) });
+    return EX_RUNTIME;
+  };
+
+  if (sub === "approve") {
+    const ref = target ? parsePath(target) : null;
+    if (!ref || !a) {
+      emit(ctx, { error: usage });
+      return EX_USAGE;
+    }
+    const note = flagValue(args, "--note");
+    const out = approveReference({ libraryRoot, ref, referenceId: a, key, dryRun: ctx.dryRun, ...(note !== undefined ? { note } : {}) });
+    if (!out.ok) return refused(out);
+    const { path, descriptor, written } = out.value;
+    emit(ctx, {
+      message: written
+        ? `${a} is now a reference of ${ref.channel}/${ref.series}: ${path}`
+        : `[DRY RUN] ${a} would become a reference of ${ref.channel}/${ref.series}: ${path}`,
+      path,
+      descriptor,
+      dryRun: !written,
+    });
+    return EX_OK;
+  }
+
+  if (sub === "withdraw") {
+    const series = seriesOf(target);
+    const reason = flagValue(args, "--reason");
+    if (!series || !a || !b || !reason) {
+      emit(ctx, { error: usage });
+      return EX_USAGE;
+    }
+    if (ctx.dryRun) {
+      emit(ctx, { message: `[DRY RUN] Would withdraw ${a}/${b} of ${target}`, dryRun: true });
+      return EX_OK;
+    }
+    const out = withdrawReference({ libraryRoot, ...series, templateId: a, referenceId: b, key, reason });
+    if (!out.ok) return refused(out);
+    emit(ctx, { message: `${b} is withdrawn: ${out.value.path}`, path: out.value.path, withdrawal: out.value.withdrawal });
+    return EX_OK;
+  }
+
+  if (sub === "verify") {
+    const series = seriesOf(target);
+    if (!series || !a || !b) {
+      emit(ctx, { error: usage });
+      return EX_USAGE;
+    }
+    const verdict = verifySeriesReference({ seriesDir: seriesPath(libraryRoot, series.channel, series.series), templateId: a, referenceId: b, key });
+    emit(ctx, {
+      message: `${a}/${b}: ${verdict.state}${verdict.problems[0] ? ` — ${verdict.problems[0].code} at ${verdict.problems[0].path}: ${verdict.problems[0].message}` : ""}`,
+      state: verdict.state,
+      problems: verdict.problems,
+      ...(verdict.withdrawal ? { withdrawal: verdict.withdrawal } : {}),
+    });
+    return verdict.state === "trusted" ? EX_OK : EX_RUNTIME;
+  }
+
+  if (sub === "list") {
+    const series = seriesOf(target);
+    if (!series) {
+      emit(ctx, { error: usage });
+      return EX_USAGE;
+    }
+    const references = listReferences({ libraryRoot, ...series, key }).map(({ templateId, referenceId, verdict }) => ({
+      templateId,
+      referenceId,
+      state: verdict.state,
+      ...(verdict.problems[0] ? { problem: verdict.problems[0] } : {}),
+    }));
+    emit(ctx, {
+      message: references.length === 0
+        ? `${target} has no references`
+        : references.map((r) => `${r.templateId}/${r.referenceId}: ${r.state}${r.problem ? ` (${r.problem.code})` : ""}`).join("\n"),
+      references,
+    });
+    return EX_OK;
+  }
+
+  emit(ctx, { error: usage });
+  return EX_USAGE;
+}
+
 // ── takes / select (avg-qr4.6) ──────────────────────────────────────────────
 
 async function cmdTakes(ctx: CliContext, args: string[]): Promise<number> {
@@ -1029,6 +1146,8 @@ const VALUE_FLAGS = new Set([
   "--mode", "--stages",
   // `pin`'s (avg-7zp.5).
   "--source", "--used-by", "--path",
+  // `reference`'s (avg-jao.6), and the notes `approve`, `reject` and `budget` take.
+  "--note", "--reason",
 ]);
 
 /**
@@ -1366,6 +1485,7 @@ const COMMANDS: Record<string, CliCommand> = {
   reject: { name: "reject", description: "Reject a stage's output, with a reason", usage: "vpr reject <channel>/<series>/<episode> <stage-id> --note <text> [--json] [--dry-run]", examples: ["vpr reject my-channel/my-series/ep001 script --note 'the wolf is too frightening'"], run: cmdReject },
   pin: { name: "pin", description: "Pin shared material (a channel source or another episode), verify it, or renew it to accept a new version", usage: "vpr pin add <channel>/<series>/<episode> <id> --source channel:<name>|episode:<series>/<episode> --used-by <stage>[,<stage>...] [--path <p>]... | vpr pin verify <channel>/<series>/<episode> | vpr pin renew <channel>/<series>/<episode> <id> [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr pin add dentro-i-versi/long/il-lampo poesia --source channel:il-lampo --used-by narration", "vpr pin verify dentro-i-versi/long/il-lampo", "vpr pin renew dentro-i-versi/long/il-lampo poesia"], run: cmdPin },
   budget: { name: "budget", description: "Show the episode's spend ledger; the operator can release an open reservation", usage: "vpr budget <channel>/<series>/<episode> [release <reservation-id> [--note <why>]] [--json] [--dry-run]", examples: ["vpr budget my-channel/my-series/ep001", "vpr budget my-channel/my-series/ep001 release rsv_01J9Z… --note 'fal dashboard shows no charge'"], run: cmdBudget },
+  reference: { name: "reference", description: "Golden references of a series: approve a proposed one, withdraw, verify, list", usage: "vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--json]", examples: ["vpr reference approve dentro-i-versi/short/san-martino san-martino-v1 --dry-run", "vpr reference verify dentro-i-versi/short short-room san-martino-v1", "vpr reference withdraw dentro-i-versi/short short-room san-martino-v1 --reason 'the recital was re-recorded'"], run: cmdReference },
   takes: { name: "takes", description: "List each stage's kept candidates and its selected take", usage: "vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>] [--json]", examples: ["vpr takes my-channel/my-series/ep001 illustrations"], run: cmdTakes },
   select: { name: "select", description: "Make an earlier candidate a stage's take; an operator's selection locks it", usage: "vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>] [--json] [--dry-run]", examples: ["vpr select my-channel/my-series/ep001 illustrations 2 --expect 3"], run: cmdSelect },
   doctor: { name: "doctor", description: "Validate workspace against canonical tree", usage: "vpr doctor --library <path> [--channel X] [--series Y] [--episode Z] [--json]", examples: ["vpr doctor --library /tmp/library", "vpr doctor --library . --channel my-channel --series season-1 --json"], run: cmdDoctor },
```

(`--note` and `--reason` join `VALUE_FLAGS` so their values never leak into positional arguments.)

- [ ] **Step 4: Build, run the tests and the typecheck**

Run: `cd studio/runtime && npm run build && npx vitest run test/unit/references.test.ts test/integration/cli-reference.test.ts && npx vitest run`
Expected: 16 passed; then the whole runtime suite `Tests 641 passed`.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/references.ts studio/runtime/src/cli.ts studio/runtime/test/helpers/reference-proposal.ts studio/runtime/test/unit/references.test.ts studio/runtime/test/integration/cli-reference.test.ts
git commit -m "feat(runtime): vpr reference approve, withdraw, verify, list (avg-jao.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `propose-reference` skill, ADR-0037, running.md, full check

**Files:**
- Create: `skills/studio/propose-reference.md`
- Modify: `studio/agent/tests/skill-discovery.test.ts`, `docs/adr/0037-series-templates-pin-editorial-standards.md`, `docs/running.md`

- [ ] **Step 1: Write the failing test**

```diff
diff --git a/studio/agent/tests/skill-discovery.test.ts b/studio/agent/tests/skill-discovery.test.ts
index 5261bdc..53b15fe 100644
--- a/studio/agent/tests/skill-discovery.test.ts
+++ b/studio/agent/tests/skill-discovery.test.ts
@@ -31,6 +31,19 @@ it("discovers the fill-episode-spec skill the series-production pipeline names",
   } finally { await rm(root, { recursive: true, force: true }); }
 });
 
+it("discovers the propose-reference skill: Pi proposes, a person approves", async () => {
+  const root = await mkdtemp(join(tmpdir(), "propose-reference-skill-"));
+  try {
+    const builtInPath = fileURLToPath(new URL("../../../skills/studio/", import.meta.url));
+    const catalog = await discoverSkills({ libraryRoot: root, builtInPath });
+    expect(catalog.list({ source: "built-in" }).find(s => s.id === "propose-reference")?.description).toContain("golden references");
+    const skill = await catalog.load("propose-reference");
+    expect(skill).toContain("pva_propose_reference");
+    expect(skill).toContain("vpr reference approve");
+    expect(skill).toContain("Never approve, sign");
+  } finally { await rm(root, { recursive: true, force: true }); }
+});
+
 it("discovers composed flat/folder skills and scopes layout-2 series overrides", async () => {
   const root = await mkdtemp(join(tmpdir(), "skills-discovery-"));
   try {
```

Run: `cd studio/agent && npx vitest run tests/skill-discovery.test.ts`
Expected: FAIL — no `propose-reference` skill.

- [ ] **Step 2: The skill**

`skills/studio/propose-reference.md`:

````markdown
---
name: propose-reference
version: "0.1.0"
description: Propose an approved series episode as one of its series' golden references, for the operator to approve
inputs:
  - name: episode
    type: string
    description: The channel/series/episode the person says is exemplary of its series, with its current render approved
  - name: referenceId
    type: string
    description: A new lowercase kebab-case id for the reference, e.g. san-martino-v1
outputs:
  - reviews/references/<id>/:
      kind: directory
      description: The frozen spec, the frozen timeline and proposal.json — unsigned
capabilities:
  - llm
---

# Propose Reference

A golden reference is evidence of a series' standard (ADR-0037): an episode a
person approved as *the* example of the format, frozen — its spec, its
timeline, its render — and signed by the operator. Later episodes are compared
with it. You can only **propose** one; a person approves it.

## When

- The person says this episode is exemplary of its series, in so many words.
  Never propose an episode on your own judgement, and never because it was
  rendered without errors.
- Its current render is the one the person approved. If they asked for
  changes since, render again and let them approve it first.

## How

1. Check with `pva_check_episode`: no errors (a reference cannot break its
   own series' rules); mention every warning to the person.
2. `pva_propose_reference { channel, series, episode, referenceId }` with a
   new id (`<episode>-v1`, `-v2` for a later one). It refuses an id already
   used, an episode whose spec or timeline changed since the render, and one
   that breaks the series' rules — say why, and what to do.
3. Tell the person what was frozen, and the command only they can run:
   `vpr reference approve <channel>/<series>/<episode> <id>`
   (with `--dry-run` first if they want to see the descriptor).

## Never

- Never approve, sign, or run `vpr reference approve` or `withdraw` yourself:
  they need the operator key, and a reference is a person's decision.
- Never edit a snapshot in `reviews/references/`, a `proposal.json`, a
  promoted descriptor in `templates/<id>/references/`, or a withdrawal.
- Never replace a reference: a better episode is a new reference with a new
  id; the operator withdraws the old one if it no longer stands.
````

Run: `cd studio/agent && npx vitest run tests/skill-discovery.test.ts`
Expected: 4 passed.

- [ ] **Step 3: Docs**

````diff
diff --git a/docs/adr/0037-series-templates-pin-editorial-standards.md b/docs/adr/0037-series-templates-pin-editorial-standards.md
index bcec616..62600f9 100644
--- a/docs/adr/0037-series-templates-pin-editorial-standards.md
+++ b/docs/adr/0037-series-templates-pin-editorial-standards.md
@@ -9,7 +9,9 @@ golden output, with `poetry-short@1.0.0` the first; the agent's
 `compileEpisode` loads and checks a spec-driven episode, and
 `pva_build_timeline`/`pva_compose_video` use it whenever an episode has an
 `episode-spec.json`. Series validators are implemented beside the compilers
-(`avg-jao.3`); golden-reference verification and promotion are `avg-jao.6`.
+(`avg-jao.3`). Golden references are proposed by Pi (`pva_propose_reference`),
+approved, verified and withdrawn by the operator (`vpr reference`), and
+verified by `verifySeriesReference` (`avg-jao.6`).
 
 ## Context
 
@@ -167,10 +169,36 @@ use, the runtime must:
    does not rewrite a golden snapshot. Withdrawing a reference is an explicit
    operator action, never replacement of its historical record.
 
-This issue defines and tests descriptor shape/bindings, **not** a promotion
-command, trust decision, filesystem loader, revocation mechanism or QA gate.
-The integration must implement those checks before treating a descriptor as
-a trusted golden; it cannot infer trust from `validateSeriesReference() === []`.
+`avg-jao.1` defined and tested the descriptor's shape and bindings; trust
+cannot be inferred from `validateSeriesReference() === []`.
+
+**How the studio does it (`avg-jao.6`).**
+
+- **Propose** (Pi or a person, `pva_propose_reference`): the episode's current
+  render, the timeline it was made from and the spec that timeline was
+  compiled from — with no series-rule errors — are frozen in
+  `reviews/references/<id>/` with an unsigned `proposal.json`.
+- **Approve** (the operator only, `vpr reference approve`): the proposed files
+  are re-hashed (what is approved is exactly what was proposed); the approval
+  is a `GateReview` of stage `reference-review` whose `planHash` is the
+  proposal's hash, signed with the operator key; the descriptor is verified in
+  full before it is written, then created exclusively — never rewritten.
+- **Verify** (`verifySeriesReference`, `vpr reference verify | list`): the
+  descriptor and its identity, the signature, a withdrawal, the files inside
+  the source episode, the frozen spec against its pinned release, and the
+  provenance from spec to timeline to render — in that order. The verdict is
+  `trusted`, `withdrawn`, `invalid` (with the first failing check) or
+  `unverifiable` (no key).
+- **Withdraw** (the operator only, `vpr reference withdraw --reason`): a
+  signed, exclusive `<id>.withdrawal.json` bound to the descriptor's hash;
+  the descriptor and its evidence stay. A forged withdrawal makes the
+  reference `invalid`, never quietly withdrawn.
+
+The record of a reference is its signed descriptor and withdrawal, not the
+episode's journal: review events there are written only by the execution
+service for pipeline stages (avg-qr4.3), and a reference is not a stage.
+Approval and promotion are one command, so an approval cannot be superseded
+before it is promoted; afterwards only a signed withdrawal ends a reference.
 
 ## Consequences and follow-ups
 
````

````diff
diff --git a/docs/running.md b/docs/running.md
index 9addcc3..c414cf5 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -95,6 +95,7 @@ Pipeline: `pva_snapshot`, `pva_run_pipeline`, `pva_run_stage`, `pva_request_appr
 Production: `pva_generate_image`, `pva_synthesize_speech`,
 `pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
 `pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`,
+`pva_propose_reference`,
 `pva_build_timeline`, `pva_check_episode`, `pva_compose_video`, `pva_compose_multitrack_video`,
 `pva_probe_media`
 
@@ -264,6 +265,21 @@ new completion becomes the take, which is how it always worked.
 shows which one is selected, who selected it, and whether the files on disk
 still match it. The last of these is reported as `drifted`.
 
+**`vpr reference`** manages a series' golden references (ADR-0037). Pi can
+only propose one (`pva_propose_reference`, which freezes the episode's spec,
+timeline and render in `reviews/references/<id>/`); the operator approves it,
+signed with the operator key, and can later withdraw it. `verify` exits 0 only
+for a trusted reference.
+
+```bash
+node studio/runtime/dist/src/cli.js reference approve my-channel/my-series/ep001 ep001-v1 \
+  --note "the series' standard" --library "$PWD/library"
+node studio/runtime/dist/src/cli.js reference verify my-channel/my-series my-template ep001-v1 --library "$PWD/library"
+node studio/runtime/dist/src/cli.js reference list my-channel/my-series --library "$PWD/library" --json
+node studio/runtime/dist/src/cli.js reference withdraw my-channel/my-series my-template ep001-v1 \
+  --reason "the recital was re-recorded" --library "$PWD/library"
+```
+
 **`vpr select`** puts an earlier candidate back in place. The gateway offers
 the same thing as `POST …/stages/:stage/select`, and `GET …/episodes/:episode/takes`
 lists the candidates.
````

- [ ] **Step 4: Full check**

Run: `npm run check && npm run docs:build`
Then: `cd studio/agent && REMOTION_E2E=1 npx vitest run tests/compose-spec.e2e.test.ts tests/compose-video.e2e.test.ts`
Expected: everything passes (contracts 373, episode 98, runtime 641, agent 196 passed with 3 skipped); VitePress builds; 3 e2e tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/studio/propose-reference.md studio/agent/tests/skill-discovery.test.ts docs/adr/0037-series-templates-pin-editorial-standards.md docs/running.md
git commit -m "docs: golden references in ADR-0037 and running.md; the propose-reference skill (avg-jao.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After the PR merges: close `avg-jao.6` (check `gh pr view` first).
