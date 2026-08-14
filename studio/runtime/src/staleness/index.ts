// ---------------------------------------------------------------------------
// Staleness module — public API
// ---------------------------------------------------------------------------

export {
  StalenessEngine,
  propagate,
} from "./propagate.js";

export {
  buildDependencyGraph,
  findDownstream,
  findUpstream,
  detectCycles,
} from "./graph.js";

export type {
  DependencyNode,
  DependencyEdge,
  DependencyGraph,
  StalenessReason,
  AffectedStage,
  StalenessReport,
  StalenessAcceptance,
} from "./types.js";
