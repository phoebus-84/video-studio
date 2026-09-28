<script lang="ts">
  /**
   * The selected stage, and what acting on it would do.
   *
   * The consequence panel is the reason this exists. Rerunning a stage is
   * cheap to click and expensive to undo, so what it invalidates and what it
   * preserves is shown next to the button, before the click — not in a
   * confirmation dialog after it.
   */
  import { episode } from "$lib/episode-store.svelte.ts";
  import { rerunConsequence, upstreamOf, downstreamOf } from "$lib/stage-graph";
  import { stageDisplayState, STAGE_LABELS } from "$lib/episode-types";
  import type { ResolvedStage } from "$lib/episode-types";

  interface Props {
    stages: ResolvedStage[];
    stageId: string | null;
  }

  let { stages, stageId }: Props = $props();

  const stage = $derived(stages.find((s) => s.id === stageId) ?? null);
  const state = $derived(stage ? stageDisplayState(stage) : null);

  const reads = $derived(stage ? upstreamOf(stages, stage.id) : []);
  const feeds = $derived(stage ? downstreamOf(stages, stage.id) : []);
  const consequence = $derived(
    stage ? rerunConsequence(stages, stage.id) : { invalidated: [], preserved: [] },
  );
</script>

{#if !stage}
  <p class="sd-empty">Select a stage to see what it reads, what it feeds, and what rerunning it would cost.</p>
{:else}
  <div class="stage-detail">
    <section class="sd-card">
      <header class="sd-head">
        <div class="sd-identity">
          <h2>{stage.name || stage.id}</h2>
          <span class="sd-state" data-state={state}>{state ? STAGE_LABELS[state] : ""}</span>
        </div>
        <div class="sd-actions">
          <button onclick={() => episode.selectStage(stage.id)}>Rerun from here</button>
          <button class="sd-primary">
            {state === "blocked"
              ? "Fix and retry"
              : state === "awaiting_review"
                ? "Approve stage"
                : state === "stale"
                  ? "Stale — re-run"
                  : "Run stage"}
          </button>
        </div>
      </header>

      <div class="sd-grid">
        <div>
          <h3>Reads</h3>
          {#if reads.length > 0}
            <ul class="sd-list">
              {#each reads as dep (dep.id)}
                <li>
                  <button onclick={() => episode.selectStage(dep.id)}>
                    <span class="sd-path">{dep.name || dep.id}</span>
                    <span class="sd-rev" data-state={stageDisplayState(dep)}>
                      {STAGE_LABELS[stageDisplayState(dep)]}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="sd-none">Nothing — this stage starts the pipeline.</p>
          {/if}
        </div>

        <div>
          <h3>Feeds</h3>
          {#if feeds.length > 0}
            <ul class="sd-list">
              {#each feeds as dep (dep.id)}
                <li>
                  <button onclick={() => episode.selectStage(dep.id)}>
                    <span class="sd-path">{dep.name || dep.id}</span>
                    <span class="sd-rev" data-state={stageDisplayState(dep)}>
                      {STAGE_LABELS[stageDisplayState(dep)]}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="sd-none">Nothing — this stage produces the deliverable.</p>
          {/if}
        </div>
      </div>

      <div class="sd-attempts">
        <h3>Attempts</h3>
        {#if stage.attemptCount > 0}
          <p class="sd-count">
            {stage.attemptCount} attempt{stage.attemptCount === 1 ? "" : "s"} recorded.
            <!-- The pipeline reports how many, not what each one cost. Inventing
                 a per-attempt cost table would be inventing evidence. -->
            <span class="sd-none">Per-attempt detail is in the journal, under Logs.</span>
          </p>
        {:else}
          <p class="sd-none">No attempts yet.</p>
        {/if}
      </div>
    </section>

    <section class="sd-card sd-consequence">
      <h3>Consequence of rerunning</h3>
      {#each consequence.invalidated as name (name)}
        <div class="sd-line">
          <span class="sd-mark sd-warn" aria-hidden="true">→</span>
          <span><strong>{name}</strong> becomes stale</span>
        </div>
      {/each}
      {#each consequence.preserved as name (name)}
        <div class="sd-line">
          <span class="sd-mark sd-ok" aria-hidden="true">✓</span>
          <span>{name} is preserved</span>
        </div>
      {/each}
      {#if consequence.invalidated.length === 0}
        <div class="sd-line">
          <span class="sd-mark sd-ok" aria-hidden="true">✓</span>
          <span>Nothing downstream depends on this stage.</span>
        </div>
      {/if}
      <p class="sd-footnote">
        Previous attempts stay on disk. Rerunning adds a new one rather than
        overwriting what is there.
      </p>
    </section>
  </div>
{/if}

<style>
  .stage-detail {
    display: grid;
    gap: var(--vs-space-4);
    align-content: start;
    padding: var(--vs-space-4);
    overflow: auto;
  }

  .sd-empty,
  .sd-none {
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    margin: 0;
  }

  .sd-empty {
    padding: var(--vs-space-5);
    text-align: center;
  }

  .sd-card {
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-lg);
    background: var(--vs-bg-surface);
    min-width: 0;
  }

  .sd-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--vs-space-3);
    padding: var(--vs-space-3) var(--vs-space-4);
    border-bottom: 1px solid var(--vs-border);
  }

  .sd-identity {
    display: flex;
    align-items: baseline;
    gap: var(--vs-space-2);
    min-width: 0;
  }

  .sd-identity h2 {
    margin: 0;
    font-size: var(--vs-text-base);
    font-weight: var(--vs-font-weight-semibold);
  }

  .sd-state {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-text-tertiary);
  }

  .sd-state[data-state="running"] { color: var(--vs-state-running); }
  .sd-state[data-state="blocked"],
  .sd-state[data-state="failed"] { color: var(--vs-state-blocked); }
  .sd-state[data-state="stale"] { color: var(--vs-state-attention); }
  .sd-state[data-state="completed"] { color: var(--vs-state-current); }

  .sd-actions {
    display: flex;
    gap: var(--vs-space-1);
    flex-shrink: 0;
  }

  .sd-actions button {
    padding: 4px 10px;
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .sd-actions button:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .sd-primary {
    background: var(--vs-accent) !important;
    border-color: var(--vs-accent) !important;
    color: var(--vs-accent-text) !important;
    font-weight: var(--vs-font-weight-semibold);
  }

  .sd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--vs-space-3);
    padding: var(--vs-space-3) var(--vs-space-4);
  }

  h3 {
    margin: 0 0 var(--vs-space-2);
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    font-weight: var(--vs-font-weight-medium);
  }

  .sd-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .sd-list button {
    display: flex;
    width: 100%;
    gap: var(--vs-space-2);
    align-items: center;
    padding: 4px 6px;
    background: none;
    border: none;
    border-radius: var(--vs-radius-sm);
    color: var(--vs-text-secondary);
    font: inherit;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    text-align: left;
    cursor: pointer;
  }

  .sd-list button:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .sd-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sd-rev {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--vs-text-tertiary);
  }

  .sd-rev[data-state="running"] { color: var(--vs-state-running); }
  .sd-rev[data-state="blocked"],
  .sd-rev[data-state="failed"] { color: var(--vs-state-blocked); }
  .sd-rev[data-state="stale"] { color: var(--vs-state-attention); }
  .sd-rev[data-state="completed"] { color: var(--vs-state-current); }

  .sd-attempts {
    padding: 0 var(--vs-space-4) var(--vs-space-4);
  }

  .sd-count {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
  }

  .sd-count .sd-none {
    display: block;
    margin-top: 2px;
  }

  .sd-consequence {
    padding: var(--vs-space-3) var(--vs-space-4);
  }

  .sd-line {
    display: flex;
    gap: var(--vs-space-2);
    padding: 4px 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
  }

  .sd-mark {
    width: 12px;
    flex-shrink: 0;
  }

  .sd-warn { color: var(--vs-state-attention); }
  .sd-ok { color: var(--vs-state-current); }

  .sd-footnote {
    margin: var(--vs-space-2) 0 0;
    padding-top: var(--vs-space-2);
    border-top: 1px solid var(--vs-border-subtle);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    max-width: 72ch;
  }
</style>
