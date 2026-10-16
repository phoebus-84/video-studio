// Type declarations for the review of a layout sheet (avg-3th.2).

import type { GateReview } from "./gate-review.mjs";

export declare const SHEET_REVIEW_STAGE: "layout-sheet";
export declare const LAYOUT_SHEET_DIR: "artifacts/layout-sheet";
export declare const LAYOUT_SHEET_REPORT: "artifacts/layout-sheet/sheet.json";
export declare const SHEET_REVIEW_FILE: "review.json";
export declare const SHEET_REVIEW_PATH: "artifacts/layout-sheet/review.json";

/** Who stands for the reading of a sheet: the operator's signed review ("review"), or the agent's (`sheet.approval: auto`). */
export interface SheetApprovalPolicy {
  approval: "review" | "auto";
  /** The settings.yaml that set it, or null for the default. */
  from: string | null;
}

/** The series' (else the channel's) `sheet.approval`; never the episode's own. */
export declare function sheetApprovalPolicy(episodeDir: string, parse: (text: string) => unknown): SheetApprovalPolicy;

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
  /** "policy": the agent's reading under `sheet.approval: auto`, unsigned. Default "human". */
  origin?: "human" | "policy";
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
  /** The series' `sheet.approval`; only "auto" accepts a review of origin "policy". Default "review". */
  policy?: "review" | "auto";
}): SheetReviewVerdict;
