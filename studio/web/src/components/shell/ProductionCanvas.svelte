<script lang="ts">
  import EpisodeWorkspace from "../episode/EpisodeWorkspace.svelte";
</script>

<main class="production-canvas" aria-label="Production canvas">
  <EpisodeWorkspace />
</main>

<style>
  .production-canvas {
    background: var(--vs-bg-canvas);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
