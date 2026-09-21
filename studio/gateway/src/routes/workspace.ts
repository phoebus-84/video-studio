import type { FastifyInstance } from "fastify";
import type { WorkspaceService } from "../workspace/service";
import { makeExecutionService, DEFAULT_PIPELINE } from "../runtime/service.js";
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
    const { channel, series, episode: epSlug } = request.params as {
      channel: string;
      series: string;
      episode: string;
    };
    try {
      const epData = await workspace.getEpisode(channel, series, epSlug);

      // ── Enrich with pipeline status from the execution service ────────
      //
      // The same `service.status()` the /status route reports, so the
      // episode list and the production panel cannot describe one episode
      // two ways. It used to shell out to `vpr status` and read `s.id` off
      // each stage; the service reports `stageId`, so every stage in this
      // projection had been arriving with `id: undefined` since the status
      // shape changed underneath it — and nothing here had a test.
      //
      // The key stays `id`: that is what this route has always published and
      // what studio/web/src/lib/episode-store.svelte.ts reads.
      try {
        const pipelineName = ((epData as any).pipeline as string | undefined) || DEFAULT_PIPELINE;
        const service = makeExecutionService((message) => request.log.info(message));
        const status = await service.status({ channel, series, episode: epSlug }, pipelineName);
        if (status.ok) {
          (epData as any).pipeline = status.value.pipeline ?? (epData as any).pipeline;
          (epData as any).stages = status.value.stages.map((s) => ({
            id: s.stageId,
            name: s.name || s.stageId,
            status: s.state,
            dependsOn: s.dependsOn,
            produces: s.produces,
          }));
        }
      } catch {
        // The pipeline could not be resolved or the journal could not be
        // read — fall back to the static data the workspace holds, which is
        // what this route did when the runtime was unreachable.
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

  // ── Narrations: list/regenerate per-scene audio ────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/narrations", {
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
    const { channel, series, episode } = request.params as any;
    try {
      const epData = await workspace.getEpisode(channel, series, episode);
      if (!epData) {
        reply.status(404).send({ error: "NOT_FOUND", message: "Episode not found" });
        return;
      }
      // Return narrations from enriched scenes
      const narrations = ((epData as any).scenes ?? [])
        .filter((s: any) => s.narration)
        .map((s: any) => ({
          sceneId: s.id,
          title: s.title,
          ...s.narration,
        }));
      return reply.send({ narrations, count: narrations.length });
    } catch (err: any) {
      reply.status(500).send({ error: "UNEXPECTED", message: err.message });
    }
  });
}
