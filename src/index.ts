#!/usr/bin/env node
import { loadConfig } from "./config/index.js";
import { resolveToken } from "./auth/index.js";
import { createGateway } from "./server.js";
import { canonicalizeRoots } from "./lib/roots.js";

/**
 * Video Studio Gateway entry point.
 *
 * Usage:
 *   node dist/index.js [config.json]
 *
 * Environment:
 *   VSG_CONFIG_PATH   – path to config JSON (overridden by CLI arg)
 */
async function main(): Promise<void> {
  const configPath =
    process.argv[2] ?? process.env.VSG_CONFIG_PATH ?? undefined;

  // 1. Load & validate configuration
  const config = loadConfig(configPath);
  console.error(
    `[gateway] Config loaded: host=${config.host} port=${config.port} loopback=${!config.allowNonLoopback}`,
  );

  // 2. Validate library roots
  canonicalizeRoots(config.libraryRoots);
  console.error(`[gateway] Library roots: ${config.libraryRoots.join(", ")}`);

  // 3. Resolve auth token
  const token = resolveToken(config.token);
  console.error(`[gateway] Token loaded (length=${token.length})`);

  // 4. Create & start server
  const gateway = await createGateway(config, token);

  const addr = await gateway.start();
  console.error(`[gateway] Listening on ${addr}`);
  console.error(`[gateway] Health: http://${addr}/health`);
  console.error(`[gateway] Docs:  http://${addr}/docs`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`[gateway] Received ${signal}, shutting down...`);
    await gateway.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[gateway] Fatal:", err.message);
  process.exit(1);
});
