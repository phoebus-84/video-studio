// ---------------------------------------------------------------------------
// Skill and context tools
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverSkills } from "../src/skills.js";
import { gatherContext } from "../src/context.js";
import type { SkillCatalog } from "../src/skills.js";

// Discover on request: compose and human edits may change skills mid-session.
async function getCatalog(): Promise<SkillCatalog> {
  return discoverSkills();
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function registerSkillTools(pi: ExtensionAPI): void {
  // --- Tool: pva_list_skills ---------------------------------------------

  pi.registerTool({
    name: "pva_list_skills",
    label: "List Skills",
    description:
      "List all available production skills: the studio's (built-in), a channel's (channel-local: how that channel makes its sources and follows its conventions) and a series' (series-local). Skills are markdown documents that guide Pi through production work.",
    parameters: Type.Object({
      source: Type.Optional(Type.Union([
        Type.Literal("built-in"),
        Type.Literal("channel-local"),
        Type.Literal("series-local"),
      ], { description: "Filter by skill source" })),
      seriesSlug: Type.Optional(Type.String({ description: "Filter by series: channel/series" })),
      channelSlug: Type.Optional(Type.String({ description: "Filter by channel: its own skills and its series'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const catalog = await getCatalog();
        const skills = catalog.list({
          source: params.source,
          seriesSlug: params.seriesSlug,
          channelSlug: params.channelSlug,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(skills, null, 2) }],
          details: { skills, total: skills.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to list skills: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_load_skill ----------------------------------------------

  pi.registerTool({
    name: "pva_load_skill",
    label: "Load Skill",
    description:
      "Load the full content of a production skill markdown file.",
    parameters: Type.Object({
      skillId: Type.String({ description: "Skill ID to load (e.g. 'write-brief')" }),
      seriesSlug: Type.Optional(Type.String({ description: "Where it is used: channel/series, or channel alone. The series' skill wins, then the channel's, then the studio's" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const catalog = await getCatalog();
        const content = await catalog.load(params.skillId, params.seriesSlug);

        return {
          content: [{ type: "text", text: `# Skill: ${params.skillId}\n\n${content}` }],
          details: { skillId: params.skillId, content },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to load skill "${params.skillId}": ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_gather_context ------------------------------------------

  pi.registerTool({
    name: "pva_gather_context",
    label: "Gather Context",
    description:
      "Gather the current production context for an episode: pipeline state, budget, staleness, review threads. Injects a compact summary for the model.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const catalog = await getCatalog();
        const context = await gatherContext(
          params.channel,
          params.series,
          params.episode,
          catalog,
        );

        return {
          content: [{ type: "text", text: context.summary }],
          details: { context },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to gather context: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });
}
