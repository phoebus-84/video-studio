<script lang="ts">
</script>

<div class="offline-banner" role="alert">
  <span class="offline-icon" aria-hidden="true">&#9888;</span>
  <span>Gateway offline — production state may be stale. Actions are paused until reconnection.</span>
</div>

<style>
  .offline-banner {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding: var(--vs-space-2) var(--vs-space-4);
    background: var(--vs-state-attention-bg);
    border-top: 1px solid var(--vs-state-attention);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
  }

  .offline-icon {
    font-size: var(--vs-text-base);
    color: var(--vs-state-attention);
    flex-shrink: 0;
  }
</style>
