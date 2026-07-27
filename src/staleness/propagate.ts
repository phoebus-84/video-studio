// ---------------------------------------------------------------------------
// Staleness propagation engine
// ---------------------------------------------------------------------------

import type { DependencyGraph } from "./types.js";
import {
  buildDependencyGraph,
  findDownstream,
  detectCycles,
} from "./graph.js";
import type {
  StalenessReport,
  StalenessReason,
  AffectedStage,
  StalenessAcceptance,
} from "./types.js";
import type { ResolvedPipeline } from "../pipeline/types.js";

/**
 * Engine for computing and managing staleness.
 */
export class StalenessEngine {
  private pipeline: ResolvedPipeline;
  private graph: DependencyGraph;
  /** Previously accepted staleness. */
  private acceptances = new Map<string, StalenessAcceptance>();

  constructor(pipeline: ResolvedPipeline) {
    this.pipeline = pipeline;
    this.graph = buildDependencyGraph(pipeline);
  }

  /**
   * Compute a staleness report given a set of changed stages.
   *
   * @param changedStageIds — stages that have been re-executed or modified.
   */
  computeReport(changedStageIds: string[]): StalenessReport {
    // Detect cycles
    const cycles = detectCycles(this.graph);
    if (cycles.length > 0) {
      const cycleStages = cycles[0]!;
      // Include all cycle members as stale
      const cycleSet = new Set(cycleStages);
      changedStageIds = [...new Set([...changedStageIds, ...cycleSet])];
    }

    // Find all downstream stages affected by the changed stages
    const downstream = findDownstream(this.graph, changedStageIds);

    // Build reason paths for each affected stage
    const reasons = new Map<string, StalenessReason[]>();
    for (const stageId of changedStageIds) {
      const affected = findDownstream(this.graph, [stageId]);
      for (const affectedId of affected) {
        const existing = reasons.get(affectedId) ?? [];
        existing.push({
          triggerStageId: stageId,
          change: "re-executed",
          path: [stageId, ...this.findPath(stageId, affectedId), affectedId],
        });
        reasons.set(affectedId, existing);
      }
    }

    const allStages = this.pipeline.stages.map((s) => s.definition.id);
    const staleSet = new Set(downstream);
    const acceptedSet = new Set<string>();
    const preservedSet = new Set<string>();

    // Build per-stage reports
    const stages: AffectedStage[] = allStages.map((stageId) => {
      const isStale = staleSet.has(stageId);
      const isAccepted = this.acceptances.has(stageId);

      if (isStale && isAccepted) {
        acceptedSet.add(stageId);
      } else if (isStale) {
        // stays in stale
      } else {
        preservedSet.add(stageId);
      }

      const acceptance = this.acceptances.get(stageId);
      return {
        stageId,
        stale: isStale,
        reasons: reasons.get(stageId) ?? [],
        accepted: isAccepted,
        acceptedBy: acceptance?.actor,
        acceptedAt: undefined, // Set when accepted
      };
    });

    return {
      episodeSlug: "", // Caller fills in
      stages,
      stale: [...staleSet].filter((id) => !acceptedSet.has(id)),
      accepted: [...acceptedSet],
      preserved: [...preservedSet],
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Accept staleness for specified stages.
   * After acceptance, these stages won't appear in the "stale" list.
   */
  accept(acceptance: StalenessAcceptance): void {
    const now = new Date().toISOString();
    for (const stageId of acceptance.stageIds) {
      this.acceptances.set(stageId, {
        stageIds: [stageId],
        actor: acceptance.actor,
        scope: acceptance.scope,
      });
    }
  }

  /**
   * Clear acceptance for specified stages (e.g., after re-execution).
   */
  clearAcceptance(stageIds: string[]): void {
    for (const id of stageIds) {
      this.acceptances.delete(id);
    }
  }

  /**
   * Find a shortest path between two stages in the dependency graph.
   * Returns the intermediate nodes (excludes start and end).
   */
  private findPath(from: string, to: string): string[] {
    const visited = new Set<string>();
    const queue: { node: string; path: string[] }[] = [{ node: from, path: [] }];

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;
      if (node === to) return path;
      if (visited.has(node)) continue;
      visited.add(node);

      const dependents = this.graph.dependents.get(node) ?? [];
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          queue.push({ node: dep, path: [...path, dep] });
        }
      }
    }

    return [];
  }
}

/**
 * Quick helper: given a pipeline and a single changed stage, return the staleness report.
 */
export function propagate(
  pipeline: ResolvedPipeline,
  changedStageIds: string[],
  episodeSlug: string,
): StalenessReport {
  const engine = new StalenessEngine(pipeline);
  const report = engine.computeReport(changedStageIds);
  report.episodeSlug = episodeSlug;
  return report;
}
