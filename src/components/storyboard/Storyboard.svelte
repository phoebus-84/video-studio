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

  function statusLabel(status: string): string {
    if (status === "ready" || status === "completed") return "done";
    if (status === "stale") return "stale";
    if (status === "generating" || status === "running") return "running";
    if (status === "failed" || status === "missing") return "failed";
    return "—";
  }

  function assetKindLabel(scene: (typeof scenes.scenes)[number]): string {
    if (scene.assetUrl) {
      if (scene.kind === "terminal-demo" || scene.assetUrl.endsWith(".mp4") || scene.assetUrl.endsWith(".webm")) return "video";
      return "image";
    }
    return "";
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

  function kindLabel(scene: (typeof scenes.scenes)[number]): string {
    const kind = detectSceneKind(scene);
    if (!kind) return "—";
    return SCENE_KIND_LABELS[kind] ?? kind;
  }

  function transitionLabel(transition: string | null): string {
    if (!transition) return "";
    return TRANSITION_LABELS[transition as keyof typeof TRANSITION_LABELS] ?? transition;
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
            <td class="sb-cell sb-kind">{kindLabel(scene)}</td>
            <td class="sb-cell sb-time">{formatTime(scene.narrationDuration ?? scene.durationSeconds)}</td>
            <td class="sb-cell">
              {#if scene.assetUrl}
                <span class="sb-kind-chip">{assetKindLabel(scene)}</span>
              {:else}
                <span class="sb-asset-missing">—</span>
              {/if}
            </td>
            <td class="sb-cell">
              <span class="sb-badge" data-status={scene.narrationStatus}>
                {statusLabel(scene.narrationStatus)}
              </span>
            </td>
            <td class="sb-cell">
              <span class="sb-badge" data-status={scene.captionsStatus}>
                {statusLabel(scene.captionsStatus)}
              </span>
            </td>
            <td class="sb-cell sb-transition">
              {#if scene.transition}
                {transitionLabel(scene.transition)}
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

  .sb-kind-chip {
    font-family: var(--vs-font-mono);
    font-size: 10px;
    color: var(--vs-text-secondary);
    background: var(--vs-bg-raised);
    border: 1px solid var(--vs-border);
    padding: 1px var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
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

  .sb-badge[data-status="ready"],
  .sb-badge[data-status="completed"] {
    color: var(--vs-state-current);
  }

  .sb-badge[data-status="failed"] {
    color: var(--vs-state-blocked);
  }

  .sb-badge[data-status="running"] {
    color: var(--vs-state-running);
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
