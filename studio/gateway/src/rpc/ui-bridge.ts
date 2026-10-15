// ---------------------------------------------------------------------------
// Pi Extension UI bridge
// ---------------------------------------------------------------------------
// Bridges Pi extension UI requests to browser interactions.
// When Pi's extension requests a UI action (ask approval, show options,
// display result), the gateway forwards it as an SSE event and
// routes the browser's response back through the intent system.
// ---------------------------------------------------------------------------

import type { EventBus } from "../events/bus.js";
import { createEvent } from "../events/bus.js";
import type { AgentSessionManager } from "./agent-sessions.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** UI request types that Pi extensions can emit. */
export type UiAction =
  | "ask-approval"
  | "ask-options"
  | "show-preview"
  | "show-error"
  | "request-input"
  | "display-choice";

/** A UI request sent from Pi to the browser. */
export interface UiRequest {
  /** Unique request ID for correlation. */
  requestId: string;
  /** What action the browser should show. */
  action: UiAction;
  /** Episode context. */
  episodeSlug: string;
  /** Stage ID context. */
  stageId?: string;
  /** Title for the UI element. */
  title: string;
  /** Description / body text. */
  description: string;
  /** Action-specific payload. */
  payload: Record<string, unknown>;
  /** Timeout in ms after which the request expires (default 60s). */
  timeoutMs?: number;
  /** When the request was created. */
  createdAt: string;
}

/** A response from the browser to a UI request. */
export interface UiResponse {
  requestId: string;
  action: "approved" | "rejected" | "selected" | "submitted" | "dismissed";
  payload: Record<string, unknown>;
}

// ── Bridge ──────────────────────────────────────────────────────────────────

export interface ExtensionBridgeOptions {
  bus: EventBus;
  processMgr: AgentSessionManager;
}

export class ExtensionBridge {
  private bus: EventBus;
  private pendingUiRequests = new Map<string, {
    resolve: (response: UiResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Register the bridge with an event bus — listens for Pi UI requests
   * and publishes them to browser channels.
   */
  start(): void {
    // This is called once during server setup.
    // We subscribe to Pi events that request browser interaction.

    // The actual subscription happens per-session via processMgr.session().
    // For now, we expose the request creation API.
  }

  /**
   * Create a UI request for the browser.
   * Returns a promise that resolves when the browser responds.
   */
  async requestUi(
    episodeSlug: string,
    action: UiAction,
    title: string,
    description: string,
    payload: Record<string, unknown> = {},
    timeoutMs: number = 60_000,
  ): Promise<UiResponse> {
    const requestId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const request: UiRequest = {
      requestId,
      action,
      episodeSlug,
      title,
      description,
      payload,
      timeoutMs,
      createdAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingUiRequests.delete(requestId);
        reject(new Error(`UI request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingUiRequests.set(requestId, { resolve, reject, timer });

      // Publish to event bus so browser SSE clients receive it
      this.bus.publish(createEvent(
        "pi",
        "ui-request",
        request as unknown as Record<string, unknown>,
        episodeSlug,
      ));
    });
  }

  /**
   * Submit a browser response to a pending UI request.
   */
  submitResponse(response: UiResponse): boolean {
    const pending = this.pendingUiRequests.get(response.requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingUiRequests.delete(response.requestId);
    pending.resolve(response);
    return true;
  }

  /**
   * Dismiss a pending UI request (e.g., user navigated away).
   */
  dismissRequest(requestId: string): void {
    const pending = this.pendingUiRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingUiRequests.delete(requestId);
      pending.reject(new Error(`UI request ${requestId} dismissed`));
    }
  }

  /** Number of pending UI requests. */
  get pendingCount(): number {
    return this.pendingUiRequests.size;
  }
}

// ── Fastify routes ──────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export function registerUiBridgeRoutes(
  app: FastifyInstance,
  bridge: ExtensionBridge,
): void {
  // ── POST /api/ui/respond ─────────────────────────────────────────────

  app.post("/api/ui/respond", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: {
      description: "Submit a browser response to a pending UI request from Pi.",
      tags: ["ui-bridge"],
      body: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          action: { type: "string", enum: ["approved", "rejected", "selected", "submitted", "dismissed"] },
          payload: { type: "object" },
        },
        required: ["requestId", "action", "payload"],
      },
    } as any,
  }, async (
    request: FastifyRequest<{
      Body: { requestId: string; action: string; payload: Record<string, unknown> };
    }>,
    reply: FastifyReply,
  ) => {
    const { requestId, action, payload } = request.body;

    const success = bridge.submitResponse({
      requestId,
      action: action as UiResponse["action"],
      payload,
    });

    if (!success) {
      return reply.status(404).send({ error: "UI request not found or already resolved", requestId });
    }

    return reply.send({ acknowledged: true, requestId });
  });

  // ── GET /api/ui/pending ──────────────────────────────────────────────

  app.get("/api/ui/pending", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: {
      description: "Get count of pending UI requests.",
      tags: ["ui-bridge"],
    } as any,
  }, async (_request, reply) => {
    return reply.send({ pending: bridge.pendingCount });
  });
}
