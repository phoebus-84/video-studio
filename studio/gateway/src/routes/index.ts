import type { FastifyInstance } from "fastify";
import type { Config } from "../config/schema.js";
import type { WorkspaceService } from "../workspace/service.js";
import type { RuntimeClient } from "../runtime/client.js";
import { collectHealth, gatewayHealth } from "../health/index.js";
import { ErrorCode, GatewayError } from "../errors/index.js";
import { canonicalizeRoots } from "../lib/roots.js";
import { registerWorkspaceRoutes } from "./workspace.js";
import { registerProductionRoutes } from "./production.js";
import { registerSeriesEpisodeRoutes } from "./series-episode.js";
import type { PiRpcHealth } from "../rpc/health.js";
import type { AdapterBridge } from "../rpc/adapter-bridge.js";
import type { AgentSessionManager } from "../rpc/agent-sessions.js";

/**
 * Register all REST API routes.
 */
export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  /**
   * The library this gateway serves, already resolved by the server from
   * `AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library"`.
   *
   * Passed rather than re-derived, and required rather than optional: every
   * route that composes an ExecutionService writes the episode journal, and
   * the journal is the only record of what ran. A route that fell back to
   * `AVG_LIBRARY_ROOT ?? "./library"` on its own would, on a gateway
   * configured purely through `libraryRoots` — which is every gateway in this
   * repo, since nothing sets the variable — lease and journal a stage into a
   * `./library` beside the process's cwd while the configured episode
   * directory stayed empty. See the comment on `libraryRoots` below: a full
   * episode has already been produced into a library this gateway does not
   * serve, and that was only a display problem. This would make the journal
   * authoritative about the wrong tree.
   */
  libraryRoot: string,
  /**
   * The operator's credential (avg-qr4.3), resolved once by the server like
   * `libraryRoot` and threaded to every registrar that composes an
   * execution service: `/approve` and `/reject` sign with it, and the
   * status-reading paths carry it for the review gate to verify with.
   */
  operatorKey: string | null,
  workspace: WorkspaceService,
  runtime: RuntimeClient,
  piHealth?: PiRpcHealth,
  adapterBridge?: AdapterBridge,
  /** Owns Pi processes; created once by the server, not per request. */
  piManager?: AgentSessionManager,
): void {
  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/health", {
    schema: {
      description: "Gateway health check. Reports gateway, runtime, Pi, and adapter readiness.",
      tags: ["health"],
      response: {
        200: {
          type: "object",
          properties: {
            overall: { type: "string", enum: ["healthy", "unhealthy"] },
            timestamp: { type: "string" },
            gateway: { $ref: "#/$defs/ComponentHealth" },
            runtime: { $ref: "#/$defs/ComponentHealth" },
            pi: { $ref: "#/$defs/ComponentHealth" },
            adapter: { $ref: "#/$defs/ComponentHealth" },
          },
          $defs: {
            ComponentHealth: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["ready", "degraded", "down", "unknown"] },
                detail: { type: "string" },
                lastChecked: { type: "string" },
              },
            },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    return collectHealth({
      gateway: gatewayHealth,
      runtime: async () => {
        const h = await runtime.health();
        return {
          status: h.reachable ? "ready" as const : "down" as const,
          detail: h.reachable
            ? `vpr ${h.version ?? "unknown"}`
            : (h.error ?? "Runtime not reachable"),
          lastChecked: new Date().toISOString(),
        };
      },
      pi: () => piHealth?.check() ?? { status: "unknown" as const, detail: "Pi RPC not yet wired (vsg-e57.6)", lastChecked: new Date().toISOString() },
      adapter: () => adapterBridge?.check() ?? { status: "unknown" as const, detail: "Adapter bridge not yet wired (vsg-e57.9)", lastChecked: new Date().toISOString() },
    });
  });

  // ── API info ──────────────────────────────────────────────────────────────
  app.get("/", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: {
      description: "Gateway API root. Returns version and available endpoints.",
      tags: ["meta"],
    } as any,
  }, async () => {
    return {
      service: "video-studio-gateway",
      version: "0.1.0",
      docs: "/docs",
      health: "/health",
      openapi: "/openapi.json",
      ws: "/ws",
      // Which libraries this gateway actually serves. The agent resolves its
      // own library root independently -- from AVG_LIBRARY_ROOT, or `./library`
      // relative to wherever Pi was started -- and the two can disagree without
      // either side erroring. A full episode was once produced into a library
      // this gateway does not serve, so the studio showed an empty workspace
      // while the work sat on disk. Publishing the roots lets a client detect
      // that instead of guessing.
      libraryRoots: canonicalizeRoots(config.libraryRoots),
      // Which agent the studio's intents reach (AVG_AGENT_BACKEND).
      agent: piManager ? { backend: piManager.backend, label: piManager.label } : null,
    };
  });

  // ── Workspace discovery ──────────────────────────────────────────────────
  registerWorkspaceRoutes(app, workspace, libraryRoot, operatorKey);

  // ── Production orchestration ─────────────────────────────────────────────
  registerProductionRoutes(app, runtime, workspace, { libraryRoot, operatorKey });
  registerSeriesEpisodeRoutes(app, { libraryRoot, operatorKey });

  // ── Pi agent lifecycle ───────────────────────────────────────────────────
  if (piHealth) {
    app.post("/api/pi/start", {
      schema: {
        description: "Start the Pi agent process and connect via RPC.",
        tags: ["pi"],
      } as any,
    }, async (request, reply) => {
      // This used to construct a manager, call nothing on it, and report "Pi
      // agent process spawned and RPC connected" — while handing it
      // EventBus.prototype instead of the bus. Nothing was ever spawned.
      if (!piManager) {
        return reply.status(503).send({
          error: "PI_UNAVAILABLE",
          message: "No Pi process manager is configured on this gateway.",
        });
      }

      const body = (request.body ?? {}) as { episode?: string };
      if (!body.episode) {
        return reply.status(400).send({
          error: "BAD_REQUEST",
          message: "episode is required, as <channel>/<series>/<episode>: Pi sessions are per episode.",
        });
      }

      try {
        const session = await piManager.session(body.episode);
        piHealth.setManager(piManager);
        return reply.send({
          status: "started",
          episode: body.episode,
          sessionId: session.identity.sessionId,
          pid: session.identity.pid,
          backend: piManager.backend,
        });
      } catch (err: any) {
        piHealth.setError(err.message);
        return reply.status(500).send({ error: "PI_START_FAILED", message: err.message });
      }
    });

    app.post("/api/pi/stop", {
      schema: {
        description: "Stop a Pi agent session, or all of them.",
        tags: ["pi"],
      } as any,
    }, async (request, reply) => {
      const body = (request.body ?? {}) as { episode?: string };

      if (piManager) {
        // Actually stop the process. Reporting "stopped" while it kept running
        // left orphaned agents holding episode leases.
        if (body.episode) await piManager.shutdownSession(body.episode);
        else await piManager.stop();
      }

      piHealth.setError("Pi stopped by operator.");
      return reply.send({ status: "stopped", episode: body.episode ?? "all" });
    });

    app.get("/api/pi/sessions", {
      schema: { description: "List running Pi sessions.", tags: ["pi"] } as any,
    }, async (_request, reply) => {
      return reply.send({ sessions: piManager?.listSessions() ?? [] });
    });
  }

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    const err = new GatewayError({
      code: ErrorCode.NOT_FOUND,
      message: "The requested resource was not found.",
    });
    reply.status(err.statusCode).send(err.toJSON());
  });
}
