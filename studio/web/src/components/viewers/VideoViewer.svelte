<script lang="ts">
  /**
   * The video workspace: the deliverable, its timeline, and what QA found.
   *
   * QA findings sit beside the player rather than in a report elsewhere,
   * because the decision they inform — ship it, or rerun a scene — is made
   * while watching. Findings that name a timecode are also marked on the
   * timeline so they can be scrubbed to directly.
   */
  import type { ViewerProps } from "$lib/viewer-registry";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { formatTime } from "$lib/waveform";

  let { mediaSrc }: ViewerProps = $props();

  let videoEl = $state<HTMLVideoElement | null>(null);
  let currentTime = $state(0);
  let duration = $state(0);
  let playing = $state(false);

  interface Finding {
    code: string;
    severity: "pass" | "warn" | "fail";
    description: string;
    /** Seconds into the timeline, when the finding names a position. */
    at: number | null;
  }

  /**
   * Pull a timecode out of a finding's text when it carries one.
   *
   * QA findings are free text from the runtime, so this only marks the timeline
   * when a position is unambiguously present — `mm:ss` or `12.4s`. A finding
   * without one is still listed, just not pinned.
   */
  function timecodeOf(text: string): number | null {
    const clock = /\b(\d{1,2}):(\d{2})(?:\.(\d+))?\b/.exec(text);
    if (clock) {
      return (
        Number(clock[1]) * 60 + Number(clock[2]) + Number(`0.${clock[3] ?? 0}`)
      );
    }
    const seconds = /\b(\d+(?:\.\d+)?)\s*s\b/.exec(text);
    return seconds ? Number(seconds[1]) : null;
  }

  const report = $derived(episode.qaReport);

  const findings = $derived.by((): Finding[] => {
    const raw = (report?.["findings"] ?? []) as Array<Record<string, unknown>>;
    return raw.map((f) => {
      const description = String(f["description"] ?? f["message"] ?? f["code"] ?? "");
      return {
        code: String(f["code"] ?? ""),
        severity: (f["severity"] as Finding["severity"]) ?? "pass",
        description,
        at: timecodeOf(description),
      };
    });
  });

  const problems = $derived(findings.filter((f) => f.severity !== "pass"));

  const marks = $derived(
    duration > 0
      ? findings
          .filter((f): f is Finding & { at: number } => f.at !== null && f.at <= duration)
          .map((f) => ({ ...f, pct: (f.at / duration) * 100 }))
      : [],
  );

  const loudness = $derived(
    report?.["loudness"] as { integrated?: number; truePeak?: number } | undefined,
  );

  const progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

  function toggle() {
    if (!videoEl) return;
    if (videoEl.paused) void videoEl.play();
    else videoEl.pause();
  }

  function scrub(event: MouseEvent) {
    if (!videoEl || duration <= 0) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fraction = (event.clientX - box.left) / box.width;
    videoEl.currentTime = Math.max(0, Math.min(fraction, 1)) * duration;
  }

  function seekTo(seconds: number) {
    if (videoEl) videoEl.currentTime = seconds;
  }

  const SEVERITY_MARK = { pass: "✓", warn: "▲", fail: "✗" } as const;
</script>

