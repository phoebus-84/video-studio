import type { LibraryTree } from "$lib/library-types";

export type LibraryState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty" }
  | { phase: "ready"; tree: LibraryTree };

/**
 * Reactive library store using Svelte 5 runes.
 * The production client injects the GatewayClient; tests use fixture data.
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
