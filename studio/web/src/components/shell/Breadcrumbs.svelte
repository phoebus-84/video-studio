<script lang="ts">
  /**
   * Where you are, and a way back up.
   *
   * The trail truncates at the level you are actually in rather than always
   * showing three segments, so a channel does not display a series and an
   * episode it is not inside.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";

  interface Crumb {
    label: string;
    level: "channel" | "series" | "episode";
    go: () => void;
  }

  /** Title for a slug when the tree knows one, otherwise the slug itself. */
  function channelTitle(slug: string): string {
    return library.tree.channels.find((c) => c.slug === slug)?.title ?? slug;
  }

  function seriesTitle(channel: string, slug: string): string {
    return (
      library.tree.channels
        .find((c) => c.slug === channel)
        ?.series.find((s) => s.slug === slug)?.title ?? slug
    );
  }

  const crumbs = $derived.by((): Crumb[] => {
    const trail: Crumb[] = [];

    if (library.selectedChannel) {
      const ch = library.selectedChannel;
      trail.push({
        label: channelTitle(ch),
        level: "channel",
        go: () => library.selectChannel(ch),
      });
      return trail;
    }

    if (library.selectedSeries) {
      const { channel, series } = library.selectedSeries;
      trail.push({
        label: channelTitle(channel),
        level: "channel",
        go: () => library.selectChannel(channel),
      });
      trail.push({
        label: seriesTitle(channel, series),
        level: "series",
        go: () => library.selectSeries(channel, series),
      });
      return trail;
    }

    if (library.selectedEpisode) {
      const [channel, series, episode] = library.selectedEpisode.split("/");
      if (!channel || !series || !episode) return trail;
      trail.push({
        label: channelTitle(channel),
        level: "channel",
        go: () => library.selectChannel(channel),
      });
      trail.push({
        label: seriesTitle(channel, series),
        level: "series",
        go: () => library.selectSeries(channel, series),
      });
      trail.push({
        label: episode,
        level: "episode",
        go: () => library.select(channel, series, episode),
      });
    }

    return trail;
  });

  /* The last crumb is where you are; earlier ones are somewhere to go. */
  const currentIndex = $derived(crumbs.length - 1);
</script>

<nav class="crumbs" aria-label="Breadcrumb">
  {#each crumbs as crumb, i (crumb.level)}
    <span class="crumb-sep" aria-hidden="true">/</span>
    <button
      class="crumb"
      class:current={i === currentIndex}
      aria-current={i === currentIndex ? "page" : undefined}
      onclick={crumb.go}
    >
      {crumb.label}
    </button>
  {/each}

  {#if studio.view === "files" && studio.openPaths.length > 0}
    <span class="crumb-file" title={studio.openPaths[studio.openPaths.length - 1]}>
      {studio.openPaths[studio.openPaths.length - 1]}
    </span>
  {/if}
</nav>

<style>
  .crumbs {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    min-width: 0;
  }

  .crumb-sep {
    color: var(--vs-text-disabled);
  }

  .crumb {
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: var(--vs-radius-sm);
    font: inherit;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }

  .crumb:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .crumb.current {
    color: var(--vs-text-primary);
    font-weight: var(--vs-font-weight-semibold);
  }

  /* The open file is context, not a place you can navigate to, so it is not a
     button. */
  .crumb-file {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    padding-left: 2px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
