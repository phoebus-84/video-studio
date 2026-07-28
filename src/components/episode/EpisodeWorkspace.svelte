<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";
  import EpisodeHeader from "./EpisodeHeader.svelte";
  import StageRail from "./StageRail.svelte";
  import EditorWorkspace from "../editor/EditorWorkspace.svelte";
  import SceneViewer from "./SceneViewer.svelte";
  import LevelWorkspace from "../shell/LevelWorkspace.svelte";

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
      <p>Loading episode…</p>
    </div>
  {:else if ep.phase === "error"}
    <div class="ws-empty ws-error" role="alert">
      <h2>Failed to load episode</h2>
      <p>{ep.message}</p>
    </div>
  {:else if library.selectedChannel}
    <LevelWorkspace
      level="channel"
      label={library.tree.channels.find(c => c.slug === library.selectedChannel)?.title ?? library.selectedChannel}
      channel={library.selectedChannel}
    />
  {:else if library.selectedSeries}
    <LevelWorkspace
      level="series"
      label={library.tree.channels.find(c => c.slug === library.selectedSeries!.channel)?.series.find(s => s.slug === library.selectedSeries!.series)?.title ?? library.selectedSeries.series}
      channel={library.selectedSeries.channel}
      series={library.selectedSeries.series}
    />
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
