# Signed Sheet Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-3th.2`. A spec-driven episode renders only when a person approved its current layout sheet. The approval is a review signed with the operator key and bound to the sheet's inputs hash, its `sheet.json` and its grid. Regenerating the sheet clears it.

**Architecture:**
- **Contracts:** `@studio/contracts` builds and judges the review (`sheet-reviews.mjs`).
- **Operator CLI:** `@studio/runtime` signs it with the operator key (`vpr sheet approve | reject | status`) and writes `artifacts/layout-sheet/review.json`.
- **Render gate:** `@studio/episode`'s `renderEpisode` refuses before writing anything (`SheetReviewError`, `code: "sheet-review"`) when the sheet is missing or stale, or its review is missing, rejected, stale or invalid. It verifies the signature when it is given the key (`operatorKey`); without the key (Pi's case), it checks the binding alone.

**Tech Stack:**
- JavaScript (ESM) for contracts, tested with `node:test`.
- TypeScript for runtime and episode, tested with vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-sheet-review-design.md` (updated in Task 3 with what prototyping settled).

The prototype is the local commit `4804c05` on branch `scratch/sheet-review`. Never push it or merge it. What ran there:
- **Suites:**
  - contracts `npm run check` (397);
  - runtime (648);
  - episode (211);
  - agent (208);
  - adapters (46).
- **Checks:** root `npm run check`.
- **Real render:** the Dentro i versi short golden episode (`REMOTION_E2E=1`). It made its sheet, approved it with a test key, then rendered.

## Global Constraints

- Work on branch `feat/sheet-review`, in the main checkout. It holds the spec commit.
- Never push or merge without the user's go.
- Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`. Never run `bd`. Use `git add` with explicit paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown.
- No dependency changes.
- The runtime must not depend on `@studio/episode` (`npm run check:boundaries`).
- Never read, print or create the real operator key. Tests use literal test keys.
- VitePress fails on a double opening curly brace outside fenced code in Markdown under `docs/`.

## Review Focus

- **Pi without the key.** Pi's render must still work after a person approved the current sheet (hash-bound check), and must be refused otherwise. Task 3 pins this ("renders without the key on an approval bound to the current sheet").
- **A forged or foreign review.** With the key, a review signed with another key must be refused. Another episode's review, another stage's review and a policy decision must be invalid at all times. Tasks 1 and 3 pin these.
- **A sheet changed after review.** An edit that changes the timeline makes the sheet stale. A new sheet starts unreviewed, and an old review copied back is stale. Task 3 pins all three.
- **The operator signing the wrong thing.** The CLI must refuse a grid image that is not the one `sheet.json` describes, refuse a missing sheet, refuse to work without the key, and refuse a rejection without a note. Task 2 pins these.
- **Episodes without a spec.** Legacy explainers must not be gated. Task 3 pins this.

---

### Task 1: The sheet review record (contracts)

**Files:**
- Create:
  - `studio/contracts/src/sheet-reviews.mjs`;
  - `studio/contracts/src/sheet-reviews.d.mts`;
  - `studio/contracts/test/sheet-reviews.test.mjs`.
- Modify: `studio/contracts/README.md`.

**Interfaces:**
- Produces:
  - the constants `SHEET_REVIEW_STAGE`, `LAYOUT_SHEET_DIR`, `LAYOUT_SHEET_REPORT`, `SHEET_REVIEW_FILE`, `SHEET_REVIEW_PATH`;
  - `buildSheetReview({episode, inputsHash, sheet, report, decision, note?, at?})`, which returns an unsigned `GateReview`;
  - `verifySheetReview({review, key, episode, inputsHash, sheetHash, reportHash})`, which returns `{state: "approved" | "rejected" | "stale" | "invalid", verified, problem?}`.

- [ ] **Step 1: Write the failing test**

Create `studio/contracts/test/sheet-reviews.test.mjs`:

````js
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

  it("refuses another episode's review, another stage's, and a policy decision", () => {
    assert.equal(verifySheetReview({ review: approved(), key: KEY, ...NOW, episode: "x/y/z" }).problem?.code, "wrong-episode");
    assert.equal(verifySheetReview({ review: { ...approved(), stageId: "render" }, key: null, ...NOW }).problem?.code, "wrong-stage");
    assert.equal(verifySheetReview({ review: { ...approved(), origin: "policy" }, key: null, ...NOW }).problem?.code, "not-human");
    assert.equal(verifySheetReview({ review: null, key: null, ...NOW }).problem?.code, "malformed");
  });
});
````

Run: `cd studio/contracts && node --test test/sheet-reviews.test.mjs`
Expected: FAIL — `Cannot find module '…/src/sheet-reviews.mjs'`.

- [ ] **Step 2: The module**

Create `studio/contracts/src/sheet-reviews.mjs`:

````js
// ---------------------------------------------------------------------------
// The review of a layout sheet (avg-3th.2)
// ---------------------------------------------------------------------------
// A person read the sheet of the timeline a render would use, frame by frame,
// and approved or rejected it. The record is a gate review signed with the
// operator key (avg-qr4.3), bound to the sheet's inputsHash (its plan) and to
// the sheet.json and grid image it looked at (its outputs), kept beside them
// in artifacts/layout-sheet/review.json — so a new sheet starts unreviewed.
// This module builds and judges the record; it reads and writes no file.
// ---------------------------------------------------------------------------

import { buildGateReview } from "./gate-review.mjs";
import { verifyReceipt } from "./receipt.mjs";

/** The stage id every sheet review carries. */
export const SHEET_REVIEW_STAGE = "layout-sheet";
/** The layout sheet's folder in an episode (avg-3th.1), its report, and the review kept beside them. */
export const LAYOUT_SHEET_DIR = "artifacts/layout-sheet";
export const LAYOUT_SHEET_REPORT = `${LAYOUT_SHEET_DIR}/sheet.json`;
export const SHEET_REVIEW_FILE = "review.json";
export const SHEET_REVIEW_PATH = `${LAYOUT_SHEET_DIR}/${SHEET_REVIEW_FILE}`;

const bare = (hash) => String(hash).replace(/^sha256:/, "");

/**
 * The review, unsigned: a human `decision` ("approved" or "rejected", which
 * needs a note) about the sheet whose inputs hash to `inputsHash`, its grid
 * `sheet` and its `report` (sheet.json), by path and hash. The caller signs it.
 */
