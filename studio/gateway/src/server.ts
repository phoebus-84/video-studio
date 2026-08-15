import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import type { Config } from "./config/schema.js";
import { registerRoutes } from "./routes/index.js";
import { EventStreamManager } from "./events/bus.js";
import { WorkspaceWatcher } from "./events/watcher.js";
import { registerEditorRoutes, registerChannelFileRoutes, registerSeriesFileRoutes } from "./routes/editor.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { registerWorkspaceFileRoutes } from "./routes/workspace-files.js";
import { registerAssetRoutes } from "./routes/assets.js";
import * as path from "node:path";
import { registerOpenApiRoute } from "./contract/index.js";
import { registerErrorHandler } from "./errors/middleware.js";
import { configureLogging, getRedactPaths } from "./logging/index.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { createRuntimeClient, type RuntimeClient } from "./runtime/client.js";
import type { WorkspaceService } from "./workspace/service.js";
import { FixtureWorkspaceService } from "./workspace/fixture-service.js";
import { FileSystemWorkspaceService } from "./workspace/filesystem-service.js";

export interface GatewayInstance {
  app: ReturnType<typeof Fastify>;
  config: Config;
  token: string;
  /** Unified event bus for publishing events. */
  events: EventStreamManager;
  /** Pipeline runtime client. */
  runtime: RuntimeClient;
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
  // Resolve the library root once, to an absolute path. A relative default
  // breaks downstream consumers (e.g. the pipeline runtime resolves
  // "<root>/../video-built-in-pipelines" and the watcher).
  const libraryRoot = path.resolve(
    process.env.AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library",
  );

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
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : ["http://localhost:5173", "http://localhost:5199"],
    credentials: false,
  });

  // ── Logging ──────────────────────────────────────────────────────────────
  configureLogging(app, config.logging);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authMiddleware = createAuthMiddleware(token, config.token.allowDevToken);

  const PUBLIC_PATHS = new Set(["/health", "/openapi.json", "/runtime/health", "/ws"]);
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
    root: libraryRoot,
  });
  // Start watcher lazily on server start, stop on shutdown

  // ── Event publisher (poll-based stage transitions) ─────────────────────
  const { EventPublisher } = await import("./events/publisher.js");
  const publisher = new EventPublisher({ bus: events.bus });

  // ── Pi RPC health ─────────────────────────────────────────────────────
  const { PiRpcHealth } = await import("./rpc/health.js");
  const piHealth = new PiRpcHealth();

  // ── Adapter bridge health ──────────────────────────────────────────────
  const { AdapterBridge } = await import("./rpc/adapter-bridge.js");
  const adapterBridge = new AdapterBridge();

  // ── Routes ───────────────────────────────────────────────────────────────
  // Pick workspace service: real filesystem if roots > 0, otherwise fixture
  const ws: WorkspaceService = workspace ?? (
    config.libraryRoots.length > 0 && config.libraryRoots[0] !== "."
      ? new FileSystemWorkspaceService(config.libraryRoots)
      : new FixtureWorkspaceService()
  );

  // ── Pipeline runtime client ──────────────────────────────────────────────
  const runtime: RuntimeClient = createRuntimeClient(
    libraryRoot,
    {
      log: (msg) => app.log.debug(msg),
      defaultTimeoutMs: 120_000,
    },
  );

  // ── Start event publisher ─────────────────────────────────────────────
  publisher.start(runtime, watcher);

  // ── Serve library assets as static files ─────────────────────────────
  // Uploads are capped so a stray request cannot fill the library's disk.
  await app.register(fastifyMultipart, {
    limits: { fileSize: 512 * 1024 * 1024, files: 20 },
  });

  await app.register(fastifyStatic, {
    root: libraryRoot,
    prefix: "/library/",
    decorateReply: false,
    maxAge: 0,  // Disable browser caching — assets regenerate frequently
  });

  registerRoutes(app, config, ws, runtime, piHealth, adapterBridge);
  registerEditorRoutes(app, {
    root: libraryRoot,
    bus: events.bus,
  });
  registerChannelFileRoutes(app, libraryRoot);
  registerSeriesFileRoutes(app, libraryRoot);

  // ── Workspace file API ───────────────────────────────────────────────────
  // One implementation per level: list, create, upload, move, delete. This is
  // what lets the studio show what is actually there instead of probing a
  // hardcoded set of filenames.
  for (const [level, prefix] of [
    ["channel", "/api/channels/:channel"],
    ["series", "/api/channels/:channel/series/:series"],
    ["episode", "/api/channels/:channel/series/:series/episodes/:episode"],
  ] as const) {
    registerWorkspaceFileRoutes(app, { root: libraryRoot, level, prefix });
  }

  // Choosing which attempt fulfils a production role, persisted.
  registerAssetRoutes(app, libraryRoot);
  registerReviewRoutes(app, {
    root: libraryRoot,
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
    runtime,
    start: async () => {
      await watcher.start();
      const addr = await app.listen({
        host: config.host,
        port: config.port,
      });
      app.log.info(`File watcher started on ${libraryRoot}`);
      return addr;
    },
    stop: async () => {
      publisher.stop();
      await watcher.stop();
      await app.close();
    },
  };
}
