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
  writeFileSync(join(dir(), "sheet.json"), JSON.stringify({ inputsHash: sha("inputs"), sheet: { path: "sheet.jpg", hash: sha("grid pixels") }, frames: [] }));
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
    writeFileSync(join(dir(), "sheet.json"), JSON.stringify({ inputsHash: sha("new inputs"), sheet: { path: "sheet.jpg", hash: sha("grid pixels") }, frames: [] }));
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY }).state).toBe("stale");
  });

  it("reads a rejection", () => {
    laySheet();
    reviewSheet({ libraryRoot: root, ref: REF, key: KEY, decision: "rejected", note: "the verse bar covers the hand" });
    expect(sheetReviewStatus({ libraryRoot: root, ref: REF, key: KEY }).state).toBe("rejected");
  });
});
