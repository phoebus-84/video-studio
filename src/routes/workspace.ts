import type { FastifyInstance } from "fastify";
import type { WorkspaceService } from "../workspace/service";
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
    const { channel, series, episode } = request.params as {
      channel: string;
      series: string;
      episode: string;
    };
    try {
      return await workspace.getEpisode(channel, series, episode);
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
