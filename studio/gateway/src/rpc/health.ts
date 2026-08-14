// ---------------------------------------------------------------------------
// Pi RPC health manager
// ---------------------------------------------------------------------------
// Reports health status for the Pi RPC component.
// Wires into PiProcessManager when available.
// ---------------------------------------------------------------------------

import type { PiProcessManager } from "./process-manager.js";
import type { ComponentHealth } from "../health/index.js";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class PiRpcHealth {
  private manager: PiProcessManager | null = null;
  private _connected = false;
  private _error: string | null = null;
  private _agentPackageFound: boolean;

  constructor() {
    // Detect if pi-video-agent package exists
    const pkgPath = resolve(__dirname, "..", "..", "..", "pi-video-agent", "package.json");
    this._agentPackageFound = existsSync(pkgPath);
  }

  /** Wire to a running PiProcessManager. */
  setManager(manager: PiProcessManager): void {
    this.manager = manager;
    this._connected = true;
    this._error = null;
  }

  /** Report health for the gateway /health endpoint. */
  check(): ComponentHealth {
    const now = new Date().toISOString();

    if (this._error) {
      return { status: "down", detail: this._error, lastChecked: now };
    }

    if (this._connected && this.manager) {
      const sessions = this.manager.activeSessions;
      return {
        status: "ready",
        detail: `Pi RPC connected (${sessions} session${sessions !== 1 ? "s" : ""})`,
        lastChecked: now,
      };
    }

    if (this._agentPackageFound) {
      return {
        status: "degraded",
        detail: "Pi agent package found. Start with POST /api/pi/start.",
        lastChecked: now,
      };
    }

    return {
      status: "unknown",
      detail: "Pi RPC not yet wired (vsg-e57.6)",
      lastChecked: now,
    };
  }

  /** Mark as errored. */
  setError(message: string): void {
    this._error = message;
    this._connected = false;
  }
}
