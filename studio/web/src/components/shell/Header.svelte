<script lang="ts">
  /**
   * Identity, search, and the two facts that must never be hidden: what this
   * production is spending, and whether the gateway is answering.
   */
  import Breadcrumbs from "./Breadcrumbs.svelte";
  import SpendMeter from "./SpendMeter.svelte";
  import OperatorKeyControl from "./OperatorKeyControl.svelte";
  import { studio } from "$lib/studio-store.svelte.ts";
  import type { EpisodeWorkspace } from "$lib/episode-types";

  interface Props {
    connected: boolean;
    episode?: EpisodeWorkspace | null;
  }

  let { connected, episode = null }: Props = $props();

  const connectionLabel = $derived(connected ? "connected" : "offline");
  const ariaLabel = $derived(
    connected ? "Gateway connected" : "Gateway offline",
  );

  /* macOS writes ⌘, everything else writes Ctrl. Showing the wrong one is a
     small lie that costs a keystroke every time. */
  const metaKey =
    typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform)
      ? "⌘"
      : "Ctrl+";
</script>

<header class="header" aria-label="Episode header">
  <div class="header-left">
    <span class="header-brand">Studio</span>
    <Breadcrumbs />
  </div>

  <button
    class="header-search"
    onclick={() => studio.togglePalette()}
    aria-keyshortcuts="Meta+K Control+K"
  >
    <span>Search files, levels, commands</span>
    <kbd>{metaKey}K</kbd>
  </button>

  <div class="header-right">
    <SpendMeter spent={episode?.budgetSpent ?? null} limit={episode?.budgetLimit ?? null} />

    <OperatorKeyControl />

    <span
      class="connection-indicator"
      data-state={connectionLabel}
      role="status"
      aria-label={ariaLabel}
    >
      <span class="connection-dot" aria-hidden="true"></span>
      {connectionLabel}
    </span>
  </div>
</header>

<style>
  .header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--vs-space-4);
    padding: 0 var(--vs-space-3);
    background: var(--vs-bg-surface);
    border-bottom: 1px solid var(--vs-border);
    user-select: none;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    min-width: 0;
    overflow: hidden;
  }

  .header-brand {
    font-weight: var(--vs-font-weight-semibold);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }

  /* Centred because it addresses the whole studio, not the current pane. */
  .header-search {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    width: min(340px, 40vw);
    padding: 5px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-tertiary);
    font: inherit;
    font-size: var(--vs-text-sm);
    text-align: left;
    cursor: pointer;
  }

  .header-search:hover {
    border-color: var(--vs-text-disabled);
    color: var(--vs-text-secondary);
  }

  .header-search kbd {
    margin-left: auto;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    border: 1px solid var(--vs-border);
    border-radius: 3px;
    padding: 1px 4px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
  }

  .connection-indicator {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    white-space: nowrap;
  }

  .connection-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vs-state-current);
  }

  .connection-indicator[data-state="offline"] .connection-dot {
    background: var(--vs-state-blocked);
  }

  @media (max-width: 1024px) {
    /* The search box is the first thing to go; ⌘K still opens the palette. */
    .header-search {
      display: none;
    }
  }
</style>
