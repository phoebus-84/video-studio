// ---------------------------------------------------------------------------
// Stage engine tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  StageStateMachine,
  StageTransitionError,
  StageExecutor,
  DEFAULT_ENGINE_CONFIG,
} from "../../../src/engine/index.js";
import type { StageInstance, StageStatus } from "../../../src/engine/types.js";
import type { StageStartedEvent, StageCompletedEvent, StageFailedEvent } from "../../../src/journal/types.js";
import { Journal } from "../../../src/journal/writer.js";
import { JournalReader } from "../../../src/journal/reader.js";
import { FakeLock, FakeFileSystem } from "../../fixtures/index.js";
import type { ResolvedPipeline } from "../../../src/pipeline/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePipeline(): ResolvedPipeline {
  return {
    name: "test-pipeline",
    version: "1.0.0",
    inheritanceChain: ["test-pipeline"],
    stages: [
      {
        definition: {
          id: "brief",
          name: "Brief",
          type: "capability",
          capabilities: [],
          dependsOn: [],
          produces: [{ kind: "text/markdown", label: "brief.md" }],
          consumes: [],
        },
        source: "test-pipeline",
        topoIndex: 0,
      },
      {
        definition: {
          id: "script",
          name: "Script",
          type: "capability",
          capabilities: [{ capability: "image.generate" }],
          dependsOn: ["brief"],
          produces: [{ kind: "text/markdown", label: "script.md" }],
          consumes: [{ kind: "text/markdown", label: "brief.md" }],
        },
        source: "test-pipeline",
        topoIndex: 1,
      },
      {
        definition: {
          id: "render",
          name: "Render",
          type: "capability",
          capabilities: [{ capability: "video.compose" }],
          dependsOn: ["script"],
          produces: [{ kind: "video/mp4", label: "output.mp4" }],
          consumes: [{ kind: "text/markdown", label: "script.md" }],
        },
        source: "test-pipeline",
        topoIndex: 2,
      },
    ],
    skills: [],
    diagnostics: [],
  };
}

