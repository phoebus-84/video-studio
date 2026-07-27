<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";

  const ep = $derived(episode.state);

  const staleStages = $derived.by(() => {
    if (ep.phase !== "ready") return [];
    return ep.episode.stages.filter((s) => s.stale);
  });

  const affectedStages = $derived.by(() => {
    if (ep.phase !== "ready") return [];
    const staleIds = new Set(staleStages.map((s) => s.id));
    /* Stages that depend on a stale stage are also affected. */
    return ep.episode.stages.filter(
      (s) => !staleIds.has(s.id) && s.dependsOn.some((d) => staleIds.has(d)),
    );
  });

  const preservedStages = $derived.by(() => {
    if (ep.phase !== "ready") return [];
    const affectedIds = new Set([
      ...staleStages.map((s) => s.id),
      ...affectedStages.map((s) => s.id),
    ]);
    return ep.episode.stages.filter(
      (s) => !affectedIds.has(s.id) && s.status === "completed",
    );
  });

  const hasStaleness = $derived(staleStages.length > 0);
</script>

{#if ep.phase === "ready" && hasStaleness}
  <div class="stale-panel" aria-label="Staleness analysis">
    <h5 class="sp-title">Staleness</h5>
    <p class="sp-summary">
      {staleStages.length} stage{staleStages.length > 1 ? "s" : ""} stale
      {#if affectedStages.length > 0}
        — {affectedStages.length} affected downstream
      {/if}
    </p>

    <!-- Stale stages -->
    <div class="sp-section">
      <h6 class="sp-section-title">Stale</h6>
      <ul class="sp-list sp-list-stale">
        {#each staleStages as stage (stage.id)}
          <li>{stage.name} — edited upstream dependency</li>
        {/each}
      </ul>
    </div>

    <!-- Affected -->
    {#if affectedStages.length > 0}
      <div class="sp-section">
        <h6 class="sp-section-title">Will be rebuilt</h6>
        <ul class="sp-list sp-list-affected">
          {#each affectedStages as stage (stage.id)}
            <li>{stage.name} — depends on stale input</li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Preserved -->
    {#if preservedStages.length > 0}
      <div class="sp-section">
        <h6 class="sp-section-title">Preserved</h6>
        <ul class="sp-list sp-list-preserved">
          {#each preservedStages as stage (stage.id)}
            <li>
              {stage.name}
              {#if stage.attemptCount > 0}
                <span class="sp-attempts">{stage.attemptCount} attempt{stage.attemptCount > 1 ? "s" : ""}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Rerun actions -->
    <div class="sp-actions">
      <button class="sp-btn sp-btn-rerun">
        Rerun affected ({staleStages.length + affectedStages.length} stages)
      </button>
      <button class="sp-btn sp-btn-accept">
        Accept staleness
      </button>
    </div>
  </div>
{/if}

<style>
  .stale-panel {
    padding: var(--vs-space-3);
    border-top: 1px solid var(--vs-border);
  }

  .sp-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0 0 var(--vs-space-1);
    color: var(--vs-state-stale);
  }

  .sp-summary {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    margin: 0 0 var(--vs-space-3);
  }

  .sp-section {
    margin-bottom: var(--vs-space-3);
  }

  .sp-section-title {
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-text-tertiary);
    margin: 0 0 var(--vs-space-1);
  }

  .sp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--vs-text-xs);
  }

  .sp-list li {
    padding: 2px 0;
  }

  .sp-list-stale li {
    color: var(--vs-state-stale);
  }

  .sp-list-affected li {
    color: var(--vs-state-attention);
  }

  .sp-list-preserved li {
    color: var(--vs-state-current);
  }

  .sp-attempts {
    font-size: 10px;
    color: var(--vs-text-tertiary);
    margin-left: var(--vs-space-1);
  }

  .sp-actions {
    display: flex;
    gap: var(--vs-space-2);
  }

  .sp-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border-radius: var(--vs-radius-sm);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .sp-btn-rerun {
    border: 1px solid var(--vs-state-attention);
    background: var(--vs-state-attention);
    color: oklch(100% 0 0);
  }

  .sp-btn-accept {
    border: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    color: var(--vs-text-secondary);
  }
</style>
