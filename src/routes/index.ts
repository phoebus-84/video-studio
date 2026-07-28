import type { FastifyInstance } from "fastify";
import type { Config } from "../config/schema.js";
import type { WorkspaceService } from "../workspace/service.js";
import type { RuntimeClient } from "../runtime/client.js";
import { collectHealth, gatewayHealth } from "../health/index.js";
import { ErrorCode, GatewayError } from "../errors/index.js";
import { registerWorkspaceRoutes } from "./workspace.js";
import { registerRuntimeRoutes } from "./runtime.js";
import { registerProductionRoutes } from "./production.js";

/**
 * Register all REST API routes.
 */
export function registerRoutes(
  app: FastifyInstance,
  _config: Config,
  workspace: WorkspaceService,
  runtime: RuntimeClient,
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
      pi: () => ({ status: "unknown" as const, detail: "Pi RPC not yet wired (vsg-e57.6)", lastChecked: new Date().toISOString() }),
      adapter: () => ({ status: "unknown" as const, detail: "Adapter bridge not yet wired (vsg-e57.9)", lastChecked: new Date().toISOString() }),
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
    };
  });

  // ── Workspace discovery ──────────────────────────────────────────────────
  registerWorkspaceRoutes(app, workspace);

  // ── Runtime endpoints ────────────────────────────────────────────────────
  registerRuntimeRoutes(app, runtime);

  // ── Production orchestration ─────────────────────────────────────────────
  registerProductionRoutes(app, runtime, workspace);

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    const err = new GatewayError({
      code: ErrorCode.NOT_FOUND,
      message: "The requested resource was not found.",
    });
    reply.status(err.statusCode).send(err.toJSON());
  });
}
