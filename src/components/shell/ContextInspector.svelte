<script lang="ts">
  import { assets } from "$lib/asset-store.svelte.ts";
  import { ASSETS_FIXTURE } from "$lib/asset-fixtures";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import AssetPanel from "../assets/AssetPanel.svelte";
  import ReviewInbox from "../review/ReviewInbox.svelte";
  import ProgressPanel from "../status/ProgressPanel.svelte";
  import StalenessPanel from "../status/StalenessPanel.svelte";

  type Tab = "assets" | "reviews" | "status";
  let tab = $state<Tab>("assets");

  $effect(() => {
    const sceneId = scenes.selectedSceneId;
    if (sceneId) {
      assets.load(ASSETS_FIXTURE);
      assets.selectGroup(sceneId);
      tab = "assets";
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