export function buildSheetReview({ episode, inputsHash, sheet, report, decision, note, at }) {
  return buildGateReview({
    stageId: SHEET_REVIEW_STAGE,
    decision,
    origin: "human",
    actor: "human",
    binding: {
      planHash: bare(inputsHash),
      inputs: [],
      outputs: [
        { path: report.path, sha256: bare(report.hash) },
        { path: sheet.path, sha256: bare(sheet.hash) },
      ],
    },
    episode,
    ...(note !== undefined ? { note } : {}),
    ...(at !== undefined ? { at } : {}),
  });
}

/**
 * What a review says about the sheet a render would use now. `key` is the
 * operator key, or null: without it the signature cannot be checked
 * (`verified: null`), and the review is judged by its binding alone.
 *
 * - `approved` / `rejected`: a well-formed human review of exactly this sheet;
 * - `stale`: it reviewed another sheet (another inputs hash, sheet or report);
 * - `invalid`: malformed, another stage or episode, or a signature that does not verify.
 */
export function verifySheetReview({ review, key, episode, inputsHash, sheetHash, reportHash }) {
  const invalid = (code, message) => ({ state: "invalid", verified: key ? false : null, problem: { code, message } });
  if (!review || typeof review !== "object" || Array.isArray(review)) return invalid("malformed", "the review is not an object");
  if (review.stageId !== SHEET_REVIEW_STAGE) return invalid("wrong-stage", `the review is of stage "${review.stageId}", not "${SHEET_REVIEW_STAGE}"`);
  if (review.origin !== "human") return invalid("not-human", `the review's origin is "${review.origin}", not a person`);
  if (review.decision !== "approved" && review.decision !== "rejected") return invalid("malformed", `"${review.decision}" is not a decision about a sheet`);
  if (review.episode !== episode) return invalid("wrong-episode", `the review is of ${review.episode}, not ${episode}`);
  if (review.decision === "rejected" && !review.note) return invalid("malformed", "a rejection without a note");
  let verified = null;
  if (key) {
    verified = verifyReceipt(review, key);
    if (!verified) return invalid("bad-signature", "the review's signature does not verify with the operator key");
  }
  const binding = review.binding ?? {};
  const outputs = Array.isArray(binding.outputs) ? binding.outputs.map((o) => o?.sha256) : [];
  if (binding.planHash !== bare(inputsHash) || !outputs.includes(bare(sheetHash)) || !outputs.includes(bare(reportHash))) {
    return { state: "stale", verified, problem: { code: "stale", message: "the review is of another sheet" } };
  }
  return { state: review.decision, verified };
}
````

Create `studio/contracts/src/sheet-reviews.d.mts`:

````ts
// Type declarations for the review of a layout sheet (avg-3th.2).

import type { GateReview } from "./gate-review.mjs";

export declare const SHEET_REVIEW_STAGE: "layout-sheet";
export declare const LAYOUT_SHEET_DIR: "artifacts/layout-sheet";
export declare const LAYOUT_SHEET_REPORT: "artifacts/layout-sheet/sheet.json";
export declare const SHEET_REVIEW_FILE: "review.json";
export declare const SHEET_REVIEW_PATH: "artifacts/layout-sheet/review.json";

export interface SheetReviewFile {
  path: string;
  /** "sha256:<hex>" or bare hex. */
  hash: string;
}

export declare function buildSheetReview(input: {
  episode: string;
  inputsHash: string;
  sheet: SheetReviewFile;
  report: SheetReviewFile;
  decision: "approved" | "rejected";
  note?: string;
  at?: string;
}): GateReview;

export type SheetReviewState = "approved" | "rejected" | "stale" | "invalid";

export interface SheetReviewVerdict {
  state: SheetReviewState;
  /** true or false when checked with the operator key; null without it. */
  verified: boolean | null;
  problem?: { code: string; message: string };
}

export declare function verifySheetReview(input: {
  review: unknown;
  key: string | null;
  episode: string;
  inputsHash: string;
  sheetHash: string;
  reportHash: string;
}): SheetReviewVerdict;
````

````diff
diff --git a/studio/contracts/README.md b/studio/contracts/README.md
index 3cf3c56..1ce6f25 100644
--- a/studio/contracts/README.md
+++ b/studio/contracts/README.md
@@ -55,6 +55,13 @@ Filesystem mutation, pipeline execution, creative skills, provider calls, render
   bindings, **not** a signature/file trust check or approval operation.
 - `placeholderPaths(data)`: JSON paths of unresolved content.
 
+`src/sheet-reviews.mjs` (`avg-3th.2`) is the review of a layout sheet: a
+gate review of stage `layout-sheet`, signed with the operator key, bound to
+the sheet's `inputsHash` (its plan) and to `sheet.json` and the grid (its
+outputs). `buildSheetReview` builds it unsigned; `verifySheetReview` answers
+`approved`, `rejected`, `stale` (another sheet) or `invalid`, checking the
+signature only when given the key.
+
 `src/series-references.mjs` (`avg-jao.6`) is where a descriptor becomes a
 verdict: `verifySeriesReference({seriesDir, templateId, referenceId, key})`
 reads the descriptor, its signature, a withdrawal, the files, the pinned
````

- [ ] **Step 3: Run it, then the contracts check**

Run: `node --test test/sheet-reviews.test.mjs`
Expected: PASS, 7 tests.

Run: `npm run check`
Expected: PASS, 397 tests.

- [ ] **Step 4: Commit**

