// ── Runtime Routes ─────────────────────────────────────────────────────────
//
// Exposes the video-pipeline-runtime CLI as REST endpoints.
// Each endpoint maps to a vpr command with --json output.

import type { FastifyInstance } from "fastify";
import type { RuntimeClient, EpisodeRef } from "../runtime/client.js";

export function registerRuntimeRoutes(app: FastifyInstance, runtime: RuntimeClient): void {
  // ── Runtime health ───────────────────────────────────────────────────────
  app.get("/runtime/health", {
    schema: {
      description: "Check if the pipeline runtime is reachable.",
      tags: ["runtime"],
      response: {
        200: {
          type: "object",
          properties: {
            reachable: { type: "boolean" },
            version: { type: "string" },
            error: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    return runtime.health();
  });

  // ── Init episode ─────────────────────────────────────────────────────────
  app.post("/runtime/init", {
    schema: {
      description: "Initialize a new episode workspace.",
      tags: ["runtime"],
      body: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          pipeline: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const { channel, series, episode, pipeline } = request.body as {
      channel: string; series: string; episode: string; pipeline?: string;
    };
    return runtime.init({ channel, series, episode }, pipeline);
  });

  // ── Resolve pipeline ─────────────────────────────────────────────────────
  app.post("/runtime/resolve", {
    schema: {
      description: "Resolve and snapshot the pipeline for an episode.",
      tags: ["runtime"],
      body: {
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
    const { channel, series, episode } = request.body as EpisodeRef;
    return runtime.resolve({ channel, series, episode });
  });

  // ── Status ───────────────────────────────────────────────────────────────
  app.post("/runtime/status", {
    schema: {
      description: "Show pipeline, stage, artifact, and budget projections.",
      tags: ["runtime"],
      body: {
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
    const { channel, series, episode } = request.body as EpisodeRef;
    return runtime.status({ channel, series, episode });
  });

  // ── Run pipeline ─────────────────────────────────────────────────────────
  app.post("/runtime/run", {
    schema: {
      description: "Execute pipeline stages.",
      tags: ["runtime"],
      body: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request) => {
    const { channel, series, episode, stage, dryRun } = request.body as {
      channel: string; series: string; episode: string; stage?: string; dryRun?: boolean;
    };
    return runtime.run({ channel, series, episode }, stage, dryRun);
  });

  // ── Rerun ────────────────────────────────────────────────────────────────
  app.post("/runtime/rerun", {
    schema: {
      description: "Plan targeted reruns with cost estimates.",
      tags: ["runtime"],
      body: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          mode: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request) => {
    const { channel, series, episode, mode, dryRun } = request.body as {
      channel: string; series: string; episode: string; mode?: string; dryRun?: boolean;
    };
    return runtime.rerun({ channel, series, episode }, mode, dryRun);
  });

  // ── Approve ──────────────────────────────────────────────────────────────
  app.post("/runtime/approve", {
    schema: {
      description: "Approve a manual gate for a stage.",
      tags: ["runtime"],
      body: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request) => {
    const { channel, series, episode, stage, dryRun } = request.body as {
      channel: string; series: string; episode: string; stage: string; dryRun?: boolean;
    };
    return runtime.approve({ channel, series, episode }, stage, dryRun);
  });

  // ── Validate ─────────────────────────────────────────────────────────────
  app.post("/runtime/validate", {
    schema: {
      description: "Validate pipeline DAG or snapshot.",
      tags: ["runtime"],
      body: {
        type: "object",
        required: ["what"],
        properties: {
          what: { type: "string", enum: ["pipeline", "snapshot"] },
          target: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const { what, target } = request.body as { what: "pipeline" | "snapshot"; target?: string };
    return runtime.validate(what, target);
  });
}
