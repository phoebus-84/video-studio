<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import { SCENES_FIXTURE } from "$lib/scene-fixtures";
  import Storyboard from "../storyboard/Storyboard.svelte";

  /* Load scenes when the compositions stage is reached. */
  $effect(() => {
    if (episode.state.phase === "ready") {
      scenes.load(SCENES_FIXTURE);
    }
  });
</script>

<div class="scene-viewer">
  <Storyboard />
</div>

<style>
  .scene-viewer {
    border-top: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    overflow-y: auto;
    max-height: 45%;
  }
</style>
