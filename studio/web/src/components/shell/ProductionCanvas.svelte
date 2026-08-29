<script lang="ts">
  /**
   * The work surface: view tabs, the view itself, and the agent bar.
   *
   * Routing is by level *and* view rather than by level alone. A channel and an
   * episode are not the same kind of thing, and neither is "the files in this
   * episode" and "the stages of this episode" — previously the canvas picked a
   * workspace from the selection and each workspace grew its own internal
   * navigation, so there were three different ways to change what you were
   * looking at.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { files } from "$lib/files-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";

  import ViewTabs from "../workspace/ViewTabs.svelte";
  import FileTabs from "../workspace/FileTabs.svelte";
  import LevelOverview from "../workspace/LevelOverview.svelte";
  import SeriesPipeline from "../workspace/SeriesPipeline.svelte";
  import FileBrowser from "../workspace/FileBrowser.svelte";
  import FileViewer from "../workspace/FileViewer.svelte";
  import StageRail from "../episode/StageRail.svelte";
  import StageDetail from "../episode/StageDetail.svelte";
  import Storyboard from "../storyboard/Storyboard.svelte";
  import NarrationPanel from "../narration/NarrationPanel.svelte";
  import RenderViewer from "../render/RenderViewer.svelte";
  import AgentBar from "../agent/AgentBar.svelte";

  const channelEntry = $derived(
    library.selectedChannel
      ? (library.tree.channels.find((c) => c.slug === library.selectedChannel) ?? null)
      : null,
  );

  const seriesEntry = $derived(
    library.selectedSeries
      ? (library.tree.channels
          .find((c) => c.slug === library.selectedSeries!.channel)
          ?.series.find((s) => s.slug === library.selectedSeries!.series) ?? null)
      : null,
  );

  /** The level the files store should be pointed at. */
  const levelRef = $derived.by(() => {
    if (library.selectedChannel) {
      return { level: "channel" as const, channel: library.selectedChannel };
    }
    if (library.selectedSeries) {
      const { channel, series } = library.selectedSeries;
      return { level: "series" as const, channel, series };
    }
    if (library.selectedEpisode) {
      const [channel, series, ep] = library.selectedEpisode.split("/");
      if (channel && series && ep) {
        return { level: "episode" as const, channel, series, episode: ep };
      }
    }
    return null;
  });

  const levelTitle = $derived(
    library.selectedChannel
      ? (channelEntry?.title ?? library.selectedChannel)
      : library.selectedSeries
        ? (seriesEntry?.title ?? library.selectedSeries.series)
        : "",
  );

  /* Load the level's files, and reset the view and open tabs when the level
     itself changes. Paths are relative to a level, so carrying tabs across
     would leave tabs pointing at files that are not there. */
  let loadedKey = $state<string | null>(null);

  $effect(() => {
    const ref = levelRef;
    if (!ref) {
      loadedKey = null;
      return;
    }

    const key = [ref.level, ref.channel, ref.series ?? "", ref.episode ?? ""].join("/");
    if (key === loadedKey) return;

    loadedKey = key;
    studio.clearFiles();
    studio.resetView();
    void files.load(ref);
  });

  const ep = $derived(episode.state);
</script>

<main class="production-canvas" aria-label="Production canvas">
  {#if !levelRef}
    <div class="pc-empty">
      <h2>Nothing selected</h2>
      <p>Choose a channel, series or episode from the library.</p>
    </div>
  {:else}
    <ViewTabs />

    {#if studio.view === "files"}
      <FileTabs />
    {/if}

    <div class="pc-body">
      {#if studio.view === "overview"}
        <LevelOverview ref={levelRef} title={levelTitle} />
      {:else if studio.view === "pipeline"}
        <SeriesPipeline />
      {:else if studio.view === "files"}
        <div class="pc-files">
          <aside class="pc-browser">
            <FileBrowser initiallyOpen={[]} />
          </aside>
          <section class="pc-viewer">
            <FileViewer />
          </section>
        </div>
      {:else if studio.view === "stages"}
        {#if ep.phase === "loading"}
          <p class="pc-note" role="status">Loading episode…</p>
        {:else if ep.phase === "error"}
          <p class="pc-note pc-error" role="alert">{ep.message}</p>
        {:else if ep.phase === "ready"}
          <div class="pc-stages">
            <StageRail
              stages={ep.episode.stages}
              selectedStageId={episode.selectedStageId}
            />
            <StageDetail
              stages={ep.episode.stages}
              stageId={episode.selectedStageId}
            />
          </div>
        {:else}
          <p class="pc-note">No episode loaded.</p>
        {/if}
      {:else if studio.view === "storyboard"}
        <Storyboard />
      {:else if studio.view === "narration"}
        <NarrationPanel />
      {:else if studio.view === "render"}
        <RenderViewer />
      {/if}
    </div>

    <AgentBar />
  {/if}
</main>

<style>
  .production-canvas {
    background: var(--vs-bg-canvas);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .pc-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Every view fills the body and scrolls inside it, so the agent bar stays
     pinned and the canvas never scrolls as a whole. */
  .pc-body > :global(*) {
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .pc-files {
    display: grid;
    grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
    min-height: 0;
  }

  .pc-browser {
    border-right: 1px solid var(--vs-border);
    min-height: 0;
    overflow: hidden;
  }

  .pc-viewer {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .pc-stages {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .pc-stages > :global(:last-child) {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .pc-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: var(--vs-space-6);
    color: var(--vs-text-secondary);
  }

  .pc-empty h2 {
    font-size: var(--vs-text-lg);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-primary);
    margin: 0 0 var(--vs-space-2);
  }

  .pc-empty p {
    font-size: var(--vs-text-sm);
    margin: 0;
  }

  .pc-note {
    margin: auto;
    padding: var(--vs-space-5);
    text-align: center;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
  }

  .pc-error {
    color: var(--vs-state-blocked);
  }

  @media (max-width: 900px) {
    .pc-files {
      grid-template-columns: 1fr;
      grid-template-rows: 180px minmax(0, 1fr);
    }

    .pc-browser {
      border-right: none;
      border-bottom: 1px solid var(--vs-border);
    }
  }
</style>
