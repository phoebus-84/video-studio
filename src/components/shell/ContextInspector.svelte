<script lang="ts">
  import { assets } from "$lib/asset-store.svelte.ts";
  import { ASSETS_FIXTURE } from "$lib/asset-fixtures";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import AssetPanel from "../assets/AssetPanel.svelte";

  /* Load assets when a scene is selected in the storyboard. */
  $effect(() => {
    const sceneId = scenes.selectedSceneId;
    if (sceneId) {
      assets.load(ASSETS_FIXTURE);
      assets.selectGroup(sceneId);
    }
  });
</script>

<aside class="context-inspector" aria-label="Contextual inspector">
  {#if assets.selectedGroup}
    <AssetPanel />
  {:else}
    <div class="inspector-empty">
      <p>Select an artifact, scene, asset, or stage to inspect details.</p>
    </div>
  {/if}
</aside>

<style>
  .context-inspector {
    background: var(--vs-bg-surface);
    border-left: 1px solid var(--vs-border);
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
