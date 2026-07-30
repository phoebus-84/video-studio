// ---------------------------------------------------------------------------
// Policy types — approval gates and budget enforcement
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

/** A budget reserve entry. */
export interface BudgetReserve {
  /** Unique reserve ID. */
  reserveId: string;
  /** Stage that requested the reserve. */
  stageId: string;
  /** Estimated cost. */
  estimatedCost: number;
  /** When the reserve was created. */
  createdAt: string;
  /** Whether this reserve has been consumed (spent). */
  consumed: boolean;
  /** Actual cost after execution (if consumed). */
  actualCost?: number;
}

/** Budget ledger tracking reserves and spend. */
export interface BudgetLedger {
  /** Episode slug. */
  episodeSlug: string;
  /** Total budget limit. */
  limit: number;
  /** Currently reserved (not yet spent). */
  reserved: number;
  /** Total spent. */
  spent: number;
  /** Available (limit - reserved - spent). */
  available: number;
  /** All reserve entries. */
  reserves: BudgetReserve[];
}
