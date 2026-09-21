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
      "Run a single pipeline stage using the gateway's own handler for it — illustrations, " +
      "captions, timing, qa. Returns when the stage has finished. Stages with no handler come " +
      "back blocked rather than running: claim those with pva_claim_stage and perform them yourself.",
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

  // --- Tool: pva_claim_stage -----------------------------------------------

  pi.registerTool({
    name: "pva_claim_stage",
    label: "Claim Stage",
    description:
      "Take a pipeline stage so you can perform it yourself. Leases the stage, records that it " +
      "has started, and returns a leaseId and a deadline. Use this for stages the gateway has no " +
      "automated handler for — brief, script, art-direction — then do the work and call " +
      "pva_complete_stage with the leaseId this returns. The claim expires on its own if you " +
      "abandon it.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to claim" }),
      dryRun: Type.Optional(Type.Boolean({ description: "Preview the claim without leasing" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/stages/${params.stageId}/claim`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dryRun: params.dryRun ?? false }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { claim: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Claim failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_complete_stage --------------------------------------------

  pi.registerTool({
    name: "pva_complete_stage",
    label: "Complete Stage",
    description:
      "Close a stage you claimed. leaseId is required on every call, including a failure report " +
      "— pass the leaseId that pva_claim_stage's response returned. The gateway refuses a call " +
      "without it: completing with no lease id closes whatever open claim it finds, which could " +
      "close a different holder's live claim if yours had already lapsed. Name the files you " +
      "wrote — the runtime checks they exist and are non-empty, and records them; outputs is " +
      "required unless failed is set. Pass failed with an error instead if the work did not " +
      "succeed. A claim that has already expired is refused: take the stage again with " +
      "pva_claim_stage before redoing the work.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to complete" }),
      leaseId: Type.String({
        description: "The lease id returned by pva_claim_stage for this stage. Required on every call.",
      }),
      outputs: Type.Optional(Type.Array(Type.String(), {
        description: "Paths written, relative to the episode directory. Required unless failed.",
      })),
      failed: Type.Optional(Type.Boolean({ description: "The work did not succeed" })),
      error: Type.Optional(Type.String({ description: "Why, when failed" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const result = await client.fetch(
          `/api/channels/${params.channel}/series/${params.series}/episodes/${params.episode}/stages/${params.stageId}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              outputs: params.outputs ?? [],
              leaseId: params.leaseId,
              failed: params.failed ?? false,
              error: params.error,
            }),
          },
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { completion: result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Completion failed: ${err instanceof Error ? err.message : String(err)}` }],
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
      "Run pending stages in dependency order, stopping at the first stage that is blocked, " +
      "fails, or is awaiting review. Stops at any stage the gateway has no handler for — " +
      "claim that stage and perform it, then call this again to continue.",
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
      "Not implemented yet: staleness propagation is unbuilt (avg-33r), and this returns an " +
      "empty result rather than a computed one. Do not treat an empty result as evidence that " +
      "nothing is stale.",
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
    // No "cost estimates": the plan's `estimatedCost` is a unitless weight
    // derived from attempt counts (studio/runtime/src/rerun/planner.ts), and
    // a description that calls it money is how Pi comes to quote a price
    // nothing in this repo can compute.
    description:
      "Plan a targeted rerun: which stages would re-run, and which prior work is preserved.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("retry-current"),
          Type.Literal("rerun-selected"),
          Type.Literal("rerun-affected-downstream"),
          Type.Literal("full-rebuild"),
        ], {
          description:
            "Rerun mode. rerun-affected-downstream needs staleness propagation (avg-33r), which " +
            "is unbuilt: it is accepted here but the gateway refuses it with MODE_UNSUPPORTED.",
        }),
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
            body: JSON.stringify({ mode: params.mode ?? "retry-current", stageIds: params.stageIds ?? [] }),
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
    // No "reserved": BudgetReport (studio/gateway/src/routes/budget.ts)
    // carries limitMicros, consumedMicros and remainingMicros and nothing
    // else. Reservations are taken and never released (avg-91o), so there is
    // no reserved figure to report and a tool that promises one invites Pi
    // to read a field that does not exist.
    description:
      "Get the episode's budget: the limit, what has been consumed, and what remains.",
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