```bash
git add studio/contracts/src/sheet-reviews.mjs studio/contracts/src/sheet-reviews.d.mts studio/contracts/test/sheet-reviews.test.mjs studio/contracts/README.md
git commit -m "The review of a layout sheet: a signed gate review bound to the sheet's inputs, its report and its grid (avg-3th.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `vpr sheet approve | reject | status` (runtime)

**Files:**
- Create:
  - `studio/runtime/src/sheet-review.ts`;
  - `studio/runtime/test/unit/sheet-review.test.ts`.
- Modify:
  - `studio/runtime/src/cli.ts`;
  - `docs/running.md`.

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `reviewSheet({libraryRoot, ref, key, decision, note?, at?, dryRun?})`, which returns `SheetOutcome<{path, review, written}>`;
  - `sheetReviewStatus({libraryRoot, ref, key})`;
  - the CLI command `sheet`.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/unit/sheet-review.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";
import { reviewSheet, sheetReviewStatus } from "../../src/sheet-review.js";

/**
 * The operator's review of a layout sheet (avg-3th.2), on a sheet laid out
 * as makeLayoutSheet leaves it: sheet.json and the grid image it describes.
 */

const KEY = "test-operator-key";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let root: string;
const dir = () => join(episodePath(root, REF.channel, REF.series, REF.episode), "artifacts", "layout-sheet");

function laySheet(image = "grid pixels") {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), "sheet.jpg"), image);
  writeFileSync(join(dir(), "sheet.json"), JSON.stringify({ inputsHash: sha("inputs"), sheet: { path: "sheet.jpg", hash: sha("grid pixels") } }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sheet-review-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("reviewSheet", () => {
  it("signs an approval of exactly the sheet on disk and writes it beside it", () => {
    laySheet();
    const out = reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "approved", note: "every frame read" });
    if (!out.ok) throw new Error(out.message);
    const written = JSON.parse(readFileSync(join(dir(), "review.json"), "utf-8"));
    expect(written).toEqual(out.value.review);
    expect(verifyReceipt(written, KEY)).toBe(true);
    expect(written.binding.planHash).toBe(sha("inputs").slice(7));
    expect(written.binding.outputs).toEqual([
      { path: "sheet.json", sha256: sha(readFileSync(join(dir(), "sheet.json"))).slice(7) },
      { path: "sheet.jpg", sha256: sha("grid pixels").slice(7) },
    ]);
    expect(written.episode).toBe("sample/poetry/morning");
  });

  it("writes nothing on a dry run", () => {
    laySheet();
    const out = reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "approved", dryRun: true });
    expect(out.ok && out.value.written).toBe(false);
    expect(existsSync(join(dir(), "review.json"))).toBe(false);
  });

  it("refuses without the operator key, without a sheet, and when the image is not the one sheet.json describes", () => {
    const code = (out: { ok: boolean; code?: string }) => (out.ok ? null : out.code);
    expect(code(reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "approved" }))).toBe("no-sheet");
    laySheet("other pixels");
    expect(code(reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "approved" }))).toBe("sheet-changed");
    laySheet();
    expect(code(reviewSheet({ libraryRoot: root, ref: REF, key: null, decision: "approved" }))).toBe("no-operator-key");
  });

  it("needs a note to reject", () => {
    laySheet();
    const out = reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "rejected" });
    expect(out.ok ? null : out.code).toBe("note-required");
  });
});

describe("sheetReviewStatus", () => {
  it("says no sheet, unreviewed, approved — and stale once the sheet is made again", () => {
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY }).state).toBe("no-sheet");
    laySheet();
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY }).state).toBe("unreviewed");
    reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "approved" });
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY })).toMatchObject({ state: "approved", verified: true });
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: null })).toMatchObject({ state: "approved", verified: null });
    writeFileSync(join(dir(), "sheet.json"), JSON.stringify({ inputsHash: sha("new inputs"), sheet: { path: "sheet.jpg", hash: sha("grid pixels") } }));
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY }).state).toBe("stale");
  });

  it("reads a rejection", () => {
    laySheet();
    reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "rejected", note: "the verse bar covers the hand" });
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY }).state).toBe("rejected");
  });
});
````

Run: `cd studio/runtime && npx vitest run test/unit/sheet-review.test.ts`
Expected: FAIL — `../../src/sheet-review.js` does not exist.

- [ ] **Step 2: The module and the command**

Create `studio/runtime/src/sheet-review.ts`:

````ts
// ---------------------------------------------------------------------------
// The operator's review of a layout sheet (avg-3th.2)
// ---------------------------------------------------------------------------
// What `vpr sheet approve | reject | status` do. A review signs with the
// operator key, so it belongs to the operator's CLI (or a process holding the
// key), never to Pi. It signs exactly the sheet on disk: sheet.json as it is,
// and the grid image whose bytes hash to what sheet.json says. Whether that
// sheet still pictures the timeline a render would use is the render's
// question (@studio/episode); this package does not depend on it.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import type { GateReview } from "@studio/contracts/src/gate-review.mjs";
import { signReceipt } from "@studio/contracts/src/receipt.mjs";
import {
  buildSheetReview,
  LAYOUT_SHEET_DIR,
  LAYOUT_SHEET_REPORT,
  SHEET_REVIEW_PATH,
  verifySheetReview,
  type SheetReviewVerdict,
} from "@studio/contracts/src/sheet-reviews.mjs";

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bare = (hash: unknown) => String(hash).replace(/^sha256:/, "");

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export type SheetOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
const refuse = <T>(code: string, message: string): SheetOutcome<T> => ({ ok: false, code, message });

interface SheetOnDisk {
  inputsHash: string;
  report: { path: string; hash: string };
  sheet: { path: string; hash: string };
}

/** The sheet on disk, its image checked against its report; or why it cannot be reviewed. */
function sheetOnDisk(episodeDir: string): SheetOutcome<SheetOnDisk> {
  const reportFile = join(episodeDir, LAYOUT_SHEET_REPORT);
  if (!existsSync(reportFile)) return refuse("no-sheet", `${LAYOUT_SHEET_REPORT} does not exist: make the layout sheet first`);
  const bytes = readFileSync(reportFile);
  let report: { inputsHash?: unknown; sheet?: { path?: unknown; hash?: unknown } };
  try {
    report = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    return refuse("bad-sheet", `${LAYOUT_SHEET_REPORT} is not JSON: ${(error as Error).message}`);
  }
  if (typeof report.inputsHash !== "string" || typeof report.sheet?.path !== "string" || typeof report.sheet?.hash !== "string") {
    return refuse("bad-sheet", `${LAYOUT_SHEET_REPORT} does not name its inputs hash and its sheet`);
  }
  const image = join(episodeDir, LAYOUT_SHEET_DIR, report.sheet.path);
  if (!existsSync(image) || bare(sha256(readFileSync(image))) !== bare(report.sheet.hash)) {
    return refuse("sheet-changed", `${LAYOUT_SHEET_DIR}/${report.sheet.path} is not the image ${LAYOUT_SHEET_REPORT} describes: make the sheet again`);
  }
  return {
    ok: true,
    value: {
      inputsHash: report.inputsHash,
      report: { path: "sheet.json", hash: sha256(bytes) },
      sheet: { path: report.sheet.path, hash: report.sheet.hash },
    },
  };
}

/**
 * Sign the operator's decision about the episode's sheet and write it to
 * artifacts/layout-sheet/review.json, replacing an earlier review of it.
 */
export function reviewSheet(input: {
  libraryRoot: string;
  ref: EpisodeRef;
  key: string | null;
  decision: "approved" | "rejected";
  note?: string;
  at?: string;
  dryRun?: boolean;
}): SheetOutcome<{ path: string; review: GateReview; written: boolean }> {
  const { ref, key, decision } = input;
  const episodeDir = episodePath(input.libraryRoot, ref.channel, ref.series, ref.episode);
  if (decision === "rejected" && !input.note) return refuse("note-required", "a rejected sheet needs a note saying what is wrong");
  const sheet = sheetOnDisk(episodeDir);
  if (!sheet.ok) return sheet;
  if (!key) return refuse("no-operator-key", "only the operator can review a sheet, and no operator key was found");
  const review = signReceipt(buildSheetReview({
    episode: `${ref.channel}/${ref.series}/${ref.episode}`,
    inputsHash: sheet.value.inputsHash,
    sheet: sheet.value.sheet,
    report: sheet.value.report,
    decision,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
  }), key) as GateReview;
  const path = join(episodeDir, SHEET_REVIEW_PATH);
  if (input.dryRun) return { ok: true, value: { path, review, written: false } };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(review, null, 2)}\n`, "utf-8");
  renameSync(temp, path);
  return { ok: true, value: { path, review, written: true } };
}

