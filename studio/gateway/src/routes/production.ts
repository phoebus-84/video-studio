// ── Production Routes ───────────────────────────────────────────────────────
//
// Orchestration endpoints that map Pi agent tools to the pipeline runtime.
// All POST/DELETE operations require authentication.
// GET operations are read-only projections.

import type { FastifyInstance } from "fastify";
import type { RuntimeClient, EpisodeRef } from "../runtime/client.js";
import type { WorkspaceService } from "../workspace/service.js";
import { ErrorCode, GatewayError } from "../errors/index.js";
import { ExecutionService, type StageOutcome } from "@studio/runtime";
import { GatewayDispatcher } from "../runtime/dispatcher.js";
import { GatewayReviewGate } from "../runtime/review-gate.js";
import { builtinPipelinesPath } from "../runtime/client.js";

/** A single execute call advances at most this many stages before returning. */
const MAX_STAGES_PER_EXECUTE = 20;

/**
 * Why a run ended, when the reason is not visible in the stage list.
 *
 * `truncated` is the one a summary cannot be allowed to omit: if the cap is
 * reached with every stage completing, the loop exits the same way it would
 * after a finished pipeline, and "20 completed, 0 failed, 20 total" reads as
 * a finish. It is not one — more stages may remain.
 *
 * `halted` carries the service's error for a run that could not even select
 * a stage. Without it a pipeline that failed to resolve produced "Nothing to
 * do", which is what a genuinely finished episode produces. That distinction
 * is the one avg-qr4.1's `sawCompletion` bought, and it has to survive here.
 */
interface RunNote {
  truncated?: boolean;
  limit?: number;
  halted?: string;
}

