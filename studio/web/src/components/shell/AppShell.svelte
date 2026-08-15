<script lang="ts">
  import Header from "./Header.svelte";
  import StructureRail from "./StructureRail.svelte";
  import ProductionCanvas from "./ProductionCanvas.svelte";
  import ContextInspector from "./ContextInspector.svelte";
  import OfflineBanner from "./OfflineBanner.svelte";
  import PanelDivider from "./PanelDivider.svelte";

  interface Props {
    connected: boolean;
    theme: "light" | "dark";
    episodeTitle?: string;
  }

  let { connected = false, theme = "light", episodeTitle }: Props = $props();

  /**
   * Panel layout: collapsible, resizable, and remembered.
   *
   * The shell was a fixed three-column grid with no way to reclaim space, so on
   * a wide screen most of the window sat empty while the canvas stayed boxed
   * in — and every reload put it back.
   */
  const STORAGE_KEY = "vs-panels";

  const STRUCTURE_MIN = 180;
  const STRUCTURE_MAX = 560;
  const INSPECTOR_MIN = 240;
  const INSPECTOR_MAX = 720;

  let structureOpen = $state(true);
  let inspectorOpen = $state(true);
  let structureWidth = $state(260);
  let inspectorWidth = $state(340);

  /* Restore once on mount. */
  $effect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      if (typeof saved.structure === "boolean") structureOpen = saved.structure;
      if (typeof saved.inspector === "boolean") inspectorOpen = saved.inspector;
      if (typeof saved.structureWidth === "number") structureWidth = saved.structureWidth;
      if (typeof saved.inspectorWidth === "number") inspectorWidth = saved.inspectorWidth;
    } catch { /* first run, or unreadable storage */ }
  });

  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          structure: structureOpen,
          inspector: inspectorOpen,
          structureWidth,
          inspectorWidth,
        }),
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

  function resizeStructure(width: number) {
    // Dragging a collapsed panel's edge reopens it; otherwise the drag would
    // set a width nobody can see.
    if (!structureOpen) structureOpen = true;
    structureWidth = width;
    persist();
  }

  function resizeInspector(width: number) {
    if (!inspectorOpen) inspectorOpen = true;
    inspectorWidth = width;
    persist();
  }

  /* Columns: structure, divider, canvas, divider, inspector. */
  const columns = $derived(
    `${structureOpen ? `${structureWidth}px` : "0px"} 14px 1fr 14px ` +
      `${inspectorOpen ? `${inspectorWidth}px` : "0px"}`,
  );
</script>

<svelte:head>
  <link rel="stylesheet" href="/src/tokens/design-tokens.css" />
</svelte:head>

<div class="app-shell" data-theme={theme}>
  <Header {episodeTitle} {connected} />

  <div class="app-body" style="grid-template-columns: {columns}">
    <div class="panel" class:hidden={!structureOpen}>
      <StructureRail />
    </div>

    <PanelDivider
      width={structureWidth}
      min={STRUCTURE_MIN}
      max={STRUCTURE_MAX}
      open={structureOpen}
      side="left"
      label="Library panel"
      onresize={resizeStructure}
      ontoggle={toggleStructure}
    />

    <ProductionCanvas />

    <PanelDivider
      width={inspectorWidth}
      min={INSPECTOR_MIN}
      max={INSPECTOR_MAX}
      open={inspectorOpen}
      side="right"
      label="Inspector panel"
      onresize={resizeInspector}
      ontoggle={toggleInspector}
    />

    <div class="panel" class:hidden={!inspectorOpen}>
      <ContextInspector />
    </div>
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

  .app-body {
    display: grid;
    overflow: hidden;
    min-height: 0;
  }

  .panel {
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* Collapsed panels keep their component mounted, so reopening does not
     reload the tree or lose scroll position. */
  .panel.hidden {
    display: none;
  }

  @media (max-width: 1024px) {
    .app-body {
      grid-template-columns: 1fr !important;
    }
  }
</style>
