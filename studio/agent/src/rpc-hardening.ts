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

  /** Close code the gateway uses to reject a bad token. */
  const WS_UNAUTHORIZED = 4001;
  const RECONNECT_BASE_MS = 1_000;
  const RECONNECT_MAX_MS = 60_000;
  const RECONNECT_MAX_ATTEMPTS = 10;

  let reconnectAttempts = 0;
  /** Set when retrying is pointless, so the loop stops instead of spinning. */
  let gatewayGaveUp = false;
  /** The session's UI, captured at session_start; null outside a session. */
  let ui: { notify(message: string, level?: "info" | "warning" | "error"): void; setStatus(key: string, text: string): void } | null = null;

  function setLinkStatus(text: string): void {
    ui?.setStatus("pva-rpc", text);
  }

  /** Reconnect with exponential backoff, giving up rather than looping forever. */
  function scheduleReconnect(): void {
    if (wsReconnectTimer || gatewayGaveUp) return;

    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      gatewayGaveUp = true;
      notify({
        type: "gateway:unavailable",
        message:
          `Gave up reconnecting to the gateway after ${RECONNECT_MAX_ATTEMPTS} attempts. ` +
          `The agent works without the event stream; restart Pi once the gateway is up.`,
      });
      return;
    }

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
    reconnectAttempts++;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWs();
    }, delay);
  }

  /**
   * Resolve the gateway token.
   *
   * The gateway auto-generates `.gateway-token` in its own working directory
   * on first start and requires an exact match on the WebSocket route — unlike
   * the HTTP middleware, it does not accept the well-known "dev-token".
   *
   * Returning "dev-token" as a fallback therefore guaranteed a rejected
   * connection while looking like a successful configuration, which is exactly
   * what produced an endless connect/disconnect loop. Failing to resolve a
   * token is now reported instead of disguised.
   */
  function resolveToken(): string | null {
    if (process.env.AVG_GATEWAY_TOKEN) return process.env.AVG_GATEWAY_TOKEN;

    // src/ → studio/agent/ → studio/ → <repo root>
    const repoRoot = resolvePath(fileURLToPath(import.meta.url), "..", "..", "..", "..");
    const candidates = [
      // Where the gateway writes it when started from studio/gateway.
      resolvePath(repoRoot, "studio", "gateway", ".gateway-token"),
      resolvePath(process.cwd(), "studio", "gateway", ".gateway-token"),
      resolvePath(process.cwd(), ".gateway-token"),
      // Library-scoped token, used by some workspace layouts.
      resolvePath(process.env.AVG_LIBRARY_ROOT ?? resolvePath(process.cwd(), "library"), ".gateway-token"),
    ];

    for (const p of candidates) {
      try {
        const tok = readFileSync(p, "utf-8").trim();
        if (tok) return tok;
      } catch { /* not found */ }
    }
    return null;
  }

  const gatewayUrl = process.env.AVG_GATEWAY_URL ?? "ws://127.0.0.1:5198/ws";
  const gatewayToken = resolveToken();

  /**
   * Act on a gateway update. Nothing goes to stderr: Pi draws its TUI on the
   * same terminal, so every event (a file-change for each file the agent
   * itself wrote, a disconnect for each retry) landed in the conversation as
   * a raw `[pva-gateway]` line. The link state goes to the status bar, a
   * dead end is said once, and only reviews and stage outcomes reach the
   * agent; the rest is already known to it.
   */
  function notify(update: { type: string; message: string; author?: string }): void {
    if (update.type === "gateway:connected") {
      setLinkStatus("gateway: connected");
      return;
    }
    if (update.type === "gateway:disconnected") {
      setLinkStatus("gateway: reconnecting");
      return;
    }
    if (update.type.startsWith("gateway:")) {
      setLinkStatus("gateway: offline");
      ui?.notify(update.message, "warning");
      return;
    }
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
    if (gatewayGaveUp) return;

    if (!gatewayToken) {
      gatewayGaveUp = true;
      notify({
        type: "gateway:unconfigured",
        message:
          "No gateway token found, so the event stream is disabled. The agent works " +
          "without it. To enable: start the gateway (it writes studio/gateway/.gateway-token) " +
          "or set AVG_GATEWAY_TOKEN.",
      });
      return;
    }

    const url = `${gatewayUrl}?token=${encodeURIComponent(gatewayToken)}`;
    try {
      ws = new WebSocket(url);

      ws.on("open", () => {
        monitor.markConnected();
        // A real connection resets the backoff. Safe even though an
        // unauthorized socket also opens briefly, because a 4001 close stops
        // retrying outright rather than relying on this counter.
        reconnectAttempts = 0;
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

      ws.on("close", (code: number, reason: Buffer) => {
        monitor.markDisconnected();
        ws = null;
        const why = reason?.toString() || "no reason given";

        // 4001 is the gateway rejecting the token. Retrying cannot fix that,
        // and doing so every 5s forever floods the session with a loop whose
        // cause is never printed.
        if (code === WS_UNAUTHORIZED) {
          gatewayGaveUp = true;
          notify({
            type: "gateway:unauthorized",
            message:
              `Gateway rejected the token (${code} ${why}). Not retrying. The agent ` +
              `works without the event stream. Fix by starting the gateway and using ` +
              `the token it writes to studio/gateway/.gateway-token, or set ` +
              `AVG_GATEWAY_TOKEN to match.`,
          });
          return;
        }

        notify({ type: "gateway:disconnected", message: `WebSocket closed (${code} ${why})` });
        scheduleReconnect();
      });

      ws.on("error", () => {
        monitor.markError();
        // ws.on('close') fires after this and handles the reconnect; the
        // error itself (usually ECONNREFUSED while the gateway is down) would
        // only repeat on every attempt.
      });
    } catch (err) {
      monitor.markError();
      scheduleReconnect();
    }
  }

  /** Disconnect WebSocket and cancel retry. */
  function disconnectWs(): void {
    // Setting `ws.onclose = null` does not remove a listener registered with
    // `ws.on("close", …)`, so the close handler kept firing after shutdown and
    // scheduled another reconnect. With the socket then holding the event loop
    // open, `pi -p` never exited.
    gatewayGaveUp = true;

    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.removeAllListeners();
      ws.close();
      ws = null;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    monitor.markConnected();
    ui = ctx.ui;
    setLinkStatus("gateway: connecting");
    // ── Connect to gateway WebSocket ─────────────────────────────────
    connectWs();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    monitor.markDisconnected();
    ctx.ui.setStatus("pva-rpc", "");
    ui = null;
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
