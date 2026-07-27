<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { RENDER_REPORT, RENDER_ATTEMPT } from "$lib/render-fixtures";

  /* For the MVP, we reference episode + render state. */
  const ep = $derived(episode.state);

  const budgetPct = $derived.by(() => {
    if (ep.phase !== "ready") return 0;
    return ep.episode.budgetLimit && ep.episode.budgetLimit > 0
      ? Math.round(((ep.episode.budgetSpent ?? 0) / ep.episode.budgetLimit) * 100)
      : 0;
  });

  const activeStage = $derived.by(() => {
    if (ep.phase !== "ready") return null;
    return ep.episode.stages.find((s) => s.status === "running" || s.blocked);
  });

  const blockedStage = $derived.by(() => {
    if (ep.phase !== "ready") return null;
    return ep.episode.stages.find((s) => s.blocked);
  });
</script>

{#if ep.phase === "ready"}
  <div class="pb-panel" aria-label="Production status">
    <!-- Budget bar -->
    {#if ep.episode.budgetLimit}
      <div class="pb-budget" aria-label="Budget: ${ep.episode.budgetSpent?.toFixed(2)} of ${ep.episode.budgetLimit.toFixed(2)}">
        <div class="pb-budget-bar" style="width: {Math.min(budgetPct, 100)}%"></div>
        <span class="pb-budget-label">
          ${ep.episode.budgetSpent?.toFixed(2)} / ${ep.episode.budgetLimit.toFixed(2)}
        </span>
      </div>
    {/if}

    <!-- Active stage progress -->
    {#if activeStage}
      <div class="pb-stage">
        <span class="pb-stage-name">{activeStage.name}</span>
        {#if activeStage.status === "running" && !activeStage.blocked}
          <div class="pb-progress-bar">
            <div
              class="pb-progress-fill"
              style="width: {Math.round(activeStage.progress * 100)}%"
            ></div>
          </div>
          <span class="pb-progress-pct">{Math.round(activeStage.progress * 100)}%</span>
        {:else if activeStage.blocked}
          <span class="pb-blocked-label">Blocked</span>
        {/if}
      </div>
    {/if}

    <!-- Blocker detail -->
    {#if blockedStage}
      <div class="pb-blocker" role="alert">
        <h5 class="pb-blocker-title">Blocked: {blockedStage.name}</h5>
        {#if blockedStage.blockedCode}
          <code class="pb-blocker-code">{blockedStage.blockedCode}</code>
        {/if}
        <p class="pb-blocker-reason">
          {ep.episode.blockedReason ?? "Stage execution blocked."}
        </p>
        <div class="pb-blocker-actions">
          <button class="pb-action-btn pb-action-retry">
            Retry
          </button>
          <button class="pb-action-btn pb-action-skip">
            Skip stage
          </button>
        </div>
      </div>
    {/if}

    <!-- Render status -->
    <div class="pb-render">
      <span class="pb-render-label">Last render</span>
      <span class="pb-render-status" data-status={RENDER_ATTEMPT.status}>
        {RENDER_ATTEMPT.status === "current" ? "Current" : RENDER_ATTEMPT.status}
      </span>
      <span class="pb-render-qa" data-overall={RENDER_REPORT.overall}>
        {RENDER_REPORT.overall === "pass" ? "QA passed" : "QA failed"}
      </span>
    </div>
  </div>
{/if}

<style>
  .pb-panel {
    padding: var(--vs-space-3);
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-3);
    border-top: 1px solid var(--vs-border);
  }

  /* Budget */
  .pb-budget {
    position: relative;
    height: 20px;
    background: var(--vs-bg-inset);
    border-radius: var(--vs-radius-sm);
    overflow: hidden;
  }

  .pb-budget-bar {
    height: 100%;
    background: var(--vs-accent);
    opacity: 0.3;
    transition: width var(--vs-duration-normal) var(--vs-ease-standard);
  }

  .pb-budget-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-secondary);
  }

  /* Stage progress */
  .pb-stage {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
  }

  .pb-stage-name {
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-medium);
    min-width: 90px;
    color: var(--vs-text-primary);
  }

  .pb-progress-bar {
    flex: 1;
    height: 4px;
    background: var(--vs-bg-inset);
    border-radius: 2px;
    overflow: hidden;
  }

  .pb-progress-fill {
    height: 100%;
    background: var(--vs-state-running);
    border-radius: 2px;
    transition: width var(--vs-duration-normal) var(--vs-ease-standard);
  }

  .pb-progress-pct {
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
    min-width: 3ch;
    text-align: right;
  }

  .pb-blocked-label {
    font-size: var(--vs-text-xs);
    color: var(--vs-state-blocked);
    font-weight: var(--vs-font-weight-semibold);
  }

  /* Blocker */
  .pb-blocker {
    padding: var(--vs-space-3);
    background: var(--vs-state-blocked-bg);
    border: 1px solid var(--vs-state-blocked);
    border-radius: var(--vs-radius-md);
  }

  .pb-blocker-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-state-blocked);
    margin: 0 0 var(--vs-space-1);
  }

  .pb-blocker-code {
    display: inline-block;
    font-family: var(--vs-font-mono);
    font-size: 11px;
    background: oklch(52% 0.18 24 / 0.2);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
    color: var(--vs-state-blocked);
    margin-bottom: var(--vs-space-1);
  }

  .pb-blocker-reason {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    margin: var(--vs-space-2) 0;
    line-height: 1.4;
  }

  .pb-blocker-actions {
    display: flex;
    gap: var(--vs-space-2);
  }

  .pb-action-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border-radius: var(--vs-radius-sm);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .pb-action-retry {
    border: 1px solid var(--vs-state-blocked);
    background: var(--vs-state-blocked);
    color: oklch(100% 0 0);
  }

  .pb-action-skip {
    border: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    color: var(--vs-text-secondary);
  }

  /* Render */
  .pb-render {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    font-size: var(--vs-text-xs);
  }

  .pb-render-label {
    color: var(--vs-text-tertiary);
  }

  .pb-render-status[data-status="current"] {
    color: var(--vs-state-current);
    font-weight: var(--vs-font-weight-medium);
  }

  .pb-render-qa[data-overall="pass"] {
    color: var(--vs-state-current);
  }

  .pb-render-qa[data-overall="fail"] {
    color: var(--vs-state-blocked);
  }
</style>
