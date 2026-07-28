<script lang="ts">
  import { assets } from "$lib/asset-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { reviews as refresh } from "$lib/refresh.svelte.ts";
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

  let regenerating = $state(false);
  let regenError = $state<string | null>(null);

  async function requestRegenerate(attempt: AssetAttempt) {
    if (!group || episode.state.phase !== "ready") return;
    const ep = episode.state.episode;
    const client = getGatewayClient();
    regenerating = true;
    regenError = null;
    const kindLabel = attempt.kind === "audio" ? "narration" : "image";
    try {
      await client.fetchJSON(
        `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchor: `${attempt.anchorType}/${group.sceneId}`,
            body: `Regenerate ${kindLabel} for scene "${group.sceneTitle}". ${attempt.kind === "audio" ? `Narration text needed.` : `Original prompt: "${attempt.prompt}"`}`,
          }),
        }
      );
      refresh.refresh();
    } catch (err) {
      regenError = err instanceof Error ? err.message : "Failed to request regeneration";
    } finally {
      regenerating = false;
    }
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
          aria-label="{attempt.kind} {attempt.id} — {attempt.selected ? 'selected' : ''} — {attempt.fileAvailable ? 'available' : 'unavailable'}"
          onclick={() => select(attempt)}
        >
          <div class="ap-card-header">
            <span class="ap-kind-badge" data-kind={attempt.kind}>
              {attempt.kind === "image" ? "🖼" : "🔊"}
            </span>
            <span class="ap-id">{attempt.id}</span>
            {#if attempt.selected}
              <span class="ap-selected-badge">Selected</span>
            {/if}
            {#if !attempt.fileAvailable}
              <span class="ap-missing-badge">No {attempt.kind === "image" ? "image" : "audio"}</span>
            {/if}
          </div>

          {#if attempt.kind === "image" && attempt.imageUrl}
            <div class="ap-thumb">
              <img src={attempt.imageUrl} alt={attempt.sceneId} loading="lazy" />
            </div>
          {:else if attempt.kind === "audio" && attempt.audioUrl}
            <div class="ap-audio">
              <audio controls src={attempt.audioUrl} preload="none">
                Your browser cannot play audio.
              </audio>
            </div>
          {/if}

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

          <div class="ap-actions">
            <span
              class="ap-regen-btn"
              class:ap-regen-disabled={regenerating}
              role="button"
              tabindex={regenerating ? -1 : 0}
              onclick={(e) => { e.stopPropagation(); if (!regenerating) requestRegenerate(attempt); }}
              onkeydown={(e) => { if (!regenerating && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); requestRegenerate(attempt); } }}
            >
              {regenerating ? "Requesting…" : `🔄 Regenerate ${attempt.kind === "audio" ? "Narration" : "Image"}`}
            </span>
          </div>
          {#if regenError}
            <div class="ap-error">{regenError}</div>
          {/if}
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

  .ap-kind-badge {
    font-size: 14px;
    line-height: 1;
  }

  .ap-kind-badge[data-kind="audio"] {
    opacity: 0.8;
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
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ap-thumb {
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: var(--vs-radius-sm);
    overflow: hidden;
    margin-bottom: var(--vs-space-2);
    background: var(--vs-bg-inset);
  }

  .ap-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .ap-audio {
    margin-bottom: var(--vs-space-2);
  }

  .ap-audio audio {
    width: 100%;
    height: 32px;
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

  .ap-actions {
    margin-top: var(--vs-space-2);
    padding-top: var(--vs-space-2);
    border-top: 1px solid var(--vs-border);
  }

  .ap-regen-btn {
    display: block;
    text-align: center;
    width: 100%;
    padding: var(--vs-space-1) var(--vs-space-2);
    border: 1px solid var(--vs-accent);
    border-radius: var(--vs-radius-sm);
    background: transparent;
    color: var(--vs-accent);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
    transition: background var(--vs-duration-fast);
    box-sizing: border-box;
  }

  .ap-regen-btn:hover:not(.ap-regen-disabled) {
    background: var(--vs-accent-subtle);
  }

  .ap-regen-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ap-error {
    margin-top: var(--vs-space-1);
    padding: var(--vs-space-1);
    background: var(--vs-state-blocked-bg);
    color: var(--vs-state-blocked);
    border-radius: var(--vs-radius-sm);
    font-size: 11px;
  }
</style>