export type SheetReviewStatus =
  | { state: "no-sheet" | "unreviewed"; message: string }
  | ({ message: string } & SheetReviewVerdict);

/** The review of the sheet on disk: none, or what verifySheetReview says of it. */
export function sheetReviewStatus(input: { libraryRoot: string; ref: EpisodeRef; key: string | null }): SheetReviewStatus {
  const { ref, key } = input;
  const episodeDir = episodePath(input.libraryRoot, ref.channel, ref.series, ref.episode);
  const sheet = sheetOnDisk(episodeDir);
  if (!sheet.ok) return { state: "no-sheet", message: sheet.message };
  const file = join(episodeDir, SHEET_REVIEW_PATH);
  if (!existsSync(file)) return { state: "unreviewed", message: "nobody has reviewed this sheet" };
  let review: unknown;
  try {
    review = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    review = null;
  }
  const verdict = verifySheetReview({
    review,
    key,
    episode: `${ref.channel}/${ref.series}/${ref.episode}`,
    inputsHash: sheet.value.inputsHash,
    sheetHash: sheet.value.sheet.hash,
    reportHash: sheet.value.report.hash,
  });
  const by = (review as { at?: string } | null)?.at;
  const message = verdict.state === "approved" || verdict.state === "rejected"
    ? `${verdict.state}${by ? ` at ${by}` : ""}${verdict.verified === null ? " (signature not checked: no operator key)" : ""}`
    : `${verdict.state}: ${verdict.problem?.message ?? ""}`;
  return { ...verdict, message };
}
````

````diff
diff --git a/studio/runtime/src/cli.ts b/studio/runtime/src/cli.ts
index 12f0c57..2aab97e 100644
--- a/studio/runtime/src/cli.ts
+++ b/studio/runtime/src/cli.ts
@@ -30,6 +30,7 @@ import type { SourceRef } from "@studio/contracts/src/source-pins.mjs";
 import type { ExecutionError, StageOutcome } from "./execution/index.js";
 import { resolveCliCredential } from "./execution/principal.js";
 import { approveReference, listReferences, withdrawReference } from "./references.js";
+import { reviewSheet, sheetReviewStatus } from "./sheet-review.js";
 import { verifySeriesReference } from "@studio/contracts/src/series-references.mjs";
 import { seriesPath } from "@studio/contracts/src/layout.mjs";
 import type { RerunMode } from "./rerun/index.js";
@@ -868,6 +869,63 @@ async function cmdReference(ctx: CliContext, args: string[]): Promise<number> {
   return EX_USAGE;
 }
 
