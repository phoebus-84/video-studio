<script lang="ts">
  import Header from "./Header.svelte";
  import StructureRail from "./StructureRail.svelte";
  import ProductionCanvas from "./ProductionCanvas.svelte";
  import ContextInspector from "./ContextInspector.svelte";
  import OfflineBanner from "./OfflineBanner.svelte";

  interface Props {
    connected: boolean;
    theme: "light" | "dark";
    episodeTitle?: string;
  }

  let { connected = false, theme = "light", episodeTitle }: Props = $props();

  /**
   * Side panels collapse, and the choice survives a reload.
   *
   * The shell used to be a fixed three-column grid with no way to reclaim
   * space, so on a wide screen most of the window was empty while the canvas
   * stayed boxed in.
   */
  const STORAGE_KEY = "vs-panels";

  let structureOpen = $state(true);
  let inspectorOpen = $state(true);

  $effect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      if (typeof saved.structure === "boolean") structureOpen = saved.structure;
      if (typeof saved.inspector === "boolean") inspectorOpen = saved.inspector;
    } catch { /* first run, or unreadable storage */ }
  });

  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ structure: structureOpen, inspector: inspectorOpen }),
      );
    } catch { /* storage unavailable; the session still works */ }
  }

  function toggleStructure() {
    structureOpen = !structureOpen;
    persist();
  }

  function toggleInspector() {
    inspectorOpen = !inspectorOpen;
    persist();
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="/src/tokens/design-tokens.css" />
</svelte:head>

<div class="app-shell" data-theme={theme}>
  <Header {episodeTitle} {connected} />

  <div class="app-body" class:no-structure={!structureOpen} class:no-inspector={!inspectorOpen}>
    {#if structureOpen}
      <StructureRail />
    {/if}

    <button
      class="panel-toggle left"
      onclick={toggleStructure}
      aria-expanded={structureOpen}
      aria-label={structureOpen ? "Collapse library" : "Expand library"}
      title={structureOpen ? "Collapse library" : "Expand library"}
    >
      {structureOpen ? "‹" : "›"}
    </button>

    <ProductionCanvas />

    <button
      class="panel-toggle right"
      onclick={toggleInspector}
      aria-expanded={inspectorOpen}
      aria-label={inspectorOpen ? "Collapse inspector" : "Expand inspector"}
      title={inspectorOpen ? "Collapse inspector" : "Expand inspector"}
    >
      {inspectorOpen ? "›" : "‹"}
    </button>

    {#if inspectorOpen}
      <ContextInspector />
    {/if}
  </div>

  {#if !connected}
    <OfflineBanner />
  {/if}
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: var(--vs-header-height) 1fr auto;
    height: 100dvh;
    overflow: hidden;
    background: var(--vs-bg-canvas);
    color: var(--vs-text-primary);
    font-family: var(--vs-font-sans);
  }

  /* Columns: structure, its toggle, canvas, inspector toggle, inspector. */
  .app-body {
    display: grid;
    grid-template-columns:
      var(--vs-region-structure-width) 14px 1fr 14px var(--vs-region-inspector-width);
    overflow: hidden;
    min-height: 0;
  }

  .app-body.no-structure {
    grid-template-columns: 14px 1fr 14px var(--vs-region-inspector-width);
  }

  .app-body.no-inspector {
    grid-template-columns: var(--vs-region-structure-width) 14px 1fr 14px;
  }

  .app-body.no-structure.no-inspector {
    grid-template-columns: 14px 1fr 14px;
  }

  .panel-toggle {
    border: none;
    border-left: 1px solid var(--vs-border-subtle, #e5e5e5);
    border-right: 1px solid var(--vs-border-subtle, #e5e5e5);
    background: var(--vs-bg-panel, #fafafa);
    cursor: pointer;
    padding: 0;
    font-size: 11px;
    line-height: 1;
    color: var(--vs-text-secondary, #999);
  }

  .panel-toggle:hover {
    background: var(--vs-bg-hover, #eee);
    color: var(--vs-text-primary, #333);
  }

  @media (max-width: 1024px) {
    .app-body,
    .app-body.no-structure,
    .app-body.no-inspector,
    .app-body.no-structure.no-inspector {
      grid-template-columns: 1fr;
    }

    .panel-toggle {
      display: none;
    }
  }
</style>
