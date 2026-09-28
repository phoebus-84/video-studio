// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
// /video, /render, /request-approval, /vstatus, /skills, /ctx
//
// These commands delegate to the pipeline tools for real execution.
// ---------------------------------------------------------------------------

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export function registerSlashCommands(pi: ExtensionAPI): void {
  // ── /video ────────────────────────────────────────────────────────────────

  pi.registerCommand?.("video", {
    description: "Create a new video or resume production on an existing one",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.trim().split(/\s+/);
      const action = parts[0] ?? "status";
      const path = parts[1] ?? "";

      if (action === "create" && path) {
        const [channel, series, episode] = path.split("/");
        if (!channel || !series || !episode) {
          ctx.ui.notify("Usage: /video create <channel>/<series>/<episode>", "error");
          return;
        }
        ctx.ui.notify(`Initializing episode workspace: ${path}`, "info");
        pi.sendUserMessage(
          `Initialize the episode workspace at ${path}. ` +
          `Use pva_create_channel, pva_create_series, and pva_create_episode as needed, ` +
          `then gather context with pva_gather_context. Report the workspace status after initialization.`
        );
        return;
      }

      if (action === "resume" && path) {
        ctx.ui.notify(`Resuming production: ${path}`, "info");
        pi.sendUserMessage(
          `Resume production on ${path}. ` +
          `Use pva_gather_context to check the current state, ` +
          `then run any pending stages with pva_run_pipeline.`
        );
        return;
      }

      if (action === "status" || !action) {
        ctx.ui.notify(`Production status: ${path || "all episodes"}`, "info");
        pi.sendUserMessage(
          `Show the production status for ${path || "all episodes"}. ` +
          `Use pva_gather_context to collect state from the gateway.`
        );
        return;
      }

      ctx.ui.notify("Usage: /video [create|resume|status] [channel/series/episode]", "error");
    },
  });

  // ── /render ───────────────────────────────────────────────────────────────

  pi.registerCommand?.("render", {
    description: "Trigger video rendering for an episode",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.trim().split(/\s+/);
      const path = parts[0];
      const preview = parts.includes("--preview");

      if (!path) {
        ctx.ui.notify("Usage: /render <channel>/<series>/<episode> [--preview]", "error");
        return;
      }

      const [channel, series, episode] = path.split("/");
      if (!channel || !series || !episode) {
        ctx.ui.notify("Usage: /render <channel>/<series>/<episode> [--preview]", "error");
        return;
      }

      ctx.ui.notify(`${preview ? "Preview" : "Full"} render: ${path}`, "info");
      pi.sendUserMessage(
        `Compose the video for episode ${path}. ` +
        `Use pva_compose_video to trigger composition with FFmpeg. ` +
        `${preview ? "Use preview/rough quality settings." : "Use full production quality."} ` +
        `After composition, report the output path, file size, and duration.`
      );
    },
  });

  // ── /request-approval ────────────────────────────────────────────────────
  // Renamed from /approve (avg-qr4.3): Pi cannot approve a human gate, only
  // ask the operator to review it. Even the tool it drives, pva_request_approval,
  // can only produce a request — the gateway downgrades an agent's approval of
  // a review: human stage to one.

  pi.registerCommand?.("request-approval", {
    description: "Ask the operator to review a manual gate for a stage",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.trim().split(/\s+/);
      const path = parts[0];
      const stageId = parts[1];

      if (!path || !stageId) {
        ctx.ui.notify("Usage: /request-approval <channel>/<series>/<episode> <stage-id>", "error");
        return;
      }

      const [channel, series, episode] = path.split("/");
      if (!channel || !series || !episode) {
        ctx.ui.notify("Usage: /request-approval <channel>/<series>/<episode> <stage-id>", "error");
        return;
      }

      ctx.ui.notify(`Requesting operator review of stage "${stageId}" for ${path}`, "info");
      pi.sendUserMessage(
        `Request operator review of stage "${stageId}" for episode ${path} with pva_request_approval, ` +
        `then stop and tell the user it is waiting for them. You cannot approve it yourself.`,
      );
    },
  });

  // ── /vstatus ──────────────────────────────────────────────────────────────

  pi.registerCommand?.("vstatus", {
    description: "Show production status overview",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const path = args.trim() || "";

      ctx.ui.notify(`Gathering production status for ${path || "all episodes"}...`, "info");
      pi.sendUserMessage(
        `Show the production status overview for ${path || "all episodes in the library"}. ` +
        `Use pva_channels, pva_series, and pva_episodes to discover what exists, ` +
        `then pva_gather_context for each episode of interest. ` +
        `Report: pipeline progress, budget consumed, stale artifacts, open reviews, blockers.`
      );
    },
  });

  // ── /skills ──────────────────────────────────────────────────────────────

  pi.registerCommand?.("skills", {
    description: "List available production skills",
    async handler(args: string, ctx: ExtensionCommandContext) {
      ctx.ui.notify(`Loading skills...`, "info");
      pi.sendUserMessage(
        `List all available production skills ` +
        `${args ? `matching "${args}"` : "for the current pipeline"}. ` +
        `Use pva_list_skills to discover them. ` +
        `For each skill, show: name, description, inputs, outputs, and capability required.`
      );
    },
  });

  // ── /ctx ──────────────────────────────────────────────────────────────────

  pi.registerCommand?.("ctx", {
    description: "Show full production context for an episode",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const path = args.trim();

      if (!path) {
        ctx.ui.notify("Usage: /ctx <channel>/<series>/<episode>", "error");
        return;
      }

      const [channel, series, episode] = path.split("/");
      if (!channel || !series || !episode) {
        ctx.ui.notify("Usage: /ctx <channel>/<series>/<episode>", "error");
        return;
      }

      ctx.ui.notify(`Gathering context for ${path}...`, "info");
      pi.sendUserMessage(
        `Gather and display the full production context for ${path}. ` +
        `Use pva_gather_context to collect: ` +
        `pipeline state, stage progress, budget, staleness, open reviews, ` +
        `available skills, and recent journal events. ` +
        `Present a compact but complete summary.`
      );
    },
  });
}
