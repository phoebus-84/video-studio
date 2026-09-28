// Type declarations for gate review records.
// Kept alongside gate-review.mjs so TypeScript consumers get the same contract
// the gateway relies on at runtime.

import type { JournalActor } from "./journal.mjs";

export type GateDecision = "requested" | "approved" | "rejected";

/** Who decided, as distinct from the journal `actor` who wrote the line. */
export type ReviewOrigin = "human" | "agent" | "policy";

export interface ArtifactHash {
  /** Path relative to the episode directory. */
  path: string;
  /** Lowercase hex sha256 of the file's bytes at the moment of review. */
  sha256: string;
}

export interface GateCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn" | "info";
  expected?: string;
  actual?: string;
  /** What was examined to reach this status. */
  evidence?: string;
}

export interface GateReviewBinding {
  /** Present on approved and rejected decisions; absent on a bare request. */
  planHash?: string;
  inputs: ArtifactHash[];
  outputs: ArtifactHash[];
}

export interface GateReview {
  stageId: string;
  decision: GateDecision;
  origin: ReviewOrigin;
  actor: JournalActor;
  at: string;
  binding: GateReviewBinding;
  checks: GateCheck[];
  note?: string;
  /** The "channel/series/episode" slug. Required on approved and rejected; signed. */
  episode?: string;
  /** Present exactly when `origin: "human"` and the decision is approved or rejected. */
  signature?: string;
}

export interface BuildGateReviewInputBinding {
  planHash?: string;
  inputs?: ArtifactHash[];
  outputs?: ArtifactHash[];
}

export interface BuildGateReviewInput {
  stageId: string;
  decision: GateDecision;
  origin: ReviewOrigin;
  actor: JournalActor;
  binding: BuildGateReviewInputBinding;
  checks?: GateCheck[];
  note?: string;
  at?: string;
  /** The "channel/series/episode" slug the decision is about. Required unless requested. */
  episode?: string;
}

/**
 * `unverifiable`: the latest decision is a human one and the reader holds no
 * operator key to check it with (avg-qr4.3). Not approved, not forged — unknown.
 */
export type GateStateName = "none" | "requested" | "approved" | "rejected" | "invalidated" | "unverifiable";

export interface GateState {
  state: GateStateName;
  /** Why a review is invalid or unverifiable, when it is. */
  reason?: string;
  at?: string;
  origin?: ReviewOrigin;
  /** Present when state is "rejected". */
  note?: string;
}

export declare const GATE_DECISIONS: readonly ["requested", "approved", "rejected"];
export declare const REVIEW_ORIGINS: readonly ["human", "agent", "policy"];
export declare const REVIEW_EVENT_FOR: Readonly<{
  requested: "approval-requested";
  approved: "approval-granted";
  rejected: "approval-rejected";
}>;

export declare function hashArtifacts(
  episodeDir: string,
  relativePaths: string[],
): Promise<ArtifactHash[]>;

export declare function buildGateReview(input: BuildGateReviewInput): GateReview;

export declare function deriveGateState(
  events: unknown[],
  stageId: string,
  episodeDir: string,
  opts?: { key?: string | null; planHash?: string; episode?: string },
): Promise<GateState>;
