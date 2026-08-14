// ---------------------------------------------------------------------------
// Policy module — public API
// ---------------------------------------------------------------------------

export {
  checkGate,
  checkGates,
  detectDowngrade,
  PolicyError,
  POLICY_CODES,
} from "./gates.js";

export {
  createLedger,
  reserveBudget,
  consumeReserve,
  releaseReserve,
  BudgetError,
  BUDGET_CODES,
} from "./ledger.js";

export type {
  PolicyGate,
  GateDecision,
  GateCheckResult,
  BudgetReserve,
  BudgetLedger,
} from "./types.js";
