// ---------------------------------------------------------------------------
// Rerun planner and recovery tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  planRerun,
  analyzeRecovery,
  canResumeWithoutDuplicate,
} from "../../../src/rerun/index.js";
import type { RerunMode, RerunPlan } from "../../../src/rerun/types.js";
import type { StalenessReport } from "../../../src/staleness/types.js";
import type { StageInstance } from "../../../src/engine/types.js";
import type { ResolvedPipeline } from "../../../src/pipeline/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePipeline(): ResolvedPipeline {
  return {
    name: "test",
    version: "1.0.0",
    inheritanceChain: ["test"],
    stages: [
      {
        definition: {
          id: "brief",
          name: "Brief",
          capabilities: [],
          dependsOn: [],
          produces: [{ kind: "text", label: "brief.md" }],
          consumes: [],
        },
        source: "test",
        topoIndex: 0,
      },
      {
        definition: {
          id: "script",
          name: "Script",
          capabilities: [{ capability: "llm" }],
          dependsOn: ["brief"],
          produces: [{ kind: "text", label: "script.md" }],
          consumes: [{ kind: "text", label: "brief.md" }],
        },
        source: "test",
        topoIndex: 1,
      },
      {
        definition: {
          id: "render",
          name: "Render",
          capabilities: [{ capability: "ffmpeg" }],
          dependsOn: ["script"],
          produces: [{ kind: "video/mp4", label: "output.mp4" }],
          consumes: [{ kind: "text", label: "script.md" }],
        },
        source: "test",
        topoIndex: 2,
      },
    ],
    skills: [],
    diagnostics: [],
  };
}

function makeReport(stale: string[]): StalenessReport {
  return {
    episodeSlug: "ep-01",
    stages: [],
    stale,
    accepted: [],
    preserved: [],
    computedAt: new Date().toISOString(),
  };
}

function makeStage(
  id: string,
  status: "pending" | "running" | "completed" | "failed" = "pending",
  attempts = 0,
): StageInstance {
  return {
    stageId: id,
    name: id,
    status,
    attempts: Array.from({ length: attempts }, (_, i) => ({
      number: i + 1,
      leaseId: `lease-${id}-${i + 1}`,
      startedAt: new Date().toISOString(),
      outcome: i < attempts - 1 ? "failure" as const : undefined,
    })),
    outputArtifacts: [],
    createdAt: new Date().toISOString(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("planRerun", () => {
  const pipeline = makePipeline();

  it("full-rebuild marks all stages for rerun", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "completed", 1)],
      ["render", makeStage("render", "completed", 1)],
    ]);
    const report = makeReport([]);
    const plan = planRerun(report, pipeline, stages, "full-rebuild");

    expect(plan.mode).toBe("full-rebuild");
    expect(plan.rerunStageIds).toEqual(["brief", "script", "render"]);
    expect(plan.preservedStageIds).toEqual([]);
    expect(plan.totalEstimatedCost).toBeGreaterThan(0);
  });

  it("retry-current only includes failed/running stages", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "failed", 2)],
      ["render", makeStage("render", "running", 1)],
    ]);
    const report = makeReport([]);
    const plan = planRerun(report, pipeline, stages, "retry-current");

    expect(plan.rerunStageIds).toContain("script");
    expect(plan.rerunStageIds).toContain("render");
    expect(plan.preservedStageIds).toContain("brief");
  });

  it("rerun-selected only reruns specified stages", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "completed", 1)],
      ["render", makeStage("render", "completed", 1)],
    ]);
    const report = makeReport([]);
    const plan = planRerun(report, pipeline, stages, "rerun-selected", ["script"]);

    expect(plan.rerunStageIds).toEqual(["script"]);
    expect(plan.preservedStageIds).toEqual(["brief", "render"]);
  });

  it("rerun-affected-downstream includes selected + stale", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "completed", 1)],
      ["render", makeStage("render", "completed", 1)],
    ]);
    const report = makeReport(["render"]);
    const plan = planRerun(report, pipeline, stages, "rerun-affected-downstream", ["script"]);

    expect(plan.rerunStageIds).toContain("script");
    expect(plan.rerunStageIds).toContain("render");
  });

  it("detects in-flight provider jobs", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "running", 1)],
      ["script", makeStage("script", "completed", 1)],
      ["render", makeStage("render", "completed", 1)],
    ]);
    const report = makeReport([]);
    const plan = planRerun(report, pipeline, stages, "retry-current");

    expect(plan.hasInFlightJobs).toBe(true);
    const brief = plan.stages.find((s) => s.stageId === "brief")!;
    expect(brief.inFlight).toBe(true);
    expect(brief.inFlightJobId).toBeDefined();
  });

  it("estimates costs from prior attempts", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "failed", 3)],
      ["render", makeStage("render", "pending", 0)],
    ]);
    const report = makeReport([]);
    const plan = planRerun(report, pipeline, stages, "full-rebuild");

    // Render (no attempts) gets default cost
    const render = plan.stages.find((s) => s.stageId === "render")!;
    expect(render.estimatedCost).toBe(0.5);
  });

  it("no rerun deletes history — preserved stages keep their data", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 2)],
      ["script", makeStage("script", "completed", 1)],
      ["render", makeStage("render", "completed", 1)],
    ]);
    const report = makeReport([]);
    const plan = planRerun(report, pipeline, stages, "rerun-selected", ["script"]);

    const brief = plan.stages.find((s) => s.stageId === "brief")!;
    expect(brief.action).toBe("preserve");
    expect(brief.preservesArtifacts).toBe(true);
  });
});

describe("analyzeRecovery", () => {
  it("detects in-flight stages after crash", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "running", 2)],
      ["render", makeStage("render", "pending", 0)],
    ]);

    const recovery = analyzeRecovery("ep-01", stages);
    expect(recovery.inFlightStages).toEqual(["script"]);
    expect(recovery.staleLeases.length).toBe(1);
    expect(recovery.recoverable).toBe(true);
    expect(recovery.action).toBe("resume");
  });

  it("returns none when no in-flight stages", () => {
    const stages = new Map([
      ["brief", makeStage("brief", "completed", 1)],
      ["script", makeStage("script", "completed", 1)],
    ]);

    const recovery = analyzeRecovery("ep-01", stages);
    expect(recovery.action).toBe("none");
    expect(recovery.recoverable).toBe(false);
  });
});

describe("canResumeWithoutDuplicate", () => {
  it("returns true for recoverable state with provider jobs", () => {
    const stages = new Map([
      ["script", makeStage("script", "running", 1)],
    ]);

    const recovery = analyzeRecovery("ep-01", stages);
    expect(canResumeWithoutDuplicate(recovery)).toBe(true);
  });

  it("returns false when no provider jobs", () => {
    const stages = new Map<string, StageInstance>([]);
    const recovery = analyzeRecovery("ep-01", stages);
    expect(canResumeWithoutDuplicate(recovery)).toBe(false);
  });
});
