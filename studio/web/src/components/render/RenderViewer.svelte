<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { reviews as refresh } from "$lib/refresh.svelte.ts";

  interface QaFinding {
    code: string;
    severity: "pass" | "warn" | "fail";
    description: string;
  }

  /* Real render + QA report from the episode store (gateway disk truth). */
  const render = $derived(episode.render);
  const qa = $derived(episode.qaReport);
  const qaFindings = $derived<QaFinding[]>(
    Array.isArray(qa?.findings) ? qa.findings : [],
  );
  const qaOverall = $derived(
    qa?.overall === "pass" || qa?.overall === "fail" ? qa.overall : null,
  );

  /* Deliverable honesty: compose/qa must be complete and not stale. */
  const composeStale = $derived.by(() => {
    if (episode.state.phase !== "ready") return false;
    return episode.state.episode.stages.some(
      (s) => (s.id === "compose" || s.id === "qa") && s.stale,
    );
  });
  const composeDone = $derived.by(() => {
    if (episode.state.phase !== "ready") return false;
    const compose = episode.state.episode.stages.find((s) => s.id === "compose");
    return compose?.status === "completed";
  });

  const deliverableState = $derived.by((): "current" | "stale" | "unvalidated" | "none" => {
    if (!render) return "none";
    if (composeStale) return "stale";
    if (!composeDone || !qa) return "unvalidated";
    return qaOverall === "fail" ? "unvalidated" : "current";
  });

  const STATE_LABELS: Record<string, string> = {
    current: "Current deliverable",
    stale: "Stale — upstream changed",
    unvalidated: "Unvalidated render",
    none: "No render yet",
  };

  /* Duration reconciliation: media truth vs. storyboard timeline. */
  let mediaDuration = $state<number | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let captionsVttUrl = $state<string | null>(null);

  /* Load the episode's SRT captions and convert to WebVTT for the track. */
  $effect(() => {
    const url = render?.url;
    if (!url) {
      captionsVttUrl = null;
      return;
    }
    const srtUrl = url.replace(/\/(output|artifacts)\/[^/]+$/, "/artifacts/captions.srt");
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(srtUrl);
        if (!res.ok) return;
        const srt = await res.text();
        const vtt = "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
        revoked = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
        if (!cancelled) captionsVttUrl = revoked;
      } catch { /* no captions available */ }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  });

  /* CC toggle drives the track mode. */
  $effect(() => {
    const v = videoEl;
    if (!v || v.textTracks.length === 0) return;
    v.textTracks[0]!.mode = showCaptions ? "showing" : "hidden";
  });
  const timelineDuration = $derived(scenes.totalDuration);
  const durationDivergence = $derived.by(() => {
    if (mediaDuration === null || !timelineDuration) return null;
    const diff = Math.abs(mediaDuration - timelineDuration);
    return diff > 0.5 ? { media: mediaDuration, timeline: timelineDuration, diff } : null;
  });

  let currentTime = $state(0);
  let showCaptions = $state(true);

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(sec: number | null): string {
    if (sec === null) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  /* Anchored review at the current playhead. */
  let reviewSent = $state(false);
  let reviewError = $state<string | null>(null);
  let sending = $state(false);

  async function addReview() {
    if (episode.state.phase !== "ready") return;
    const ep = episode.state.episode;
    const client = getGatewayClient();
    sending = true;
    reviewError = null;
    reviewSent = false;
    try {
      await client.fetchJSON(
        `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchor: `render/${render?.file ?? "current"}`,
            body: `Review at ${formatDuration(currentTime)}: `,
          }),
        }
      );
      reviewSent = true;
      refresh.refresh();
    } catch (err) {
      reviewError = err instanceof Error ? err.message : "Failed to create review";
    } finally {
      sending = false;
    }
  }

  const passCount = $derived(qaFindings.filter((f) => f.severity === "pass").length);
  const warnCount = $derived(qaFindings.filter((f) => f.severity === "warn").length);
  const failCount = $derived(qaFindings.filter((f) => f.severity === "fail").length);
</script>

<div class="render-player" aria-label="Render viewer">
  <div class="rp-header">
    <h4 class="rp-title">Render</h4>
    <span class="rp-status" data-status={deliverableState}>
      {STATE_LABELS[deliverableState]}
    </span>
  </div>

  <!-- Video display -->
  <div class="rp-video" aria-label="Video preview — {render ? 'available' : 'unavailable'}">
    {#if render}
      <video
        controls
        class="rp-real-video"
        src={render.url}
        preload="metadata"
        bind:this={videoEl}
        bind:duration={mediaDuration}
        bind:currentTime
      >
        {#if captionsVttUrl}
          <track kind="captions" src={captionsVttUrl} srclang="en" label="Captions" default />
        {/if}
        Your browser cannot play this video.
      </video>
    {:else}
      <div class="rp-video-missing">
        <span>No render on disk for this episode.</span>
        <span class="rp-missing-path">Run the compose stage to produce a deliverable.</span>
      </div>
    {/if}
  </div>

  <!-- Transport and metadata -->
  <div class="rp-transport">
    <div class="rp-timecode" aria-label="Current timecode">
      <span class="rp-tc-current">{formatDuration(currentTime)}</span>
      <span class="rp-tc-sep">/</span>
      <span class="rp-tc-total">{formatDuration(mediaDuration)}</span>
      {#if timelineDuration}
        <span class="rp-tc-timeline">timeline {formatDuration(timelineDuration)}</span>
      {/if}
    </div>
    <div class="rp-transport-actions">
      <label class="rp-caption-toggle" for="rp-cc">
        <input id="rp-cc" name="captions" type="checkbox" bind:checked={showCaptions} />
        CC
      </label>
      <button
        class="rp-review-btn"
        onclick={addReview}
        disabled={sending || !render}
        aria-label="Add review at {formatDuration(currentTime)}"
      >
        {sending ? "Sending…" : "+ Review"}
      </button>
    </div>
  </div>

  {#if reviewSent}
    <p class="rp-note rp-note-ok" role="status">Review thread created — visible in the Reviews tab.</p>
  {/if}
  {#if reviewError}
    <p class="rp-note rp-note-err" role="alert">{reviewError}</p>
  {/if}
  {#if durationDivergence}
    <p class="rp-note rp-note-warn" role="status">
      Media duration {formatDuration(durationDivergence.media)} differs from the storyboard
      timeline {formatDuration(durationDivergence.timeline)} by {durationDivergence.diff.toFixed(1)}s.
      The render does not match the current timeline.
    </p>
  {/if}

  <!-- Meta row: real file facts only -->
  {#if render}
    <div class="rp-meta">
      <span>{render.file}</span>
      <span>{formatBytes(render.size)}</span>
      <span>rendered {new Date(render.generatedAt).toLocaleString()}</span>
    </div>
  {/if}

  <!-- QA Report: only when a real report file exists -->
  <div class="rp-qa" aria-label="Quality report">
    <h5 class="rp-qa-title">
      Quality Report
      {#if qaOverall}
        <span class="rp-qa-summary" data-overall={qaOverall}>
          {qaOverall === "pass" ? "Pass" : "Fail"}
        </span>
        <span class="rp-qa-counts">
          {passCount} pass · {warnCount} warn · {failCount} fail
        </span>
      {/if}
    </h5>

    {#if qaFindings.length > 0}
      <ol class="rp-findings">
        {#each qaFindings as finding (finding.code)}
          <li class="rp-finding" data-severity={finding.severity}>
            <span class="rp-finding-symbol" aria-hidden="true">
              {finding.severity === "pass" ? "✓" : finding.severity === "warn" ? "⚠" : "✗"}
            </span>
            <span class="rp-finding-code">{finding.code}</span>
            <span class="rp-finding-desc">{finding.description}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="rp-qa-empty">
        No QA report on disk for this render.
        {render ? "Run the qa stage to validate the deliverable." : ""}
      </p>
    {/if}
  </div>
</div>

<style>
  .render-player {
    padding: var(--vs-space-4);
  }

  .rp-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--vs-space-3);
  }

  .rp-title {
    font-size: var(--vs-text-md);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0;
  }

  .rp-status {
    font-size: var(--vs-text-xs);
    padding: 1px var(--vs-space-2);
    border-radius: var(--vs-radius-sm);
  }

  .rp-status[data-status="current"] {
    background: var(--vs-state-current-bg);
    color: var(--vs-state-current);
  }

  .rp-status[data-status="stale"] {
    background: var(--vs-state-stale-bg);
    color: var(--vs-state-stale);
  }

  .rp-status[data-status="unvalidated"] {
    background: var(--vs-state-attention-bg);
    color: var(--vs-state-attention);
  }

  .rp-status[data-status="none"] {
    background: var(--vs-bg-raised);
    color: var(--vs-text-tertiary);
  }

  .rp-video {
    aspect-ratio: 16 / 9;
    background: var(--vs-bg-inset);
    border-radius: var(--vs-radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--vs-space-3);
    overflow: hidden;
  }

  .rp-real-video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .rp-video-missing {
    text-align: center;
    color: var(--vs-text-secondary);
    font-size: var(--vs-text-sm);
  }

  .rp-missing-path {
    display: block;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-top: var(--vs-space-1);
  }

  .rp-transport {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--vs-space-2);
  }

  .rp-timecode {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-sm);
  }

  .rp-tc-current {
    color: var(--vs-text-primary);
    font-weight: var(--vs-font-weight-semibold);
  }

  .rp-tc-sep {
    color: var(--vs-text-disabled);
    margin: 0 2px;
  }

  .rp-tc-total {
    color: var(--vs-text-tertiary);
  }

  .rp-tc-timeline {
    color: var(--vs-text-tertiary);
    font-size: var(--vs-text-xs);
    margin-left: var(--vs-space-2);
  }

  .rp-transport-actions {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
  }

  .rp-caption-toggle {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    cursor: pointer;
  }

  .rp-review-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border: 1px solid var(--vs-accent-strong);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-accent-strong);
    color: var(--vs-accent-text);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .rp-review-btn:hover:not(:disabled) {
    background: var(--vs-accent-strong-hover);
  }

  .rp-review-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .rp-note {
    font-size: var(--vs-text-xs);
    padding: var(--vs-space-1) var(--vs-space-2);
    border-radius: var(--vs-radius-sm);
    margin: 0 0 var(--vs-space-2);
  }

  .rp-note-ok {
    color: var(--vs-state-current);
    background: var(--vs-state-current-bg);
  }

  .rp-note-err {
    color: var(--vs-state-blocked);
    background: var(--vs-state-blocked-bg);
  }

  .rp-note-warn {
    color: var(--vs-state-attention);
    background: var(--vs-state-attention-bg);
  }

  .rp-meta {
    display: flex;
    gap: var(--vs-space-3);
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
    margin-bottom: var(--vs-space-4);
    padding-bottom: var(--vs-space-3);
    border-bottom: 1px solid var(--vs-border);
  }

  .rp-qa-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0 0 var(--vs-space-2);
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
  }

  .rp-qa-summary[data-overall="pass"] {
    color: var(--vs-state-current);
    font-size: var(--vs-text-xs);
  }

  .rp-qa-summary[data-overall="fail"] {
    color: var(--vs-state-blocked);
    font-size: var(--vs-text-xs);
  }

  .rp-qa-counts {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    font-weight: var(--vs-font-weight-normal);
  }

  .rp-qa-empty {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .rp-findings {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .rp-finding {
    display: flex;
    gap: var(--vs-space-2);
    align-items: baseline;
    font-size: var(--vs-text-xs);
    padding: 2px 0;
    font-family: var(--vs-font-mono);
  }

  .rp-finding[data-severity="fail"] {
    color: var(--vs-state-blocked);
  }

  .rp-finding[data-severity="warn"] {
    color: var(--vs-state-attention);
  }

  .rp-finding[data-severity="pass"] {
    color: var(--vs-state-current);
  }

  .rp-finding-symbol {
    width: 14px;
    flex-shrink: 0;
  }

  .rp-finding-code {
    font-weight: var(--vs-font-weight-semibold);
    flex-shrink: 0;
    min-width: 120px;
  }

  .rp-finding-desc {
    color: var(--vs-text-secondary);
    font-family: var(--vs-font-sans);
  }
</style>
