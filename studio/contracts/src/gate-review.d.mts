// Type declarations for gate review records.
// Kept alongside gate-review.mjs so TypeScript consumers get the same contract
// the gateway relies on at runtime.

import type { JournalActor } from "./journal.mjs";

export type GateDecision = "requested" | "approved";

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

export interface GateReview {
  stageId: string;
  decision: GateDecision;
  actor: JournalActor;
  at: string;
  inputs: ArtifactHash[];
  outputs: ArtifactHash[];
  checks: GateCheck[];
  note?: string;
}

export interface BuildGateReviewInput {
  stageId: string;
  decision: GateDecision;
  actor: JournalActor;
  inputs?: ArtifactHash[];
  outputs?: ArtifactHash[];
  checks?: GateCheck[];
  note?: string;
  at?: string;
}

export type GateStateName = "none" | "requested" | "approved" | "invalidated";

export interface GateState {
  state: GateStateName;
  /** Why a review is invalid, when it is. */
  reason?: string;
  at?: string;
  actor?: JournalActor;
}

export declare const GATE_DECISIONS: readonly ["requested", "approved"];

export declare function hashArtifacts(
  episodeDir: string,
  relativePaths: string[],
): Promise<ArtifactHash[]>;

export declare function buildGateReview(input: BuildGateReviewInput): GateReview;

export declare function deriveGateState(
  events: unknown[],
  stageId: string,
  episodeDir: string,
): Promise<GateState>;
