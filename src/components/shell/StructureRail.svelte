<script lang="ts">
  /* Placeholder structure region — will be populated by vsw-pbt.3 */
</script>

<nav class="structure-rail" aria-label="Library structure">
  <div class="structure-empty">
    <p>No active production.</p>
    <p class="hint">Start a series or episode in Pi.</p>
  </div>
</nav>

<style>
  .structure-rail {
    background: var(--vs-bg-surface);
    border-right: 1px solid var(--vs-border);
    overflow-y: auto;
    padding: var(--vs-space-3);
  }

  .structure-empty {
    padding: var(--vs-space-4);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    text-align: center;
  }

  .hint {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-top: var(--vs-space-2);
  }

  @media (max-width: 1024px) {
    .structure-rail {
      display: none;
    }
  }
</style>
