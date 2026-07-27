import type { LibraryTree } from "$lib/library-types";
import type { GatewayClient } from "$contracts/client";
import { buildFixtureTree } from "$lib/fixtures";

export type LibraryState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty" }
  | { phase: "ready"; tree: LibraryTree };

/**
 * Reactive library store using Svelte 5 runes.
 * Supports both fixture and gateway-backed loading.
 */
class LibraryStore {
  tree = $state<LibraryTree>({ channels: [] });
  phase = $state<LibraryState["phase"]>("loading");
  message = $state("");
  selectedEpisode = $state<string | null>(null);

  /** Load from a fixture (test / no-gateway mode). */
  loadFixture(tree: LibraryTree) {
    this.tree = tree;
    this.phase = tree.channels.length === 0 ? "empty" : "ready";
    this.message = "";
  }

  /** Load from the gateway API. */
  async loadFromGateway(client: GatewayClient) {
    this.phase = "loading";
    try {
      const channels = await client.listChannels();
      if (channels.length === 0) {
        this.phase = "empty";
        this.tree = { channels: [] };
        return;
      }

      const seriesByChannel: Record<string, { slug: string; title: string; episodeCount: number }[]> = {};
      const episodesBySeries: Record<string, { slug: string; title: string; status: string; currentDeliverable: boolean; blocked: boolean; lastActivity: string }[]> = {};

      for (const ch of channels) {
        const series = await client.listSeries(ch.slug);
        seriesByChannel[ch.slug] = series;
        for (const ser of series) {
          const key = `${ch.slug}/${ser.slug}`;
          const episodes = await client.listEpisodes(ch.slug, ser.slug);
          episodesBySeries[key] = episodes;
        }
      }

      this.tree = buildFixtureTree({
        channels,
        seriesByChannel: seriesByChannel as any,
        episodesBySeries: episodesBySeries as any,
      });
      this.phase = "ready";
      this.message = "";
    } catch (err) {
      this.loadError(err instanceof Error ? err.message : "Gateway unavailable");
    }
  }

  /** Load error state. */
  loadError(message: string) {
    this.phase = "error";
    this.message = message;
    this.tree = { channels: [] };
  }

  /** Mark an episode as selected. */
  select(channel: string, _series: string, episode: string) {
    this.selectedEpisode = `${channel}/${episode}`;
  }
}

export const library = new LibraryStore();