+// ── sheet (avg-3th.2) ───────────────────────────────────────────────────────
+
+/**
+ * `vpr sheet approve | reject | status`: the operator's signed review of an
+ * episode's layout sheet. A spec-driven episode does not render without an
+ * approval of its current sheet.
+ */
+async function cmdSheet(ctx: CliContext, args: string[]): Promise<number> {
+  const usage =
+    "Usage: vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | " +
+    "vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode> [--library <path>]";
+  const libraryRoot = libraryFrom(args);
+  const [sub, target] = positionalArgs(args);
+  if (!libraryRoot) {
+    emit(ctx, { error: "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
+    return EX_USAGE;
+  }
+  const ref = target ? parsePath(target) : null;
+  if (!ref || !["approve", "reject", "status"].includes(sub ?? "")) {
+    emit(ctx, { error: usage });
+    return EX_USAGE;
+  }
+  let credential;
+  try {
+    credential = resolveCliCredential();
+  } catch (e) {
+    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
+    return EX_RUNTIME;
+  }
+  const key = credential.operatorKey;
+
+  if (sub === "status") {
+    const status = sheetReviewStatus({ libraryRoot, ref, key });
+    emit(ctx, { ...status, message: `${target}: ${status.message}` });
+    return status.state === "approved" ? EX_OK : EX_RUNTIME;
+  }
+
+  const note = flagValue(args, "--note");
+  if (sub === "reject" && !note) {
+    emit(ctx, { error: usage });
+    return EX_USAGE;
+  }
+  const out = reviewSheet({ libraryRoot, ref, key, decision: sub === "approve" ? "approved" : "rejected", dryRun: ctx.dryRun, ...(note !== undefined ? { note } : {}) });
+  if (!out.ok) {
+    emit(ctx, { error: out.message, code: out.code });
+    return EX_RUNTIME;
+  }
+  const { path, review, written } = out.value;
+  emit(ctx, {
+    message: `${written ? "" : "[DRY RUN] "}${target}'s sheet ${written ? "is" : "would be"} ${review.decision}: ${path}`,
+    path,
+    review,
+    dryRun: !written,
+  });
+  return EX_OK;
+}
+
 // ── takes / select (avg-qr4.6) ──────────────────────────────────────────────
 
 async function cmdTakes(ctx: CliContext, args: string[]): Promise<number> {
@@ -1485,6 +1543,7 @@ const COMMANDS: Record<string, CliCommand> = {
   reject: { name: "reject", description: "Reject a stage's output, with a reason", usage: "vpr reject <channel>/<series>/<episode> <stage-id> --note <text> [--json] [--dry-run]", examples: ["vpr reject my-channel/my-series/ep001 script --note 'the wolf is too frightening'"], run: cmdReject },
   pin: { name: "pin", description: "Pin shared material (a channel source or another episode), verify it, or renew it to accept a new version", usage: "vpr pin add <channel>/<series>/<episode> <id> --source channel:<name>|episode:<series>/<episode> --used-by <stage>[,<stage>...] [--path <p>]... | vpr pin verify <channel>/<series>/<episode> | vpr pin renew <channel>/<series>/<episode> <id> [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr pin add dentro-i-versi/long/il-lampo poesia --source channel:il-lampo --used-by narration", "vpr pin verify dentro-i-versi/long/il-lampo", "vpr pin renew dentro-i-versi/long/il-lampo poesia"], run: cmdPin },
   budget: { name: "budget", description: "Show the episode's spend ledger; the operator can release an open reservation", usage: "vpr budget <channel>/<series>/<episode> [release <reservation-id> [--note <why>]] [--json] [--dry-run]", examples: ["vpr budget my-channel/my-series/ep001", "vpr budget my-channel/my-series/ep001 release rsv_01J9Z… --note 'fal dashboard shows no charge'"], run: cmdBudget },
+  sheet: { name: "sheet", description: "Review an episode's layout sheet: approve it, reject it with a note, or see its review; a spec-driven episode renders only with an approval of its current sheet", usage: "vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode>", examples: ["vpr sheet approve dentro-i-versi/short/san-martino", "vpr sheet reject dentro-i-versi/short/san-martino --note 'the verse bar covers the hand at 0:12'", "vpr sheet status dentro-i-versi/short/san-martino"], run: cmdSheet },
   reference: { name: "reference", description: "Golden references of a series: approve a proposed one, withdraw, verify, list", usage: "vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--json]", examples: ["vpr reference approve dentro-i-versi/short/san-martino san-martino-v1 --dry-run", "vpr reference verify dentro-i-versi/short short-room san-martino-v1", "vpr reference withdraw dentro-i-versi/short short-room san-martino-v1 --reason 'the recital was re-recorded'"], run: cmdReference },
   takes: { name: "takes", description: "List each stage's kept candidates and its selected take", usage: "vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>] [--json]", examples: ["vpr takes my-channel/my-series/ep001 illustrations"], run: cmdTakes },
   select: { name: "select", description: "Make an earlier candidate a stage's take; an operator's selection locks it", usage: "vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>] [--json] [--dry-run]", examples: ["vpr select my-channel/my-series/ep001 illustrations 2 --expect 3"], run: cmdSelect },
````

- [ ] **Step 3: Run it, then everything**

Run: `npx vitest run test/unit/sheet-review.test.ts`
Expected: PASS, 6 tests.

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS, 648 tests.

- [ ] **Step 4: Docs**

````diff
diff --git a/docs/running.md b/docs/running.md
index 4af9228..d53e2e8 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -344,6 +344,21 @@ node studio/runtime/dist/src/cli.js reference withdraw my-channel/my-series my-t
   --reason "the recital was re-recorded" --library "$PWD/library"
 ```
 
+**`vpr sheet`** records the operator's review of an episode's layout sheet
+(avg-3th.2). A spec-driven episode renders only when its current sheet was
+approved: making the sheet again clears the review, and an edit that changes
+what the sheet would show makes it stale. `approve` and `reject` sign with the
+operator key exactly the sheet on disk (`artifacts/layout-sheet/review.json`);
+a rejection needs a note. `status` exits 0 only for an approval. Pi only makes
+and reads the sheet.
+
+```bash
+node studio/runtime/dist/src/cli.js sheet approve my-channel/my-series/ep001 --library "$PWD/library"
+node studio/runtime/dist/src/cli.js sheet reject my-channel/my-series/ep001 \
+  --note "the verse bar covers the hand at 0:12" --library "$PWD/library"
+node studio/runtime/dist/src/cli.js sheet status my-channel/my-series/ep001 --library "$PWD/library"
+```
+
 **`vpr select`** puts an earlier candidate back in place. The gateway offers
 the same thing as `POST …/stages/:stage/select`, and `GET …/episodes/:episode/takes`
 lists the candidates.
````

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/sheet-review.ts studio/runtime/test/unit/sheet-review.test.ts studio/runtime/src/cli.ts docs/running.md
git commit -m "vpr sheet approve | reject | status: the operator signs a review of exactly the sheet on disk (avg-3th.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The render needs an approval of the current sheet (episode)

**Files:**
- Create:
  - `studio/episode/src/sheet-review.ts`;
  - `studio/episode/tests/sheet-review.test.ts`.
- Modify:
  - `studio/episode/src/layout-sheet.ts` (`layoutSheetStatusOf`);
  - `studio/episode/src/episode-render.ts` (the gate, `operatorKey`);
  - `studio/episode/src/index.ts`;
  - `studio/episode/src/testing.ts` (`approveSheet`);
  - `studio/episode/tests/render-snapshot.test.ts`, `studio/episode/tests/render-audit.test.ts` (they mock the gate);
  - `studio/episode/tests/dentro-i-versi-short.e2e.test.ts` (approves its sheet);
  - `docs/workspace.md`;
  - `docs/superpowers/specs/2026-10-09-sheet-review-design.md`.

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `requireSheetReview(episodeDir, options, decision, key)`;
  - `SheetReviewError` (`code: "sheet-review"`, `problems: [{code: "sheet-missing" | "sheet-stale" | "review-missing" | "review-rejected" | "review-stale" | "review-invalid", message, path}]`);
  - `layoutSheetStatusOf(episodeDir, options, decide)`;
  - `EpisodeRenderOptions.operatorKey`;
  - `approveSheet(episodeDir, ref, key?, decision?, note?)`.

- [ ] **Step 1: Write the failing tests and the helper**

````diff
diff --git a/studio/episode/src/testing.ts b/studio/episode/src/testing.ts
index 27e1629..9507004 100644
--- a/studio/episode/src/testing.ts
+++ b/studio/episode/src/testing.ts
@@ -8,6 +8,8 @@ import { createHash } from "node:crypto";
 import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
 import { createRequire } from "node:module";
 import { dirname, join } from "node:path";
+import { signReceipt } from "@studio/contracts/src/receipt.mjs";
+import { buildSheetReview, LAYOUT_SHEET_REPORT, SHEET_REVIEW_PATH } from "@studio/contracts/src/sheet-reviews.mjs";
 
 const require = createRequire(import.meta.url);
 const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
@@ -104,3 +106,22 @@ export function editSpec(episodeDir: string, change: (spec: any) => void): void
   change(spec);
   writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
 }
+
+/**
+ * Sign an approval of the episode's sheet as it is on disk, as
+ * `vpr sheet approve` does, with a test key (avg-3th.2). Returns the review.
+ */
+export function approveSheet(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }, key = "test-operator-key", decision: "approved" | "rejected" = "approved", note?: string): unknown {
+  const reportBytes = readFileSync(join(episodeDir, LAYOUT_SHEET_REPORT));
+  const report = JSON.parse(reportBytes.toString("utf-8"));
+  const review = signReceipt(buildSheetReview({
+    episode: `${episodeRef.channel}/${episodeRef.series}/${episodeRef.episode}`,
+    inputsHash: report.inputsHash,
+    sheet: { path: report.sheet.path, hash: report.sheet.hash },
+    report: { path: "sheet.json", hash: sha256(reportBytes) },
+    decision,
+    ...(note !== undefined ? { note } : {}),
+  }), key);
+  writeFileSync(join(episodeDir, SHEET_REVIEW_PATH), `${JSON.stringify(review, null, 2)}\n`);
+  return review;
+}
````

Create `studio/episode/tests/sheet-review.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderEpisode } from "../src/episode-render.js";
import { makeLayoutSheet } from "../src/layout-sheet.js";
import { requireSheetReview, SheetReviewError } from "../src/sheet-review.js";
import { approveSheet, editSpec, sha256, specEpisode } from "../src/testing.js";

/**
 * A spec-driven episode renders only with an approval of its current layout
 * sheet (avg-3th.2). Rendering, the sheet's and the video's, is faked.
 */

let rendered = 0;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, `sheet of ${frames.length} at ${options.timeline.durationInFrames}`);
      return {
        frames,
        sheet: { path, hash: sha256(`sheet of ${frames.length} at ${options.timeline.durationInFrames}`), columns: 8, rows: 1, width: 2160, height: 1600 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      rendered++;
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return { path: options.outputPath, durationSeconds: 1, sizeBytes: 8, hash: sha256("fake mp4"), kits: [], profile: options.timeline.profile.id, loudness: null };
    },
    auditRender: async () => ({ passed: true, checks: ["decode"], findings: [] }),
  };
});

