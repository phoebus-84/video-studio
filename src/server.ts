import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import type { Config } from "./config/schema.js";
import { registerRoutes } from "./routes/index.js";
import { EventStreamManager } from "./events/bus.js";
import { WorkspaceWatcher } from "./events/watcher.js";
import { registerEditorRoutes } from "./routes/editor.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import { registerOpenApiRoute } from "./contract/index.js";
import { registerErrorHandler } from "./errors/middleware.js";
import { configureLogging, getRedactPaths } from "./logging/index.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import type { WorkspaceService } from "./workspace/service.js";
import { FixtureWorkspaceService } from "./workspace/fixture-service.js";
import { FileSystemWorkspaceService } from "./workspace/filesystem-service.js";

export interface GatewayInstance {
  app: ReturnType<typeof Fastify>;
  config: Config;
  token: string;
  /** Unified event bus for publishing events. */
  events: EventStreamManager;
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
  workspace?: WorkspaceService,
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
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : ["http://localhost:5199"],
    credentials: false,
  });

  // ── Logging ──────────────────────────────────────────────────────────────
  configureLogging(app, config.logging);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authMiddleware = createAuthMiddleware(token);

  const PUBLIC_PATHS = new Set(["/health", "/openapi.json"]);
  const PUBLIC_PREFIXES = ["/library/"];

  // Global preHandler: all routes require auth except public paths.
  // This is more reliable than onRoute which has ordering issues with plugins.
  app.addHook("preHandler", async (request, reply) => {
    /* CORS preflight: no auth header sent by browser. */
    if (request.method === "OPTIONS") return;

    const url = request.url.split("?")[0]!;
    if (PUBLIC_PATHS.has(url) || PUBLIC_PREFIXES.some((p) => url.startsWith(p))) {
      return; // public endpoint
    }
    await authMiddleware(request, reply);
  });

  // ── Global error handler ─────────────────────────────────────────────────
  registerErrorHandler(app);

  // ── Event bus ───────────────────────────────────────────────────────────
  const events = new EventStreamManager();
  events.register(app, token);

  // ── Workspace watcher ────────────────────────────────────────────────────
  const watcher = new WorkspaceWatcher(events.bus, {
    root: process.env.AVG_LIBRARY_ROOT ?? "./library",
  });
  // Start watcher lazily on server start, stop on shutdown

  // ── Routes ───────────────────────────────────────────────────────────────
  // Pick workspace service: real filesystem if roots > 0, otherwise fixture
  const ws = workspace ?? (
    config.libraryRoots.length > 0 && config.libraryRoots[0] !== "."
      ? new FileSystemWorkspaceService(config.libraryRoots)
      : new FixtureWorkspaceService()
  );

  // ── Serve library assets as static files ─────────────────────────────
  const libraryRoot = process.env.AVG_LIBRARY_ROOT ?? "./library";
  await app.register(fastifyStatic, {
    root: path.resolve(libraryRoot),
    prefix: "/library/",
    decorateReply: false,
  });

  registerRoutes(app, config, ws);
  registerEditorRoutes(app, {
    root: process.env.AVG_LIBRARY_ROOT ?? "./library",
    bus: events.bus,
  });
  registerReviewRoutes(app, {
    root: process.env.AVG_LIBRARY_ROOT ?? "./library",
    bus: events.bus,
  });
  registerOpenApiRoute(app);

  // ── Ready ────────────────────────────────────────────────────────────────
  await app.ready();

  return {
    app,
    config,
    token,
    events,
    start: async () => {
      await watcher.start();
      const addr = await app.listen({
        host: config.host,
        port: config.port,
      });
      app.log.info(`File watcher started on ${process.env.AVG_LIBRARY_ROOT ?? "./library"}`);
      return addr;
    },
    stop: async () => {
      await watcher.stop();
      await app.close();
    },
  };
}
