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
