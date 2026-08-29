<script lang="ts">
  import { library } from "$lib/library-store.svelte.ts";
  import type { ResolvedChannel } from "$lib/library-types";
  import SeriesItem from "./SeriesItem.svelte";

  interface Props {
    channel: ResolvedChannel;
    /** Hold the branch open regardless of local state, e.g. while filtering. */
    forceExpand?: boolean;
  }

  let { channel, forceExpand = false }: Props = $props();

  let openedByUser = $state(false);
  let autoExpandedSeries = $state(false);

  /* A forced-open branch stays open even if it was collapsed before, and goes
     back to the user's own choice once the force is lifted. */
  const expanded = $derived(forceExpand || openedByUser);

  function toggle() {
    openedByUser = !expanded;
    if (!expanded && !autoExpandedSeries && channel.series.length === 1) {
      autoExpandedSeries = true;
    }
  }

  function selectChannel() {
    library.selectChannel(channel.slug);
    // Also expand the tree when clicking the channel label
    if (!expanded) {
      openedByUser = true;
      if (!autoExpandedSeries && channel.series.length === 1) {
        autoExpandedSeries = true;
      }
    }
  }
</script>

<div class="channel-group">
  <div class="channel-row">
    <button
      class="channel-chevron-btn"
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse" : "Expand"}
      onclick={toggle}
    >
      <span class="channel-chevron" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
    </button>
    <button
      class="channel-name-btn"
      class:selected={library.selectedChannel === channel.slug}
      onclick={selectChannel}
    >
      <span class="channel-name">{channel.title}</span>
    </button>
    {#if channel.error}
      <span class="channel-error-badge" aria-label="Error loading">!</span>
    {/if}
  </div>

  {#if expanded}
    <div class="series-list" role="group" aria-label="{channel.title} series">
      {#each channel.series as series (series.slug)}
        <SeriesItem
          channelSlug={channel.slug}
          {series}
          {forceExpand}
          autoExpand={autoExpandedSeries && channel.series.length === 1}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .channel-row {
    display: flex;
    align-items: center;
    gap: 0;
    border-radius: var(--vs-radius-sm);
    overflow: hidden;
  }

  .channel-chevron-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    padding: var(--vs-space-2) 0;
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .channel-chevron-btn:hover {
    background: var(--vs-bg-hover);
  }

  .channel-chevron {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .channel-name-btn {
    flex: 1;
    display: flex;
    align-items: center;
    padding: var(--vs-space-2) var(--vs-space-3) var(--vs-space-2) 0;
    background: none;
    border: none;
    color: var(--vs-text-primary);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    text-align: left;
    cursor: pointer;
    border-radius: 0;
  }

  .channel-name-btn:hover {
    background: var(--vs-bg-hover);
  }

  .channel-name-btn.selected {
    background: var(--vs-accent-subtle);
    color: var(--vs-accent);
  }

  .channel-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel-error-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--vs-state-blocked);
    color: oklch(100% 0 0);
    font-size: 10px;
    font-weight: var(--vs-font-weight-semibold);
    flex-shrink: 0;
    margin-right: var(--vs-space-2);
  }

  .series-list {
    padding-left: var(--vs-space-4);
  }
</style>
