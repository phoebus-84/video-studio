// Type declarations for candidates and take selection (avg-qr4.6).
// Kept alongside takes.mjs so TypeScript consumers get the same contract the
// runtime relies on at runtime.

import type { JournalActor, JournalEvent } from "./journal.mjs";
import type { ArtifactHash, ReviewOrigin } from "./gate-review.mjs";

export declare const ATTEMPTS_DIR: "attempts";

export declare function candidatePath(stageId: string, attemptNumber: number, relative?: string): string;

/** A completion whose files were kept, read-only, under `attempts/`. */
export interface Candidate {
  attemptNumber: number;
  leaseId: string;
  at: string;
  outputs: ArtifactHash[];
}

export interface SelectedTake {
  attemptNumber: number;
  leaseId: string;
  origin: ReviewOrigin;
  at: string;
  /** Null for a completion from before candidates were kept: nothing to restore or compare. */
  outputs: ArtifactHash[] | null;
  /** The files this take is made of, relative to the episode. */
  paths: string[];
  /** The operator selected it, and nothing shows the selection forged. */
  locked: boolean;
  /** Whether an operator's signature verified; null when nothing was checked. */
  verified: boolean | null;
}

export interface StageTakes {
  stageId: string;
  candidates: Candidate[];
  selected: SelectedTake | null;
}

export interface TakeSelection {
  stageId: string;
  decision: "selected";
  origin: ReviewOrigin;
  actor: JournalActor;
  at: string;
  episode: string;
  binding: { attemptNumber: number; leaseId: string; outputs: ArtifactHash[] };
  previous: number | null;
  signature?: string;
}

export declare function buildTakeSelection(input: {
  stageId: string;
  origin: ReviewOrigin;
  actor: JournalActor;
  attemptNumber: number;
  leaseId: string;
  outputs: ArtifactHash[];
  episode: string;
  previous?: number | null;
  at?: string;
}): TakeSelection;

export declare function deriveTakes(
  events: JournalEvent[],
  stageIds: string[],
  opts?: { key?: string | null; episode?: string },
): Map<string, StageTakes>;
