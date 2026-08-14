// ---------------------------------------------------------------------------
// RPC hardening and gateway event handling
// ---------------------------------------------------------------------------
// Validates RPC messages, handles disconnect/reconnect, and
// processes gateway events for production state changes.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

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

  // ── WebSocket client state ──────────────────────────────────────────
  let ws: WebSocket | null = null;
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentEpisodeSlug: string | null = null;

  /** Resolve the gateway token from env or gateway config file. */
  function resolveToken(): string {
    if (process.env.AVG_GATEWAY_TOKEN) return process.env.AVG_GATEWAY_TOKEN;
    // Try reading .gateway-token relative to the extension's own location
    // and common project layout patterns.
    const bases = [
      // Extension's own directory (pi-video-agent/src/ → ../video-studio-gateway/)
      resolvePath(fileURLToPath(import.meta.url), "..", "..", "..", "video-studio-gateway", ".gateway-token"),
      // Project root (if Pi runs from the avg/ directory)
      resolvePath(process.cwd(), "video-studio-gateway", ".gateway-token"),
      // Directly in cwd
      resolvePath(process.cwd(), ".gateway-token"),
    ];
    for (const p of bases) {
      try {
        const tok = readFileSync(p, "utf-8").trim();
        if (tok) return tok;
      } catch { /* not found */ }
    }
    return "dev-token";
  }

  const gatewayUrl = process.env.AVG_GATEWAY_URL ?? "ws://127.0.0.1:5198/ws";
  const gatewayToken = resolveToken();

  /** Emit an update that can notify Pi of gateway events. */
  function notify(update: { type: string; message: string; author?: string }): void {
    // Use stderr for logging (Pi shows this in agent output)
    process.stderr.write(`[pva-gateway] ${update.type}: ${update.message}\n`);
    // For review events, trigger Pi to read the journal and respond.
    // Only trigger on thread creation and on operator comments; pi's own
    // comments are echoed back through the bus and must not re-trigger a turn.
    if (update.type === "review-reply" && update.author !== "operator") {
      return;
    }
    if (update.type === "review-new" || update.type === "review-reply") {
      try {
        // sendUserMessage always triggers a turn (unlike sendMessage with nextTurn)
        pi.sendUserMessage?.(`New review activity just arrived: ${update.message}. Please call pva_journal to read the latest reviews and respond to the operator's feedback.`, {
          deliverAs: "followUp",
        });
      } catch { /* best-effort */ }
    }
    // For stage completions, notify Pi via sendMessage (triggers a context-aware turn)
    if (update.type === "stage-done" || update.type === "stage-fail") {
      try {
        pi.sendMessage?.({
          customType: "pva:stage-update",
          content: update.message,
          display: true,
        }, { triggerTurn: false });
      } catch { /* best-effort */ }
    }
  }

  /** Connect WebSocket to the gateway. */
  function connectWs(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const url = `${gatewayUrl}?token=${encodeURIComponent(gatewayToken)}`;
    try {
      ws = new WebSocket(url);

      ws.on("open", () => {
        monitor.markConnected();
        // Subscribe to relevant channels
        const subMsg: Record<string, unknown> = {
          type: "subscribe",
          channels: ["pipeline", "review", "workspace", "pi"],
        };
        if (currentEpisodeSlug) {
          subMsg.episodeSlug = currentEpisodeSlug;
        }
        ws?.send(JSON.stringify(subMsg));
        notify({ type: "gateway:connected", message: `Connected to ${url}` });
      });

      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          // The gateway sends events in GatewayEvent format
          if (msg.channel && msg.type) {
            monitor.markEvent();
            processGatewayEvent(
              {
                channel: msg.channel as string,
                type: msg.type as string,
                data: (msg.data as Record<string, unknown>) ?? {},
                episodeSlug: (msg.episodeSlug as string) ?? currentEpisodeSlug ?? undefined,
              },
              (update) => {
                notify(update);
              }
            );
          }
          // Also handle SSE-style events
          if (msg.data) {
            const sseData = typeof msg.data === "string" ? msg.data : null;
            if (sseData) {
              try {
                const parsed = JSON.parse(sseData);
                if (parsed.channel && parsed.type) {
                  monitor.markEvent();
                  processGatewayEvent(
                    {
                      channel: parsed.channel as string,
                      type: parsed.type as string,
                      data: (parsed.data as Record<string, unknown>) ?? {},
                      episodeSlug: (parsed.episodeSlug as string) ?? currentEpisodeSlug ?? undefined,
                    },
                    (update) => { notify(update); }
                  );
                }
              } catch { /* not SSE JSON */ }
            }
          }
        } catch {
          monitor.markError();
        }
      });

      ws.on("close", () => {
        monitor.markDisconnected();
        ws = null;
        notify({ type: "gateway:disconnected", message: "WebSocket closed" });
        // Reconnect after 5s with backoff
        if (!wsReconnectTimer) {
          wsReconnectTimer = setTimeout(() => {
            wsReconnectTimer = null;
            connectWs();
          }, 5000);
        }
      });

      ws.on("error", (err: Error) => {
        monitor.markError();
        // ws.on('close') will fire after this, triggering reconnect
        process.stderr.write(`[pva-gateway] WS error: ${err.message}\n`);
      });
    } catch (err) {
      monitor.markError();
      // Retry after backoff
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWs();
      }, 5000);
    }
  }

  /** Disconnect WebSocket and cancel retry. */
  function disconnectWs(): void {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.onclose = null; // prevent reconnect
      ws.close();
      ws = null;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    monitor.markConnected();
    ctx.ui.setStatus("pva-rpc", "rpc: connected");
    // ── Connect to gateway WebSocket ─────────────────────────────────
    connectWs();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    monitor.markDisconnected();
    ctx.ui.setStatus("pva-rpc", "");
    // ── Disconnect gateway WebSocket ─────────────────────────────────
    disconnectWs();
  });

  // Register an RPC health tool
  pi.registerTool?.({
    name: "pva_rpc_health",
    label: "RPC Health",
    description: "Check the health of the RPC connection to the gateway.",
    parameters: Type.Object({}),
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
  });
}

// ── Gateway event processing ────────────────────────────────────────────────

/**
 * Process a gateway event and update production state accordingly.
 * Called when SSE/WS events are received from the gateway.
 */
export function processGatewayEvent(
  event: { channel: string; type: string; data: Record<string, unknown>; episodeSlug?: string },
  onUpdate: (update: { type: string; message: string; author?: string }) => void,
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
        const author = typeof data.author === "string" ? data.author : "unknown";
        onUpdate({
          type: "review-reply",
          message: `New ${author} comment in review thread`,
          author,
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