const KEY = "test-operator-key";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sheet-review-"));
  specEpisode(dir(), REF);
  rendered = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The refusal's single problem code; and nothing rendered or written to output/. */
async function refused(options: { operatorKey?: string | null } = {}): Promise<string> {
  const error = await renderEpisode(dir(), { episodeRef: REF, ...options }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SheetReviewError);
  expect((error as SheetReviewError).code).toBe("sheet-review");
  expect(rendered).toBe(0);
  expect(existsSync(at("output"))).toBe(false);
  return (error as SheetReviewError).problems[0]!.code;
}

describe("renderEpisode needs an approval of the current layout sheet", () => {
  it("refuses with no sheet", async () => {
    expect(await refused()).toBe("sheet-missing");
  });

  it("refuses with a sheet nobody approved", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(await refused()).toBe("review-missing");
  });

  it("renders with an approval of the current sheet, verified when it holds the key", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    await renderEpisode(dir(), { episodeRef: REF, operatorKey: KEY });
    expect(rendered).toBe(1);
  });

  it("renders without the key on an approval bound to the current sheet (Pi's case)", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    await renderEpisode(dir(), { episodeRef: REF });
    expect(rendered).toBe(1);
  });

  it("refuses a rejected sheet, quoting the reviewer", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY, "rejected", "the verse bar covers the hand");
    const error = (await renderEpisode(dir(), { episodeRef: REF }).catch((e: unknown) => e)) as SheetReviewError;
    expect(error.problems[0]).toMatchObject({ code: "review-rejected", message: expect.stringContaining("the verse bar covers the hand") });
  });

  it("refuses a sheet made stale by an edit, and a review of an earlier sheet", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    editSpec(dir(), (spec) => { spec.data.title = `${spec.data.title} (revised)`; spec.revision += 1; });
    expect(await refused()).toBe("sheet-stale");
    const old = readFileSync(at("artifacts/layout-sheet/review.json"), "utf-8");
    await makeLayoutSheet(dir(), { episodeRef: REF });
    // a new sheet starts unreviewed: regenerating it cleared the review
    expect(existsSync(at("artifacts/layout-sheet/review.json"))).toBe(false);
    writeFileSync(at("artifacts/layout-sheet/review.json"), old);
    expect(await refused()).toBe("review-stale");
  });

  it("does not gate an episode without a spec", () => {
    const legacy = join(root, "legacy");
    mkdirSync(legacy, { recursive: true });
    expect(() => requireSheetReview(legacy, { episodeRef: REF }, null as never, null)).not.toThrow();
  });

  it("with the key, refuses a review whose signature does not verify", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, "someone-else's-key");
    expect(await refused({ operatorKey: KEY })).toBe("review-invalid");
  });
});
````

Run: `npm run build --workspace @av/remotion-composer && cd studio/episode && npx vitest run tests/sheet-review.test.ts`
Expected: FAIL — `../src/sheet-review.js` does not exist.

- [ ] **Step 2: The gate**

Create `studio/episode/src/sheet-review.ts`:

