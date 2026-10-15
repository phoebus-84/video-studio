// ---------------------------------------------------------------------------
// GUI intent routing
// ---------------------------------------------------------------------------
// Routes browser-initiated intents (HTTP requests from the web studio)
// to the appropriate Pi RPC command, with response correlation.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AgentSessionManager } from "../rpc/agent-sessions.js";
import type { EventBus } from "../events/bus.js";
import { createEvent } from "../events/bus.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Intent types coming from the GUI. */
export type GuiIntent =
  | "prompt"     // User typed a new production prompt
  | "steer"      // User provided guidance without full new prompt
  | "follow-up"  // User replied to Pi's question
  | "approve"    // User approved a manual gate
  | "rerun"      // User requested a rerun
  | "edit"       // User edited an artifact (via diff/patch)
  | "review"     // User added a review comment
  | "cancel";    // User cancelled an in-progress operation

/** Intent context from the GUI. */
export interface GuiIntentContext {
  intent: GuiIntent;
  episodeSlug: string;
  /** Optional stage ID target. */
  stageId?: string;
  /** Intent payload (prompt text, approval, diff). */
  payload: Record<string, unknown>;
  /** Request ID for correlation (provided by client). */
  correlationId?: string;
}

/** Intent result sent back to the GUI. */
export interface GuiIntentResult {
  success: boolean;
  correlationId?: string;
  /** What Pi did in response. */
  action: string;
  /** Structured result data. */
  data: Record<string, unknown>;
  /** Machine-readable status. */
  status: "accepted" | "rejected" | "queued" | "error";
}

// ── Intent handler ──────────────────────────────────────────────────────────

/**
 * Route a GUI intent to the appropriate Pi RPC command.
 */
export async function handleIntent(
  ctx: GuiIntentContext,
  processMgr: AgentSessionManager,
  bus: EventBus,
): Promise<GuiIntentResult> {
  // Get or create a Pi session for this episode
  const session = await processMgr.session(ctx.episodeSlug);

  // Publish intent received event
  bus.publish(createEvent(
    "review",
    "intent-received",
    {
      intent: ctx.intent,
      episodeSlug: ctx.episodeSlug,
      stageId: ctx.stageId,
      correlationId: ctx.correlationId,
    },
    ctx.episodeSlug,
  ));

  try {
    switch (ctx.intent) {
      case "prompt": {
        // New production prompt → start fresh episode
        const result = await session.request("pva_run_pipeline", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          prompt: ctx.payload.prompt as string,
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "pipeline-started",
          data: result as Record<string, unknown>,
          status: "accepted",
        };
      }

      case "steer": {
        // Guidance without full prompt
        const result = await session.request("pva_steer", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          guidance: ctx.payload.guidance as string,
          stageId: ctx.stageId,
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "steered",
          data: result as Record<string, unknown>,
          status: "accepted",
        };
      }

      case "follow-up": {
        // Reply to Pi's question
        const result = await session.request("pva_follow_up", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          response: ctx.payload.response as string,
          threadId: ctx.payload.threadId as string,
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "follow-up-sent",
          data: result as Record<string, unknown>,
          status: "accepted",
        };
      }

      case "approve": {
        // Not forwarded to Pi: Pi cannot approve (avg-qr4.3), and this router
        // holds no execution service to record a decision itself. The studio
        // calls the stage approve route directly with the operator credential.
        const [channel, series, episode] = ctx.episodeSlug.split("/");
        return {
          success: false,
          correlationId: ctx.correlationId,
          action: "use-approve-route",
          data: { route: `/api/channels/${channel}/series/${series}/episodes/${episode}/stages/${ctx.stageId}/approve` },
          status: "rejected",
        };
      }

      case "rerun": {
        // Request rerun
        const result = await session.request("pva_plan_rerun", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          mode: ctx.payload.mode as string ?? "retry-current",
          stageIds: ctx.payload.stageIds as string[] ?? [ctx.stageId].filter(Boolean),
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "rerun-planned",
          data: result as Record<string, unknown>,
          status: "accepted",
        };
      }

      case "edit": {
        // User edited an artifact — notify Pi about the change
        session.notify("pva_artifact_changed", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          artifactPath: ctx.payload.artifactPath as string,
          editor: "gui-operator",
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "change-notified",
          data: { acknowledged: true },
          status: "accepted",
        };
      }

      case "review": {
        // User added a review comment — notify Pi
        session.notify("pva_review_added", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          threadId: ctx.payload.threadId as string,
          messageId: ctx.payload.messageId as string,
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "review-notified",
          data: { acknowledged: true },
          status: "accepted",
        };
      }

      case "cancel": {
        // Cancel an in-progress operation
        const result = await session.request("pva_cancel", {
          channel: ctx.episodeSlug.split("/")[0],
          series: ctx.episodeSlug.split("/")[1],
          episode: ctx.episodeSlug.split("/")[2],
          stageId: ctx.stageId,
        });
        return {
          success: true,
          correlationId: ctx.correlationId,
          action: "cancelled",
          data: result as Record<string, unknown>,
          status: "accepted",
        };
      }

      default:
        return {
          success: false,
          correlationId: ctx.correlationId,
          action: "unknown-intent",
          data: { message: `Unknown intent: ${ctx.intent}` },
          status: "rejected",
        };
    }
  } catch (err) {
    // Intent execution failed
    bus.publish(createEvent(
      "review",
      "intent-failed",
      {
        intent: ctx.intent,
        episodeSlug: ctx.episodeSlug,
        error: err instanceof Error ? err.message : String(err),
      },
      ctx.episodeSlug,
    ));

    return {
      success: false,
      correlationId: ctx.correlationId,
      action: ctx.intent,
      data: { error: err instanceof Error ? err.message : String(err) },
      status: "error",
    };
  }
}

// ── Fastify routes ──────────────────────────────────────────────────────────

/**
 * Register HTTP routes that map GUI intents to Pi RPC commands.
 */
export function registerIntentRoutes(
  app: FastifyInstance,
  processMgr: AgentSessionManager,
  bus: EventBus,
): void {
  app.post("/api/intent", {
    schema: {
      description: "Route a GUI intent (prompt, steer, approve, rerun, etc.) to Pi.",
      tags: ["intent"],
      body: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: ["prompt", "steer", "follow-up", "approve", "rerun", "edit", "review", "cancel"],
          },
          episodeSlug: { type: "string" },
          stageId: { type: "string" },
          payload: { type: "object" },
          correlationId: { type: "string" },
        },
        required: ["intent", "episodeSlug", "payload"],
      },
    },
  }, async (
    request: FastifyRequest<{
      Body: {
        intent: string;
        episodeSlug: string;
        stageId?: string;
        payload: Record<string, unknown>;
        correlationId?: string;
      };
    }>,
    reply: FastifyReply,
  ) => {
    const { intent, episodeSlug, stageId, payload, correlationId } = request.body;

    const result = await handleIntent(
      { intent: intent as GuiIntent, episodeSlug, stageId, payload, correlationId },
      processMgr,
      bus,
    );

    const statusCode = result.status === "error" ? 500
      : result.status === "rejected" ? 400
      : 200;

    return reply.status(statusCode).send(result);
  });
}
