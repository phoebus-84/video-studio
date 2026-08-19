<script lang="ts">
  /**
   * The inspector answers questions about whatever the canvas is showing:
   * where it came from, how it changed, what happened, and what was said.
   *
   * The subject line at the top is load-bearing. Without it the panel is four
   * tabs of context with no statement of what they are context *for*, and the
   * inspector silently retargets as the selection moves.
   *
   * "Run" keeps the asset, review and progress panels the studio already had.
   * They answer a different question — what is this production doing — and
   * folding them in here keeps them reachable rather than deleting working
   * surfaces to match a screen that did not mention them.
   */
  import { studio, type InspectorTab } from "$lib/studio-store.svelte.ts";
  import { files } from "$lib/files-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";

  import ProvenancePanel from "../inspector/ProvenancePanel.svelte";
  import VersionsPanel from "../inspector/VersionsPanel.svelte";
  import LogsPanel from "../inspector/LogsPanel.svelte";
  import ReviewInbox from "../review/ReviewInbox.svelte";
  import AssetPanel from "../assets/AssetPanel.svelte";
  import ProductionPanel from "../episode/ProductionPanel.svelte";
  import ProgressPanel from "../status/ProgressPanel.svelte";
  import StalenessPanel from "../status/StalenessPanel.svelte";
  import { buildAssetGroups } from "$lib/asset-groups";
  import { assets as assetStore } from "$lib/asset-store.svelte.ts";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import { untrack } from "svelte";

  /* Keep the asset store in step with the episode's scenes. Every field comes
     from disk truth: files the gateway found, real mtimes, real narration text.
     Unknown fields stay null and the panel hides them. */
  $effect(() => {
    if (episode.state.phase !== "ready") return;
    const epScenes = (episode.state.episode.scenes ?? []) as Record<string, unknown>[];
    if (epScenes.length === 0) return;

    const texts = episode.narrationTexts;
    const base = episode.assets;
    untrack(() => assetStore.load(buildAssetGroups(epScenes, texts, base)));
  });

  /* Selecting a scene is a request to look at its assets. */
  $effect(() => {
    const sceneId = scenes.selectedSceneId;
    if (!sceneId) return;
    untrack(() => {
      assetStore.selectGroup(sceneId);
      studio.inspectorTab = "run";
    });
  });

  const TABS: { key: InspectorTab; label: string }[] = [
    { key: "provenance", label: "Provenance" },
    { key: "versions", label: "Versions" },
    { key: "logs", label: "Logs" },
    { key: "comments", label: "Comments" },
    { key: "run", label: "Run" },
  ];

  /** What the panel is currently about, named exactly. */
  const subject = $derived.by(() => {
    if (studio.view === "files" && files.selectedPath) return files.selectedPath;
    if (studio.level === "episode") {
      const ep = episode.state.phase === "ready" ? episode.state.episode : null;
      const stage = episode.selectedStageId;
      if (ep && stage) return `${ep.slug} · ${stage}`;
      if (ep) return `episode · ${ep.slug}`;
      return "no episode selected";
    }
    if (studio.level === "series" && library.selectedSeries) {
      return `series · ${library.selectedSeries.series}`;
    }
    if (studio.level === "channel" && library.selectedChannel) {
      return `channel · ${library.selectedChannel}`;
    }
    return "nothing selected";
  });
</script>

<aside class="context-inspector" aria-label="Contextual inspector">
  <div class="ci-tabs" role="tablist" aria-label="Inspector panels">
    {#each TABS as tabDef (tabDef.key)}
      <button
        class="ci-tab"
        role="tab"
        aria-selected={studio.inspectorTab === tabDef.key}
        onclick={() => (studio.inspectorTab = tabDef.key)}
      >
        {tabDef.label}
      </button>
    {/each}
  </div>

  <div class="ci-subject">
    <span class="ci-subject-label">about</span>
    <span class="ci-subject-value" title={subject}>{subject}</span>
  </div>

  <div class="ci-content">
    {#if studio.inspectorTab === "provenance"}
      <ProvenancePanel />
    {:else if studio.inspectorTab === "versions"}
      <VersionsPanel />
    {:else if studio.inspectorTab === "logs"}
      <LogsPanel />
    {:else if studio.inspectorTab === "comments"}
      <ReviewInbox />
    {:else}
      {#if assetStore.selectedGroup}
        <AssetPanel />
      {/if}
      <ProductionPanel />
      <ProgressPanel />
      <StalenessPanel />
    {/if}
  </div>
</aside>

<style>
  .context-inspector {
    background: var(--vs-bg-surface);
    border-left: 1px solid var(--vs-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .ci-tabs {
    display: flex;
    border-bottom: 1px solid var(--vs-border);
    flex-shrink: 0;
  }

  .ci-tab {
    flex: 1;
    padding: 9px 2px;
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
    color: var(--vs-accent-strong);
    border-bottom-color: var(--vs-accent-strong);
  }

  .ci-subject {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    padding: 7px var(--vs-space-3);
    border-bottom: 1px solid var(--vs-border-subtle);
    min-width: 0;
    flex-shrink: 0;
  }

  .ci-subject-label {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .ci-subject-value {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ci-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  @media (max-width: 1024px) {
    .context-inspector {
      display: none;
    }
  }
</style>
