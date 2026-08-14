<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import EpisodeHeader from "./EpisodeHeader.svelte";
  import StageRail from "./StageRail.svelte";
  import EditorWorkspace from "../editor/EditorWorkspace.svelte";
  import SceneViewer from "./SceneViewer.svelte";

  const ep = $derived(episode.state);
</script>

<div class="episode-workspace">
  {#if ep.phase === "unselected"}
    <div class="ws-empty">
      <h2>No episode selected</h2>
      <p>Select an episode from the library to begin.</p>
    </div>
  {:else if ep.phase === "loading"}
    <div class="ws-empty" role="status">
      <span class="ws-spinner" aria-hidden="true"></span>
      <p>Loading episode…</p>
    </div>
  {:else if ep.phase === "error"}
    <div class="ws-empty ws-error" role="alert">
      <h2>Failed to load episode</h2>
      <p>{ep.message}</p>
    </div>
  {:else}
    <EpisodeHeader episode={ep.episode} />
    <StageRail
      stages={ep.episode.stages}
      selectedStageId={episode.selectedStageId}
    />
    <div class="ws-canvas">
      <EditorWorkspace />
    </div>
    <SceneViewer />
  {/if}
</div>

<style>
  .episode-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .ws-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: var(--vs-space-6);
    color: var(--vs-text-secondary);
  }

  .ws-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--vs-border);
    border-top-color: var(--vs-accent);
    border-radius: 50%;
    animation: ws-spin 0.8s linear infinite;
    margin-bottom: var(--vs-space-3);
  }

  @keyframes ws-spin {
    to { transform: rotate(360deg); }
  }

  .ws-empty h2 {
    font-size: var(--vs-text-lg);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-primary);
    margin: 0 0 var(--vs-space-2);
  }

  .ws-empty p {
    font-size: var(--vs-text-sm);
    margin: 0;
  }

  .ws-error {
    color: var(--vs-state-blocked);
  }

  .ws-canvas {
    flex: 1;
    overflow: hidden;
  }
</style>
