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

/**
 * Weight given to a stage with no prior attempts.
 *
 * Unitless, and deliberately not money. See `stageWeight` below.
 */
const DEFAULT_STAGE_WEIGHT = 0.5;

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
  let totalWeight = 0;
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
    const weight = stageWeight(inst);

    if (isRerun) {
      totalWeight += weight;
      rerun.push(id);

      // Check if this stage has an in-flight provider job
      const lastAttempt = inst?.attempts[inst.attempts.length - 1];
      const inFlight = inst?.status === "running";
      if (inFlight) hasInFlight = true;

      entries.push({
        stageId: id,
        action: "rerun",
        reason: `${mode} mode: stage "${id}" selected for rerun`,
        estimatedCost: weight,
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
    totalEstimatedCost: totalWeight,
    preservedStageIds: preserved,
    rerunStageIds: rerun,
    hasInFlightJobs: hasInFlight,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * How heavy a stage looks, from its attempt history alone.
 *
 * A UNITLESS relative weight, not a price and not a prediction of one. It
 * reads nothing but this stage's own attempts: 0.5 for one that succeeded,
 * 1.0 for one that did not, averaged. Nothing here has ever seen a provider
 * rate card, a token count or a second of GPU time.
 *
 * It is called a weight rather than a cost because it used to be called a
 * cost and was rendered to operators as `about $1.50`. A fabricated spend
 * figure is the number an operator trusts to decide whether to keep going —
 * the reasoning that removed the invented total from `/budget`
 * (studio/gateway/src/routes/budget.ts) applies here unchanged. No surface
 * prints this with a currency symbol; none should start.
 */
function stageWeight(inst: StageInstance | undefined): number {
  if (!inst || inst.attempts.length === 0) return DEFAULT_STAGE_WEIGHT;

  const weights = inst.attempts
    .map((a) => (a.outcome === "success" ? 0.5 : 1.0))
    .filter((c) => c > 0);

  return weights.length > 0
    ? weights.reduce((s, c) => s + c, 0) / weights.length
    : DEFAULT_STAGE_WEIGHT;
}
