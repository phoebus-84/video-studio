<script lang="ts">
  import { RENDER_ATTEMPT, RENDER_REPORT } from "$lib/render-fixtures";
  import type { RenderAttempt, RenderReport } from "$lib/render-types";

  interface Props {
    attempt?: RenderAttempt;
    report?: RenderReport;
  }

  let { attempt = RENDER_ATTEMPT, report = RENDER_REPORT }: Props = $props();

  let currentTime = $state(0);
  let showCaptions = $state(true);

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function addReview() {
    /* In production: open a review thread at currentTime. */
  }

  const passCount = $derived(report.findings.filter((f) => f.severity === "pass").length);
  const warnCount = $derived(report.findings.filter((f) => f.severity === "warn").length);
  const failCount = $derived(report.findings.filter((f) => f.severity === "fail").length);
</script>

<div class="render-player" aria-label="Render viewer">
  <div class="rp-header">
    <h4 class="rp-title">Render</h4>
    <span class="rp-status" data-status={attempt.status}>
      {attempt.status === "current" ? "Current Deliverable" : attempt.status}
    </span>
  </div>

  <!-- Placeholder video area -->
  <div class="rp-video" aria-label="Video preview — {attempt.fileAvailable ? 'available' : 'unavailable'}">
    {#if attempt.fileAvailable}
      <div class="rp-video-placeholder">
        <span class="rp-video-icon" aria-hidden="true">▶</span>
        <span class="rp-video-label">
          1920×1080 · {formatDuration(attempt.durationSeconds)} · {attempt.fps}fps
        </span>
      </div>
    {:else}
      <div class="rp-video-missing">
        <span>Render file unavailable</span>
        <span class="rp-missing-path">{attempt.filePath}</span>
      </div>
    {/if}
  </div>

  <!-- Transport and metadata -->
  <div class="rp-transport">
    <div class="rp-timecode" aria-label="Current timecode">
      <span class="rp-tc-current">{formatDuration(currentTime)}</span>
      <span class="rp-tc-sep">/</span>
      <span class="rp-tc-total">{formatDuration(attempt.durationSeconds)}</span>
    </div>
    <div class="rp-transport-actions">
      <label class="rp-caption-toggle">
        <input type="checkbox" bind:checked={showCaptions} />
        CC
      </label>
      <button
        class="rp-review-btn"
        onclick={addReview}
        aria-label="Add review at {formatDuration(currentTime)}"
      >
        + Review
      </button>
    </div>
  </div>

  <!-- Meta row -->
  <div class="rp-meta">
    <span>{attempt.codecs.video} / {attempt.codecs.audio}</span>
    <span>{formatBytes(attempt.fileSizeBytes)}</span>
    <span>Render {attempt.id}</span>
  </div>

  <!-- QA Report -->
  <div class="rp-qa" aria-label="Quality report">
    <h5 class="rp-qa-title">
      Quality Report
      <span class="rp-qa-summary" data-overall={report.overall}>
        {report.overall === "pass" ? "✓ Pass" : "✗ Fail"}
      </span>
      <span class="rp-qa-counts">
        {passCount} pass · {warnCount} warn · {failCount} fail
      </span>
    </h5>

    <ol class="rp-findings">
      {#each report.findings as finding (finding.code)}
        <li class="rp-finding" data-severity={finding.severity}>
          <span class="rp-finding-symbol">
            {finding.severity === "pass" ? "✓" : finding.severity === "warn" ? "⚠" : "✗"}
          </span>
          <span class="rp-finding-code">{finding.code}</span>
          <span class="rp-finding-desc">{finding.description}</span>
        </li>
      {/each}
    </ol>
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

  .rp-status[data-status="failed"] {
    background: var(--vs-state-blocked-bg);
    color: var(--vs-state-blocked);
  }

  /* Placeholder video */
  .rp-video {
    aspect-ratio: 16 / 9;
    background: var(--vs-bg-inset);
    border-radius: var(--vs-radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--vs-space-3);
  }

  .rp-video-placeholder {
    text-align: center;
  }

  .rp-video-icon {
    display: block;
    font-size: 3rem;
    color: var(--vs-text-disabled);
    margin-bottom: var(--vs-space-2);
  }

  .rp-video-label {
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
  }

  .rp-video-missing {
    text-align: center;
    color: var(--vs-state-blocked);
    font-size: var(--vs-text-sm);
  }

  .rp-missing-path {
    display: block;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    margin-top: var(--vs-space-1);
  }

  /* Transport */
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
    border: 1px solid var(--vs-accent);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-accent);
    color: var(--vs-accent-text);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .rp-review-btn:hover {
    background: var(--vs-accent-hover);
  }

  /* Meta */
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

  /* QA */
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
