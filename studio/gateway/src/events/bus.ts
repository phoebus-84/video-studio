// ---------------------------------------------------------------------------
// Unified event bus
// ---------------------------------------------------------------------------
// Pub/sub style event bus that fans out to SSE and WebSocket clients.
// Events are typed and versioned. Subscribers can filter by channel.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

// ── Event types ─────────────────────────────────────────────────────────────

export type EventChannel =
  | "workspace"
  | "pipeline"
  | "review"
  | "pi"
  | "adapter"
  | "provider";

/** Event category for filtering/subscribing. */
export type EventCategory = EventChannel | "file" | "connection";

export interface GatewayEvent {
  /** Event schema version. */
  schema: "gateway-event/v1alpha1";
  /** Unique event ID (UUID). */
  id: string;
  /** Channel this event belongs to. */
  channel: EventChannel;
  /** Event type within the channel. */
  type: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Event payload. */
  data: Record<string, unknown>;
  /** Episode slug if applicable. */
  episodeSlug?: string;
}

// ── Subscriber ──────────────────────────────────────────────────────────────

export interface EventSubscriber {
  /** Send an event to this subscriber. */
  send(event: GatewayEvent): void;
  /** Close this subscriber's connection. */
  close(): void;
  /** Whether the subscriber is still connected. */
  isAlive(): boolean;
  /** Optional channel filter. */
  channels?: EventChannel[];
  /** Optional episode filter. */
  episodeSlug?: string;
}

// ── Event bus ───────────────────────────────────────────────────────────────

export class EventBus {
  private subscribers: EventSubscriber[] = [];

  /** Subscribe a client. */
  subscribe(subscriber: EventSubscriber): void {
    this.subscribers.push(subscriber);
  }

  /** Unsubscribe a client. */
  unsubscribe(subscriber: EventSubscriber): void {
    this.subscribers = this.subscribers.filter((s) => s !== subscriber);
  }

  /** Publish an event to all matching subscribers. */
  publish(event: GatewayEvent): void {
    const dead: EventSubscriber[] = [];

    for (const sub of this.subscribers) {
      if (!sub.isAlive()) {
        dead.push(sub);
        continue;
      }

      // Channel filter
      if (sub.channels && !sub.channels.includes(event.channel)) continue;

      // Episode filter
      if (sub.episodeSlug && event.episodeSlug && sub.episodeSlug !== event.episodeSlug) continue;

      try {
        sub.send(event);
      } catch {
        dead.push(sub);
      }
    }

    for (const d of dead) this.unsubscribe(d);
  }

  /** Number of active subscribers. */
  get subscriberCount(): number {
    this.subscribers = this.subscribers.filter((s) => s.isAlive());
    return this.subscribers.length;
  }
}

// ── Helper: generate event ID ───────────────────────────────────────────────

let eventCounter = 0;

