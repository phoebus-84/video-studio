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
