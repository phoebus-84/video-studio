<script lang="ts">
  import type { ResolvedStage } from "$lib/episode-types";
  import { episode } from "$lib/episode-store.svelte.ts";

  interface Props {
    stages: ResolvedStage[];
    selectedStageId: string | null;
  }

  let { stages, selectedStageId }: Props = $props();

  function select(id: string) {
    episode.selectStage(id);
  }
</script>

<nav class="stage-rail" aria-label="Pipeline stages">
  <ol class="stage-list">
    {#each stages as stage, i (stage.id)}
      {@const isLast = i === stages.length - 1}
      <li class="stage-li">
        <button
          class="stage-item"
          class:selected={stage.id === selectedStageId}
          class:running={stage.status === "running" && !stage.blocked}
          class:blocked={stage.blocked}
          class:stale={stage.stale}
          class:failed={stage.status === "failed"}
          class:completed={stage.status === "completed"}
          aria-current={stage.id === selectedStageId ? "step" : undefined}
          aria-label="{stage.name} — {stage.status}"
          onclick={() => select(stage.id)}
        >
          <span class="si-indicator" aria-hidden="true"></span>
          <span class="si-name">{stage.name}</span>
          {#if stage.blockedCode}
            <span class="si-code" aria-label="Error code">{stage.blockedCode}</span>
          {/if}
        </button>
        {#if !isLast}
          <span class="stage-connector" aria-hidden="true"></span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .stage-rail {
    padding: var(--vs-space-4);
    overflow-y: auto;
  }

  .stage-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
    row-gap: var(--vs-space-2);
    min-height: 0;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .stage-li {
    display: flex;
    align-items: center;
  }

  .stage-item {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding: var(--vs-space-2) var(--vs-space-3);
    background: var(--vs-bg-surface);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    cursor: pointer;
    transition:
      border-color var(--vs-duration-fast) var(--vs-ease-standard),
      background var(--vs-duration-fast) var(--vs-ease-standard);
    white-space: nowrap;
  }

  .stage-item:hover {
    background: var(--vs-bg-hover);
  }

  .stage-item:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: 1px;
  }

  .stage-item.selected {
    border-color: var(--vs-accent);
    background: var(--vs-accent-subtle);
    color: var(--vs-accent);
  }

  .stage-item.running {
    border-color: var(--vs-state-running);
    background: var(--vs-state-running-bg);
  }

  .stage-item.running .si-indicator {
    background: var(--vs-state-running);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .stage-item.blocked {
    border-color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
  }

  .stage-item.stale {
    border-style: dashed;
    border-color: var(--vs-state-stale);
  }

  .stage-item.failed {
    border-color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
  }

  .stage-item.completed {
    border-color: var(--vs-state-current);
  }

  .si-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vs-text-disabled);
    flex-shrink: 0;
  }

  .stage-item.completed .si-indicator {
    background: var(--vs-state-current);
  }

  .stage-item.blocked .si-indicator,
  .stage-item.failed .si-indicator {
    background: var(--vs-state-blocked);
  }

  .stage-item.stale .si-indicator {
    background: var(--vs-state-stale);
  }

  .si-name {
    font-weight: var(--vs-font-weight-medium);
  }

  .si-code {
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .stage-connector {
    display: block;
    width: 16px;
    height: 1px;
    background: var(--vs-border);
    margin: 0 var(--vs-space-1);
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage-item.running .si-indicator {
      animation: none;
      opacity: 1;
    }
  }
</style>
