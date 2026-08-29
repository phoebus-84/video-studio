<script lang="ts">
  import Header from "./Header.svelte";
  import StatusStrip from "./StatusStrip.svelte";
  import StructureRail from "./StructureRail.svelte";
  import ProductionCanvas from "./ProductionCanvas.svelte";
  import ContextInspector from "./ContextInspector.svelte";
  import OfflineBanner from "./OfflineBanner.svelte";
  import PanelDivider from "./PanelDivider.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";
  import { displayStatus } from "$lib/library-types";
  import type { LevelRollup } from "$lib/production-status";
  import type { ResolvedEpisode } from "$lib/library-types";

  interface Props {
    connected: boolean;
    theme: "light" | "dark";
  }

  let { connected = false, theme = "light" }: Props = $props();

  const currentEpisode = $derived(
    episode.state.phase === "ready" ? episode.state.episode : null,
  );

  /* With a channel or series selected there is no episode to report on, so the
     strip summarises what is underneath instead of saying nothing useful. */
  const rollup = $derived.by((): LevelRollup | null => {
    let episodes: ResolvedEpisode[] = [];
    let label = "";

    if (library.selectedChannel) {
      const channel = library.tree.channels.find(
        (c) => c.slug === library.selectedChannel,
      );
      if (!channel) return null;
      episodes = channel.series.flatMap((s) => s.episodes);
      label = channel.title;
    } else if (library.selectedSeries) {
      const { channel, series } = library.selectedSeries;
      const entry = library.tree.channels
        .find((c) => c.slug === channel)
        ?.series.find((s) => s.slug === series);
      if (!entry) return null;
      episodes = entry.episodes;
      label = entry.title;
    } else {
      return null;
    }

    const states = episodes.map(displayStatus);
    return {
      label,
      total: episodes.length,
      running: states.filter((s) => s === "running").length,
      blocked: states.filter((s) => s === "blocked" || s === "failed").length,
      stale: states.filter((s) => s === "stale").length,
    };
  });

  /**
   * Actions offered by the status strip and the palette.
   *
   * They are resolved here because the strip should not know how to navigate
   * and the palette should not know what a rerun is. Actions that need a
   * runtime call the studio cannot yet make say so on the agent status line
   * rather than doing nothing when clicked.
   */
  function runAction(id: string) {
    switch (id) {
      case "open-render":
        studio.show("render");
        break;
      case "open-log":
        studio.inspectorTab = "logs";
        break;
      case "show-stale":
        studio.inspectorTab = "run";
        break;
      case "reconnect":
        location.reload();
        break;
      case "rerun-affected":
      case "retry":
      case "run":
      case "pause":
      case "accept":
      case "reveal":
      case "read-only":
        studio.agentStatus = {
          kind: "unavailable",
          text: `“${id}” is not wired to the runtime yet — ask Pi below instead.`,
        };
        break;
      default:
        break;
    }
  }

  /* ⌘K / Ctrl+K anywhere opens the palette; Escape closes it. Bound on the
     window so it works regardless of what has focus. */
  function onKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === "k" || key === "p")) {
      event.preventDefault();
      studio.togglePalette();
    } else if (event.key === "Escape" && studio.paletteOpen) {
      event.preventDefault();
      studio.closePalette();
    }
  }

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

<svelte:window onkeydown={onKeydown} />

<div class="app-shell" data-theme={theme}>
  <Header {connected} episode={currentEpisode} />

  <StatusStrip {connected} episode={currentEpisode} {rollup} onaction={runAction} />

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

  <CommandPalette onaction={runAction} />
</div>

<style>
  .app-shell {
    display: grid;
    /* header · status strip · body · offline banner */
    grid-template-rows: var(--vs-header-height) var(--vs-strip-height) 1fr auto;
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
