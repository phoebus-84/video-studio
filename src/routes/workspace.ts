import type { FastifyInstance } from "fastify";
import type { WorkspaceService } from "../workspace/service";
import type { RuntimeClient } from "../runtime/client.js";
import {
  channelNotFound,
  WorkspaceError,
} from "../workspace/service";

/**
 * Register workspace discovery routes.
 */
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  workspace: WorkspaceService,
  runtime?: RuntimeClient,
): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */

  app.get("/api/channels", {
    schema: {} as any,
  }, async () => {
    return workspace.listChannels();
  });

  app.get("/api/channels/:channel/series", {
    schema: {
      params: {
        type: "object",
        required: ["channel"],
        properties: { channel: { type: "string" } },
      },
    } as any,
  }, async (request, reply) => {
    const { channel } = request.params as { channel: string };
    const result = await workspace.listSeries(channel);
    if (result.length === 0) {
      const channels = await workspace.listChannels();
      if (!channels.some((c) => c.slug === channel)) {
        const err = channelNotFound(channel);
        reply.status(err.statusCode).send({
          error: err.code,
          message: err.message,
        });
        return;
      }
    }
    return result;
  });

  app.get("/api/channels/:channel/series/:series/episodes", {
    schema: {
      params: {
        type: "object",
        required: ["channel", "series"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
        },
      },
    } as any,
  }, async (request) => {
    const { channel, series } = request.params as {
      channel: string;
      series: string;
    };
    return workspace.listEpisodes(channel, series);
  });

  app.get("/api/channels/:channel/series/:series/episodes/:episode", {
    schema: {
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
    } as any,
  }, async (request, reply) => {
    const { channel, series, episode: epSlug } = request.params as {
      channel: string;
      series: string;
      episode: string;
    };
    try {
      const epData = await workspace.getEpisode(channel, series, epSlug);

      // ── Enrich with pipeline status from runtime ──────────────────────
      if (runtime) {
        try {
          const pipelineName = (epData as any).pipeline ?? "fairy-tale-adaptation";
          const status = await runtime.status({ channel, series, episode: epSlug }, pipelineName as string);
          if (status.ok && status.data) {
            const data = status.data as Record<string, unknown>;
            (epData as any).pipeline = data.pipeline ?? (epData as any).pipeline;
            (epData as any).stages = (data.stages as Array<Record<string, unknown>>)?.map((s: any) => ({
              id: s.id,
              name: s.name ?? s.id,
              status: s.state ?? "pending",
              dependsOn: s.dependsOn ?? [],
              produces: s.produces ?? [],
            })) ?? (epData as any).stages;
          }
        } catch {
          // Runtime unavailable — use static data from workspace
        }
      }

      return epData;
    } catch (err) {
      if (err instanceof WorkspaceError) {
        reply.status(err.statusCode).send({
          error: err.code,
          message: err.message,
        });
        return;
      }
      throw err;
    }
  });
}
