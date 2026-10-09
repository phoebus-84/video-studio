// ---------------------------------------------------------------------------
// Studio configuration and service clients
// ---------------------------------------------------------------------------
// Resolves library roots, constructs typed clients for all production
// services, and exposes health/capability diagnostics.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── Configuration types ─────────────────────────────────────────────────────

export interface StudioConfig {
  /** Absolute path to the library root (contains channel directories). */
  libraryRoot: string;
  /** Gateway base URL for browser/agent communication. */
  gatewayUrl: string;
  /** Gateway bearer token. */
  gatewayToken: string;
  /** fal.ai API key (only path/ref stored, never the value). */
  falKeyRef: string;
  /** TTS worker HTTP base URL. */
  ttsWorkerUrl: string;
  /** Graphics renderer module path. */
  graphicsRendererPath: string;
  /** FFmpeg composer module path. */
  ffmpegComposerPath: string;
  /** Whether we resolved successfully. */
  resolved: boolean;
  /** Diagnostics from resolution. */
  diagnostics: ConfigDiagnostic[];
}

export interface ConfigDiagnostic {
  level: "error" | "warning" | "info";
  key: string;
  message: string;
}

/** Partial configuration from environment. */
export interface EnvOverrides {
  AVG_LIBRARY_ROOT?: string;
  AVG_GATEWAY_URL?: string;
  AVG_GATEWAY_TOKEN?: string;
  FAL_KEY?: string;
  AVG_TTS_WORKER_URL?: string;
  /** Freesound's API key for archive media (avg-fe8.7). */
  FREESOUND_API_KEY?: string;
}

// ── Client types ────────────────────────────────────────────────────────────

export interface ServiceClients {
  /** Whether all clients are healthy. */
  healthy: boolean;
  /** Per-service health status. */
  health: Record<string, ServiceHealth>;
}

export interface ServiceHealth {
  available: boolean;
  message: string;
  checkedAt: string;
}

// ── Configuration resolution ────────────────────────────────────────────────

const DEFAULT_LIBRARY_ROOT = path.resolve(process.cwd(), "library");
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:5198";
/**
 * Where the voice worker listens.
 *
 * This said 5199 while the two places that actually synthesize speech said
 * 5197, and mise binds the worker to 5197 precisely so the studio and the
 * worker agree. The health check was therefore probing a port nothing listens
 * on: `pva_health` reported the TTS worker unreachable while synthesis worked
 * perfectly, which reads as a broken worker rather than a wrong number.
 * Exported so the synthesis paths share it instead of repeating it.
 */
export const DEFAULT_TTS_WORKER_URL = "http://127.0.0.1:5197";

/**
 * Read environment overrides (never logs values).
 */
export async function readEnv(): Promise<EnvOverrides> {
  const fromFile: EnvOverrides = {};
  try {
    const raw = await fs.readFile(path.resolve(process.cwd(), ".env"), "utf-8");
    const allowed = new Set<keyof EnvOverrides>([
      "AVG_LIBRARY_ROOT",
      "AVG_GATEWAY_URL",
      "AVG_GATEWAY_TOKEN",
      "FAL_KEY",
      "AVG_TTS_WORKER_URL",
      "FREESOUND_API_KEY",
    ]);
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || !allowed.has(match[1] as keyof EnvOverrides)) continue;
      let value = match[2] ?? "";
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fromFile[match[1] as keyof EnvOverrides] = value;
    }
  } catch {
    // A project-local .env is optional. Environment variables remain primary.
  }

  return {
    AVG_LIBRARY_ROOT: process.env.AVG_LIBRARY_ROOT ?? fromFile.AVG_LIBRARY_ROOT,
    AVG_GATEWAY_URL: process.env.AVG_GATEWAY_URL ?? fromFile.AVG_GATEWAY_URL,
    AVG_GATEWAY_TOKEN: process.env.AVG_GATEWAY_TOKEN ?? fromFile.AVG_GATEWAY_TOKEN,
    FAL_KEY: process.env.FAL_KEY ?? fromFile.FAL_KEY,
    AVG_TTS_WORKER_URL: process.env.AVG_TTS_WORKER_URL ?? fromFile.AVG_TTS_WORKER_URL,
    FREESOUND_API_KEY: process.env.FREESOUND_API_KEY ?? fromFile.FREESOUND_API_KEY,
  };
}

/**
 * Resolve the studio configuration.
 *
 * Precedence: environment > defaults > project-local discovery.
 */
