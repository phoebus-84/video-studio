// ---------------------------------------------------------------------------
// A render needs a person to have read the sheet (avg-3th.2)
// ---------------------------------------------------------------------------
// A spec-driven episode renders only when artifacts/layout-sheet/ pictures the
// timeline the render will use and a person approved exactly that sheet
// (review.json, signed by `vpr sheet approve`). With the operator key the
// signature is verified; without it — Pi never holds it — the review is held
// to its binding alone (forgery by a same-user process is avg-qr4.8's OS
// isolation, as for every receipt). Episodes without a spec are not gated.
// Where the operator set `sheet.approval: auto` in the series' (or channel's)
// settings.yaml, the agent's reading stands for theirs: recordSheetReading
// writes it as the review, origin "policy" — approved only when the agent
// found nothing wrong on a current sheet.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import {
  buildSheetReview,
  LAYOUT_SHEET_REPORT,
  SHEET_REVIEW_PATH,
  sheetApprovalPolicy as policyOf,
  verifySheetReview,
  type SheetApprovalPolicy,
} from "@studio/contracts/src/sheet-reviews.mjs";
import { decideEditTimeline, type TimelineDecision } from "./episode-render.js";
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

export type { SheetApprovalPolicy };

/** The operator's `sheet.approval` for the episode: the series' settings.yaml, else the channel's (never the episode's). */
export const sheetApprovalPolicy = (episodeDir: string): SheetApprovalPolicy => policyOf(episodeDir, parseYaml);

/** Throws SheetReviewError unless the current sheet of `decision`'s timeline is approved. */
export function requireSheetReview(episodeDir: string, options: BuildOptions, decision: TimelineDecision, key: string | null, approval: "review" | "pipeline-gate" = "review"): void {
  if (!isSpecDriven(episodeDir)) return;
  const status = layoutSheetStatusOf(episodeDir, options, () => decision);
  if (status.state === "missing") {
    throw new SheetReviewError("sheet-missing", `there is no layout sheet (${status.reason}): make it, read it, approve it`, LAYOUT_SHEET_REPORT);
  }
  if (status.state === "stale") {
    throw new SheetReviewError("sheet-stale", `the layout sheet no longer pictures the timeline (${status.reasons.join("; ")}): make it again, read it, approve it`, LAYOUT_SHEET_REPORT);
  }
  // The pipeline's gate on its sheet stage was the person's reading (see EpisodeRenderOptions.sheetApproval).
  if (approval === "pipeline-gate") return;
  const policy = sheetApprovalPolicy(episodeDir).approval;
  const review = sheetReviewOf(episodeDir, options, status, key, policy);
  if (review.state === "approved") return;
  const then = policy === "auto" ? "record the reading (pva_record_sheet_reading)" : "`vpr sheet approve`";
  if (review.state === "missing") {
    throw new SheetReviewError("review-missing", `nobody has approved the current layout sheet: read it, then ${then}`, SHEET_REVIEW_PATH);
  }
  if (review.state === "rejected") {
    throw new SheetReviewError("review-rejected", `the layout sheet was rejected: "${review.note}"`, SHEET_REVIEW_PATH);
  }
  if (review.state === "stale") {
    throw new SheetReviewError("review-stale", `the review is of another layout sheet: read the current one, then ${then}`, SHEET_REVIEW_PATH);
  }
  throw new SheetReviewError("review-invalid", review.message, SHEET_REVIEW_PATH);
}

export type SheetReview =
  | { state: "approved"; at: string | null; message: string }
  | { state: "rejected"; note: string; at: string | null; message: string }
  | { state: "missing" | "stale" | "invalid"; message: string };

/**
 * The operator's review of a current layout sheet (`vpr sheet approve|reject`):
 * approved or rejected, and when; missing; of another sheet (stale); or not
 * to be trusted (invalid). Reads only.
 */
export function sheetReviewOf(
  episodeDir: string,
  options: BuildOptions,
  status: { inputsHash: string; sheetHash: string },
  key: string | null,
  policy: SheetApprovalPolicy["approval"] = sheetApprovalPolicy(episodeDir).approval,
): SheetReview {
  const file = join(episodeDir, SHEET_REVIEW_PATH);
  if (!existsSync(file)) return { state: "missing", message: "nobody has reviewed the current layout sheet" };
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
    policy,
  });
  const at = typeof (review as { at?: unknown } | null)?.at === "string" ? (review as { at: string }).at : null;
  if (verdict.state === "approved") return { state: "approved", at, message: "approved" };
  if (verdict.state === "rejected") {
    return { state: "rejected", note: String((review as { note?: unknown }).note ?? ""), at, message: "rejected" };
  }
  if (verdict.state === "stale") return { state: "stale", message: "the review is of another layout sheet" };
  return { state: "invalid", message: `the review cannot be trusted: ${verdict.problem?.message ?? "malformed"}` };
}

/** What the agent's reading of the sheet came to, written as the review. */
export interface SheetReading {
  decision: "approved" | "rejected";
  path: string;
  policy: SheetApprovalPolicy;
}

/**
 * The agent's reading of the current sheet, written as its review where the
 * operator set `sheet.approval: auto`: approved when it found nothing wrong,
 * rejected with what it found otherwise — a render then refuses, and the
 * operator is told. Refused (SheetReviewError) where the series keeps the
 * operator's review, or when the sheet is missing or no longer current.
 */
export function recordSheetReading(episodeDir: string, options: BuildOptions, reading: { problems: string[] }): SheetReading {
  const policy = sheetApprovalPolicy(episodeDir);
  if (policy.approval !== "auto") {
    throw new SheetReviewError("review-missing", "this series keeps the operator's review of the sheet (no sheet.approval: auto in its settings.yaml): ask them to read it and `vpr sheet approve`", SHEET_REVIEW_PATH);
  }
  const status = layoutSheetStatusOf(episodeDir, options, () => decideEditTimeline(episodeDir, options));
  if (status.state === "missing") {
    throw new SheetReviewError("sheet-missing", `there is no layout sheet (${status.reason}): make it and read it first`, LAYOUT_SHEET_REPORT);
  }
  if (status.state === "stale") {
    throw new SheetReviewError("sheet-stale", `the layout sheet no longer pictures the timeline (${status.reasons.join("; ")}): make it again and read that one`, LAYOUT_SHEET_REPORT);
  }
  const reportBytes = readFileSync(join(episodeDir, LAYOUT_SHEET_REPORT));
  const report = JSON.parse(reportBytes.toString("utf-8")) as { sheet: { path: string } };
  const problems = reading.problems.map((p) => p.trim()).filter((p) => p.length > 0);
  const decision = problems.length === 0 ? "approved" as const : "rejected" as const;
  const { channel, series, episode } = options.episodeRef;
  const review = buildSheetReview({
    episode: `${channel}/${series}/${episode}`,
    inputsHash: status.inputsHash,
    sheet: { path: report.sheet.path, hash: status.sheetHash },
    report: { path: "sheet.json", hash: sha256(reportBytes) },
    decision,
    ...(decision === "rejected" ? { note: problems.join("; ") } : {}),
    origin: "policy",
  });
  const path = join(episodeDir, SHEET_REVIEW_PATH);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(review, null, 2)}\n`, "utf-8");
  renameSync(temp, path);
  return { decision, path, policy };
}
