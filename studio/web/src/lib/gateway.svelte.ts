/**
 * Shared gateway client for UI components.
 * Reads connection info from localStorage (set by App.svelte).
 * Manages WebSocket connection for live event streaming.
 */
import { GatewayClient } from "$contracts/client";

export { GatewayClient } from "$contracts/client";

let _client: GatewayClient | null = null;
let _ws: WebSocket | null = null;
let _wsCallbacks: Array<(event: Record<string, unknown>) => void> = [];
let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _wsUrl = "";

/** Where the operator key the person entered is kept, beside the gateway token. */
export const OPERATOR_KEY_STORAGE = "vs-operator-key";

/**
 * Which credential the studio presents (avg-qr4.3). The operator key makes
 * this browser the operator, so its approvals are signed human decisions.
 * Without it the studio still works on the agent token, and an approval
 * becomes a request, which fails closed.
 *
 * The key is only ever one the person entered (avg-qr4.3 final review, I1):
 * a build-time key was inlined into modules the dev server serves without
 * authentication, and into production bundles.
 */
export function credentialFor(storage: Pick<Storage, "getItem">, gatewayToken: string): string {
  return storage.getItem(OPERATOR_KEY_STORAGE)
    || storage.getItem("vs-gateway-token") || gatewayToken;
}

/**
 * Keep the operator key the person pasted, trimmed; an empty entry forgets
 * it. The caller reloads: the client and its socket are built once, with the
 * credential they started with.
 */
export function saveOperatorKey(storage: Pick<Storage, "setItem" | "removeItem">, key: string): void {
  const trimmed = key.trim();
  if (trimmed) storage.setItem(OPERATOR_KEY_STORAGE, trimmed);
  else storage.removeItem(OPERATOR_KEY_STORAGE);
}

/** Whether this browser holds an operator key. Never returns the key itself. */
export function hasOperatorKey(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return Boolean(storage.getItem(OPERATOR_KEY_STORAGE));
}

export function getGatewayClient(): GatewayClient {
  if (!_client) {
    const baseUrl = localStorage.getItem("vs-gateway-url") ?? "http://127.0.0.1:5198";
    const token = credentialFor(localStorage, __GATEWAY_TOKEN__);
    _client = new GatewayClient({
      baseUrl,
      tokenProvider: () => token,
    });
    // Set up WebSocket with token in query param
    _wsUrl = baseUrl.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(token)}`;
    connectWs(token);
  }
  return _client;
}

/** Subscribe to gateway events. Returns an unsubscribe function. */
export function onGatewayEvent(callback: (event: Record<string, unknown>) => void): () => void {
  _wsCallbacks.push(callback);
  return () => {
    _wsCallbacks = _wsCallbacks.filter((c) => c !== callback);
  };
}

/** Get WebSocket connection state. */
export function getWsState(): "connected" | "connecting" | "disconnected" {
  if (!_ws) return "disconnected";
  if (_ws.readyState === WebSocket.OPEN) return "connected";
  if (_ws.readyState === WebSocket.CONNECTING) return "connecting";
  return "disconnected";
}

function connectWs(token: string): void {
  if (!_wsUrl) return;
  try {
    _ws = new WebSocket(_wsUrl);

    _ws.onopen = () => {
      // Subscribe to relevant channels
      _ws?.send(JSON.stringify({
        type: "subscribe",
        channels: ["pipeline", "workspace", "review", "pi"],
      }));
      notifyCallbacks({ type: "connection.ws.connected", data: { url: _wsUrl } });
    };

    _ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        // Handle both SSE-style (data: {...}) and raw WS messages
        if (event.channel || event.type) {
          notifyCallbacks(event);
        }
      } catch { /* ignore */ }
    };

    _ws.onclose = () => {
      notifyCallbacks({ type: "connection.ws.disconnected", data: {} });
      _ws = null;
      // Reconnect after 5s
      if (!_wsReconnectTimer) {
        _wsReconnectTimer = setTimeout(() => {
          _wsReconnectTimer = null;
          connectWs(token);
        }, 5000);
      }
    };

    _ws.onerror = () => { /* handled by onclose */ };
  } catch { /* WS not supported */ }
}

function notifyCallbacks(event: Record<string, unknown>): void {
  for (const cb of _wsCallbacks) {
    try { cb(event); } catch { /* ignore */ }
  }
}

export function resetGatewayClient(): void {
  _client = null;
  if (_ws) { _ws.close(); _ws = null; }
  if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
  _wsCallbacks = [];
}
