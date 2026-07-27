<script lang="ts">
  /* Placeholder production canvas */
</script>

<main class="production-canvas" aria-label="Production canvas">
  <div class="canvas-empty">
    <div class="empty-icon" aria-hidden="true">&#9675;</div>
    <h2 class="empty-title">No episode selected</h2>
    <p class="empty-text">
      Open a channel, series, or episode to begin inspecting production state.
    </p>
  </div>
</main>

<style>
  .production-canvas {
    background: var(--vs-bg-canvas);
    overflow-y: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .canvas-empty {
    text-align: center;
    max-width: 320px;
  }

  .empty-icon {
    font-size: 2rem;
    color: var(--vs-text-disabled);
    margin-bottom: var(--vs-space-3);
  }

  .empty-title {
    font-size: var(--vs-text-lg);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-primary);
    margin: 0 0 var(--vs-space-2);
  }

  .empty-text {
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    line-height: var(--vs-leading-normal);
    margin: 0;
  }
</style>
