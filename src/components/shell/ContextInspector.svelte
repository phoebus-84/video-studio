<script lang="ts">
  import { assets as assetStore } from "$lib/asset-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import type { AssetGroup } from "$lib/asset-types";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import AssetPanel from "../assets/AssetPanel.svelte";
  import ReviewInbox from "../review/ReviewInbox.svelte";
  import ProgressPanel from "../status/ProgressPanel.svelte";
  import StalenessPanel from "../status/StalenessPanel.svelte";

  import { untrack } from "svelte";

  type Tab = "assets" | "reviews" | "status";
  let tab = $state<Tab>("assets");

  // Build asset groups from episode scenes + real image URLs.
  // Rebuilds whenever episodes or scenes change.
  $effect(() => {
    if (episode.state.phase !== "ready") return;
    const sceneList = scenes.scenes;
    if (sceneList.length === 0) return;

    const imgUrls = episode.assets.images;
    const narUrls = episode.assets.narration;
    untrack(() => {
      const generated: AssetGroup[] = sceneList.map((scene) => {
        const imgUrl = imgUrls[scene.id] ?? null;
        const narUrl = narUrls[scene.id] ?? null;
        const hasNarration = narUrl != null;

        return {
          sceneId: scene.id,
          sceneTitle: scene.title,
          attempts: [
            // Image attempt
            {
              id: `img-${scene.id}`,
              sceneId: scene.id,
              kind: "image" as const,
              prompt: scene.intent ?? `Image for ${scene.title}`,
              referenceImages: [],
              provider: "fal.ai",
              model: "flux-schnell",
              seed: null,
              dimensions: { width: 1920, height: 1080 },
              cost: null,
              license: imgUrl ? "generated" : "pending",
              createdAt: new Date().toISOString(),
              selected: true,
              imageUrl: imgUrl,
              filePath: imgUrl,
              fileAvailable: imgUrl != null,
              state: imgUrl ? "ready" as const : "generating" as const,
              anchorType: "assets" as const,
            },
            // Narration audio attempt
            {
              id: `nar-${scene.id}`,
              sceneId: scene.id,
              kind: "audio" as const,
              prompt: `Narration for scene "${scene.title}" (${scene.durationSeconds ?? 10}s)`,
              referenceImages: [],
              provider: "Qwen3-TTS",
              model: "0.6B-4bit",
              seed: null,
              dimensions: { width: 0, height: 0 },
              cost: null,
              license: hasNarration ? "synthesized" : "pending",
              createdAt: new Date().toISOString(),
              selected: false,
              imageUrl: null,
              audioUrl: narUrl,
              filePath: narUrl,
              fileAvailable: hasNarration,
              state: hasNarration ? "ready" as const : "generating" as const,
              anchorType: "narration" as const,
            },
          ],
        };
      });
      assetStore.load(generated);
    });
  });

  // Select the asset group when a scene is selected
  $effect(() => {
    const sceneId = scenes.selectedSceneId;
    if (sceneId) {
      untrack(() => {
        assetStore.selectGroup(sceneId);
        tab = "assets";
      });
    }
  });
</script>

<aside class="context-inspector" aria-label="Contextual inspector">
  <div class="ci-tabs" role="tablist" aria-label="Inspector panels">
    <button
      class="ci-tab"
      role="tab"
      aria-selected={tab === "assets"}
      onclick={() => tab = "assets"}
    >
      Assets
    </button>
    <button
      class="ci-tab"
      role="tab"
      aria-selected={tab === "reviews"}
      onclick={() => tab = "reviews"}
    >
      Reviews
    </button>
    <button
      class="ci-tab"
      role="tab"
      aria-selected={tab === "status"}
      onclick={() => tab = "status"}
    >
      Status
    </button>
  </div>

  <div class="ci-content">
    {#if tab === "assets" && assetStore.selectedGroup}
      <AssetPanel />
    {:else if tab === "reviews"}
      <ReviewInbox />
    {:else if tab === "status"}
      <ProgressPanel />
      <StalenessPanel />
    {:else}
      <div class="inspector-empty">
        <p>Select a scene to inspect assets.</p>
      </div>
    {/if}
  </div>
</aside>

<style>
  .context-inspector {
    background: var(--vs-bg-surface);
    border-left: 1px solid var(--vs-border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .ci-tabs {
    display: flex;
    border-bottom: 1px solid var(--vs-border);
  }

  .ci-tab {
    flex: 1;
    padding: var(--vs-space-2);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    cursor: pointer;
    margin-bottom: -1px;
  }

  .ci-tab:hover {
    color: var(--vs-text-primary);
  }

  .ci-tab[aria-selected="true"] {
    color: var(--vs-accent);
    border-bottom-color: var(--vs-accent);
  }

  .ci-content {
    flex: 1;
    overflow-y: auto;
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
