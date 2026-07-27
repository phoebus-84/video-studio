// ---------------------------------------------------------------------------
// Staleness types
// ---------------------------------------------------------------------------

/** A node in the dependency graph. */
export interface DependencyNode {
  /** Stage ID. */
  stageId: string;
  /** Artifacts this stage produces. */
  produces: string[];
  /** Artifacts this stage consumes. */
  consumes: string[];
}

/** A directed edge in the dependency graph. */
export interface DependencyEdge {
  /** Source stage (producer). */
  from: string;
  /** Target stage (consumer). */
  to: string;
  /** The artifact label that creates this dependency. */
  artifact: string;
}

/** A dependency graph for a pipeline. */
export interface DependencyGraph {
  /** All nodes indexed by stage ID. */
  nodes: Map<string, DependencyNode>;
  /** All edges. */
  edges: DependencyEdge[];
  /** Reverse adjacency: for each stage, which stages depend on it. */
  dependents: Map<string, string[]>;
  /** Forward adjacency: for each stage, which stages it depends on. */
  dependencies: Map<string, string[]>;
}

/** Reason explaining why a stage is stale. */
export interface StalenessReason {
  /** The stage that triggered staleness. */
  triggerStageId: string;
  /** The change that occurred (e.g., "re-executed", "artifact-changed"). */
  change: string;
  /** The path of propagation. */
  path: string[];
}

/** A single stage in a staleness report. */
export interface AffectedStage {
  /** Stage ID. */
  stageId: string;
  /** Whether this stage is stale. */
  stale: boolean;
  /** If stale, the reason(s) explaining why. */
  reasons: StalenessReason[];
  /** Whether staleness has been accepted. */
  accepted: boolean;
  /** Who accepted the staleness. */
  acceptedBy?: string;
  /** When accepted. */
  acceptedAt?: string;
}

/** Full staleness report for an episode pipeline. */
export interface StalenessReport {
  /** Episode slug. */
  episodeSlug: string;
  /** All stages and their staleness status. */
  stages: AffectedStage[];
  /** Stages that are currently stale (not accepted). */
  stale: string[];
  /** Stages affected by staleness but accepted. */
  accepted: string[];
  /** Stages not affected. */
  preserved: string[];
  /** When this report was computed. */
  computedAt: string;
}

/** Accept staleness for specific stages. */
export interface StalenessAcceptance {
  /** Stages to accept staleness for. */
  stageIds: string[];
  /** Who is accepting. */
  actor: string;
  /** Optional scope description. */
  scope?: string;
}
