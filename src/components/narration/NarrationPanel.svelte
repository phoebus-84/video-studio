<script lang="ts">
  import { narration } from "$lib/narration-store.svelte.ts";
  import { STATUS_SYMBOLS } from "$lib/narration-types";

  function formatTime(sec: number | null): string {
    if (sec === null) return "--:--";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function togglePlay(segmentId: string) {
    if (narration.playingId === segmentId) {
      narration.stopPlayback();
    } else {
      const seg = narration.segments.find((s) => s.id === segmentId);
      if (seg) narration.synthesizeAndPlay(seg);
    }
  }
</script>

<div class="narration-panel" aria-label="Narration segments">
  <div class="np-header">
    <h4 class="np-title">Narration</h4>
    <span class="np-summary">
      {narration.readyCount}/{narration.segments.length} ready · {formatTime(narration.totalDuration)}
    </span>
  </div>

  {#if narration.voice}
    <div class="np-voice">
      <span class="np-voice-name">{narration.voice.name}</span>
      <span class="np-voice-model">{narration.voice.modelSize}</span>
      {#if !narration.voice.installed}
        <span class="np-voice-missing">Not installed</span>
      {/if}
    </div>
  {/if}

  <ol class="np-list">
    {#each narration.segments as seg (seg.id)}
      <li class="np-segment" data-status={seg.status}>
        <div class="np-seg-header">
          <span class="np-seg-idx" aria-label="Segment {seg.id}">
            {seg.id}
          </span>
          <span class="np-seg-status">
            {STATUS_SYMBOLS[seg.status]}
          </span>
          <span class="np-seg-time">
            {formatTime(seg.durationSeconds)}
          </span>

          {#if narration.synthesizing && narration.playingId === seg.id}
            <button class="np-play-btn" aria-label="Synthesizing..." disabled>
              ⟳
            </button>
          {:else}
            <button
              class="np-play-btn"
              aria-label="{narration.playingId === seg.id ? 'Pause' : 'Play'} segment {seg.id}"
              onclick={() => togglePlay(seg.id)}
            >
              {narration.playingId === seg.id ? "⏸" : "▶"}
            </button>
          {/if}

          {#if seg.attemptCount > 0}
            <span class="np-attempts" aria-label="{seg.attemptCount} attempts">
              {seg.attemptCount}
            </span>
          {/if}
        </div>

        <p class="np-text">{seg.text}</p>
      </li>
    {/each}
  </ol>
</div>

<style>
  .narration-panel {
    padding: var(--vs-space-3);
  }

  .np-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--vs-space-2);
  }

  .np-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0;
  }

  .np-summary {
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
  }

  .np-voice {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    padding: var(--vs-space-2) var(--vs-space-3);
    margin-bottom: var(--vs-space-3);
    background: var(--vs-bg-inset);
    border-radius: var(--vs-radius-sm);
    font-size: var(--vs-text-xs);
  }

  .np-voice-name {
    font-weight: var(--vs-font-weight-medium);
    color: var(--vs-text-primary);
  }

  .np-voice-model {
    color: var(--vs-text-tertiary);
    font-family: var(--vs-font-mono);
  }

  .np-voice-missing {
    color: var(--vs-state-blocked);
  }

  .np-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-2);
  }

  .np-segment {
    padding: var(--vs-space-2) var(--vs-space-3);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    background: var(--vs-bg-surface);
  }

  .np-segment[data-status="generating"] {
    border-color: var(--vs-state-running);
    background: var(--vs-state-running-bg);
  }

  .np-segment[data-status="failed"] {
    border-color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
  }

  .np-segment[data-status="stale"] {
    border-style: dashed;
    border-color: var(--vs-state-stale);
    opacity: 0.7;
  }

  .np-segment[data-status="missing"] {
    opacity: 0.5;
  }

  .np-seg-header {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    margin-bottom: var(--vs-space-1);
  }

  .np-seg-idx {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .np-seg-status {
    font-size: var(--vs-text-xs);
  }

  .np-segment[data-status="ready"] .np-seg-status {
    color: var(--vs-state-current);
  }

  .np-segment[data-status="failed"] .np-seg-status {
    color: var(--vs-state-blocked);
  }

  .np-segment[data-status="stale"] .np-seg-status {
    color: var(--vs-state-stale);
  }

  .np-seg-time {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-left: auto;
  }

  .np-play-btn {
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    cursor: pointer;
    font-size: var(--vs-text-xs);
    padding: 1px var(--vs-space-1);
    color: var(--vs-text-primary);
    line-height: 1;
  }

  .np-play-btn:hover {
    background: var(--vs-bg-hover);
  }

  .np-play-btn:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: 1px;
  }

  .np-attempts {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    background: var(--vs-bg-inset);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .np-text {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    line-height: 1.4;
    margin: 0;
  }
</style>
