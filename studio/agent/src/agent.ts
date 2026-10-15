// ---------------------------------------------------------------------------
// Pi Video Agent — standalone RPC process
// ---------------------------------------------------------------------------
// Spawned by the gateway as a subprocess. Communicates via JSONL RPC over
// stdin/stdout. Responds to health checks, capability discovery, and episode
// operations. Connects to the gateway WebSocket for live event streaming.
// ---------------------------------------------------------------------------

import { createInterface } from "node:readline";
import { WebSocket } from "ws";

// ── Types ───────────────────────────────────────────────────────────────────

interface RpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface RpcResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── Agent State ─────────────────────────────────────────────────────────────

const startedAt = Date.now();
let ws: WebSocket | null = null;
let episodeContext: Record<string, unknown> | null = null;
let gatewayUrl: string | null = null;

// ── Capabilities ────────────────────────────────────────────────────────────

const CAPABILITIES = {
  skills: [
    "fairy-tale-ingest",
    "write-brief",
    "write-script",
    "art-direction",
    "audience-adaptation",
    "safety-review",
    "content-plan",
    "repo-analysis",
    "compose-video",
  ],
  tools: [
    "create-channel",
    "create-series",
    "create-episode",
    "generate-image",
    "render-vector-animation",
    "synthesize-nonverbal-audio",
    "synthesize-narration",
    "compose-multitrack-video",
    "compose-video",
    "add-captions",
    "qa-check",
    "search-media",
    "fetch-media",
    "check-provenance",
    "search-local-media",
    "reuse-local-media",
    "derive-media",
    "mapillary",
  ],
  pipelines: [
    "blender-animation",
    "fairy-tale-adaptation",
    "narrated-illustrated-video",
    "repository-documentation",
    "series-production",
  ],
};

// ── RPC Handler ─────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin });

// Suppress stdout except for JSONL responses
const originalStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (() => {
  // We need stdout for RPC responses, so don't suppress
  return originalStdout;
})();

function send(response: RpcResponse): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function sendEvent(type: string, data: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ type, data, timestamp: new Date().toISOString() }) + "\n");
}

function sendError(id: string, code: number, message: string, data?: unknown): void {
  send({ id, error: { code, message, data } });
}

async function handleMessage(line: string): Promise<void> {
  let request: RpcRequest;
  try {
    request = JSON.parse(line);
  } catch {
    // Non-JSON line, skip
    return;
  }

  const { id, method, params } = request;

  try {
    switch (method) {
      // ── Health ─────────────────────────────────────────────────────
      case "health": {
        send({
          id,
          result: {
            status: "connected",
            uptimeMs: Date.now() - startedAt,
            capabilities: Object.keys(CAPABILITIES).length,
            skillsCount: CAPABILITIES.skills.length,
            toolsCount: CAPABILITIES.tools.length,
            connectedToGateway: !!ws,
            episodeContext: episodeContext?.episode ?? null,
          },
        });
        break;
      }

      // ── Capabilities ───────────────────────────────────────────────
      case "capabilities": {
        send({ id, result: CAPABILITIES });
        break;
      }

      // ── Episode open ───────────────────────────────────────────────
      case "episode.open": {
        episodeContext = params as Record<string, unknown>;
        // Connect to gateway WebSocket for this episode
        if (gatewayUrl && !ws) {
          connectGateway(gatewayUrl);
        }
        send({
          id,
          result: {
            opened: true,
            episode: params.episode ?? params,
            pipeline: params.pipeline,
          },
        });
        break;
      }

      // ── Episode close ──────────────────────────────────────────────
      case "episode.close": {
        episodeContext = null;
        send({ id, result: { closed: true } });
        break;
      }

      // ── Gateway URL ────────────────────────────────────────────────
      case "gateway.connect": {
        gatewayUrl = (params.url as string) ?? "ws://127.0.0.1:5198/ws";
        connectGateway(gatewayUrl);
        send({ id, result: { connecting: true, url: gatewayUrl } });
        break;
      }

      // ── Unknown method ─────────────────────────────────────────────
      default: {
        sendError(id, -32601, `Method not found: ${method}`);
        break;
      }
    }
  } catch (err) {
    sendError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

// ── Gateway WebSocket connection ────────────────────────────────────────────

function connectGateway(url: string): void {
  try {
    ws = new WebSocket(url);

    ws.on("open", () => {
      sendEvent("pi.connected", { url, timestamp: new Date().toISOString() });

      // Subscribe to relevant channels
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "subscribe",
          channels: ["pipeline", "review", "file"],
          episodeSlug: episodeContext?.episode as string | undefined,
        }));
      }
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "event" || msg.channel) {
          // Route gateway events to internal handlers
          sendEvent("pi.event.received", {
            channel: msg.channel,
            type: msg.type,
            timestamp: new Date().toISOString(),
          });
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on("close", () => {
      sendEvent("pi.disconnected", { url, timestamp: new Date().toISOString() });
      ws = null;
      // Reconnect after 5s
      setTimeout(() => {
        if (gatewayUrl && !ws) connectGateway(gatewayUrl);
      }, 5000);
    });

    ws.on("error", (err) => {
      // Log to stderr (not stdout — that's for RPC)
      process.stderr.write(`[pi-agent] WS error: ${err.message}\n`);
    });
  } catch (err) {
    process.stderr.write(`[pi-agent] WS connect failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── Process lifecycle ───────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  sendEvent("pi.shutdown", { reason: "SIGTERM" });
  if (ws) ws.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  sendEvent("pi.shutdown", { reason: "SIGINT" });
  if (ws) ws.close();
  process.exit(0);
});

// ── Read RPC messages ───────────────────────────────────────────────────────

rl.on("line", async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  await handleMessage(trimmed);
});

// Signal readiness on stderr (stdout is for JSONL RPC)
process.stderr.write(`[pi-video-agent] ready, pid=${process.pid}, capabilities=${CAPABILITIES.skills.length} skills, ${CAPABILITIES.tools.length} tools\n`);

// Don't auto-connect — wait for gateway.connect RPC with auth token
