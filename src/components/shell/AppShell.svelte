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
</script>

<svelte:head>
  <link rel="stylesheet" href="/src/tokens/design-tokens.css" />
</svelte:head>

<div class="app-shell" data-theme={theme}>
  <Header {episodeTitle} {connected} />
  <div class="app-body">
    <StructureRail />
    <ProductionCanvas />
    <ContextInspector />
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
    grid-template-columns:
      var(--vs-region-structure-width) 1fr var(--vs-region-inspector-width);
    overflow: hidden;
  }

  @media (max-width: 1024px) {
    .app-body {
      grid-template-columns: 1fr;
    }
  }
</style>
