import type { FastifyInstance } from "fastify";
import type { Config } from "../config/schema.js";
import type { WorkspaceService } from "../workspace/service.js";
import { collectHealth, gatewayHealth, unknownHealth } from "../health/index.js";
import { ErrorCode, GatewayError } from "../errors/index.js";
import { registerWorkspaceRoutes } from "./workspace.js";

/**
 * Register all REST API routes.
 */
export function registerRoutes(
  app: FastifyInstance,
  _config: Config,
  workspace: WorkspaceService,
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
      runtime: () => unknownHealth("Runtime connection not yet wired (vsg-e57.7)"),
      pi: () => unknownHealth("Pi RPC not yet wired (vsg-e57.6)"),
      adapter: () => unknownHealth("Adapter bridge not yet wired (vsg-e57.9)"),
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

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    const err = new GatewayError({
      code: ErrorCode.NOT_FOUND,
      message: "The requested resource was not found.",
    });
    reply.status(err.statusCode).send(err.toJSON());
  });
}
