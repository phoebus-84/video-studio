<script lang="ts">
  import type { ResolvedSeries } from "$lib/library-types";
  import EpisodeItem from "./EpisodeItem.svelte";

  interface Props {
    series: ResolvedSeries;
  }

  let { series }: Props = $props();

  let expanded = $state(false);

  function toggle() {
    expanded = !expanded;
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
  <button
    class="series-row"
    aria-expanded={expanded}
    onclick={toggle}
    onkeydown={onKeydown}
  >
    <span class="series-chevron" aria-hidden="true">
      {expanded ? "▾" : "▸"}
    </span>
    <span class="series-name">{series.title}</span>
    <span class="series-count" aria-label="{series.episodes.length} episodes">
      {series.episodes.length}
    </span>
    {#if series.error}
      <span class="series-error-badge" aria-label="Error loading series">!</span>
    {/if}
  </button>

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
    gap: var(--vs-space-1);
    width: 100%;
    padding: var(--vs-space-1) var(--vs-space-2);
    background: none;
    border: none;
    color: var(--vs-text-primary);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-medium);
    text-align: left;
    cursor: pointer;
    border-radius: var(--vs-radius-sm);
  }

  .series-row:hover {
    background: var(--vs-bg-hover);
  }

  .series-row:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: -2px;
  }

  .series-chevron {
    width: 14px;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
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
