// ---------------------------------------------------------------------------
// Stage executor — processes stages in topological order
// ---------------------------------------------------------------------------

import type { Journal } from "../journal/writer.js";
import type { StageInstance, EngineConfig } from "./types.js";
import { StageStateMachine } from "./state-machine.js";
import type { ResolvedPipeline } from "../pipeline/types.js";

/** Callback for executing an individual stage. */
export type StageHandler = (
  stageId: string,
  attemptNumber: number,
) => Promise<{ ok: boolean; error?: string; retryable?: boolean }>;

/** Status of the overall pipeline execution. */
export interface ExecutionStatus {
  /** All stage instances indexed by stage ID. */
  stages: Map<string, StageInstance>;
  /** Whether the overall execution is complete (all stages terminal). */
  complete: boolean;
  /** Whether any stage has failed (and cannot be retried). */
  failed: boolean;
  /** List of stages currently ready to execute. */
  ready: string[];
  /** List of stage IDs that are permanently failed. */
  deadStages: string[];
}

/**
 * Pipeline executor.
 *
 * Takes a resolved pipeline and drives stages through their state machine
 * using topological dependency ordering.
 */
export class StageExecutor {
  private sm: StageStateMachine;
  private journal: Journal;

  constructor(
    sm: StageStateMachine,
    journal: Journal,
    _config: EngineConfig,
  ) {
    this.sm = sm;
    this.journal = journal;
  }

  /**
   * Initialize stage instances from a resolved pipeline.
   * All stages start in "pending" state.
   */
  initStages(pipeline: ResolvedPipeline): Map<string, StageInstance> {
    const stages = new Map<string, StageInstance>();
    const now = new Date().toISOString();

    for (const stage of pipeline.stages) {
      stages.set(stage.definition.id, {
        stageId: stage.definition.id,
        name: stage.definition.name,
        status: "pending",
        attempts: [],
        outputArtifacts: [],
        createdAt: now,
      });
    }

    return stages;
  }

  /**
   * Determine which stages are ready to execute.
   * A stage is ready if it's pending and all its dependencies are completed.
   */
  getReady(
    stages: Map<string, StageInstance>,
    pipeline: ResolvedPipeline,
  ): string[] {
    const ready: string[] = [];
    const stageMap = new Map(pipeline.stages.map((s) => [s.definition.id, s]));

    for (const [id, instance] of stages) {
      if (instance.status !== "pending") continue;

      const def = stageMap.get(id);
      if (!def) continue;

      const allDepsSatisfied = def.definition.dependsOn.every((depId) => {
        const depInstance = stages.get(depId);
        return depInstance && depInstance.status === "completed";
      });

      if (allDepsSatisfied) {
        ready.push(id);
      }
    }

    return ready;
  }

  /**
   * Check overall execution status.
   */
  getStatus(
    stages: Map<string, StageInstance>,
    pipeline: ResolvedPipeline,
  ): ExecutionStatus {
    const allIds = pipeline.stages.map((s) => s.definition.id);
    const terminal = allIds.every((id) => {
      const s = stages.get(id);
      return s && (s.status === "completed" || s.status === "failed");
    });
    const deadStages: string[] = [];
    let hasDeadFailure = false;

    for (const [id, instance] of stages) {
      if (instance.status === "failed" && !this.sm.canRetry(instance)) {
        deadStages.push(id);
        hasDeadFailure = true;
      }
    }

    return {
      stages,
      complete: terminal,
      failed: hasDeadFailure,
      ready: this.getReady(stages, pipeline),
      deadStages,
    };
  }

  /**
   * Start a single stage: pending → running.
   * Records a stage.started event to the journal.
   */
  async startStage(
    instance: StageInstance,
    journalPath: string,
  ): Promise<StageInstance> {
    const result = await this.sm.transition(instance, "running");

    await this.journal.append(journalPath, {
      type: "stage.started",
      episodeSlug: result.transition.stageId.split("/")[0] ?? "",
      payload: {
        stageId: instance.stageId,
        attemptNumber: result.transition.attemptNumber,
        leaseId: result.transition.leaseId!,
      },
    });

    return result.instance;
  }

  /**
   * Complete a stage: running → completed.
   * Records a stage.completed event.
   */
  async completeStage(
    instance: StageInstance,
    artifactRefs: string[],
    journalPath: string,
  ): Promise<StageInstance> {
    instance.outputArtifacts = artifactRefs;
    const result = await this.sm.complete(instance);

    await this.journal.append(journalPath, {
      type: "stage.completed",
      episodeSlug: instance.stageId.split("/")[0] ?? "",
      payload: {
        stageId: instance.stageId,
        attemptNumber: result.transition.attemptNumber,
        leaseId: result.transition.leaseId!,
        artifactRefs,
      },
    });

    return result.instance;
  }

  /**
   * Fail a stage: running → failed.
   * Records a stage.failed event.
   */
  async failStage(
    instance: StageInstance,
    error: string,
    journalPath: string,
  ): Promise<StageInstance> {
    const retryable = this.sm.canRetry(instance);
    const result = await this.sm.fail(instance, error, retryable);

    await this.journal.append(journalPath, {
      type: "stage.failed",
      episodeSlug: instance.stageId.split("/")[0] ?? "",
      payload: {
        stageId: instance.stageId,
        attemptNumber: result.transition.attemptNumber,
        leaseId: result.transition.leaseId!,
        error,
        retryable,
      },
    });

    return result.instance;
  }

  /**
   * Retry a failed stage: failed → pending.
   * The stage will be picked up by getReady on the next cycle.
   */
  async retryStage(instance: StageInstance): Promise<StageInstance> {
    if (!this.sm.canRetry(instance)) {
      // Force transition back to pending by resetting status
      // (retry is the only case where we go against the FSM for retryable failures)
      instance.status = "pending";
      return instance;
    }

    instance.status = "pending";
    return instance;
  }
}
