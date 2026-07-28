<script lang="ts">
  import { library } from "$lib/library-store.svelte.ts";
  import type { ResolvedSeries } from "$lib/library-types";
  import EpisodeItem from "./EpisodeItem.svelte";

  interface Props {
    channelSlug: string;
    series: ResolvedSeries;
    autoExpand?: boolean;
  }

  let { channelSlug, series, autoExpand = false }: Props = $props();

  let expanded = $state(autoExpand);

  function toggle() {
    expanded = !expanded;
  }

  function selectSeries() {
    library.selectSeries(channelSlug, series.slug);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
    if (e.key === "ArrowRight" && !expanded) {
      e.preventDefault();
      expanded = true;
    }
    if (e.key === "ArrowLeft" && expanded) {
      e.preventDefault();
      expanded = false;
    }
  }
</script>

<div class="series-group">
  <div class="series-row">
    <button
      class="series-chevron-btn"
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse" : "Expand"}
      onclick={toggle}
    >
      <span class="series-chevron" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
    </button>
    <button
      class="series-name-btn"
      class:selected={library.selectedSeries?.series === series.slug && library.selectedSeries?.channel === channelSlug}
      onclick={selectSeries}
    >
      <span class="series-name">{series.title}</span>
      <span class="series-count" aria-label="{series.episodes.length} episodes">
        {series.episodes.length === 0 ? "empty" : `${series.episodes.length} ep`}
      </span>
    </button>
    {#if series.error}
      <span class="series-error-badge" aria-label="Error loading series">!</span>
    {/if}
  </div>

  {#if expanded}
    <div
      class="episode-list"
      role="group"
      aria-label="{series.title} episodes"
    >
      {#each series.episodes as episode (episode.slug)}
        <EpisodeItem {episode} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .series-row {
    display: flex;
    align-items: center;
    border-radius: var(--vs-radius-sm);
    overflow: hidden;
  }

  .series-chevron-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    padding: var(--vs-space-1) 0;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .series-chevron-btn:hover {
    background: var(--vs-bg-hover);
  }

  .series-chevron {
    width: 14px;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .series-name-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding: var(--vs-space-1) var(--vs-space-2);
    background: none;
    border: none;
    color: var(--vs-text-primary);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-medium);
    text-align: left;
    cursor: pointer;
    border-radius: 0;
  }

  .series-name-btn:hover {
    background: var(--vs-bg-hover);
  }

  .series-name-btn.selected {
    background: var(--vs-accent-subtle);
    color: var(--vs-accent);
  }

  .series-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .series-count {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    background: var(--vs-bg-inset);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .series-error-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--vs-state-blocked);
    color: oklch(100% 0 0);
    font-size: 9px;
    font-weight: var(--vs-font-weight-semibold);
    flex-shrink: 0;
  }

  .episode-list {
    padding-left: var(--vs-space-4);
  }
</style>