export async function resolveConfig(): Promise<StudioConfig> {
  const env = await readEnv();
  const diagnostics: ConfigDiagnostic[] = [];

  // Library root
  let libraryRoot = env.AVG_LIBRARY_ROOT ?? DEFAULT_LIBRARY_ROOT;
  try {
    await fs.access(libraryRoot);
    diagnostics.push({
      level: "info",
      key: "libraryRoot",
      message: `Library root found at ${libraryRoot}`,
    });
  } catch {
    diagnostics.push({
      level: "warning",
      key: "libraryRoot",
      message: `Library root ${libraryRoot} does not exist`,
    });
  }

  // Gateway token
  const gatewayUrl = env.AVG_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
  let gatewayToken = env.AVG_GATEWAY_TOKEN ?? "";
  if (!gatewayToken) {
    // Try reading from .gateway-token file
    try {
      const tokenFile = path.resolve(process.cwd(), ".gateway-token");
      gatewayToken = (await fs.readFile(tokenFile, "utf-8")).trim();
      diagnostics.push({
        level: "info",
        key: "gatewayToken",
        message: "Gateway token read from .gateway-token",
      });
    } catch {
      diagnostics.push({
        level: "warning",
        key: "gatewayToken",
        message: "No gateway token found (set AVG_GATEWAY_TOKEN or create .gateway-token)",
      });
    }
  }

  // fal key
  const falKeyRef = env.FAL_KEY ?? "";
  if (falKeyRef) {
    diagnostics.push({
      level: "info",
      key: "falKey",
      message: "fal.ai key configured via FAL_KEY",
    });
  } else {
    diagnostics.push({
      level: "warning",
      key: "falKey",
      message: "fal.ai key not configured (set FAL_KEY)",
    });
  }

  // TTS worker
  const ttsWorkerUrl = env.AVG_TTS_WORKER_URL ?? DEFAULT_TTS_WORKER_URL;
  diagnostics.push({
    level: "info",
    key: "ttsWorkerUrl",
    message: `TTS worker URL: ${ttsWorkerUrl}`,
  });

  const config: StudioConfig = {
    libraryRoot,
    gatewayUrl,
    gatewayToken,
    falKeyRef,
    ttsWorkerUrl,
    graphicsRendererPath: "studio-graphics-renderer",
    ffmpegComposerPath: "ffmpeg-video-composer",
    resolved: true,
    diagnostics,
  };

  return config;
}

/**
 * Is the agent's library root one the gateway actually serves?
 *
 * The two resolve their libraries independently — the agent from
 * `AVG_LIBRARY_ROOT` or `./library` relative to wherever Pi was started, the
 * gateway from `libraryRoots` in its config — and nothing has ever compared
 * them. Starting Pi from the wrong directory therefore produced into a library
 * the studio does not serve: a complete episode, images and narration and a
 * finished render, invisible in a workspace that reported itself empty. Neither
 * side errored, because from each side alone nothing was wrong.
 *
 * Paths are compared as already-resolved strings; callers pass real paths.
 */
export function describeLibraryVisibility(
  libraryRoot: string,
  gatewayRoots: string[],
): { visible: boolean; message: string } {
  if (gatewayRoots.length === 0) {
    return { visible: false, message: "Gateway reports no library roots" };
  }
  const contained = gatewayRoots.some(
    (root) => libraryRoot === root || libraryRoot.startsWith(`${root}${path.sep}`),
  );
  if (contained) {
    return { visible: true, message: `Served by the gateway (${libraryRoot})` };
  }
  return {
    visible: false,
    message:
      `Library root ${libraryRoot} is NOT served by the gateway ` +
      `(serving: ${gatewayRoots.join(", ")}). Work produced here will not appear ` +
      `in the studio. Set AVG_LIBRARY_ROOT, or start Pi from the directory whose ` +
      `library the gateway serves.`,
  };
}

/** Resolve a path for comparison, tolerating one that does not exist yet. */
async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Check health of all configured services.
 * No background processes are started — each check is a single probe.
 */
export async function checkServiceHealth(
  config: StudioConfig,
): Promise<ServiceClients> {
  const health: Record<string, ServiceHealth> = {};
  const now = new Date().toISOString();

  // Library root
  try {
    await fs.access(config.libraryRoot);
    health["library"] = { available: true, message: "Accessible", checkedAt: now };
  } catch {
    health["library"] = { available: false, message: "Not accessible", checkedAt: now };
  }

  // Gateway
  try {
    const res = await fetch(`${config.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    health["gateway"] = {
      available: res.ok,
      message: res.ok ? "Healthy" : `Status ${res.status}`,
      checkedAt: now,
    };
  } catch {
    health["gateway"] = { available: false, message: "Unreachable", checkedAt: now };
  }

  // Does the gateway serve the library this agent writes to? Only answerable
  // when the gateway is up; an unreachable gateway is already reported above.
  if (health["gateway"]?.available) {
    try {
      const res = await fetch(`${config.gatewayUrl}/`, {
        headers: config.gatewayToken ? { Authorization: `Bearer ${config.gatewayToken}` } : {},
        signal: AbortSignal.timeout(2000),
      });
      const info = (await res.json()) as { libraryRoots?: unknown };
      const roots = Array.isArray(info.libraryRoots)
        ? info.libraryRoots.filter((r): r is string => typeof r === "string")
        : [];
      const verdict = describeLibraryVisibility(await realpathOrSelf(config.libraryRoot), roots);
      health["library-visibility"] = {
        available: verdict.visible,
        message: verdict.message,
        checkedAt: now,
      };
    } catch {
      health["library-visibility"] = {
        available: false,
        message: "Could not read the gateway's library roots",
        checkedAt: now,
      };
    }
  }

  // TTS worker
  try {
    const res = await fetch(`${config.ttsWorkerUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    health["tts-worker"] = {
      available: res.ok,
      message: res.ok ? "Healthy" : `Status ${res.status}`,
      checkedAt: now,
    };
  } catch {
    health["tts-worker"] = { available: false, message: "Unreachable", checkedAt: now };
  }

  const allHealthy = Object.values(health).every((h) => h.available);

  return {
    healthy: allHealthy,
    health,
  };
}