function makeInstance(
  id: string,
  status: StageStatus = "pending",
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
    })),
    outputArtifacts: [],
    createdAt: new Date().toISOString(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("StageStateMachine", () => {
  let sm: StageStateMachine;

  beforeEach(() => {
    const lock = new FakeLock();
    sm = new StageStateMachine(lock, DEFAULT_ENGINE_CONFIG);
  });

  describe("valid transitions", () => {
    it("transitions pending → running", async () => {
      const instance = makeInstance("brief", "pending");
      const result = await sm.transition(instance, "running");
      expect(result.instance.status).toBe("running");
      expect(result.transition.from).toBe("pending");
      expect(result.transition.to).toBe("running");
      expect(result.transition.attemptNumber).toBe(1);
      expect(result.transition.leaseId).toBeDefined();
      expect(result.instance.attempts.length).toBe(1);
    });

    it("transitions running → completed", async () => {
      let instance = makeInstance("brief", "pending");
      const r1 = await sm.transition(instance, "running");
      instance = r1.instance;

      const r2 = await sm.transition(instance, "completed");
      expect(r2.instance.status).toBe("completed");
      expect(r2.instance.attempts[0]!.outcome).toBe("success");
      expect(r2.instance.attempts[0]!.endedAt).toBeDefined();
    });

    it("transitions running → failed", async () => {
      let instance = makeInstance("script", "pending");
      instance = (await sm.transition(instance, "running")).instance;

      const result = await sm.fail(instance, "LLM error", true);
      expect(result.instance.status).toBe("failed");
      expect(result.instance.attempts[0]!.outcome).toBe("failure");
      expect(result.instance.attempts[0]!.error).toBe("LLM error");
      expect(result.instance.attempts[0]!.retryable).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("rejects pending → completed", async () => {
      const instance = makeInstance("brief", "pending");
      await expect(sm.transition(instance, "completed")).rejects.toThrow(
        StageTransitionError,
      );
    });

    it("rejects completed → running", async () => {
      let instance = makeInstance("brief", "pending");
      instance = (await sm.transition(instance, "running")).instance;
      instance = (await sm.transition(instance, "completed")).instance;

      await expect(sm.transition(instance, "running")).rejects.toThrow(
        StageTransitionError,
      );
    });
  });

  describe("retry", () => {
    it("allows retry if under max attempts", async () => {
      const instance = makeInstance("brief", "failed", 1);
      expect(sm.canRetry(instance)).toBe(true);
    });

    it("denies retry if max attempts reached", async () => {
      const instance = makeInstance("brief", "failed", 3);
      expect(sm.canRetry(instance)).toBe(false);
    });
  });
});

describe("StageExecutor", () => {
  let executor: StageExecutor;
  let pipeline: ResolvedPipeline;

  beforeEach(() => {
    const lock = new FakeLock();
    const sm = new StageStateMachine(lock, DEFAULT_ENGINE_CONFIG);
    const fs = new FakeFileSystem();
    fs.seed({ "/workspace/ep-01/.keep": "" });
    const journal = new Journal(fs);
    executor = new StageExecutor(sm, journal, DEFAULT_ENGINE_CONFIG);
    pipeline = makePipeline();
  });

  describe("initStages", () => {
    it("creates pending instances for all pipeline stages", () => {
      const stages = executor.initStages(pipeline);
      expect(stages.size).toBe(3);
      expect(stages.get("brief")!.status).toBe("pending");
      expect(stages.get("script")!.status).toBe("pending");
      expect(stages.get("render")!.status).toBe("pending");
    });
  });

  describe("getReady", () => {
    it("returns stages with no dependencies as ready", () => {
      const stages = executor.initStages(pipeline);
      const ready = executor.getReady(stages, pipeline);
      expect(ready).toEqual(["brief"]);
    });

    it("returns nothing when dependencies not met", () => {
      const stages = executor.initStages(pipeline);
      // Set brief to running, script should not be ready
      stages.get("brief")!.status = "running";
      const ready = executor.getReady(stages, pipeline);
      expect(ready).toEqual([]);
    });

    it("returns downstream stages when dependencies complete", () => {
      const stages = executor.initStages(pipeline);
      stages.get("brief")!.status = "completed";
      const ready = executor.getReady(stages, pipeline);
      expect(ready).toEqual(["script"]);
    });
  });

  describe("getStatus", () => {
    it("detects complete execution", () => {
      const stages = executor.initStages(pipeline);
      for (const [, inst] of stages) {
        inst.status = "completed";
      }
      const status = executor.getStatus(stages, pipeline);
      expect(status.complete).toBe(true);
      expect(status.failed).toBe(false);
    });

    it("detects dead stages that cannot retry", () => {
      const stages = executor.initStages(pipeline);
      stages.get("brief")!.status = "failed";
      stages.get("brief")!.attempts = [
        { number: 1, leaseId: "l1", startedAt: "" },
        { number: 2, leaseId: "l2", startedAt: "" },
        { number: 3, leaseId: "l3", startedAt: "" },
      ];
      const status = executor.getStatus(stages, pipeline);
      expect(status.deadStages).toContain("brief");
      expect(status.failed).toBe(true);
    });
  });

  describe("start / complete / fail lifecycle", () => {
    it("records stage events to journal", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "/workspace/ep-01/.keep": "" });
      const journal = new Journal(fs);
      const path = "/workspace/ep-01/ep-01.journal.jsonl";
      await journal.init(path);
      const lock = new FakeLock();
      const sm = new StageStateMachine(lock, DEFAULT_ENGINE_CONFIG);
      const exec = new StageExecutor(sm, journal, DEFAULT_ENGINE_CONFIG);

      const stages = exec.initStages(pipeline);
      const brief = stages.get("brief")!;

      // Start → complete
      const instance = await exec.startStage(brief, path);
      await exec.completeStage(instance, ["brief.md"], path);

      // Read journal
      const reader = new JournalReader(fs);
      const events = (await reader.readAll(path)).value!;

      expect(events.length).toBe(2);
      expect(events[0]!.type).toBe("stage.started");
      expect((events[0] as StageStartedEvent).payload.stageId).toBe("brief");
      expect(events[1]!.type).toBe("stage.completed");
      expect((events[1] as StageCompletedEvent).payload.artifactRefs).toEqual(["brief.md"]);
    });

    it("records failure events", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "/workspace/ep-01/.keep": "" });
      const journal = new Journal(fs);
      const path = "/workspace/ep-01/ep-01.journal.jsonl";
      await journal.init(path);
      const lock = new FakeLock();
      const sm = new StageStateMachine(lock, DEFAULT_ENGINE_CONFIG);
      const exec = new StageExecutor(sm, journal, DEFAULT_ENGINE_CONFIG);

      const stages = exec.initStages(pipeline);
      const script = stages.get("script")!;

      const instance = await exec.startStage(script, path);
      await exec.failStage(instance, "API timeout", path);

      const reader = new JournalReader(fs);
      const events = (await reader.readAll(path)).value!;

      expect(events[0]!.type).toBe("stage.started");
      expect(events[1]!.type).toBe("stage.failed");
      expect((events[1] as StageFailedEvent).payload.error).toBe("API timeout");
      expect((events[1] as StageFailedEvent).payload.retryable).toBe(true);
    });
  });
});
