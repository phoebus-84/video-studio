import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import type { Config } from "./config/schema.js";
import { registerRoutes } from "./routes/index.js";
import { EventStreamManager } from "./events/bus.js";
import { PiProcessManager } from "./rpc/process-manager.js";
import { WorkspaceWatcher } from "./events/watcher.js";
import { registerEditorRoutes, registerChannelFileRoutes, registerSeriesFileRoutes } from "./routes/editor.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { registerWorkspaceFileRoutes } from "./routes/workspace-files.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerBudgetRoutes } from "./routes/budget.js";
import * as path from "node:path";
import { registerOpenApiRoute } from "./contract/index.js";
import { registerErrorHandler } from "./errors/middleware.js";
import { configureLogging, getRedactPaths } from "./logging/index.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { resolveOperatorKey } from "./auth/token.js";
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
  //
  // Written as two bindings from one expression rather than two expressions:
  // everything downstream — the watcher, the static mount, the execution
  // service, both route registrars AND the workspace service that lists what
  // the studio shows — has to name the same tree, and the way they stop
  // naming the same tree is by each re-deriving it.
  const configuredLibrary = process.env.AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library";
  const libraryRoot = path.resolve(configuredLibrary);

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
  // Every request defaults to "agent" (avg-qr4.3): a route registered on a
  // bare Fastify instance without this server's global hook — as several
  // gateway tests do, calling `registerProductionRoutes` directly — still
  // gets a decided value instead of `undefined`, and "no credential" must
  // never read as "operator". Declared before the hook runs, so it is in
  // place for every request the hook itself does not reach.
  app.decorateRequest("principal", "agent");

  // The operator's credential, resolved here like the token rather than
  // accepted as a parameter: nothing legitimate assembles a gateway without
  // also generating this file, and a parameter would let a caller omit it
  // and get a gateway that can never sign a human decision.
  const operatorKey = resolveOperatorKey(config.operatorKey.file);
  const authMiddleware = createAuthMiddleware(token, operatorKey, config.token.allowDevToken);

  const PUBLIC_PATHS = new Set(["/health", "/openapi.json", "/ws"]);
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
  events.register(app, [token, operatorKey]);

  // ── Workspace watcher ────────────────────────────────────────────────────
  const watcher = new WorkspaceWatcher(events.bus, {
    root: libraryRoot,
  });
  // Start watcher lazily on server start, stop on shutdown

  // ── Event publisher (poll-based stage transitions) ─────────────────────
  const { EventPublisher } = await import("./events/publisher.js");
  const publisher = new EventPublisher({ bus: events.bus, libraryRoot, operatorKey });

  // ── Pi RPC health ─────────────────────────────────────────────────────
  const { PiRpcHealth } = await import("./rpc/health.js");
  const piHealth = new PiRpcHealth();

  // Owns Pi processes for the lifetime of the gateway: one manager, sessions
  // per episode, idle ones evicted. The start route used to build a throwaway
  // manager per request and never spawn anything.
  const piManager = new PiProcessManager({
    libraryRoot,
    bus: events.bus,
  });
  piManager.start();

  // ── Adapter bridge health ──────────────────────────────────────────────
  const { AdapterBridge } = await import("./rpc/adapter-bridge.js");
  const adapterBridge = new AdapterBridge();

  // ── Routes ───────────────────────────────────────────────────────────────
  // Pick workspace service: the real filesystem when this gateway was pointed
  // at a library, otherwise the fixture.
  //
  // It reads `libraryRoot` — the same resolved tree the execution service,
  // the watcher and the static mount use. It used to be built from the raw
  // `config.libraryRoots`, which meant that with AVG_LIBRARY_ROOT set the
  // thing that LISTS episodes for the studio and the thing that EXECUTES them
  // read different trees: the studio would show one library's episodes while
  // a claim leased and journaled into another. See the comment on
  // `registerRoutes`' `libraryRoot` parameter — this class of failure has
  // already cost this project an episode.
  const ws: WorkspaceService = workspace ?? (
    configuredLibrary !== "."
      ? new FileSystemWorkspaceService([libraryRoot])
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
  publisher.start(watcher);

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

  registerRoutes(app, config, libraryRoot, operatorKey, ws, runtime, piHealth, adapterBridge, piManager);
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

  // Budget read from disk, replacing a handler that returned a fixed $5.
  registerBudgetRoutes(app, libraryRoot);
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
      // Shut down Pi sessions before the gateway goes away, or they outlive it
      // holding episode leases with nothing left to talk to.
      await piManager.stop();
      await watcher.stop();
      await app.close();
    },
  };
}
