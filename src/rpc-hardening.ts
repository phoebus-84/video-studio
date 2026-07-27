// ---------------------------------------------------------------------------
// RPC hardening and gateway event handling
// ---------------------------------------------------------------------------
// Validates RPC messages, handles disconnect/reconnect, and
// processes gateway events for production state changes.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Types ───────────────────────────────────────────────────────────────────

interface RpcHealth {
  connected: boolean;
  pendingRequests: number;
  lastEventAt: string | null;
  uptimeMs: number;
}

// ── RPC Monitor ─────────────────────────────────────────────────────────────

class RpcMonitor {
  private connected = false;
  private lastEventAt: string | null = null;
  private startedAt: number = Date.now();
  private pending = 0;
  private eventCount = 0;
  private errorCount = 0;

  markConnected(): void {
    this.connected = true;
    this.startedAt = Date.now();
  }

  markDisconnected(): void {
    this.connected = false;
  }

  markEvent(): void {
    this.lastEventAt = new Date().toISOString();
    this.eventCount++;
  }

  markError(): void {
    this.errorCount++;
  }

  setPending(n: number): void {
    this.pending = n;
  }

  get health(): RpcHealth {
    return {
      connected: this.connected,
      pendingRequests: this.pending,
      lastEventAt: this.lastEventAt,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  get stats(): Record<string, number> {
    return {
      events: this.eventCount,
      errors: this.errorCount,
      pending: this.pending,
    };
  }
}

// ── Message validation ──────────────────────────────────────────────────────

function validateRpcMessage(msg: unknown): { valid: boolean; reason?: string } {
  if (!msg || typeof msg !== "object") {
    return { valid: false, reason: "Not an object" };
  }

  const obj = msg as Record<string, unknown>;

  // Must have at least one of: id, type, method
  if (!obj.id && !obj.type && !obj.method) {
    return { valid: false, reason: "Missing id, type, or method" };
  }

  // If it has id, it's a request or response
  if (obj.id && typeof obj.id !== "string") {
    return { valid: false, reason: "id must be a string" };
  }

  // If it has method but no id, it's a notification
  if (obj.method && typeof obj.method !== "string") {
    return { valid: false, reason: "method must be a string" };
  }

  return { valid: true };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerRpcHardening(pi: ExtensionAPI): void {
  const monitor = new RpcMonitor();

  pi.on("session_start", (_event, ctx) => {
    monitor.markConnected();
    ctx.ui.setStatus("pva-rpc", "rpc: connected");
  });

  pi.on("session_shutdown", (_event, ctx) => {
    monitor.markDisconnected();
    ctx.ui.setStatus("pva-rpc", "");
  });

  // Register an RPC health tool
  pi.registerTool?.({
    name: "pva_rpc_health",
    label: "RPC Health",
    description: "Check the health of the RPC connection to the gateway.",
    parameters: {} as any,
    async execute(_toolCallId: string, _params: unknown, _signal: unknown, _onUpdate: unknown, _ctx: unknown) {
      const health = monitor.health;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(health, null, 2),
        }],
        details: { rpcHealth: health },
      };
    },
  } as any);
}

// ── Gateway event processing ────────────────────────────────────────────────

/**
 * Process a gateway event and update production state accordingly.
 * Called when SSE/WS events are received from the gateway.
 */
export function processGatewayEvent(
  event: { channel: string; type: string; data: Record<string, unknown>; episodeSlug?: string },
  onUpdate: (update: { type: string; message: string }) => void,
): void {
  const { channel, type, data, episodeSlug } = event;

  switch (channel) {
    case "pipeline": {
      if (type === "stage.started") {
        onUpdate({ type: "stage-start", message: `Stage "${data.stageId}" started` });
      } else if (type === "stage.completed") {
        onUpdate({ type: "stage-done", message: `Stage "${data.stageId}" completed` });
      } else if (type === "stage.failed") {
        onUpdate({ type: "stage-fail", message: `Stage "${data.stageId}" failed: ${data.error}` });
      }
      break;
    }

    case "review": {
      if (type === "thread-created") {
        onUpdate({
          type: "review-new",
          message: `New review thread on "${data.anchor}"`,
        });
      } else if (type === "message-added") {
        onUpdate({
          type: "review-reply",
          message: `New ${data.author} comment in review thread`,
        });
      }
      break;
    }

    case "workspace": {
      if (type === "file-changed") {
        onUpdate({
          type: "file-change",
          message: `File changed: ${data.path}`,
        });
      } else if (type === "artifact-written") {
        onUpdate({
          type: "artifact-write",
          message: `Artifact written: ${data.path}`,
        });
      }
      break;
    }

    case "pi": {
      if (type === "session-created") {
        onUpdate({
          type: "pi-session",
          message: `Pi session created for ${episodeSlug}`,
        });
      }
      break;
    }

    default:
      // Unknown channel — log but don't crash
      break;
  }
}