````ts
// ---------------------------------------------------------------------------
// A render needs a person to have read the sheet (avg-3th.2)
// ---------------------------------------------------------------------------
// A spec-driven episode renders only when artifacts/layout-sheet/ pictures the
// timeline the render will use and a person approved exactly that sheet
// (review.json, signed by `vpr sheet approve`). With the operator key the
// signature is verified; without it — Pi never holds it — the review is held
// to its binding alone (forgery by a same-user process is avg-qr4.8's OS
// isolation, as for every receipt). Episodes without a spec are not gated.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT_SHEET_REPORT, SHEET_REVIEW_PATH, verifySheetReview } from "@studio/contracts/src/sheet-reviews.mjs";
import type { TimelineDecision } from "./episode-render.js";
import type { BuildOptions } from "./edit-timeline-builder.js";
import { layoutSheetStatusOf } from "./layout-sheet.js";
import { isSpecDriven } from "./series-compile.js";

export type SheetReviewProblemCode = "sheet-missing" | "sheet-stale" | "review-missing" | "review-rejected" | "review-stale" | "review-invalid";

/** The render was refused before anything was written: the sheet was not read, or not this one. */
export class SheetReviewError extends Error {
  readonly code = "sheet-review";
  readonly problems: { code: SheetReviewProblemCode; message: string; path: string }[];
  constructor(problem: SheetReviewProblemCode, detail: string, path: string) {
    super(`a render needs a person to have approved the current layout sheet: ${detail}`);
    this.name = "SheetReviewError";
    this.problems = [{ code: problem, message: detail, path }];
  }
}

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Throws SheetReviewError unless the current sheet of `decision`'s timeline is approved. */
export function requireSheetReview(episodeDir: string, options: BuildOptions, decision: TimelineDecision, key: string | null): void {
  if (!isSpecDriven(episodeDir)) return;
  const status = layoutSheetStatusOf(episodeDir, options, () => decision);
  if (status.state === "missing") {
    throw new SheetReviewError("sheet-missing", `there is no layout sheet (${status.reason}): make it, read it, approve it`, LAYOUT_SHEET_REPORT);
  }
  if (status.state === "stale") {
    throw new SheetReviewError("sheet-stale", `the layout sheet no longer pictures the timeline (${status.reasons.join("; ")}): make it again, read it, approve it`, LAYOUT_SHEET_REPORT);
  }
  const file = join(episodeDir, SHEET_REVIEW_PATH);
  if (!existsSync(file)) {
    throw new SheetReviewError("review-missing", "nobody has approved the current layout sheet: read it, then `vpr sheet approve`", SHEET_REVIEW_PATH);
  }
  let review: unknown;
  try {
    review = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    review = null;
  }
  const { channel, series, episode } = options.episodeRef;
  const verdict = verifySheetReview({
    review,
    key,
    episode: `${channel}/${series}/${episode}`,
    inputsHash: status.inputsHash,
    sheetHash: status.sheetHash,
    reportHash: sha256(readFileSync(join(episodeDir, LAYOUT_SHEET_REPORT))),
  });
  if (verdict.state === "approved") return;
  if (verdict.state === "rejected") {
    throw new SheetReviewError("review-rejected", `the layout sheet was rejected: "${(review as { note?: string }).note}"`, SHEET_REVIEW_PATH);
  }
  if (verdict.state === "stale") {
    throw new SheetReviewError("review-stale", "the review is of another layout sheet: read the current one, then `vpr sheet approve`", SHEET_REVIEW_PATH);
  }
  throw new SheetReviewError("review-invalid", `the review cannot be trusted: ${verdict.problem?.message ?? "malformed"}`, SHEET_REVIEW_PATH);
}
````

````diff
diff --git a/studio/episode/src/episode-render.ts b/studio/episode/src/episode-render.ts
index 9c0eb84..9006d06 100644
--- a/studio/episode/src/episode-render.ts
+++ b/studio/episode/src/episode-render.ts
@@ -25,6 +25,7 @@ import {
   type EditTimelineDoc,
 } from "./edit-timeline-builder.js";
 import { checkEpisode, compileEpisode, isSpecDriven, sharedRootsOf, type SeriesFinding } from "./series-compile.js";
+import { requireSheetReview } from "./sheet-review.js";
 
 const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
 
@@ -325,6 +326,12 @@ export function currentEditTimeline(episodeDir: string, options: BuildOptions):
 export interface EpisodeRenderOptions extends BuildOptions {
   /** Lowercase kebab-case; the render id starts with it. */
   label?: string;
+  /**
+   * The operator key, when this process holds it: the sheet review's
+   * signature is then verified. Without it (Pi) the review is held to its
+   * binding alone (avg-3th.2).
+   */
+  operatorKey?: string | null;
   onProgress?: (progress: number) => void;
 }
 
@@ -358,6 +365,8 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
   if (errors.length > 0) {
     throw new SeriesRulesError(decision.validation!.validator, errors, hintFor(errors, decision.rebuilt === null));
   }
+  // A spec-driven episode renders only the timeline whose sheet a person approved.
+  requireSheetReview(episodeDir, options, decision, options.operatorKey ?? null);
   const current = applyDecision(episodeDir, decision);
 
   const outputDir = join(episodeDir, "output");
diff --git a/studio/episode/src/index.ts b/studio/episode/src/index.ts
index f248dc6..4ca3240 100644
--- a/studio/episode/src/index.ts
+++ b/studio/episode/src/index.ts
@@ -10,6 +10,7 @@ export * from "./spec-init.js";
 export * from "./references.js";
 export * from "./sheet-instants.js";
 export * from "./layout-sheet.js";
+export * from "./sheet-review.js";
 export * from "./version-diff.js";
 export * from "./version-compare.js";
 export * from "./speech-align.js";
