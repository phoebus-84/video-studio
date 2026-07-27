// ---------------------------------------------------------------------------
// Dependency graph builder
// ---------------------------------------------------------------------------

import type { ResolvedPipeline } from "../pipeline/types.js";
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
} from "./types.js";

/**
 * Build a dependency graph from a resolved pipeline.
 *
 * Nodes are stages. Edges connect a producer to a consumer
 * when they share an artifact label.
 */
export function buildDependencyGraph(
  pipeline: ResolvedPipeline,
): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const dependents = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();

  // Create nodes
  for (const stage of pipeline.stages) {
    const node: DependencyNode = {
      stageId: stage.definition.id,
      produces: stage.definition.produces.map((p) => p.label),
      consumes: stage.definition.consumes.map((c) => c.label),
    };
    nodes.set(stage.definition.id, node);
    dependents.set(stage.definition.id, []);
    dependencies.set(stage.definition.id, []);
  }

  // Create edges based on shared artifact labels
  for (const stage of pipeline.stages) {
    for (const artifact of stage.definition.consumes) {
      // Find which stages produce this artifact
      for (const other of pipeline.stages) {
        if (other.definition.id === stage.definition.id) continue;

        const producesLabel = other.definition.produces.some(
          (p) => p.label === artifact.label,
        );
        if (producesLabel) {
          const edge: DependencyEdge = {
            from: other.definition.id,
            to: stage.definition.id,
            artifact: artifact.label,
          };
          edges.push(edge);

          // Update adjacency
          dependents.get(other.definition.id)!.push(stage.definition.id);
          dependencies.get(stage.definition.id)!.push(other.definition.id);
        }
      }
    }
  }

  return { nodes, edges, dependents, dependencies };
}

/**
 * Find all downstream stages transitively reachable from the given stage IDs.
 * Uses BFS through the dependency graph.
 */
export function findDownstream(
  graph: DependencyGraph,
  stageIds: string[],
): string[] {
  const visited = new Set<string>();
  const queue = [...stageIds];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const downstream = graph.dependents.get(current) ?? [];
    for (const dep of downstream) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  // Remove the input stages from the result
  const seed = new Set(stageIds);
  return [...visited].filter((id) => !seed.has(id));
}

/**
 * Find all upstream stages that the given stages depend on.
 */
export function findUpstream(
  graph: DependencyGraph,
  stageIds: string[],
): string[] {
  const visited = new Set<string>();
  const queue = [...stageIds];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const upstream = graph.dependencies.get(current) ?? [];
    for (const dep of upstream) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  const seed = new Set(stageIds);
  return [...visited].filter((id) => !seed.has(id));
}

/**
 * Check for cycles in the graph using DFS.
 */
export function detectCycles(graph: DependencyGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      // Found a cycle — extract it from the path
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart);
      cycle.push(node);
      cycles.push(cycle);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const downstream = graph.dependents.get(node) ?? [];
    for (const dep of downstream) {
      dfs(dep, [...path]);
    }

    inStack.delete(node);
  }

  for (const nodeId of graph.nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  return cycles;
}
