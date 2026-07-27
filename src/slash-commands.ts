// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
// /video, /render, /approve, /vstatus, /skills, /ctx
// ---------------------------------------------------------------------------

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export function registerSlashCommands(pi: ExtensionAPI): void {
  pi.registerCommand?.("video", {
    description: "Create a new video or resume production on an existing one",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.split(/\s+/);
      const action = parts[0] ?? "status";
      const path = parts[1];
      if (!path && action !== "status") {
        ctx.ui.notify("Usage: /video [create|resume|status] <path>", "error");
        return;
      }
      ctx.ui.notify(`Video ${action}: ${path ?? "all"}`, "info");
    },
  });

  pi.registerCommand?.("render", {
    description: "Trigger video rendering for an episode",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.split(/\s+/);
      const path = parts[0];
      const preview = parts.includes("--preview");
      if (!path) { ctx.ui.notify("Usage: /render <path> [--preview]", "error"); return; }
      ctx.ui.notify(`${preview ? "Preview" : "Full"} render: ${path}`, "info");
    },
  });

  pi.registerCommand?.("approve", {
    description: "Approve a manual gate for a stage",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parts = args.split(/\s+/);
      const path = parts[0];
      const stageId = parts[1];
      if (!path || !stageId) { ctx.ui.notify("Usage: /approve <path> <stage-id>", "error"); return; }
      ctx.ui.notify(`Approved stage "${stageId}" for ${path}`, "info");
    },
  });

  pi.registerCommand?.("vstatus", {
    description: "Show production status overview",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const path = args.trim() || "all";
      ctx.ui.notify(`Production status: ${path}`, "info");
    },
  });

  pi.registerCommand?.("skills", {
    description: "List available production skills",
    async handler(args: string, ctx: ExtensionCommandContext) {
      ctx.ui.notify(`Skills: ${args.trim() || "all"}`, "info");
    },
  });

  pi.registerCommand?.("ctx", {
    description: "Show production context for an episode",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const path = args.trim();
      if (!path) { ctx.ui.notify("Usage: /ctx <path>", "error"); return; }
      ctx.ui.notify(`Context: ${path}`, "info");
    },
  });
}
