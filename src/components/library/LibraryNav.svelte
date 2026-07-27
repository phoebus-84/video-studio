<script lang="ts">
  import { library } from "$lib/library-store.svelte.ts";
  import ChannelItem from "./ChannelItem.svelte";
</script>

<nav class="library-nav" aria-label="Library">
  {#if library.phase === "loading"}
    <div class="lib-state" role="status">
      <span class="lib-message">Loading library…</span>
    </div>
  {:else if library.phase === "error"}
    <div class="lib-state lib-state-error" role="alert">
      <span class="lib-message">{library.message}</span>
    </div>
  {:else if library.phase === "empty"}
    <div class="lib-state">
      <span class="lib-icon" aria-hidden="true">&#9675;</span>
      <p>No active production.</p>
      <p class="lib-hint">Start a series or episode in Pi.</p>
    </div>
  {:else}
    {#each library.tree.channels as channel (channel.slug)}
      <ChannelItem {channel} />
    {/each}
  {/if}
</nav>

<style>
  .library-nav {
    overflow-y: auto;
    user-select: none;
  }

  .lib-state {
    padding: var(--vs-space-4);
    text-align: center;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
  }

  .lib-state-error {
    color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
    border-radius: var(--vs-radius-sm);
    margin: var(--vs-space-2);
  }

  .lib-icon {
    font-size: 1.25rem;
    color: var(--vs-text-disabled);
    margin-bottom: var(--vs-space-2);
    display: block;
  }

  .lib-hint {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-top: var(--vs-space-2);
  }

  .lib-message {
    display: block;
    line-height: var(--vs-leading-normal);
  }
</style>
