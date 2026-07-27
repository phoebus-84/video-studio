// ---------------------------------------------------------------------------
// Pipeline execution and policy tools
// ---------------------------------------------------------------------------
// Registered by pi-video-agent to let Pi execute and manage pipeline stages.
// Connects to the runtime API through the gateway.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveConfig } from "../src/config.js";

// ── Gateway client (extended) ────────────────────────────────────────────────

interface GatewayClient {
  fetch(path: string, init?: RequestInit): Promise<any>;
}

function createClient(baseUrl: string, token: string): GatewayClient {
  return {
    async fetch(path, init = {}) {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> || {}) },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(`Gateway ${res.status}: ${body.error ?? res.statusText}`);
      }
      return res.json();
    },
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function registerPipelineTools(pi: ExtensionAPI): void {
  let gwClient: GatewayClient | null = null;

  async function getClient(): Promise<GatewayClient> {
    if (!gwClient) {
      const config = await resolveConfig();
      gwClient = createClient(config.gatewayUrl, config.gatewayToken);
    }
    return gwClient;
  }

  // --- Tool: pva_snapshot ------------------------------------------------

  pi.registerTool({
    name: "pva_snapshot",
    label: "Pipeline Snapshot",
    description:
      "Create an immutable pipeline snapshot for an episode. Resolves settings, pipeline, and dependencies.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      label: Type.Optional(Type.String({ description: "Human-readable label for the snapshot" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        // Pipeline snapshot creation goes through the gateway
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/snapshot`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: params.label }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { snapshot: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Snapshot creation failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_run_stage -----------------------------------------------

  pi.registerTool({
    name: "pva_run_stage",
    label: "Run Stage",
    description:
      "Execute a single pipeline stage and wait for completion.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to execute" }),
      dryRun: Type.Optional(Type.Boolean({ description: "Preview execution without running" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/stages/${params.stageId}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dryRun: params.dryRun ?? false }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { execution: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Stage execution failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_run_pipeline --------------------------------------------

  pi.registerTool({
    name: "pva_run_pipeline",
    label: "Run Pipeline",
    description:
      "Execute all pending pipeline stages in topological order.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      dryRun: Type.Optional(Type.Boolean({ description: "Preview execution without running" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dryRun: params.dryRun ?? false }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { pipelineRun: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Pipeline execution failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_check_staleness -----------------------------------------

  pi.registerTool({
    name: "pva_check_staleness",
    label: "Check Staleness",
    description:
      "Check which artifacts are stale after changes to upstream stages.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/staleness`,
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { staleness: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Staleness check failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_plan_rerun ----------------------------------------------

  pi.registerTool({
    name: "pva_plan_rerun",
    label: "Plan Rerun",
    description:
      "Plan a targeted rerun with cost estimates and preserved work.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("retry-current"),
          Type.Literal("rerun-selected"),
          Type.Literal("rerun-affected"),
          Type.Literal("full-rebuild"),
        ], { description: "Rerun mode" }),
      ),
      stageIds: Type.Optional(Type.Array(Type.String(), { description: "Specific stages to rerun (rerun-selected mode)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/rerun-plan`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: params.mode ?? "rerun-affected", stageIds: params.stageIds ?? [] }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { rerunPlan: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Rerun plan failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_approve -------------------------------------------------

  pi.registerTool({
    name: "pva_approve",
    label: "Approve Stage",
    description:
      "Approve a manual gate for a stage that requires operator approval.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to approve" }),
      justification: Type.Optional(Type.String({ description: "Approval justification" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/stages/${params.stageId}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ justification: params.justification ?? "Approved via Pi" }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { approval: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Approval failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_budget_status -------------------------------------------

  pi.registerTool({
    name: "pva_budget_status",
    label: "Budget Status",
    description:
      "Get current budget status including reserved, consumed, and remaining funds.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/budget`,
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { budget: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Budget status failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_journal -------------------------------------------------

  pi.registerTool({
    name: "pva_journal",
    label: "Episode Journal",
    description:
      "Read the episode event journal (JSONL). Optionally filter by event type.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      eventType: Type.Optional(Type.String({ description: "Filter by event type" })),
      limit: Type.Optional(Type.Number({ description: "Max events to return", default: 50 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const queryParams = new URLSearchParams();
        if (params.eventType) queryParams.set("type", params.eventType);
        if (params.limit) queryParams.set("limit", String(params.limit));

        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/journal?${queryParams}`,
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { journal: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Journal read failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });
}
