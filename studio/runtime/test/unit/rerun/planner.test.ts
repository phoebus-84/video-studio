// ---------------------------------------------------------------------------
// planRerun without a staleness report
//
// Three of `RerunMode`'s four members — `retry-current`, `rerun-selected`,
// `full-rebuild` — derive their rerun set from the stage map alone, which is
// exactly what `deriveExecutionState` produces. Only `rerun-affected-downstream`
// reads a `StalenessReport`, so it is the only mode that should refuse when
// `report` is absent; the other three must plan normally.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { planRerun } from "../../../src/rerun/planner.js";
import type { StageInstance } from "../../../src/engine/types.js";
import type { ResolvedPipeline } from "../../../src/pipeline/types.js";

/**
 * The minimal `ResolvedPipeline` the planner reads: `pipeline.stages[].definition.id`,
 * in the order given.
 */
function pipelineOf(ids: string[]): ResolvedPipeline {
  return {
    name: "test-pipeline",
    version: "1.0.0",
    inheritanceChain: ["test-pipeline"],
    stages: ids.map((id, i) => ({
      definition: {
        id,
        name: id,
        type: "capability",
        capabilities: [],
        dependsOn: i > 0 ? [ids[i - 1]!] : [],
        produces: [],
        consumes: [],
        gates: { autopilot: true, review: "none", retryOnFailure: 0 },
      },
      source: "test",
      topoIndex: i,
    })),
    skills: [],
    diagnostics: [],
  };
}

/**
 * The minimal `Map<string, StageInstance>` the planner reads: each instance's
 * `status` and `attempts`. Defaults to `pending` with no attempts; callers
 * mutate the returned map's entries (`.status = "failed"`, etc.) to shape a
 * specific scenario.
 */
function instancesOf(ids: string[]): Map<string, StageInstance> {
  return new Map(
    ids.map((id) => [
      id,
      {
        stageId: id,
        name: id,
        status: "pending",
        attempts: [],
        outputArtifacts: [],
        createdAt: new Date().toISOString(),
      } satisfies StageInstance,
    ]),
  );
}

describe("planRerun without a staleness report", () => {
  it("plans full-rebuild from the stage map alone", () => {
    const plan = planRerun(undefined, pipelineOf(["a", "b"]), instancesOf(["a", "b"]), "full-rebuild");
    expect(plan.rerunStageIds).toEqual(["a", "b"]);
  });

  it("plans retry-current from the stage map alone", () => {
    const stages = instancesOf(["a", "b"]);
    stages.get("a")!.status = "failed";
    const plan = planRerun(undefined, pipelineOf(["a", "b"]), stages, "retry-current");
    expect(plan.rerunStageIds).toEqual(["a"]);
  });

  it("plans rerun-selected from the stage map alone", () => {
    const plan = planRerun(undefined, pipelineOf(["a", "b"]), instancesOf(["a", "b"]), "rerun-selected", ["b"]);
    expect(plan.rerunStageIds).toEqual(["b"]);
  });

  it("raises for rerun-affected-downstream, which needs staleness", () => {
    expect(() =>
      planRerun(undefined, pipelineOf(["a", "b"]), instancesOf(["a", "b"]), "rerun-affected-downstream"),
    ).toThrow(/staleness/i);
  });

  it("falls back to the pipeline name for episodeSlug when neither a report nor an explicit slug is given", () => {
    const plan = planRerun(undefined, pipelineOf(["a"]), instancesOf(["a"]), "full-rebuild");
    expect(plan.episodeSlug).toBe("test-pipeline");
    expect(plan.episodeSlug).not.toBe("");
  });

  it("prefers an explicit episodeSlug over the pipeline name", () => {
    const plan = planRerun(undefined, pipelineOf(["a"]), instancesOf(["a"]), "full-rebuild", [], "ch/series/ep");
    expect(plan.episodeSlug).toBe("ch/series/ep");
  });
});