export function makeEventId(): string {
  eventCounter += 1;
  return `evt-${Date.now()}-${eventCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Helper: create an event ─────────────────────────────────────────────────

export function createEvent(
  channel: EventChannel,
  type: string,
  data: Record<string, unknown>,
  episodeSlug?: string,
): GatewayEvent {
  return {
    schema: "gateway-event/v1alpha1",
    id: makeEventId(),
    channel,
    type,
    timestamp: new Date().toISOString(),
    data,
    episodeSlug,
  };
}

// ── SSE subscriber ──────────────────────────────────────────────────────────

export function createSSESubscriber(reply: {
  write(chunk: string): void;
}): EventSubscriber {
  let alive = true;

  return {
    send(event: GatewayEvent) {
      if (!alive) return;
      reply.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      alive = false;
    },
    isAlive() {
      return alive;
    },
  };
}

// ── WS subscriber ───────────────────────────────────────────────────────────

export function createWSSubscriber(socket: WebSocket): EventSubscriber {
  let alive = true;

  return {
    send(event: GatewayEvent) {
      if (!alive) return;
      if (socket.readyState !== 1 /* OPEN */) {
        alive = false;
        return;
      }
      socket.send(JSON.stringify(event) + "\n");
    },
    close() {
      alive = false;
      try { socket.close(); } catch { /* ignore */ }
    },
    isAlive() {
      if (socket.readyState !== 1) alive = false;
      return alive;
    },
  };
}

// ── EventStream manager ─────────────────────────────────────────────────────

/**
 * Manages SSE and WebSocket endpoints backed by an EventBus.
 */
export class EventStreamManager {
  readonly bus = new EventBus();

  /**
   * Register SSE and WebSocket endpoints on the Fastify app.
   */
  register(fastify: FastifyInstance, token: string): void {
    // ── SSE ──────────────────────────────────────────────────────────────

    fastify.get("/events", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema: { description: "Server-Sent Events stream", tags: ["events"] } as any,
    }, async (request, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sub = createSSESubscriber(reply.raw);
      this.bus.subscribe(sub);

      // Send initial connection event
      sub.send({
        schema: "gateway-event/v1alpha1",
        id: makeEventId(),
        channel: "workspace",
        type: "connected",
        timestamp: new Date().toISOString(),
        data: { protocol: "sse" },
      });

      // Keep-alive heartbeat
      const heartbeat = setInterval(() => {
        if (!sub.isAlive()) {
          clearInterval(heartbeat);
          return;
        }
        reply.raw.write(`: heartbeat\n\n`);
      }, 30_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        this.bus.unsubscribe(sub);
      });

      return reply.hijack();
    });

    // ── WebSocket ────────────────────────────────────────────────────────

    fastify.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const queryToken = url.searchParams.get("token");

      if (queryToken !== token) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: "UNAUTHORIZED",
            message: "Invalid or missing WebSocket token.",
          }) + "\n",
        );
        socket.close(4001, "Unauthorized");
        return;
      }

      const sub = createWSSubscriber(socket);
      this.bus.subscribe(sub);

      sub.send({
        schema: "gateway-event/v1alpha1",
        id: makeEventId(),
        channel: "workspace",
        type: "connected",
        timestamp: new Date().toISOString(),
        data: { protocol: "websocket" },
      });

      // Ping/pong
      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
          const msg = JSON.parse(data.toString());
          if (msg.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }) + "\n");
          }
          if (msg.type === "subscribe" && msg.channels) {
            sub.channels = msg.channels as EventChannel[];
          }
        } catch { /* ignore */ }
      });

      socket.on("close", () => this.bus.unsubscribe(sub));
      socket.on("error", () => this.bus.unsubscribe(sub));
    });
  }
}

// ── Standard event type constants ──────────────────────────────────────────

export const EVENTS = {
  // Pipeline
  STAGE_STARTED:    "stage.started",
  STAGE_COMPLETED:  "stage.completed",
  STAGE_FAILED:     "stage.failed",
  STALE_DETECTED:   "staleness.detected",

  // Pi session
  PI_CONNECTED:     "pi.connected",
  PI_DISCONNECTED:  "pi.disconnected",
  PI_RESPONSE:      "pi.response",

  // Providers
  PROVIDER_JOB_STARTED:   "provider.job.started",
  PROVIDER_JOB_COMPLETED: "provider.job.completed",
  PROVIDER_JOB_FAILED:    "provider.job.failed",

  // Files
  FILE_CHANGED:     "file.changed",
  FILE_DELETED:     "file.deleted",

  // Reviews
  REVIEW_CREATED:   "review.created",
  REVIEW_UPDATED:   "review.updated",
  REVIEW_RESOLVED:  "review.resolved",

  // Connection
  WS_CONNECTED:     "connection.ws.connected",
  WS_DISCONNECTED:  "connection.ws.disconnected",
} as const;

/** Map event type to its category. */
export function eventCategory(type: string): EventCategory {
  if (type.startsWith("stage.") || type.startsWith("staleness.")) return "pipeline";
  if (type.startsWith("pi.")) return "pi";
  if (type.startsWith("provider.")) return "provider";
  if (type.startsWith("file.")) return "file";
  if (type.startsWith("review.")) return "review";
  if (type.startsWith("connection.")) return "connection";
  return "workspace";
}
