<script lang="ts">
  import { assets } from "$lib/asset-store.svelte.ts";
  import type { AssetAttempt } from "$lib/asset-types";

  const group = $derived(assets.selectedGroup);

  function select(attempt: AssetAttempt) {
    /* In production: call gateway to update the selected pointer.
       Here we just visually reflect the choice. */
    if (group) {
      for (const a of group.attempts) {
        a.selected = a.id === attempt.id;
      }
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }
</script>

{#if group}
  <div class="asset-panel" aria-label="Asset attempts for {group.sceneTitle}">
    <h4 class="ap-title">Assets — {group.sceneTitle}</h4>

    <ol class="ap-list">
      {#each group.attempts as attempt (attempt.id)}
        <li class="ap-item">
        <button
          class="ap-card"
          class:selected={attempt.selected}
          class:unavailable={!attempt.fileAvailable}
          aria-label="Attempt {attempt.id} — {attempt.selected ? 'selected' : ''} — {attempt.fileAvailable ? 'available' : 'file unavailable'}"
          onclick={() => select(attempt)}
        >
          <div class="ap-card-header">
            <span class="ap-id">{attempt.id}</span>
            {#if attempt.selected}
              <span class="ap-selected-badge">Selected</span>
            {/if}
            {#if !attempt.fileAvailable}
              <span class="ap-missing-badge">File unavailable</span>
            {/if}
          </div>

          <div class="ap-prompt">{attempt.prompt}</div>

          <div class="ap-meta">
            <span>{attempt.model}</span>
            <span>Seed {attempt.seed ?? "—"}</span>
            <span>{attempt.dimensions.width}×{attempt.dimensions.height}</span>
            {#if attempt.cost !== null}
              <span>${attempt.cost.toFixed(3)}</span>
            {/if}
          </div>

          <div class="ap-footer">
            <span class="ap-date">{formatDate(attempt.createdAt)}</span>
            <span class="ap-license">{attempt.license}</span>
          </div>
        </button>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .asset-panel {
    padding: var(--vs-space-3);
  }

  .ap-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0 0 var(--vs-space-3);
    color: var(--vs-text-primary);
  }

  .ap-list {
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .ap-item {
    list-style: none;
  }

  .ap-card {
    text-align: left;
    padding: var(--vs-space-3);
    background: var(--vs-bg-surface);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    cursor: pointer;
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-primary);
    width: 100%;
    transition:
      border-color var(--vs-duration-fast) var(--vs-ease-standard);
  }

  .ap-card:hover {
    border-color: var(--vs-accent);
  }

  .ap-card:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: 1px;
  }

  .ap-card.selected {
    border-color: var(--vs-accent);
    background: var(--vs-accent-subtle);
  }

  .ap-card.unavailable {
    opacity: 0.5;
    border-style: dashed;
  }

  .ap-card-header {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    margin-bottom: var(--vs-space-1);
  }

  .ap-id {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    font-weight: var(--vs-font-weight-semibold);
  }

  .ap-selected-badge {
    font-size: var(--vs-text-xs);
    color: var(--vs-accent);
    background: var(--vs-accent-subtle);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .ap-missing-badge {
    font-size: var(--vs-text-xs);
    color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .ap-prompt {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    line-height: 1.4;
    margin-bottom: var(--vs-space-2);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ap-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--vs-space-2);
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
    margin-bottom: var(--vs-space-1);
  }

  .ap-footer {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--vs-text-disabled);
  }

  .ap-license {
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
