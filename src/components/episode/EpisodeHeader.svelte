<script lang="ts">
  import type { EpisodeWorkspace } from "$lib/episode-types";
  import { APPROVAL_LABELS } from "$lib/episode-types";

  interface Props {
    episode: EpisodeWorkspace;
  }

  let { episode: ep }: Props = $props();

  const blockedReason = $derived(
    ep.blocked ? ep.blockedReason ?? "Episode blocked" : null,
  );

  const staleSummary = $derived(
    ep.staleCount > 0
      ? `${ep.staleCount} stage${ep.staleCount === 1 ? "" : "s"} stale`
      : null,
  );
</script>

<div class="episode-header" aria-label="Episode identity">
  <div class="eh-identity">
    <h2 class="eh-title">{ep.title}</h2>
    <div class="eh-meta">
      <span class="eh-approval" aria-label="Approval mode: {APPROVAL_LABELS[ep.approvalMode]}">
        {APPROVAL_LABELS[ep.approvalMode]}
      </span>
      {#if ep.budgetLimit}
        <span class="eh-budget" aria-label="Budget: ${ep.budgetSpent?.toFixed(2)} of ${ep.budgetLimit.toFixed(2)}">
          ${ep.budgetSpent?.toFixed(2)} / ${ep.budgetLimit.toFixed(2)}
        </span>
      {/if}
    </div>
  </div>

  <div class="eh-status">
    {#if ep.blocked}
      <span class="eh-blocked" role="alert">{blockedReason}</span>
    {/if}
    {#if staleSummary}
      <span class="eh-stale">{staleSummary}</span>
    {/if}
    {#if !ep.currentDeliverableValidated && ep.currentDeliverable}
      <span class="eh-unvalidated">Unvalidated deliverable</span>
    {/if}
  </div>
</div>

<style>
  .episode-header {
    padding: var(--vs-space-4);
    border-bottom: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
  }

  .eh-identity {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--vs-space-3);
  }

  .eh-title {
    font-size: var(--vs-text-lg);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0;
    color: var(--vs-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .eh-meta {
    display: flex;
    gap: var(--vs-space-3);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .eh-status {
    display: flex;
    gap: var(--vs-space-2);
    margin-top: var(--vs-space-2);
    font-size: var(--vs-text-xs);
  }

  .eh-blocked {
    color: oklch(100% 0 0);
    background: var(--vs-state-blocked);
    padding: 1px var(--vs-space-2);
    border-radius: var(--vs-radius-sm);
    font-weight: var(--vs-font-weight-medium);
  }

  .eh-stale {
    color: var(--vs-state-stale);
    background: var(--vs-state-stale-bg);
    padding: 1px var(--vs-space-2);
    border-radius: var(--vs-radius-sm);
  }

  .eh-unvalidated {
    color: var(--vs-state-attention);
    background: var(--vs-state-attention-bg);
    padding: 1px var(--vs-space-2);
    border-radius: var(--vs-radius-sm);
  }
</style>
