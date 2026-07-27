// ---------------------------------------------------------------------------
// Workspace and artifact tools
// ---------------------------------------------------------------------------
// Registered by pi-video-agent to let Pi navigate and manipulate
// the canonical workspace data through the gateway.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StudioConfig } from "../src/config.js";
import { resolveConfig } from "../src/config.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface GatewayClient {
  listChannels(): Promise<{ slug: string; title: string; seriesCount: number }[]>;
  listSeries(channel: string): Promise<{ slug: string; title: string; episodeCount: number }[]>;
  listEpisodes(channel: string, series: string): Promise<{ slug: string; title: string; status: string }[]>;
  getEpisode(channel: string, series: string, episode: string): Promise<Record<string, unknown>>;
}

function createGatewayClient(config: StudioConfig): GatewayClient {
  const base = config.gatewayUrl;
  const token = config.gatewayToken;

  async function gw(path: string): Promise<any> {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  return {
    listChannels: () => gw("/api/channels"),
    listSeries: (c) => gw(`/api/channels/${c}/series`),
    listEpisodes: (c, s) => gw(`/api/channels/${c}/series/${s}/episodes`),
    getEpisode: (c, s, e) => gw(`/api/channels/${c}/series/${s}/episodes/${e}`),
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function registerWorkspaceTools(pi: ExtensionAPI): void {
  let gwClient: GatewayClient | null = null;

  async function getClient(): Promise<GatewayClient> {
    if (!gwClient) {
      const config = await resolveConfig();
      gwClient = createGatewayClient(config);
    }
    return gwClient;
  }

  // --- Tool: pva_channels -----------------------------------------------

  pi.registerTool({
    name: "pva_channels",
    label: "List Channels",
    description: "List all channels in the Agentic Video Studio workspace.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const channels = await client.listChannels();
        return {
          content: [{ type: "text", text: JSON.stringify(channels, null, 2) }],
          details: { channels },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to list channels: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_series -------------------------------------------------

  pi.registerTool({
    name: "pva_series",
    label: "List Series",
    description: "List all series in a channel.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug (e.g. 'tech-explainer')" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const series = await client.listSeries(params.channel);
        return {
          content: [{ type: "text", text: JSON.stringify(series, null, 2) }],
          details: { series },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to list series: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_episodes -----------------------------------------------

  pi.registerTool({
    name: "pva_episodes",
    label: "List Episodes",
    description: "List all episodes in a series.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const episodes = await client.listEpisodes(params.channel, params.series);
        return {
          content: [{ type: "text", text: JSON.stringify(episodes, null, 2) }],
          details: { episodes },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to list episodes: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });

  // --- Tool: pva_episode_detail -----------------------------------------

  pi.registerTool({
    name: "pva_episode_detail",
    label: "Episode Detail",
    description: "Get full detail for an episode including pipeline stages, budget, and status.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const client = await getClient();
        const episode = await client.getEpisode(params.channel, params.series, params.episode);
        return {
          content: [{ type: "text", text: JSON.stringify(episode, null, 2) }],
          details: { episode },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to get episode: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true as unknown as boolean,
        };
      }
    },
  });
}
