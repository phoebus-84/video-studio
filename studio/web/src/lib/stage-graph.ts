/**
 * What a stage reads, what reads it, and what rerunning it would cost you.
 *
 * The pipeline reports edges (`dependsOn`), not consequences. But "if I rerun
 * illustrations, what do I lose" is the question actually being asked at the
 * moment someone reaches for the rerun button, and it is answerable from the
 * edges alone: everything transitively downstream goes stale, everything else
 * is preserved.
 *
 * Deriving it here rather than asking the gateway matters for a second reason:
 * the rerun-plan endpoint shells out to the runtime, and consequences should be
 * visible before anything is executed, not as a side effect of asking.
 */

import type { ResolvedStage } from "$lib/episode-types";

export interface Consequence {
  /** Stages whose outputs this rerun would invalidate. */
  invalidated: string[];
  /** Stages untouched by the rerun. */
  preserved: string[];
}

/** Stage ids this stage directly depends on, in pipeline order. */
export function upstreamOf(
  stages: readonly ResolvedStage[],
  stageId: string,
): ResolvedStage[] {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return [];
  return stage.dependsOn
    .map((id) => stages.find((s) => s.id === id))
    .filter((s): s is ResolvedStage => s !== undefined);
}

/** Stage ids that directly depend on this stage. */
export function downstreamOf(
  stages: readonly ResolvedStage[],
  stageId: string,
): ResolvedStage[] {
  return stages.filter((s) => s.dependsOn.includes(stageId));
}

/**
 * Everything transitively downstream of a stage.
 *
 * Breadth-first with a seen set, so a diamond-shaped pipeline reports each
 * stage once and a cycle — which a malformed manifest can express — terminates
 * instead of hanging the panel.
 */
export function transitiveDownstream(
  stages: readonly ResolvedStage[],
  stageId: string,
): ResolvedStage[] {
  const seen = new Set<string>([stageId]);
  const out: ResolvedStage[] = [];
  const queue = [stageId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of downstreamOf(stages, current)) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      out.push(next);
      queue.push(next.id);
    }
  }

  return out;
}

/** What rerunning this stage would invalidate, and what it would leave alone. */
export function rerunConsequence(
  stages: readonly ResolvedStage[],
  stageId: string,
): Consequence {
  const downstream = transitiveDownstream(stages, stageId);
  const invalidated = downstream.map((s) => s.name || s.id);
  const invalidatedIds = new Set(downstream.map((s) => s.id));

  const preserved = stages
    .filter((s) => s.id !== stageId && !invalidatedIds.has(s.id))
    .map((s) => s.name || s.id);

  return { invalidated, preserved };
}
