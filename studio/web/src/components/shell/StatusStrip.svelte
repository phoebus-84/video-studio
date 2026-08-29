<script lang="ts">
  /**
   * The always-present production state line.
   *
   * Which state wins is decided in `production-status.ts`; this only draws it.
   * The strip keeps its row whatever the state, so the canvas below never
   * shifts when a run starts, blocks or finishes.
   */
  import {
    deriveStatusStrip,
    STRIP_STATE,
    type LevelRollup,
    type StripAction,
  } from "$lib/production-status";
  import type { EpisodeWorkspace } from "$lib/episode-types";

  interface Props {
    connected: boolean;
    episode: EpisodeWorkspace | null;
    /** Summary of what is under the selected channel or series, when no
        episode is open. */
    rollup?: LevelRollup | null;
    lastSeen?: string | null;
    /** The shell owns what an action id means. */
    onaction: (id: string) => void;
  }

  let {
    connected,
    episode,
    rollup = null,
    lastSeen = null,
    onaction,
  }: Props = $props();

  const strip = $derived(
    deriveStatusStrip({ connected, episode, rollup, lastSeen }),
  );
  const state = $derived(STRIP_STATE[strip.kind]);

  const pct = $derived(
    strip.progress === null ? null : Math.round(strip.progress * 100),
  );

  function actionClass(action: StripAction): string {
    return action.primary ? "strip-btn strip-primary" : "strip-btn";
  }
</script>

<div class="strip" data-state={state} data-kind={strip.kind} role="status">
  <span class="strip-title">
    <!-- The dot repeats the state the colour already carries; the title beside
         it is what actually names it, so colour is never the only signal. -->
    <span class="strip-dot" class:pulsing={strip.kind === "running"} aria-hidden="true"></span>
    {strip.title}
  </span>

  {#if strip.detail}
    <span class="strip-detail">{strip.detail}</span>
  {/if}

  {#if pct !== null}
    <span
      class="strip-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Stage progress"
    >
      <span class="strip-fill" style="width: {pct}%"></span>
    </span>
    <span class="strip-pct">{pct}%</span>
  {/if}

  {#if strip.actions.length > 0}
    <span class="strip-actions">
      {#each strip.actions as action (action.id)}
        <button class={actionClass(action)} onclick={() => onaction(action.id)}>
          {action.label}
        </button>
      {/each}
    </span>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
    padding: 0 var(--vs-space-3);
    height: var(--vs-strip-height);
    border-bottom: 1px solid var(--vs-border);
    font-size: var(--vs-text-sm);
    overflow: hidden;
  }

  /* One tinted band per state, drawn from the semantic tokens rather than a
     per-state hex, so both themes stay in step. */
  .strip[data-state="running"] { background: var(--vs-state-running-bg); }
  .strip[data-state="blocked"] { background: var(--vs-state-blocked-bg); }
  .strip[data-state="attention"] { background: var(--vs-state-attention-bg); }
  .strip[data-state="current"] { background: var(--vs-state-current-bg); }
  .strip[data-state="stale"] { background: var(--vs-bg-raised); }

  .strip-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: var(--vs-font-weight-semibold);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .strip[data-state="running"] .strip-title { color: var(--vs-state-running); }
  .strip[data-state="blocked"] .strip-title { color: var(--vs-state-blocked); }
  .strip[data-state="attention"] .strip-title { color: var(--vs-state-attention); }
  .strip[data-state="current"] .strip-title { color: var(--vs-state-current); }
  .strip[data-state="stale"] .strip-title { color: var(--vs-text-secondary); }

  .strip-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  /* Motion here explains state — work is happening — rather than decorating. */
  .pulsing {
    animation: strip-pulse 1.5s ease-in-out infinite;
  }

  @keyframes strip-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulsing { animation: none; }
  }

  .strip-detail {
    color: var(--vs-text-secondary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strip-track {
    width: 160px;
    height: 4px;
    border-radius: 2px;
    background: var(--vs-border);
    overflow: hidden;
    flex-shrink: 0;
  }

  .strip-fill {
    display: block;
    height: 100%;
    background: var(--vs-state-running);
  }

  .strip-pct {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .strip-actions {
    margin-left: auto;
    display: flex;
    gap: var(--vs-space-1);
    flex-shrink: 0;
  }

  .strip-btn {
    padding: 3px 10px;
    border-radius: var(--vs-radius-md);
    border: 1px solid var(--vs-border);
    background: none;
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
    white-space: nowrap;
  }

  .strip-btn:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .strip-primary {
    background: var(--vs-accent);
    border-color: var(--vs-accent);
    color: var(--vs-accent-text);
    font-weight: var(--vs-font-weight-semibold);
  }

  .strip-primary:hover {
    background: var(--vs-accent-hover);
    color: var(--vs-accent-text);
  }
</style>
