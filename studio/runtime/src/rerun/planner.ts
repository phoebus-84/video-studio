// ---------------------------------------------------------------------------
// Rerun planner — from staleness to execution plan
// ---------------------------------------------------------------------------

import type { StageInstance } from "../engine/types.js";
import type { ResolvedPipeline } from "../pipeline/types.js";
import type { StalenessReport } from "../staleness/types.js";
import type {
  RerunMode,
  RerunPlan,
  RerunStageEntry,
} from "./types.js";

/** Default cost estimate for a stage with no prior attempts. */
const DEFAULT_STAGE_COST = 0.5;

/**
 * Generate a rerun plan from pipeline, stage instances, and mode.
 *
 * `report` is optional because exactly one mode reads it. The three others
 * derive their rerun set from the stage map alone — which is what
 * `deriveExecutionState` produces — so requiring staleness for all four would
 * make a caller fabricate an empty report to satisfy a signature, and an
 * empty report silently plans nothing. The type says which mode depends on
 * staleness; the throw says so at the one moment it matters.
 *
 * `episodeSlug` is likewise optional: it is cosmetic (nothing downstream
 * reads `RerunPlan.episodeSlug`), and the one thing this function must not do
 * is repeat `report`'s mistake by reading `report.episodeSlug` unconditionally.
 * A caller that knows the episode — the service wrapper, which holds the
 * `EpisodeRef` — should pass it; absent that, and absent a report, the
 * pipeline's own name is the least-wrong non-empty fallback.
 */
export function planRerun(
  report: StalenessReport | undefined,
  pipeline: ResolvedPipeline,
  stages: Map<string, StageInstance>,
  mode: RerunMode,
  selectedStages?: string[],
  episodeSlug?: string,
): RerunPlan {
  const stageIds = pipeline.stages.map((s) => s.definition.id);
  const entries: RerunStageEntry[] = [];
  let totalCost = 0;
  const preserved: string[] = [];
  const rerun: string[] = [];
  let hasInFlight = false;

  // Compute rerun set based on mode
  let rerunSet: Set<string>;
  switch (mode) {
    case "retry-current":
      // Just the failed/in-progress stages
      rerunSet = new Set(
        stageIds.filter((id) => {
          const inst = stages.get(id);
          return inst && (inst.status === "failed" || inst.status === "running");
        }),
      );
      break;
    case "rerun-selected":
      rerunSet = new Set(selectedStages ?? []);
      break;
    case "rerun-affected-downstream":
      // Selected + all stale downstream
      if (!report) {
        throw new Error(
          'mode "rerun-affected-downstream" needs a staleness report, which is not computed yet (avg-33r)',
        );
      }
      rerunSet = new Set([...(selectedStages ?? []), ...report.stale]);
      break;
    case "full-rebuild":
      rerunSet = new Set(stageIds);
      break;
    default:
      rerunSet = new Set();
  }

  for (const id of stageIds) {
    const inst = stages.get(id);
    const isRerun = rerunSet.has(id);
    const cost = estimateCost(inst);

    if (isRerun) {
      totalCost += cost;
      rerun.push(id);

      // Check if this stage has an in-flight provider job
      const lastAttempt = inst?.attempts[inst.attempts.length - 1];
      const inFlight = inst?.status === "running";
      if (inFlight) hasInFlight = true;

      entries.push({
        stageId: id,
        action: "rerun",
        reason: `${mode} mode: stage "${id}" selected for rerun`,
        estimatedCost: cost,
        preservesArtifacts: false,
        inFlight: inFlight ?? false,
        inFlightJobId: inFlight ? lastAttempt?.leaseId : undefined,
      });
    } else {
      preserved.push(id);
      entries.push({
        stageId: id,
        action: "preserve",
        reason: `Not in rerun scope for mode "${mode}"`,
        estimatedCost: 0,
        preservesArtifacts: true,
        inFlight: false,
      });
    }
  }

  return {
    episodeSlug: episodeSlug ?? report?.episodeSlug ?? pipeline.name,
    mode,
    stages: entries,
    totalEstimatedCost: totalCost,
    preservedStageIds: preserved,
    rerunStageIds: rerun,
    hasInFlightJobs: hasInFlight,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Estimate cost for a stage based on prior attempts.
 */
function estimateCost(inst: StageInstance | undefined): number {
  if (!inst || inst.attempts.length === 0) return DEFAULT_STAGE_COST;

  // Average of prior attempt costs, or default
  const priorCosts = inst.attempts
    .map((a) => (a.outcome === "success" ? 0.5 : 1.0))
    .filter((c) => c > 0);

  return priorCosts.length > 0
    ? priorCosts.reduce((s, c) => s + c, 0) / priorCosts.length
    : DEFAULT_STAGE_COST;
}
