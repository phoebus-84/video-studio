<script lang="ts">
  interface Props {
    episodeTitle?: string | undefined;
    connected: boolean;
  }

  let { episodeTitle, connected }: Props = $props();

  const connectionLabel = $derived(
    connected ? "connected" : "offline",
  );
  const ariaLabel = $derived(
    connected ? "Gateway connected" : "Gateway offline",
  );
</script>

<header class="header" aria-label="Episode header">
  <div class="header-left">
    <span class="header-brand" aria-hidden="true">Studio</span>
    {#if episodeTitle}
      <span class="header-separator" aria-hidden="true">/</span>
      <h1 class="header-episode">{episodeTitle}</h1>
    {/if}
  </div>
  <div class="header-right">
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--vs-space-4);
    background: var(--vs-bg-surface);
    border-bottom: 1px solid var(--vs-border);
    user-select: none;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    overflow: hidden;
  }

  .header-brand {
    font-weight: var(--vs-font-weight-semibold);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .header-separator {
    color: var(--vs-text-disabled);
    font-size: var(--vs-text-sm);
  }

  .header-episode {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-medium);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-indicator {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .connection-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vs-state-running);
  }

  .connection-indicator[data-state="offline"] .connection-dot {
    background: var(--vs-state-blocked);
  }
</style>
