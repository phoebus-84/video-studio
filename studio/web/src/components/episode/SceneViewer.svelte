<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import { untrack } from "svelte";
  import Storyboard from "../storyboard/Storyboard.svelte";
  import NarrationPanel from "../narration/NarrationPanel.svelte";
  import RenderViewer from "../render/RenderViewer.svelte";

  type Tab = "storyboard" | "narration" | "render";
  let tab = $state<Tab>("storyboard");
  let loaded = false;

  // Auto-switch tab when a pipeline stage is selected
  $effect(() => {
    const stageId = episode.selectedStageId;
    if (stageId && episode.state.phase === "ready") {
      untrack(() => {
        if (stageId === "narration") {
          tab = "narration";
        } else if (stageId === "render") {
          tab = "render";
        } else {
          tab = "storyboard";
        }
      });
    }
  });

  // Populate the scene store only when it is empty (fixture path). When data
  // came from the gateway, loadFromGateway already loaded enriched scenes;
  // reloading here would discard narrationStatus/captionsStatus.
  $effect(() => {
    if (episode.state.phase === "ready" && !loaded && scenes.scenes.length === 0) {
      loaded = true;
      const ep = episode.state.episode;
      if (ep.scenes && ep.scenes.length > 0) {
        scenes.load(ep.scenes.map((s: any, i: number) => ({
          id: s.id ?? `s${i + 1}`,
          index: i,
          title: s.title ?? `Scene ${i + 1}`,
          intent: s.intent ?? "",
          role: (s.role ?? "narrator") as any,
          durationSeconds: s.durationSeconds ?? 10,
          status: (s.narration?.status === "completed" ? "completed" : "idle") as any,
          stale: s.stale ?? false,
          selectedAssetId: s.id ?? `s${i + 1}`,
          attemptCount: s.attemptCount ?? 0,
          narrationStatus: (s.narration?.status ?? "idle") as any,
          captionsStatus: (s.captions?.count > 0 ? "completed" : "idle") as any,
          transition: (s.transition ?? "cut") as any,
          assetUrl: s.asset?.url ?? null,
          narrationUrl: s.narration?.url ?? null,
          narrationDuration: s.narration?.durationSeconds ?? s.durationSeconds ?? 10,
        })));
      }
    }
  });

  /* Keyboard power path: j/k moves scene selection, 1/2/3 switches tabs.
     Inert while typing in a field or holding a modifier. */
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const list = scenes.scenes;
    if (e.key === "1") { tab = "storyboard"; return; }
    if (e.key === "2") { tab = "narration"; return; }
    if (e.key === "3") { tab = "render"; return; }
    if (list.length === 0) return;
    if (e.key !== "j" && e.key !== "k") return;
    e.preventDefault();
    const idx = list.findIndex((s) => s.id === scenes.selectedSceneId);
    const next =
      idx === -1
        ? (e.key === "j" ? 0 : list.length - 1)
        : e.key === "j"
          ? Math.min(idx + 1, list.length - 1)
          : Math.max(idx - 1, 0);
    scenes.select(list[next]!.id);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="scene-viewer">
  <div class="sv-tabs" role="tablist" aria-label="Production details">
    <button
      class="sv-tab"
      role="tab"
      aria-selected={tab === "storyboard"}
      onclick={() => tab = "storyboard"}
      aria-keyshortcuts="1"
    >
      Storyboard <kbd class="sv-kbd">1</kbd>
    </button>
    <button
      class="sv-tab"
      role="tab"
      aria-selected={tab === "narration"}
      onclick={() => tab = "narration"}
      aria-keyshortcuts="2"
    >
      Narration <kbd class="sv-kbd">2</kbd>
    </button>
    <button
      class="sv-tab"
      role="tab"
      aria-selected={tab === "render"}
      onclick={() => tab = "render"}
      aria-keyshortcuts="3"
    >
      Render <kbd class="sv-kbd">3</kbd>
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

  .sv-kbd {
    font-family: var(--vs-font-mono);
    font-size: 9px;
    color: var(--vs-text-disabled);
    border: 1px solid var(--vs-border);
    border-radius: 3px;
    padding: 0 3px;
    margin-left: 2px;
  }

  .sv-content {
    overflow-y: auto;
    max-height: 45vh;
  }
</style>
