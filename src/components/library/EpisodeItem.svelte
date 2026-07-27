<script lang="ts">
  import type { ResolvedEpisode } from "$lib/library-types";
  import { displayStatus, STATUS_LABELS } from "$lib/library-types";
  import { library } from "$lib/library-store.svelte.ts";

  interface Props {
    episode: ResolvedEpisode;
  }

  let { episode }: Props = $props();

  const status = $derived(displayStatus(episode));
  const label = $derived(STATUS_LABELS[status]);

  const selected = $derived(
    library.selectedEpisode === `${episode.channel}/${episode.slug}`,
  );

  function doSelect() {
    library.select(episode.channel, episode.series, episode.slug);
  }
</script>

<button
  class="episode-row"
  class:selected
  data-status={status}
  onclick={doSelect}
  aria-current={selected ? "true" : undefined}
>
  <span class="episode-status-dot" aria-hidden="true"></span>
  <span class="episode-title">{episode.title}</span>
  {#if status !== "idle" && status !== "completed"}
    <span class="episode-status-label">{label}</span>
  {/if}
  {#if episode.error}
    <span class="episode-error-label">Corrupt</span>
  {/if}
</button>

<style>
  .episode-row {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    width: 100%;
    padding: var(--vs-space-1) var(--vs-space-2);
    background: none;
    border: none;
    color: var(--vs-text-secondary);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    text-align: left;
    cursor: pointer;
    border-radius: var(--vs-radius-sm);
    transition: background var(--vs-duration-fast) var(--vs-ease-standard);
  }

  .episode-row:hover {
    background: var(--vs-bg-hover);
  }

  .episode-row:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: -2px;
  }

  .episode-row.selected {
    background: var(--vs-accent-subtle);
    color: var(--vs-accent);
  }

  .episode-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--vs-text-disabled);
  }

  .episode-row[data-status="running"] .episode-status-dot {
    background: var(--vs-state-running);
  }

  .episode-row[data-status="blocked"] .episode-status-dot,
  .episode-row[data-status="failed"] .episode-status-dot,
  .episode-row[data-status="malformed"] .episode-status-dot {
    background: var(--vs-state-blocked);
  }

  .episode-row[data-status="awaiting_review"] .episode-status-dot {
    background: var(--vs-state-attention);
  }

  .episode-row[data-status="stale"] .episode-status-dot {
    background: var(--vs-state-stale);
  }

  .episode-row[data-status="completed"] .episode-status-dot {
    background: var(--vs-state-current);
  }

  .episode-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .episode-status-label {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .episode-row[data-status="running"] .episode-status-label {
    color: var(--vs-state-running);
  }

  .episode-row[data-status="blocked"] .episode-status-label,
  .episode-row[data-status="failed"] .episode-status-label {
    color: var(--vs-state-blocked);
  }

  .episode-error-label {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-state-blocked);
    flex-shrink: 0;
  }
</style>
