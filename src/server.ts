import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import type { Config } from "./config/schema.js";
import { registerRoutes } from "./routes/index.js";
import { registerWebSocket, registerSSE } from "./ws/index.js";
import { registerOpenApiRoute } from "./contract/index.js";
import { registerErrorHandler } from "./errors/middleware.js";
import { configureLogging, getRedactPaths } from "./logging/index.js";
import { createAuthMiddleware } from "./auth/middleware.js";

export interface GatewayInstance {
  app: ReturnType<typeof Fastify>;
  config: Config;
  token: string;
  /** Start listening. Returns the assigned address. */
  start: () => Promise<string>;
  /** Gracefully shut down the server. */
  stop: () => Promise<void>;
}

/**
 * Create a configured gateway instance.
 *
 * The server is assembled but NOT started. Call `start()` to bind.
 *
 * @param config Validated gateway configuration.
 * @param token The canonical bearer token (from resolveToken).
 */
export async function createGateway(
  config: Config,
  token: string,
): Promise<GatewayInstance> {
  const app = Fastify({
    logger: {
      level: config.logging.level,
      ...(config.logging.redactSecrets ? { redact: getRedactPaths() } : {}),
      transport: config.logging.pretty
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    },
    // Trust only loopback proxies by default
    trustProxy: config.host === "127.0.0.1" || config.host === "::1" || config.host === "localhost",
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
    credentials: false,
  });

  // ── Logging ──────────────────────────────────────────────────────────────
  configureLogging(app, config.logging);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authMiddleware = createAuthMiddleware(token);

  const PUBLIC_PATHS = new Set(["/health", "/openapi.json"]);

  // Global preHandler: all routes require auth except public paths.
  // This is more reliable than onRoute which has ordering issues with plugins.
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0]!;
    if (PUBLIC_PATHS.has(url)) {
      return; // public endpoint
    }
    await authMiddleware(request, reply);
  });

  // ── Global error handler ─────────────────────────────────────────────────
  registerErrorHandler(app);

  // ── Routes ───────────────────────────────────────────────────────────────
  registerRoutes(app, config);
  registerWebSocket(app, token);
  registerSSE(app);
  registerOpenApiRoute(app);

  // ── Ready ────────────────────────────────────────────────────────────────
  await app.ready();

  return {
    app,
    config,
    token,
    start: async () => {
      const addr = await app.listen({
        host: config.host,
        port: config.port,
      });
      return addr;
    },
    stop: async () => {
      await app.close();
    },
  };
}
