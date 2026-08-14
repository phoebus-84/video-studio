import type { FastifyInstance } from "fastify";

/**
 * OpenAPI 3.0 specification for the gateway.
 *
 * Generated from Fastify route schemas at startup.
 * The spec is available at GET /openapi.json and rendered
 * by scalar/swagger at GET /docs.
 */
export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
}

const DEFAULT_INFO: OpenApiInfo = {
  title: "Video Studio Gateway",
  version: "0.1.0",
  description:
    "Trusted local backend connecting browser clients, Pi RPC, and filesystem production state. " +
    "All endpoints require Bearer token authentication. " +
    "Loopback-only by default.",
};

/**
 * Route for serving the raw OpenAPI 3.0 JSON spec.
 */
export function registerOpenApiRoute(
  app: FastifyInstance,
  info: OpenApiInfo = DEFAULT_INFO,
): void {
  app.get("/openapi.json", async () => {
    // Return the base spec. When @fastify/swagger is mounted, use its output.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseSpec = (app as any).swagger
      ? (app as any).swagger()
      : buildBaseSpec(info);
    return baseSpec;
  });
}

/**
 * Build a minimal base OpenAPI spec when @fastify/swagger is not mounted.
 * The full spec is enriched by Fastify route schemas when swagger is enabled.
 */
function buildBaseSpec(info: OpenApiInfo): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    servers: [
      {
        url: "http://127.0.0.1:{port}",
        description: "Loopback gateway",
        variables: {
          port: { default: "auto" },
        },
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Token from .gateway-token file (auto-generated on first start).",
        },
      },
      schemas: {
        HealthReport: {
          type: "object",
          properties: {
            overall: {
              type: "string",
              enum: ["healthy", "unhealthy"],
            },
            timestamp: { type: "string", format: "date-time" },
            gateway: { $ref: "#/components/schemas/ComponentHealth" },
            runtime: { $ref: "#/components/schemas/ComponentHealth" },
            pi: { $ref: "#/components/schemas/ComponentHealth" },
            adapter: { $ref: "#/components/schemas/ComponentHealth" },
          },
        },
        ComponentHealth: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["ready", "degraded", "down", "unknown"],
            },
            detail: { type: "string" },
            lastChecked: { type: "string", format: "date-time" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
            correlationId: { type: "string", format: "uuid" },
            details: { type: "object" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {},
  };
}

/**
 * Write the OpenAPI spec to stdout (for `npm run contract:generate`).
 */
export async function generateContract(): Promise<void> {
  const spec = buildBaseSpec(DEFAULT_INFO);
  process.stdout.write(JSON.stringify(spec, null, 2) + "\n");
}
