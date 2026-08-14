import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ErrorCode } from "../errors/index.js";

/**
 * Register WebSocket endpoint for real-time event delivery.
 *
 * The gateway exposes a single `/ws` endpoint that authenticates via
 * the `token` query parameter (same bearer token, but in the query string
 * since browser WebSocket constructors do not support custom headers).
 *
 * Events are JSON-encoded and separated by newlines (JSONL over WS).
 */
export function registerWebSocket(app: FastifyInstance, token: string): void {
  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    // Authenticate via query parameter
    const url = new URL(req.url ?? "/", "http://localhost");
    const queryToken = url.searchParams.get("token");

    if (queryToken !== token) {
      socket.send(
        JSON.stringify({
          type: "error",
          error: ErrorCode.UNAUTHORIZED,
          message: "Invalid or missing WebSocket token.",
        }) + "\n",
      );
      socket.close(4001, "Unauthorized");
      return;
    }

    // Connection accepted
    socket.send(
      JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
      }) + "\n",
    );

    // Heartbeat: respond to ping with pong
    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }) + "\n");
        }
      } catch {
        // Ignore unparseable messages from clients
      }
    });

    socket.on("close", () => {
      // Connection closed – no action needed
    });

    socket.on("error", (_err: Error) => {
      // Socket error – close is handled above
    });
  });
}

/**
 * Register SSE (Server-Sent Events) endpoint.
 *
 * Provides the same event stream as WebSocket over HTTP SSE for
 * simpler clients. Authenticated via Bearer token in the
 * Authorization header (standard for EventSource polyfills).
 */
export function registerSSE(app: FastifyInstance): void {
  app.get("/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connection event
    reply.raw.write(
      `data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`,
    );

    // Keep-alive heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat\n\n`);
    }, 30_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
    });

    // Don't close the reply – SSE is a long-lived connection
    return reply.hijack();
  });
}
