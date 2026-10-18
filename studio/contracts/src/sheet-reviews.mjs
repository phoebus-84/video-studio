// ---------------------------------------------------------------------------
// The review of a layout sheet (avg-3th.2)
// ---------------------------------------------------------------------------
// A person read the sheet of the timeline a render would use, frame by frame,
// and approved or rejected it. The record is a gate review signed with the
// operator key (avg-qr4.3), bound to the sheet's inputsHash (its plan) and to
// the sheet.json and grid image it looked at (its outputs), kept beside them
// in artifacts/layout-sheet/review.json — so a new sheet starts unreviewed.
// A series whose operator set `sheet.approval: auto` in its settings.yaml has
// the agent's reading stand for that review: the agent records it, unsigned,
// with origin "policy", approved when it found nothing wrong and rejected
// (with what it found) otherwise. Without that setting it counts for nothing.
// This module builds and judges the record; it writes no file, and reads only
// the settings that say whose reading counts.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
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
/** Only blank lines and `#` comments (a BOM and CRLF allowed): a settings.yaml that declares nothing. */
const declaresNothing = (text) => text.replace(/^﻿/, "").split(/\r?\n/).every((line) => /^\s*(#.*)?$/.test(line));

/**
 * The operator's `sheet.approval` for an episode (library/<channel>/series/
 * <series>/episodes/<episode>): the series' settings.yaml, else the channel's;
 * "review" when neither sets it. Never the episode's own settings, which the
 * agent writes. Only an absent declaration inherits: an unreadable or
 * malformed file, or an invalid sheet policy, requires human review rather
 * than inheriting a possibly more permissive channel policy. `parse` turns
 * YAML into an object (contracts carries no parser). Reads only.
 */
export function sheetApprovalPolicy(episodeDir, parse) {
  const seriesDir = path.dirname(path.dirname(episodeDir));
  for (const dir of [seriesDir, path.dirname(path.dirname(seriesDir))]) {
    const file = path.join(dir, "settings.yaml");
    const review = { approval: "review", from: file };
    let text;
    try {
      text = readFileSync(file, "utf-8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      return review;
    }
    // A file of blank lines and comments declares nothing — the one `vpr`/pva_create_series writes — so it inherits too.
    if (declaresNothing(text)) continue;
    let doc;
    try {
      doc = parse(text);
    } catch {
      return review;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return review;
    if (!Object.hasOwn(doc, "sheet")) continue;
    const sheet = doc.sheet;
    if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return review;
    if (!Object.hasOwn(sheet, "approval")) continue;
    return sheet.approval === "auto" ? { approval: "auto", from: file } : review;
  }
  return { approval: "review", from: null };
}

/**
 * The review, unsigned: a human `decision` ("approved" or "rejected", which
 * needs a note) about the sheet whose inputs hash to `inputsHash`, its grid
 * `sheet` and its `report` (sheet.json), by path and hash. The caller signs it.
 * With `origin: "policy"` it is the agent's reading under `sheet.approval:
 * auto`, and stays unsigned.
 */
export function buildSheetReview({ episode, inputsHash, sheet, report, decision, note, at, origin = "human" }) {
  if (origin !== "human" && origin !== "policy") throw new Error(`a sheet review's origin is "human" or "policy", not "${origin}"`);
  return buildGateReview({
    stageId: SHEET_REVIEW_STAGE,
    decision,
    origin,
    actor: origin === "human" ? "human" : "pi",
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
 * `policy` is the series' `sheet.approval`: only "auto" lets the agent's
 * reading (origin "policy", never signed: `verified: null`) count.
 *
 * - `approved` / `rejected`: a well-formed human review of exactly this sheet;
 * - `stale`: it reviewed another sheet (another inputs hash, sheet or report);
 * - `invalid`: malformed, another stage or episode, or a signature that does not verify.
 */
export function verifySheetReview({ review, key, episode, inputsHash, sheetHash, reportHash, policy = "review" }) {
  const invalid = (code, message) => ({ state: "invalid", verified: key ? false : null, problem: { code, message } });
  if (!review || typeof review !== "object" || Array.isArray(review)) return invalid("malformed", "the review is not an object");
  if (review.stageId !== SHEET_REVIEW_STAGE) return invalid("wrong-stage", `the review is of stage "${review.stageId}", not "${SHEET_REVIEW_STAGE}"`);
  const byPolicy = review.origin === "policy";
  if (byPolicy && policy !== "auto") {
    return invalid("not-allowed", "the review is the agent's reading, which stands for a person's only where the series sets sheet.approval: auto");
  }
  if (review.origin !== "human" && !byPolicy) return invalid("not-human", `the review's origin is "${review.origin}", not a person`);
  if (review.decision !== "approved" && review.decision !== "rejected") return invalid("malformed", `"${review.decision}" is not a decision about a sheet`);
  if (review.episode !== episode) return invalid("wrong-episode", `the review is of ${review.episode}, not ${episode}`);
  if (review.decision === "rejected" && !review.note) return invalid("malformed", "a rejection without a note");
  let verified = null;
  if (key && !byPolicy) {
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
