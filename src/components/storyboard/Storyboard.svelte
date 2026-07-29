<script lang="ts">
  import { scenes } from "$lib/scene-store.svelte.ts";
  import { assets as assetStore } from "$lib/asset-store.svelte.ts";
  import { TRANSITION_LABELS, SCENE_KIND_LABELS, type SceneKind } from "$lib/scene-types";

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function selectScene(id: string) {
    scenes.select(id);
    assetStore.selectGroup(id);
  }

  function statusSymbol(status: string): string {
    if (status === "ready") return "✓";
    if (status === "stale") return "⚠";
    if (status === "generating") return "◎";
    return "—";
  }

  function assetIcon(scene: (typeof scenes.scenes)[number]): string {
    if (scene.assetUrl) {
      // Determine from scene kind or URL extension
      if (scene.kind === "terminal-demo" || scene.assetUrl.endsWith(".mp4")) return "▶";
      return "🖼";
    }
    return "—";
  }

  function detectSceneKind(scene: (typeof scenes.scenes)[number]): SceneKind | undefined {
    if (scene.kind && (scene.kind as string) in SCENE_KIND_LABELS) return scene.kind as SceneKind;
    // Heuristic detection from intent keywords
    const intent = (scene.intent ?? "").toLowerCase();
    if (/terminal|shell|cli|command|code walkthrough|screencast/.test(intent)) return "terminal-demo";
    if (/title card|opener/.test(intent)) return "title-card";
    if (/end card|outro/.test(intent)) return "end-card";
    if (/diagram|architecture|layered/.test(intent)) return "diagram";
    return "illustration";
  }
</script>

<div class="storyboard" aria-label="Scene storyboard">
  <div class="sb-header">
    <h3 class="sb-title">Storyboard</h3>
    <span class="sb-duration">
      {scenes.scenes.length} scenes · {formatTime(scenes.totalDuration)}
    </span>
  </div>

  <div class="sb-table-wrap">
    <table class="sb-table" aria-label="Scenes">
      <thead>
        <tr>
          <th aria-label="Scene number">#</th>
          <th>Scene</th>
          <th>Kind</th>
          <th>Duration</th>
          <th>Asset</th>
          <th>Narration</th>
          <th>Captions</th>
          <th>Transition</th>
        </tr>
      </thead>
      <tbody>
        {#each scenes.scenes as scene (scene.id)}
          <tr
            class="sb-row"
            class:selected={scene.id === scenes.selectedSceneId}
            class:stale={scene.stale}
            onclick={() => selectScene(scene.id)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectScene(scene.id);
              }
            }}
            tabindex="0"
            aria-selected={scene.id === scenes.selectedSceneId}
          >
            <td class="sb-cell sb-idx">{scene.index + 1}</td>
            <td class="sb-cell sb-name">
              <span class="sb-scene-title">{scene.title}</span>
              <span class="sb-intent">{scene.intent}</span>
            </td>
            <td class="sb-cell sb-kind">{SCENE_KIND_LABELS[detectSceneKind(scene)] ?? detectSceneKind(scene)}</td>
            <td class="sb-cell sb-time">{formatTime(scene.narrationDuration ?? scene.durationSeconds)}</td>
            <td class="sb-cell">
              {#if scene.assetUrl}
                <span class="sb-asset-selected">{assetIcon(scene)}</span>
              {:else if scene.selectedAssetId}
                <span class="sb-asset-selected">{scene.selectedAssetId.slice(0, 8)}</span>
              {:else}
                <span class="sb-asset-missing">—</span>
              {/if}
            </td>
            <td class="sb-cell">
              <span class="sb-badge" data-status={scene.narrationStatus}>
                {statusSymbol(scene.narrationStatus)}
              </span>
            </td>
            <td class="sb-cell">
              <span class="sb-badge" data-status={scene.captionsStatus}>
                {statusSymbol(scene.captionsStatus)}
              </span>
            </td>
            <td class="sb-cell sb-transition">
              {#if scene.transition}
                {TRANSITION_LABELS[scene.transition] ?? scene.transition}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .storyboard {
    padding: var(--vs-space-4);
  }

  .sb-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--vs-space-3);
  }

  .sb-title {
    font-size: var(--vs-text-md);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0;
    color: var(--vs-text-primary);
  }

  .sb-duration {
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
  }

  .sb-table-wrap {
    overflow-x: auto;
  }

  .sb-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--vs-text-sm);
  }

  .sb-table th {
    text-align: left;
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-medium);
    color: var(--vs-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: var(--vs-space-2) var(--vs-space-3);
    border-bottom: 1px solid var(--vs-border);
    white-space: nowrap;
  }

  .sb-row {
    cursor: pointer;
    border-bottom: 1px solid var(--vs-border);
    transition: background var(--vs-duration-fast) var(--vs-ease-standard);
  }

  .sb-row:hover {
    background: var(--vs-bg-hover);
  }

  .sb-row:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: -2px;
  }

  .sb-row.selected {
    background: var(--vs-accent-subtle);
  }

  .sb-row.stale {
    opacity: 0.6;
  }

  .sb-cell {
    padding: var(--vs-space-2) var(--vs-space-3);
    vertical-align: top;
  }

  .sb-idx {
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
    width: 2ch;
  }

  .sb-name {
    min-width: 180px;
  }

  .sb-scene-title {
    display: block;
    font-weight: var(--vs-font-weight-medium);
    color: var(--vs-text-primary);
  }

  .sb-intent {
    display: block;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-top: 2px;
  }

  .sb-role {
    color: var(--vs-text-secondary);
    white-space: nowrap;
  }

  .sb-time {
    font-family: var(--vs-font-mono);
    color: var(--vs-text-secondary);
    white-space: nowrap;
  }

  .sb-transition {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .sb-asset-selected {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-accent);
  }

  .sb-attempt-count {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-left: var(--vs-space-1);
  }

  .sb-asset-unselected {
    font-size: var(--vs-text-xs);
    color: var(--vs-state-attention);
  }

  .sb-asset-missing {
    color: var(--vs-text-disabled);
  }

  .sb-badge {
    font-size: var(--vs-text-xs);
  }

  .sb-badge[data-status="ready"] {
    color: var(--vs-state-current);
  }

  .sb-badge[data-status="stale"] {
    color: var(--vs-state-stale);
  }

  .sb-badge[data-status="missing"] {
    color: var(--vs-text-disabled);
  }

  .sb-badge[data-status="generating"] {
    color: var(--vs-state-running);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sb-badge[data-status="generating"] {
      animation: none;
    }
  }
</style>
