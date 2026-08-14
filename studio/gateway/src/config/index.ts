import { readFileSync, existsSync } from "node:fs";
import { configSchema, resolveBindAddress, type Config } from "./schema.js";
import { DEFAULTS } from "./defaults.js";

/**
 * Load configuration from an optional JSON file and merge with secure defaults.
 *
 * Resolution order (later wins):
 *  1. Hard-coded DEFAULTS (loopback-only, token-authenticated)
 *  2. JSON config file at `filePath` if present
 *  3. Environment variables (not yet wired)
 *
 * @throws {ConfigError} If the resolved config is invalid or
 *         the bind address is non-loopback without explicit secure config.
 */
export function loadConfig(filePath?: string): Config {
  let fileConfig: Partial<Config> = {};

  if (filePath && existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      fileConfig = JSON.parse(raw) as Partial<Config>;
    } catch (err) {
      throw new ConfigError(
        `Failed to parse config file "${filePath}": ${(err as Error).message}`,
      );
    }
  }

  // Merge: defaults → file config
  const merged: Config = { ...DEFAULTS, ...fileConfig } as Config;

  // Validate with zod
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  const cfg = parsed.data;

  // Bind address security check
  const resolved = resolveBindAddress(cfg.host, cfg.allowNonLoopback, cfg.tls);
  if (resolved.error) {
    throw new ConfigError(resolved.error);
  }

  return { ...cfg, host: resolved.host };
}

/** Structured configuration error. */
export class ConfigError extends Error {
  public readonly code = "CONFIG_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type { Config };
export { configSchema, resolveBindAddress };
