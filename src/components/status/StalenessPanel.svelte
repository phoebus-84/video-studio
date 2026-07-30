<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { reviews as refresh } from "$lib/refresh.svelte.ts";

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

  /**
   * Root causes: stale stages whose own dependencies are NOT stale. Their
   * inputs changed on disk; every other stale stage inherits from them.
   */
  const rootStaleIds = $derived.by(() => {
    const staleIds = new Set(staleStages.map((s) => s.id));
    return new Set(
      staleStages
        .filter((s) => !s.dependsOn.some((d) => staleIds.has(d)))
        .map((s) => s.id),
    );
  });

  function staleReason(stage: (typeof staleStages)[number]): string {
    if (rootStaleIds.has(stage.id)) {
      return "inputs changed on disk since last run";
    }
    const staleDeps = stage.dependsOn.filter((d) =>
      staleStages.some((s) => s.id === d),
    );
    return `upstream ${staleDeps.join(", ")} changed`;
  }

  const hasStaleness = $derived(staleStages.length > 0);

  /* ── rerun planning + request (Pi executes; the studio requests) ── */

  type PlanState =
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; stageCount: number; message: string }
    | { phase: "sent" }
    | { phase: "error"; message: string };

  let plan = $state<PlanState>({ phase: "idle" });

  async function loadPlan() {
    if (ep.phase !== "ready") return;
    const w = ep.episode;
    const client = getGatewayClient();
    plan = { phase: "loading" };
    try {
      const result = (await client.fetchJSON(
        `/api/channels/${w.channel}/series/${w.series}/episodes/${w.slug}/rerun-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "rerun-affected" }),
        },
      )) as { ok: boolean; plan?: { message?: string; stages?: unknown[] } };
      const count = result.plan?.stages?.length ?? staleStages.length + affectedStages.length;
      plan = {
        phase: "ready",
        stageCount: count,
        message: result.plan?.message ?? `${count} stages would rerun`,
      };
    } catch (err) {
      plan = {
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to plan rerun",
      };
    }
  }

  async function requestRerun() {
    if (ep.phase !== "ready") return;
    const w = ep.episode;
    const client = getGatewayClient();
    plan = { phase: "loading" };
    try {
      await client.fetchJSON(
        `/api/channels/${w.channel}/series/${w.series}/episodes/${w.slug}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchor: `episode/${w.slug}`,
            body: `Rerun requested from the studio: ${staleStages.map((s) => s.id).join(", ")} stale${affectedStages.length > 0 ? `, ${affectedStages.map((s) => s.id).join(", ")} affected downstream` : ""}. Mode: rerun-affected.`,
          }),
        },
      );
      plan = { phase: "sent" };
      refresh.refresh();
    } catch (err) {
      plan = {
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to request rerun",
      };
    }
  }
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
          <li>{stage.name} — {staleReason(stage)}</li>
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

    <!-- Rerun: plan first, then request. Pi executes; the studio never does. -->
    <div class="sp-actions">
      {#if plan.phase === "idle"}
        <button class="sp-btn sp-btn-rerun" onclick={loadPlan}>
          Plan rerun ({staleStages.length + affectedStages.length} stages)
        </button>
      {:else if plan.phase === "loading"}
        <span class="sp-working" role="status">Working…</span>
      {:else if plan.phase === "ready"}
        <div class="sp-plan">
          <p class="sp-plan-msg">{plan.message}. Pi runs the stages; prior attempts are preserved.</p>
          <div class="sp-plan-actions">
            <button class="sp-btn sp-btn-rerun" onclick={requestRerun}>
              Request rerun from Pi
            </button>
            <button class="sp-btn sp-btn-accept" onclick={() => (plan = { phase: "idle" })}>
              Cancel
            </button>
          </div>
        </div>
      {:else if plan.phase === "sent"}
        <p class="sp-sent" role="status">Rerun requested — Pi will pick it up from the Reviews inbox.</p>
      {:else if plan.phase === "error"}
        <p class="sp-error" role="alert">{plan.message}</p>
        <button class="sp-btn sp-btn-accept" onclick={() => (plan = { phase: "idle" })}>Dismiss</button>
      {/if}
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
    color: var(--vs-on-attention);
    font-weight: var(--vs-font-weight-medium);
  }

  .sp-btn-accept {
    border: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    color: var(--vs-text-secondary);
  }

  .sp-working {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .sp-plan-msg {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    margin: 0 0 var(--vs-space-2);
  }

  .sp-plan-actions {
    display: flex;
    gap: var(--vs-space-2);
  }

  .sp-sent {
    font-size: var(--vs-text-xs);
    color: var(--vs-state-current);
    margin: 0;
  }

  .sp-error {
    font-size: var(--vs-text-xs);
    color: var(--vs-state-blocked);
    margin: 0 0 var(--vs-space-1);
  }
</style>
