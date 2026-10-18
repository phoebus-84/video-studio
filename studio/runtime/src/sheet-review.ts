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
import { load as parseYaml } from "js-yaml";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import type { GateReview } from "@studio/contracts/src/gate-review.mjs";
import { signReceipt } from "@studio/contracts/src/receipt.mjs";
import {
  buildSheetReview,
  LAYOUT_SHEET_DIR,
  LAYOUT_SHEET_REPORT,
  SHEET_REVIEW_PATH,
  sheetApprovalPolicy,
  verifySheetReview,
  type SheetReviewVerdict,
} from "@studio/contracts/src/sheet-reviews.mjs";

const SHEET_IMAGE = /^sheet\.jpg$/;
const STILL = /^frames\/\d{3}\.jpg$/;
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
  let report: { inputsHash?: unknown; sheet?: { path?: unknown; hash?: unknown }; frames?: unknown };
  try {
    report = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    return refuse("bad-sheet", `${LAYOUT_SHEET_REPORT} is not JSON: ${(error as Error).message}`);
  }
  if (typeof report.inputsHash !== "string" || typeof report.sheet?.path !== "string" || typeof report.sheet?.hash !== "string") {
    return refuse("bad-sheet", `${LAYOUT_SHEET_REPORT} does not name its inputs hash and its sheet`);
  }
  // The same files the render checks (@studio/episode's readReport): the grid and every still, by name and hash.
  const frames = Array.isArray(report.frames) ? report.frames as { path?: unknown; hash?: unknown }[] : null;
  if (!SHEET_IMAGE.test(report.sheet.path) || !frames || !frames.every((f) => typeof f?.path === "string" && STILL.test(f.path) && typeof f.hash === "string")) {
    return refuse("bad-sheet", `${LAYOUT_SHEET_REPORT} names files outside the sheet`);
  }
  for (const file of [report.sheet as { path: string; hash: string }, ...(frames as { path: string; hash: string }[])]) {
    const on = join(episodeDir, LAYOUT_SHEET_DIR, file.path);
    if (!existsSync(on) || bare(sha256(readFileSync(on))) !== bare(file.hash)) {
      return refuse("sheet-changed", `${LAYOUT_SHEET_DIR}/${file.path} is not the one ${LAYOUT_SHEET_REPORT} describes: make the sheet again`);
    }
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
    policy: sheetApprovalPolicy(episodeDir, parseYaml).approval,
  });
  const by = (review as { at?: string } | null)?.at;
  const message = verdict.state === "approved" || verdict.state === "rejected"
    ? `${verdict.state}${by ? ` at ${by}` : ""}${(review as { origin?: string }).origin === "policy" ? " by the agent's reading (sheet.approval: auto)" : verdict.verified === null ? " (signature not checked: no operator key)" : ""}; the render checks that the sheet still pictures the timeline`
    : `${verdict.state}: ${verdict.problem?.message ?? ""}`;
  return { ...verdict, message };
}
