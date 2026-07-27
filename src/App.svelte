<script lang="ts">
  import AppShell from "$components/shell/AppShell.svelte";
  import { library } from "$lib/library-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { GatewayClient } from "$contracts/client";
  import { buildFixtureTree, DEFAULT_FIXTURE } from "$lib/fixtures";
  import {
    EPISODE_FIXTURE,
    BLOCKED_EPISODE_FIXTURE,
    STALE_EPISODE_FIXTURE,
  } from "$lib/episode-fixtures";

  const episodeMap: Record<string, typeof EPISODE_FIXTURE> = {
    "tech-explainer/ep-01-cpu": EPISODE_FIXTURE,
    "tech-explainer/ep-02-memory": EPISODE_FIXTURE,
    "tech-explainer/ep-03-pipelines": STALE_EPISODE_FIXTURE,
    "tech-explainer/ep-01-cache": BLOCKED_EPISODE_FIXTURE,
    "tutorials/ep-01-ownership": {
      ...EPISODE_FIXTURE,
      slug: "ep-01-ownership",
      title: "Understanding Ownership",
      channel: "tutorials",
      series: "rust-101",
      status: "failed" as const,
      stages: EPISODE_FIXTURE.stages.map((s) =>
        s.id === "illustrations"
          ? { ...s, status: "failed" as const, progress: 0.3 }
          : s,
      ),
    },
    "tutorials/ep-02-borrowing": {
      ...EPISODE_FIXTURE,
      slug: "ep-02-borrowing",
      title: "Borrowing and Lifetimes",
      channel: "tutorials",
      series: "rust-101",
      status: "awaiting_review" as const,
      stages: EPISODE_FIXTURE.stages.map((s) =>
        s.id === "illustrations"
          ? { ...s, status: "awaiting_approval" as const, progress: 1 }
          : s,
      ),
    },
  };

  interface Props {
    theme: "light" | "dark";
  }

  let { theme }: Props = $props();

  let connected = $state(false);
  let gatewayClient: GatewayClient | null = $state(null);

  /* Try gateway first, fall back to fixtures. */
  $effect(() => {
    const gwUrl = localStorage.getItem("vs-gateway-url") ?? "http://127.0.0.1:5198";
    const gwToken = localStorage.getItem("vs-gateway-token") ?? "";

    if (gwToken) {
      const client = new GatewayClient({
        baseUrl: gwUrl,
        tokenProvider: () => gwToken,
      });
      gatewayClient = client;

      library.loadFromGateway(client).then(() => {
        connected = true;
      }).catch(() => {
        library.loadFixture(buildFixtureTree(DEFAULT_FIXTURE));
      });
    } else {
      library.loadFixture(buildFixtureTree(DEFAULT_FIXTURE));
    }
  });

  /* Wire episode selection from library into the episode workspace. */
  $effect(() => {
    const key = library.selectedEpisode;
    if (!key) return;

    if (episodeMap[key]) {
      episode.load(episodeMap[key]!);
    } else if (gatewayClient) {
      // Parse channel/episode from the key (format: channel/episode)
      const parts = key.split("/");
      if (parts.length >= 2) {
        // Find the series from the library tree
        const channel = parts[0]!;
        const epSlug = parts[1]!;
        const chEntry = library.tree.channels.find((c) => c.slug === channel);
        const series = chEntry?.series?.[0]?.slug ?? "unknown";
        episode.loadFromGateway(gatewayClient, channel, series, epSlug);
      }
    }
  });

  /* Detect OS theme changes during the session. */
  $effect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("vs-theme")) {
        theme = e.matches ? "dark" : "light";
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });
</script>

<AppShell {connected} {theme} />
