<script lang="ts">
  import type { ResolvedChannel } from "$lib/library-types";
  import SeriesItem from "./SeriesItem.svelte";

  interface Props {
    channel: ResolvedChannel;
  }

  let { channel }: Props = $props();

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

<div class="channel-group">
  <button
    class="channel-row"
    aria-expanded={expanded}
    onclick={toggle}
    onkeydown={onKeydown}
  >
    <span class="channel-chevron" aria-hidden="true">
      {expanded ? "▾" : "▸"}
    </span>
    <span class="channel-name">{channel.title}</span>
    {#if channel.error}
      <span class="channel-error-badge" aria-label="Error loading">!</span>
    {/if}
  </button>

  {#if expanded}
    <div class="series-list" role="group" aria-label="{channel.title} series">
      {#each channel.series as series (series.slug)}
        <SeriesItem {series} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .channel-row {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    width: 100%;
    padding: var(--vs-space-2) var(--vs-space-3);
    background: none;
    border: none;
    color: var(--vs-text-primary);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    text-align: left;
    cursor: pointer;
    border-radius: var(--vs-radius-sm);
  }

  .channel-row:hover {
    background: var(--vs-bg-hover);
  }

  .channel-row:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: -2px;
  }

  .channel-chevron {
    width: 14px;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
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
  }

  .series-list {
    padding-left: var(--vs-space-4);
  }
</style>
