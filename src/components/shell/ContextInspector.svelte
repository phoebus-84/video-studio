<script lang="ts">
  /* Placeholder contextual inspector */
</script>

<aside class="context-inspector" aria-label="Contextual inspector">
  <div class="inspector-empty">
    <p>Select an artifact, scene, asset, or stage to inspect details.</p>
  </div>
</aside>

<style>
  .context-inspector {
    background: var(--vs-bg-surface);
    border-left: 1px solid var(--vs-border);
    overflow-y: auto;
    padding: var(--vs-space-3);
  }

  .inspector-empty {
    padding: var(--vs-space-4);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    text-align: center;
  }

  @media (max-width: 1024px) {
    .context-inspector {
      display: none;
    }
  }
</style>
