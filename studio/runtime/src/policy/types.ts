// ---------------------------------------------------------------------------
// Policy types — approval gates
// ---------------------------------------------------------------------------

/** A gate declared by a pipeline stage that requires approval. */
export interface PolicyGate {
  /** Unique gate identifier (stageId + gate name). */
  gateId: string;
  /** The stage that declares this gate. */
  stageId: string;
  /** Human-readable description of what this gate guards. */
  description: string;
  /** Whether this is a hard blocker (fails the run) or advisory. */
  hard: boolean;
}

/** Decision outcome for a gate. */
export type GateDecision = "proceed" | "block" | "prompt";

/** Result of checking a gate against the current approval policy. */
export interface GateCheckResult {
  gate: PolicyGate;
  decision: GateDecision;
  /** Reason for the decision (machine-readable). */
  reason: string;
}