diff --git a/studio/episode/src/layout-sheet.ts b/studio/episode/src/layout-sheet.ts
index 0b82b57..b337838 100644
--- a/studio/episode/src/layout-sheet.ts
+++ b/studio/episode/src/layout-sheet.ts
@@ -187,12 +187,17 @@ function readReport(episodeDir: string): { ok: true; report: LayoutSheetReport }
  * now? Reads only.
  */
 export function layoutSheetStatus(episodeDir: string, options: BuildOptions): LayoutSheetStatus {
+  return layoutSheetStatusOf(episodeDir, options, () => decideEditTimeline(episodeDir, options));
+}
+
+/** layoutSheetStatus against a timeline decision already made (the render's). */
+export function layoutSheetStatusOf(episodeDir: string, options: BuildOptions, decide: () => TimelineDecision): LayoutSheetStatus {
   const read = readReport(episodeDir);
   if (!read.ok) return { state: "missing", reason: read.reason };
   const { report } = read;
   let now;
   try {
-    now = inputsOf(episodeDir, options, decideEditTimeline(episodeDir, options));
+    now = inputsOf(episodeDir, options, decide());
   } catch (error) {
     return { state: "stale", reasons: [`the timeline a render would use cannot be decided: ${(error as Error).message}`] };
   }
````

- [ ] **Step 3: Existing tests**

The render tests that are not about the gate mock it. The real e2e approves its sheet:

````diff
diff --git a/studio/episode/tests/dentro-i-versi-short.e2e.test.ts b/studio/episode/tests/dentro-i-versi-short.e2e.test.ts
index d43390d..a1106f0 100644
--- a/studio/episode/tests/dentro-i-versi-short.e2e.test.ts
+++ b/studio/episode/tests/dentro-i-versi-short.e2e.test.ts
@@ -5,7 +5,7 @@ import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { renderEpisode } from "../src/episode-render.js";
 import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
-import { divShortEpisode } from "../src/testing.js";
+import { approveSheet, divShortEpisode } from "../src/testing.js";
 
 /**
  * The dentro-i-versi-short golden episode (avg-dcf.3), rendered for real
@@ -48,7 +48,8 @@ describe.skipIf(!enabled)("the dentro-i-versi-short golden episode, rendered", (
   }, 300_000);
 
   it("renders the whole video: 1129 frames, 1080x1920", async () => {
-    const render = await renderEpisode(dir(), { episodeRef: REF, label: "e2e" });
+    approveSheet(dir(), REF, "e2e-operator-key");
+    const render = await renderEpisode(dir(), { episodeRef: REF, label: "e2e", operatorKey: "e2e-operator-key" });
     const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets", "-of", "json", render.outputPath]).toString());
     expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920, nb_read_packets: "1129" });
     expect(JSON.parse(readFileSync(join(dir(), "output", `${render.renderId}.timeline.json`), "utf-8")).durationInFrames).toBe(1129);
diff --git a/studio/episode/tests/render-audit.test.ts b/studio/episode/tests/render-audit.test.ts
index d68f2e1..1d02c10 100644
--- a/studio/episode/tests/render-audit.test.ts
+++ b/studio/episode/tests/render-audit.test.ts
@@ -41,6 +41,9 @@ vi.mock("@av/remotion-composer", async (importOriginal) => {
   };
 });
 
+// The sheet-review gate has its own tests (sheet-review.test.ts).
+vi.mock("../src/sheet-review.js", () => ({ requireSheetReview: () => undefined }));
+
 const REF = { channel: "sample", series: "poetry", episode: "morning" };
 let root: string;
 const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
diff --git a/studio/episode/tests/render-snapshot.test.ts b/studio/episode/tests/render-snapshot.test.ts
index 8fdc42d..90f3eb7 100644
--- a/studio/episode/tests/render-snapshot.test.ts
+++ b/studio/episode/tests/render-snapshot.test.ts
@@ -35,6 +35,9 @@ vi.mock("@av/remotion-composer", async (importOriginal) => {
   };
 });
 
+// The sheet-review gate has its own tests (sheet-review.test.ts).
+vi.mock("../src/sheet-review.js", () => ({ requireSheetReview: () => undefined }));
+
 const REF = { channel: "sample", series: "poetry", episode: "morning" };
 let root: string;
 const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
````

- [ ] **Step 4: Run it, then everything**

Run: `npx vitest run tests/sheet-review.test.ts`
Expected: PASS, 8 tests.

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, 211 tests (3 skipped).

Then the consumers: `cd ../agent && npx vitest run` (208 tests) and `cd ../adapters && npx vitest run` (46 tests). Both must PASS.

- [ ] **Step 5: Docs**

````diff
diff --git a/docs/superpowers/specs/2026-10-09-sheet-review-design.md b/docs/superpowers/specs/2026-10-09-sheet-review-design.md
index 6628698..fe33dc2 100644
--- a/docs/superpowers/specs/2026-10-09-sheet-review-design.md
+++ b/docs/superpowers/specs/2026-10-09-sheet-review-design.md
@@ -83,6 +83,5 @@ The series-production pipeline puts a human review on its `sheet` stage. `render
 ## Documentation
 
 - `docs/workspace.md`: the review file.
-- The CLI's help.
-- The runtime README's command list.
-- The `review-layout-sheet` skill, if it names the step.
+- The CLI's help, and `docs/running.md`'s command list.
+- The `review-layout-sheet` skill is unchanged: it already hands the sheet to a person, and Pi never approves.
diff --git a/docs/workspace.md b/docs/workspace.md
index c2014d5..771e37c 100755
--- a/docs/workspace.md
+++ b/docs/workspace.md
@@ -111,7 +111,7 @@ are `seriesTemplatePath` and `seriesReferencePath` in `layout.mjs`;
 
 ## Editing rules
 
-Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink. A render becomes current only after its file passes the render audit (decode, streams, duration, loudness, and the loop when the timeline declares one); a render that fails stays in `output/` with its report, which says why.
+Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink. For a spec-driven episode, a render starts only when a person approved its current layout sheet (`artifacts/layout-sheet/review.json`, signed by `vpr sheet approve`; making the sheet again clears it). A render becomes current only after its file passes the render audit (decode, streams, duration, loudness, and the loop when the timeline declares one); a render that fails stays in `output/` with its report, which says why.
 
 ## Git and storage
 
````

- [ ] **Step 6: Commit**

```bash
git add studio/episode/src/sheet-review.ts studio/episode/tests/sheet-review.test.ts studio/episode/src/layout-sheet.ts studio/episode/src/episode-render.ts studio/episode/src/index.ts studio/episode/src/testing.ts studio/episode/tests/render-snapshot.test.ts studio/episode/tests/render-audit.test.ts studio/episode/tests/dentro-i-versi-short.e2e.test.ts docs/workspace.md docs/superpowers/specs/2026-10-09-sheet-review-design.md
git commit -m "A spec-driven episode renders only with an approval of its current layout sheet (avg-3th.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Whole-branch checks

- [ ] **Step 1:** Run `git diff --stat 4804c05 HEAD -- studio docs/running.md docs/workspace.md docs/superpowers/specs/2026-10-09-sheet-review-design.md`. It must be empty.
- [ ] **Step 2:** From the root, run `npm run check && npm run docs:build`. Expected: PASS.
- [ ] **Step 3:** No commit. Report the test counts.