/** The shape the web UI already reads. Kept deliberately unchanged. */
function report(
  ref: { channel: string; series: string; episode: string },
  pipeline: string,
  stages: StageOutcome[],
  startedAt: number,
  note: RunNote = {},
) {
  const totalDurationMs = Date.now() - startedAt;
  const seconds = (totalDurationMs / 1000).toFixed(1);
  const count = (status: StageOutcome["status"]) => stages.filter((s) => s.status === status).length;
  const parts = [`${count("completed")} completed`, `${count("failed")} failed`];
  // A run that halted is not a run that finished.
  if (count("awaiting_review") > 0) parts.push(`${count("awaiting_review")} awaiting review`);
  if (count("blocked") > 0) parts.push(`${count("blocked")} blocked`);
  parts.push(`${stages.length} total`);
  if (note.truncated) {
    parts.push(
      `stopped at this call's limit of ${note.limit ?? MAX_STAGES_PER_EXECUTE} stages — ` +
      `the pipeline may have more`,
    );
  }
  if (note.halted) parts.push(`halted: ${note.halted}`);

  return {
    episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}`,
    pipeline,
    stages: stages.map((s) => ({
      stageId: s.stageId,
      status: s.status,
      outputs: s.outputs,
      durationMs: s.durationMs,
      ...(s.reason ? { error: s.reason } : {}),
    })),
    totalDurationMs,
    summary: stages.length > 0
      ? `${parts.join(", ")} (${seconds}s)`
      : note.halted
        ? `Nothing ran — ${note.halted} (${seconds}s)`
        : `Nothing to do (${seconds}s)`,
  };
}

function parseEpisode(params: Record<string, string>): EpisodeRef {
  return {
    channel: params.channel!,
    series: params.series!,
    episode: params.episode!,
  };
}

async function inheritedPipeline(workspace: WorkspaceService, ref: EpisodeRef, explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  const episode = await workspace.getEpisode(ref.channel, ref.series, ref.episode);
  const pipeline = episode?.pipeline;
  return typeof pipeline === "string" && pipeline.length > 0 ? pipeline : undefined;
}

export function registerProductionRoutes(
  app: FastifyInstance,
  runtime: RuntimeClient,
  workspace: WorkspaceService,
  /**
   * How much work one /execute call may do. Configurable because it is a
   * deployment choice, and because the truncation branch below is otherwise
   * only reachable by a pipeline with more than twenty runnable stages.
   */
  options: { maxStagesPerExecute?: number } = {},
): void {
  const maxStagesPerExecute = options.maxStagesPerExecute ?? MAX_STAGES_PER_EXECUTE;
  // ── Snapshot ──────────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/snapshot", {
    schema: {
      description: "Create an immutable pipeline snapshot for an episode.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          label: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const pipeline = await inheritedPipeline(workspace, ref);
    const result = await runtime.resolve(ref, pipeline);
    if (!result.ok) {
      throw new GatewayError({
        code: ErrorCode.RUNTIME_UNREACHABLE,
        message: result.error ?? "Snapshot creation failed",
      });
    }
    return { ok: true, snapshot: result.data, message: "Snapshot created" };
  });

  // ── Execute stage ─────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/execute", {
    schema: {
      description: "Execute a single pipeline stage.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const { dryRun } = request.body as { dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref);
    const result = await runtime.run(ref, stageId, dryRun, pipeline);
    return { ok: result.ok, data: result.data, error: result.error };
  });

  // ── Execute full pipeline ─────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/execute", {
    schema: {
      description: "Execute pending pipeline stages in dependency order, stopping at the first stage that is blocked, fails, or is awaiting review.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          pipeline: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request, _reply) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { pipeline: requestedPipeline, dryRun } = request.body as { pipeline?: string; dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref, requestedPipeline) ?? "narrated-illustrated-video";

    const libraryRoot = process.env.AVG_LIBRARY_ROOT ?? "./library";
    const service = new ExecutionService({
      libraryRoot,
      // `|| undefined` rather than the bare call: builtinPipelinesPath()
      // returns "" when package resolution fails, and createDefaultLoader's
      // `??` does not fall back on an empty string — so AVG_BUILTIN_PIPELINES,
      // the operator's escape hatch, would be dead exactly when it is needed.
      // Without this the loader searches only the library root, and every
      // built-in pipeline resolves to nothing: the same reasoning the deleted
      // loadGates carried.
      builtinPipelines: builtinPipelinesPath() || undefined,
      dispatcher: new GatewayDispatcher(),
      review: new GatewayReviewGate(),
      budget: { maySpend: async () => ({ ok: true as const, value: { reserveId: "gateway", estimatedCost: 0 } }) },
      holder: `gateway/pid-${process.pid}`,
      log: (message) => request.log.info(message),
    });

    if (dryRun) {
      const outcome = await service.run(ref, pipeline, { dryRun: true });
      return outcome.ok
        ? { ok: true, dryRun: true, outcome: outcome.value }
        : { ok: false, dryRun: true, error: outcome.error };
    }

    // The loop the gateway used to own is now just a caller's choice: keep
    // going while stages complete, stop at the first one that does not.
    const startedAt = Date.now();
    const stages: StageOutcome[] = [];
    // Tracked, not inferred: a loop that exits by exhausting the cap looks
    // exactly like one that exits because the pipeline is done — same stage
    // count, same statuses — and the summary must not report the first as the
    // second. `i` is read after the loop for that reason alone.
    let i = 0;
    for (; i < maxStagesPerExecute; i++) {
      const outcome = await service.run(ref, pipeline);
      if (!outcome.ok) {
        return {
          ok: false,
          error: outcome.error,
          report: report(ref, pipeline, stages, startedAt, { halted: outcome.error.message }),
        };
      }
      if (outcome.value.status === "idle") break;
      stages.push(outcome.value);
      if (outcome.value.status !== "completed") break;
    }
    const truncated = i === maxStagesPerExecute;

    return {
      ok: stages.every((s) => s.status !== "failed"),
      report: report(ref, pipeline, stages, startedAt, { truncated, limit: maxStagesPerExecute }),
    };
  });

  // ── Status ────────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/status", {
    schema: {
      description: "Show pipeline status, stages, and projections.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const pipeline = await inheritedPipeline(workspace, ref);
    const result = await runtime.status(ref, pipeline);
    return { ok: result.ok, data: result.data, error: result.error };
  });

  // ── Staleness ─────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/staleness", {
    schema: {
      description: "Check which artifacts are stale.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
    },
  }, async () => {
    // Staleness is derived from the status projection
    // For MVP, return a basic structure
    return {
      stale: [] as string[],
      affected: [] as string[],
      staleCount: 0,
      affectedCount: 0,
    };
  });

  // ── Rerun plan ────────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/rerun-plan", {
    schema: {
      description: "Plan a targeted rerun with cost estimates.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["retry-current", "rerun-selected", "rerun-affected", "full-rebuild"] },
          stageIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { mode } = request.body as { mode?: string };
    const result = await runtime.rerun(ref, mode);
    return { ok: result.ok, plan: result.data, error: result.error };
  });

  // ── Approve stage ─────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/approve", {
    schema: {
      description: "Approve a manual gate for a stage.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          justification: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const result = await runtime.approve(ref, stageId);
    return { ok: result.ok, data: result.data, error: result.error };
  });

  // ── Journal ───────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/journal", {
    schema: {
      description: "Read the episode event journal.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          type: { type: "string" },
          limit: { type: "number", default: 50 },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    // Read from workspace events
    try {
      const events = await workspace.findEvents(ref, request.query as Record<string, unknown>);
      return { events, episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}` };
    } catch {
      return { events: [], episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}` };
    }
  });

  // ── Init workspace ────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/init", {
    schema: {
      description: "Initialize a new episode workspace.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          pipeline: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { pipeline } = request.body as { pipeline?: string };
    const result = await runtime.init(ref, pipeline);
    return { ok: result.ok, data: result.data, error: result.error };
  });
}
