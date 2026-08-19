<script lang="ts">
  /**
   * The audio workspace: transport, the real waveform, and the lines that were
   * spoken into it.
   *
   * The waveform is decoded from the file rather than drawn decoratively, so
   * clicking it seeks to a real position and the shape actually shows where the
   * silence and the peaks are.
   */
  import type { ViewerProps } from "$lib/viewer-registry";
  import {
    decodeWaveform,
    peaksToPath,
    formatTime,
    type Waveform,
  } from "$lib/waveform";
  import { files } from "$lib/files-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { narration } from "$lib/narration-store.svelte.ts";
  import { STATUS_SYMBOLS } from "$lib/narration-types";

  let { path, mediaSrc }: ViewerProps = $props();

  let audioEl = $state<HTMLAudioElement | null>(null);
  let wave = $state<Waveform | null>(null);
  let decoding = $state(false);
  let decodeFailed = $state(false);
  let currentTime = $state(0);
  let playing = $state(false);

  /* Decode whenever the file changes. Keyed on the path, not the object URL,
     so a re-issued URL for the same file does not re-decode it. */
  $effect(() => {
    const filePath = path;
    if (!filePath) {
      wave = null;
      return;
    }

    let cancelled = false;
    decoding = true;
    decodeFailed = false;

    files
      .mediaBytes(filePath)
      .then((bytes) => (bytes ? decodeWaveform(bytes) : null))
      .then((result) => {
        if (cancelled) return;
        wave = result;
        decodeFailed = result === null;
        decoding = false;
      });

    return () => {
      cancelled = true;
    };
  });

  const wavePath = $derived(wave ? peaksToPath(wave.peaks, 1000, 120) : "");

  const duration = $derived(
    wave?.durationSeconds ?? audioEl?.duration ?? 0,
  );

  const progress = $derived(
    duration > 0 ? Math.min(currentTime / duration, 1) : 0,
  );

  /**
   * Which scene this file is, established by matching the path against the
   * narration URLs the gateway reported — not by parsing the filename, which
   * would be a guess that silently attaches the wrong transcript.
   */
  const sceneId = $derived.by(() => {
    const name = path.split("/").pop();
    if (!name) return null;
    for (const [id, url] of Object.entries(episode.assets.narration)) {
      if (url.split("/").pop() === name) return id;
    }
    return null;
  });

  const segments = $derived(
    sceneId ? narration.segments.filter((s) => s.sceneId === sceneId) : [],
  );

  /** Segment boundaries, laid out by their real durations. */
  const marks = $derived.by(() => {
    if (segments.length === 0 || duration <= 0) return [];
    const out: { id: string; at: number }[] = [];
    let elapsed = 0;
    for (const segment of segments) {
      if (segment.durationSeconds === null) return [];
      elapsed += segment.durationSeconds;
      out.push({ id: segment.id, at: (elapsed / duration) * 100 });
    }
    return out.slice(0, -1);
  });

  function toggle() {
    if (!audioEl) return;
    if (audioEl.paused) void audioEl.play();
    else audioEl.pause();
  }

  function seek(event: MouseEvent) {
    if (!audioEl || duration <= 0) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fraction = (event.clientX - box.left) / box.width;
    audioEl.currentTime = Math.max(0, Math.min(fraction, 1)) * duration;
  }
</script>

