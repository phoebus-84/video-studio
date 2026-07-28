// ── Production Routes ───────────────────────────────────────────────────────
//
// Orchestration endpoints that map Pi agent tools to the pipeline runtime.
// All POST/DELETE operations require authentication.
// GET operations are read-only projections.

import type { FastifyInstance } from "fastify";
import type { RuntimeClient, EpisodeRef } from "../runtime/client.js";
import type { WorkspaceService } from "../workspace/service.js";
import { runAutopilot } from "../runtime/executor.js";
import { ErrorCode, GatewayError } from "../errors/index.js";

interface EpisodeParams {
  channel: string;
  series: string;
  episode: string;
}

function parseEpisode(params: Record<string, string>): EpisodeRef {
  return {
    channel: params.channel!,
    series: params.series!,
    episode: params.episode!,
  };
}

export function registerProductionRoutes(
  app: FastifyInstance,
  runtime: RuntimeClient,
  workspace: WorkspaceService,
): void {
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
    const result = await runtime.resolve(ref);
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
    const result = await runtime.run(ref, stageId, dryRun);
    return { ok: result.ok, data: result.data, error: result.error };
  });

  // ── Execute full pipeline ─────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/execute", {
    schema: {
      description: "Execute all pending pipeline stages in topological order using autopilot.",
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
  }, async (request, reply) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { pipeline, dryRun } = request.body as { pipeline?: string; dryRun?: boolean };

    if (dryRun) {
      const result = await runtime.run(ref, undefined, true);
      return { ok: result.ok, data: result.data, dryRun: true };
    }

    const libraryRoot = process.env.AVG_LIBRARY_ROOT ?? "./library";
    const report = await runAutopilot(
      runtime,
      ref,
      pipeline ?? "fairy-tale-adaptation",
      libraryRoot,
      (msg) => request.log.info(msg),
    );

    return {
      ok: report.stages.filter((s) => s.status === "failed").length === 0,
      report,
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
    const result = await runtime.status(ref);
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

  // ── Budget ────────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/budget", {
    schema: {
      description: "Get budget status.",
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
    return {
      currency: "USD",
      limitMicros: 5_000_000,  // $5.00 default
      consumedMicros: 0,
      remainingMicros: 5_000_000,
    };
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
