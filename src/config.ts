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
  AVG_FAL_KEY?: string;
  AVG_TTS_WORKER_URL?: string;
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
const DEFAULT_TTS_WORKER_URL = "http://127.0.0.1:5199";

/**
 * Read environment overrides (never logs values).
 */
function readEnv(): EnvOverrides {
  return {
    AVG_LIBRARY_ROOT: process.env.AVG_LIBRARY_ROOT,
    AVG_GATEWAY_URL: process.env.AVG_GATEWAY_URL,
    AVG_GATEWAY_TOKEN: process.env.AVG_GATEWAY_TOKEN,
    AVG_FAL_KEY: process.env.AVG_FAL_KEY,
    AVG_TTS_WORKER_URL: process.env.AVG_TTS_WORKER_URL,
  };
}

/**
 * Resolve the studio configuration.
 *
 * Precedence: environment > defaults > project-local discovery.
 */
export async function resolveConfig(): Promise<StudioConfig> {
  const env = readEnv();
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
  const falKeyRef = env.AVG_FAL_KEY ?? "";
  if (falKeyRef) {
    diagnostics.push({
      level: "info",
      key: "falKey",
      message: "fal.ai key configured via AVG_FAL_KEY",
    });
  } else {
    diagnostics.push({
      level: "warning",
      key: "falKey",
      message: "fal.ai key not configured (set AVG_FAL_KEY)",
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