<div class="audio">
  {#if !mediaSrc}
    <p class="au-note">Loading audio…</p>
  {:else}
    <div class="au-stage">
      <div class="au-transport">
        <button
          class="au-play"
          onclick={toggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span class="au-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        {#if wave}
          <span class="au-meta">
            {wave.sampleRate.toLocaleString()} Hz ·
            {wave.channels === 1 ? "mono" : `${wave.channels} ch`}
          </span>
        {/if}
      </div>

      <!-- Clicking the waveform seeks, which is only meaningful because the
           shape is the real signal. -->
      <div
        class="au-wave"
        role="slider"
        tabindex="0"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        onclick={seek}
        onkeydown={(e) => {
          if (!audioEl) return;
          if (e.key === "ArrowRight") audioEl.currentTime = currentTime + 1;
          if (e.key === "ArrowLeft") audioEl.currentTime = currentTime - 1;
        }}
      >
        {#if decoding}
          <p class="au-note au-inline" role="status">Decoding audio…</p>
        {:else if decodeFailed}
          <p class="au-note au-inline">
            This file could not be decoded, so there is no waveform to show.
            Playback may still work.
          </p>
        {:else if wave}
          <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
            <path d={wavePath} />
          </svg>
          {#each marks as mark (mark.id)}
            <span class="au-mark" style="left: {mark.at}%"></span>
          {/each}
          <span class="au-playhead" style="left: {(progress * 100).toFixed(2)}%"></span>
        {/if}
      </div>

      <!-- svelte-ignore a11y_media_has_caption -->
      <audio
        bind:this={audioEl}
        src={mediaSrc}
        onplay={() => (playing = true)}
        onpause={() => (playing = false)}
        ontimeupdate={() => (currentTime = audioEl?.currentTime ?? 0)}
      ></audio>
    </div>

    {#if segments.length > 0}
      <ol class="au-segments">
        {#each segments as segment (segment.id)}
          <li class="au-segment" data-status={segment.status}>
            <span class="au-seg-status" title={segment.status}>
              {STATUS_SYMBOLS[segment.status]}
            </span>
            <span class="au-seg-time">
              {segment.durationSeconds === null
                ? "—"
                : formatTime(segment.durationSeconds)}
            </span>
            <span class="au-seg-text">{segment.text}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="au-note au-foot">
        No transcript is linked to this file. The narration view has the
        per-segment text for this episode.
      </p>
    {/if}
  {/if}
</div>

<style>
  .audio {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .au-stage {
    padding: var(--vs-space-4);
    background: var(--vs-bg-inset);
    border-bottom: 1px solid var(--vs-border);
    flex-shrink: 0;
  }

  .au-transport {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
    padding-bottom: var(--vs-space-3);
  }

  .au-play {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--vs-accent);
    border: none;
    color: var(--vs-accent-text);
    font-size: var(--vs-text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }

  .au-play:hover {
    background: var(--vs-accent-hover);
  }

  .au-time {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-primary);
  }

  .au-meta {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .au-wave {
    position: relative;
    height: 120px;
    cursor: pointer;
  }

  .au-wave svg {
    width: 100%;
    height: 120px;
    display: block;
  }

  .au-wave path {
    fill: var(--vs-state-running);
    opacity: 0.75;
  }

  .au-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--vs-text-disabled);
  }

  .au-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--vs-accent);
  }

  .au-segments {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .au-segment {
    display: flex;
    gap: var(--vs-space-3);
    align-items: flex-start;
    padding: 9px var(--vs-space-4);
    border-bottom: 1px solid var(--vs-border-subtle);
  }

  /* A segment that failed or drifted is flagged by tint *and* by its symbol. */
  .au-segment[data-status="failed"] {
    background: var(--vs-state-blocked-bg);
  }

  .au-segment[data-status="stale"] {
    background: var(--vs-state-attention-bg);
  }

  .au-seg-status {
    width: 14px;
    flex-shrink: 0;
    color: var(--vs-text-tertiary);
    font-size: var(--vs-text-xs);
  }

  .au-segment[data-status="ready"] .au-seg-status { color: var(--vs-state-current); }
  .au-segment[data-status="failed"] .au-seg-status { color: var(--vs-state-blocked); }
  .au-segment[data-status="stale"] .au-seg-status { color: var(--vs-state-attention); }

  .au-seg-time {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    width: 56px;
    flex-shrink: 0;
  }

  .au-seg-text {
    flex: 1;
    font-size: var(--vs-text-sm);
    line-height: var(--vs-leading-normal);
    color: var(--vs-text-primary);
    text-wrap: pretty;
  }

  .au-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
  }

  .au-inline {
    padding-top: var(--vs-space-5);
    text-align: center;
  }

  .au-foot {
    padding: var(--vs-space-4);
  }
</style>
