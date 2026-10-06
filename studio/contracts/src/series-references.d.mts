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