<div class="video">
  <div class="vv-main">
    <div class="vv-stage">
      {#if mediaSrc}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={videoEl}
          src={mediaSrc}
          onplay={() => (playing = true)}
          onpause={() => (playing = false)}
          ontimeupdate={() => (currentTime = videoEl?.currentTime ?? 0)}
          onloadedmetadata={() => (duration = videoEl?.duration ?? 0)}
        ></video>
      {:else}
        <p class="vv-note">Loading video…</p>
      {/if}
    </div>

    <div class="vv-transport">
      <button class="vv-play" onclick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>

      <div
        class="vv-timeline"
        role="slider"
        tabindex="0"
        aria-label="Scrub"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        onclick={scrub}
        onkeydown={(e) => {
          if (!videoEl) return;
          if (e.key === "ArrowRight") videoEl.currentTime = currentTime + 5;
          if (e.key === "ArrowLeft") videoEl.currentTime = currentTime - 5;
        }}
      >
        <span class="vv-track"></span>
        <span class="vv-played" style="width: {progress}%"></span>
        {#each marks as mark (mark.code + mark.at)}
          <span
            class="vv-mark"
            data-severity={mark.severity}
            style="left: {mark.pct}%"
            title={mark.description}
          ></span>
        {/each}
        <span class="vv-head" style="left: {progress}%"></span>
      </div>

      <span class="vv-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  </div>

  <aside class="vv-qa">
    <h3>Render QA</h3>

    {#if !report}
      <p class="vv-note">
        No QA report for this render. Nothing has validated it yet.
      </p>
    {:else}
      <p class="vv-overall" data-overall={report["overall"]}>
        {report["overall"] === "pass" ? "Passed" : "Failed"}
        {#if problems.length > 0}
          · {problems.length} finding{problems.length === 1 ? "" : "s"}
        {/if}
      </p>

      {#if loudness?.integrated !== undefined}
        <div class="vv-check">
          <span class="vv-mark-glyph">✓</span>
          <span class="vv-check-label">Integrated loudness</span>
          <span class="vv-check-value">{loudness.integrated} LUFS</span>
        </div>
      {/if}
      {#if loudness?.truePeak !== undefined}
        <div class="vv-check">
          <span class="vv-mark-glyph">✓</span>
          <span class="vv-check-label">True peak</span>
          <span class="vv-check-value">{loudness.truePeak} dBTP</span>
        </div>
      {/if}

      {#each findings as finding (finding.code + finding.description)}
        <div class="vv-check" data-severity={finding.severity}>
          <span class="vv-mark-glyph">{SEVERITY_MARK[finding.severity]}</span>
          {#if finding.at !== null}
            <button class="vv-check-label vv-seek" onclick={() => seekTo(finding.at!)}>
              {finding.description}
            </button>
          {:else}
            <span class="vv-check-label">{finding.description}</span>
          {/if}
          <span class="vv-check-value">{finding.code}</span>
        </div>
      {:else}
        <p class="vv-note">The report lists no findings.</p>
      {/each}
    {/if}
  </aside>
</div>

<style>
  .video {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    overflow: hidden;
  }

  .vv-main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--vs-bg-inset);
  }

  .vv-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--vs-space-4);
    overflow: hidden;
  }

  .vv-stage video {
    max-width: 100%;
    max-height: 100%;
  }

  .vv-transport {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
    padding: var(--vs-space-2) var(--vs-space-4) var(--vs-space-3);
    border-top: 1px solid var(--vs-border);
    flex-shrink: 0;
  }

  .vv-play {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--vs-accent);
    border: none;
    color: var(--vs-accent-text);
    font-size: var(--vs-text-xs);
    cursor: pointer;
    flex-shrink: 0;
  }

  .vv-play:hover {
    background: var(--vs-accent-hover);
  }

  .vv-timeline {
    position: relative;
    flex: 1;
    height: 26px;
    cursor: pointer;
  }

  .vv-track,
  .vv-played {
    position: absolute;
    top: 11px;
    height: 4px;
    border-radius: 2px;
  }

  .vv-track {
    left: 0;
    right: 0;
    background: var(--vs-border);
  }

  .vv-played {
    left: 0;
    background: var(--vs-accent);
  }

  .vv-mark {
    position: absolute;
    top: 5px;
    width: 2px;
    height: 16px;
    background: var(--vs-state-attention);
  }

  .vv-mark[data-severity="fail"] {
    background: var(--vs-state-blocked);
  }

  .vv-head {
    position: absolute;
    top: 6px;
    width: 2px;
    height: 14px;
    background: var(--vs-text-primary);
  }

  .vv-time {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .vv-qa {
    border-left: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    overflow-y: auto;
    padding: var(--vs-space-3);
    min-height: 0;
  }

  h3 {
    margin: 0 0 var(--vs-space-2);
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    font-weight: var(--vs-font-weight-medium);
  }

  .vv-overall {
    margin: 0 0 var(--vs-space-2);
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
  }

  .vv-overall[data-overall="pass"] { color: var(--vs-state-current); }
  .vv-overall[data-overall="fail"] { color: var(--vs-state-blocked); }

  .vv-check {
    display: flex;
    gap: var(--vs-space-2);
    align-items: baseline;
    padding: 5px 0;
    border-bottom: 1px solid var(--vs-border-subtle);
  }

  .vv-mark-glyph {
    width: 12px;
    flex-shrink: 0;
    color: var(--vs-state-current);
    font-size: var(--vs-text-xs);
  }

  .vv-check[data-severity="warn"] .vv-mark-glyph { color: var(--vs-state-attention); }
  .vv-check[data-severity="fail"] .vv-mark-glyph { color: var(--vs-state-blocked); }

  .vv-check-label {
    flex: 1;
    min-width: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-primary);
    text-align: left;
  }

  /* Findings that name a timecode are buttons, because the useful next move is
     to go and look at that moment. */
  .vv-seek {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: var(--vs-text-sm);
    color: var(--vs-accent-strong);
    cursor: pointer;
    text-align: left;
  }

  .vv-seek:hover {
    text-decoration: underline;
  }

  .vv-check-value {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .vv-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    line-height: var(--vs-leading-normal);
  }

  @media (max-width: 1100px) {
    .video {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .vv-qa {
      border-left: none;
      border-top: 1px solid var(--vs-border);
      max-height: 220px;
    }
  }
</style>
