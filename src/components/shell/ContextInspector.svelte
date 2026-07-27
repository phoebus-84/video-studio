<script lang="ts">
  import { assets } from "$lib/asset-store.svelte.ts";
  import { ASSETS_FIXTURE } from "$lib/asset-fixtures";
  import type { AssetGroup } from "$lib/asset-types";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import AssetPanel from "../assets/AssetPanel.svelte";
  import ReviewInbox from "../review/ReviewInbox.svelte";
  import ProgressPanel from "../status/ProgressPanel.svelte";
  import StalenessPanel from "../status/StalenessPanel.svelte";

  import { untrack } from "svelte";

  type Tab = "assets" | "reviews" | "status";
  let tab = $state<Tab>("assets");

  // Build asset groups from scenes if fixtures don't cover them
  $effect(() => {
    if (scenes.scenes.length > 0) {
      const fixtureIds = new Set(ASSETS_FIXTURE.map((g) => g.sceneId));
      const missing = scenes.scenes.filter((s) => !fixtureIds.has(s.id));

      if (missing.length > 0) {
        // Build lightweight asset groups from scene data
        const generated: AssetGroup[] = missing.map((scene) => ({
          sceneId: scene.id,
          sceneTitle: scene.title,
          attempts: [{
            id: `gen-${scene.id}-1`,
            sceneId: scene.id,
            prompt: scene.intent ?? `Asset for ${scene.title}`,
            referenceImages: [],
            provider: "fal.ai",
            model: "flux-dev-v1",
            seed: 42,
            dimensions: { width: 1920, height: 1080 },
            cost: 0,
            license: "pending",
            createdAt: new Date().toISOString(),
            selected: true,
            filePath: null,
            fileAvailable: false,
          }],
        }));
        assets.load([...ASSETS_FIXTURE, ...generated]);
      } else if (assets.groups.length === 0) {
        assets.load(ASSETS_FIXTURE);
      }
    }
  });

  // Select the asset group when a scene is selected
  $effect(() => {
    const sceneId = scenes.selectedSceneId;
    if (sceneId) {
      untrack(() => {
        assets.selectGroup(sceneId);
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
    {#if tab === "assets" && assets.selectedGroup}
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
