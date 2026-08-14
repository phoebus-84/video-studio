<script lang="ts">
  /**
   * Routes to a workspace by what is selected.
   *
   * This previously rendered the episode workspace unconditionally, and the
   * channel and series views lived *inside* it behind a check on episode
   * phase — so selecting a channel with no episode loaded showed "No episode
   * selected", and those views were effectively unreachable.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import EpisodeWorkspace from "../episode/EpisodeWorkspace.svelte";
  import LevelWorkspace from "../workspace/LevelWorkspace.svelte";

  const channel = $derived(library.selectedChannel);
  const series = $derived(library.selectedSeries);

  const channelEntry = $derived(
    channel ? library.tree.channels.find((c) => c.slug === channel) : null,
  );

  const seriesEntry = $derived(
    series
      ? library.tree.channels
          .find((c) => c.slug === series.channel)
          ?.series.find((s) => s.slug === series.series)
      : null,
  );
</script>

<main class="production-canvas" aria-label="Production canvas">
  {#if channel}
    <LevelWorkspace
      ref={{ level: "channel", channel }}
      title={channelEntry?.title ?? channel}
      childCount={channelEntry?.series?.length}
    />
  {:else if series}
    <LevelWorkspace
      ref={{ level: "series", channel: series.channel, series: series.series }}
      title={seriesEntry?.title ?? series.series}
      childCount={seriesEntry?.episodes?.length}
    />
  {:else}
    <EpisodeWorkspace />
  {/if}
</main>

<style>
  .production-canvas {
    background: var(--vs-bg-canvas);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
