<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import { narration } from "$lib/narration-store.svelte.ts";
  import { NARRATION_FIXTURE, VOICE_FIXTURE } from "$lib/narration-fixtures";
  import Storyboard from "../storyboard/Storyboard.svelte";
  import NarrationPanel from "../narration/NarrationPanel.svelte";
  import RenderViewer from "../render/RenderViewer.svelte";

  type Tab = "storyboard" | "narration" | "render";
  let tab = $state<Tab>("storyboard");
  let loaded = false;

  $effect(() => {
    if (episode.state.phase === "ready" && !loaded) {
      loaded = true;
      const ep = episode.state.episode;
      if (ep.scenes && ep.scenes.length > 0) {
        scenes.load(ep.scenes);
      } else if (ep.pipeline) {
        scenes.load(ep.stages.map((s, i) => ({
          id: s.id,
          index: i,
          title: s.name,
          intent: s.status,
          role: "narrator" as const,
          durationSeconds: 15,
          status: s.status === "completed" ? "ready" : s.status === "running" ? "generating" : "idle",
          stale: false,
          selectedAssetId: null,
          attemptCount: s.status === "completed" ? 1 : 0,
          narrationStatus: s.status === "completed" ? "ready" : "idle",
          captionsStatus: "idle" as const,
          transition: "cut" as const,
        })));
      } else {
        scenes.load([]);
      }
      narration.load(NARRATION_FIXTURE, VOICE_FIXTURE);
    }
  });
</script>

<div class="scene-viewer">
  <div class="sv-tabs" role="tablist" aria-label="Production details">
    <button
      class="sv-tab"
      role="tab"
      aria-selected={tab === "storyboard"}
      onclick={() => tab = "storyboard"}
    >
      Storyboard
    </button>
    <button
      class="sv-tab"
      role="tab"
      aria-selected={tab === "narration"}
      onclick={() => tab = "narration"}
    >
      Narration
    </button>
    <button
      class="sv-tab"
      role="tab"
      aria-selected={tab === "render"}
      onclick={() => tab = "render"}
    >
      Render
    </button>
  </div>

  <div class="sv-content">
    {#if tab === "storyboard"}
      <Storyboard />
    {:else if tab === "narration"}
      <NarrationPanel />
    {:else}
      <RenderViewer />
    {/if}
  </div>
</div>

<style>
  .scene-viewer {
    border-top: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    display: flex;
    flex-direction: column;
  }

  .sv-tabs {
    display: flex;
    border-bottom: 1px solid var(--vs-border);
    padding: 0 var(--vs-space-4);
  }

  .sv-tab {
    padding: var(--vs-space-2) var(--vs-space-3);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    cursor: pointer;
    margin-bottom: -1px;
  }

  .sv-tab:hover {
    color: var(--vs-text-primary);
  }

  .sv-tab[aria-selected="true"] {
    color: var(--vs-accent);
    border-bottom-color: var(--vs-accent);
  }

  .sv-content {
    overflow-y: auto;
    max-height: 45vh;
  }
</style>
