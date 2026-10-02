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

export type {
  PolicyGate,
  GateDecision,
  GateCheckResult,
} from "./types.js";
