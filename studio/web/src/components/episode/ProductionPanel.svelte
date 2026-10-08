<script lang="ts">
  /**
   * Running a production, from the studio.
   *
   * The studio could read and edit but never act — it never called /execute,
   * /approve or /snapshot. This is where a stage gets run, approved, or the
   * pipeline gets resolved in the first place.
   *
   * What the runtime says is shown verbatim. A production tool that summarises
   * its engine's errors is a tool you stop trusting the moment one matters.
   */
  import { production, actionsFor } from "$lib/production-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";
  import { untrack } from "svelte";

  /*
   * Follow the selected episode.
   *
   * The load call is untracked: it reads and writes the same store state, and
   * an effect that tracks those reads re-runs itself forever.
   */
  $effect(() => {
    const key = library.selectedEpisode;
    if (!key) return;
    const [channel, series, episode] = key.split("/");
    if (channel && series && episode) {
      untrack(() => production.load({ channel, series, episode }));
    }
  });

  const busy = $derived(production.busyStage !== null);

  /**
   * The stage whose reject note field is open, and what has been typed into
   * it (avg-qr4.3, task 11).
   *
   * No browser `prompt()`: a note that explains what the next attempt has to
   * fix is worth more room and more care than a single-line native dialog
   * gives it, and a dialog cannot be styled to match a disabled Submit.
   */
  let rejectingStage = $state<string | null>(null);
  let rejectNote = $state("");

  function openReject(stageId: string): void {
    rejectingStage = stageId;
    rejectNote = "";
  }

  function cancelReject(): void {
    rejectingStage = null;
    rejectNote = "";
  }

  async function submitReject(stageId: string): Promise<void> {
    const note = rejectNote.trim();
    if (!note) return;
    rejectingStage = null;
    rejectNote = "";
    await production.rejectStage(stageId, note);
  }
</script>

<section class="production" aria-label="Production">
  <header>
    <h3>Production</h3>
    {#if production.pipeline}
      <span class="pipeline">{production.pipeline}</span>
    {/if}
  </header>

  {#if production.loading}
    <p class="note" role="status">Reading stage status…</p>
  {:else if production.needsSnapshot}
    <!-- Not an error: the episode has simply never been resolved. -->
    <div class="unresolved">
      <p>This episode has no resolved pipeline yet.</p>
      <p class="hint">
        Resolving freezes the pipeline, settings and skill versions this episode
        is produced under, so later changes cannot silently alter it.
      </p>
      <button class="primary" onclick={() => production.resolveSnapshot()} disabled={busy}>
        {busy ? "Resolving…" : "Resolve pipeline"}
      </button>
      <!-- /snapshot reports failure by throwing, so it arrives non-2xx and
           `load` never runs: `needsSnapshot` stays true and this branch keeps
           rendering. Without this line a failed resolve looks like the button
           did nothing — the same silence this panel was fixed to stop telling,
           one branch over. -->
      {#if production.error}
        <p class="error" role="alert">{production.error}</p>
      {/if}
    </div>
  {:else if production.error && production.stages.length === 0}
    <p class="error" role="alert">{production.error}</p>
  {:else if production.stages.length === 0}
    <p class="note">No stages reported.</p>
  {:else}
    <!-- Shown beside the pipeline, not instead of it: a refusal is a fact
         about one stage, and hiding the other nine to report it leaves the
         reader with no idea what the episode looks like. -->
    {#if production.error}
      <p class="error" role="alert">{production.error}</p>
    {/if}
    {#if production.lastMessage}
      <p class="said" role="status">{production.lastMessage}</p>
    {/if}

    {#if production.source === "files"}
      <p class="said">These stages are read from the episode's files: Pi makes them with its tools, and the layout sheet is approved in the Storyboard tab.</p>
    {/if}

    <ol class="stages">
      {#each production.stages as stage (stage.stageId)}
        {@const actions = actionsFor(stage.state, production.source)}
        <li>
          <div class="row">
            <span class="state s-{stage.state}">{stage.state}</span>
            <span class="id">{stage.stageId}</span>

            <span class="acts">
              {#each actions as action}
                <button
                  onclick={() => {
                    if (action === "run") production.runStage(stage.stageId);
                    else if (action === "approve") production.approveStage(stage.stageId);
                    else openReject(stage.stageId);
                  }}
                  disabled={busy}
                  title={action === "run"
                    ? `Run ${stage.stageId}`
                    : action === "approve"
                      ? `Approve ${stage.stageId} and let the pipeline continue`
                      : `Reject ${stage.stageId} with a note explaining why`}
                >
                  {production.busyStage === stage.stageId ? "…" : action}
                </button>
              {/each}
            </span>
          </div>

          <!-- Inline, not a browser prompt(): a rejection note is what the
               next attempt has to fix, and Submit stays disabled while it is
               empty — there is no such thing as a reason-free rejection. -->
          {#if rejectingStage === stage.stageId}
            <div class="reject-form">
              <textarea
                class="reject-note"
                placeholder="What has to change before this is accepted?"
                bind:value={rejectNote}
                disabled={busy}
              ></textarea>
              <span class="reject-buttons">
                <button
                  class="primary"
                  onclick={() => submitReject(stage.stageId)}
                  disabled={busy || rejectNote.trim().length === 0}
                >
                  Submit
                </button>
                <button onclick={cancelReject} disabled={busy}>Cancel</button>
              </span>
            </div>
          {/if}

          <!-- A pending or blocked stage now offers no buttons at all, so the
               service's own sentence about why is the only thing it has to
               say. Shown rather than dropped: it names what to fix. -->
          {#if stage.stateReason}
            <p class="why">{stage.stateReason}</p>
          {/if}
          {#if stage.produces.length}
            <p class="produces">{stage.produces.join(", ")}</p>
          {/if}
          {#if stage.dependsOn.length}
            <p class="deps">after {stage.dependsOn.join(", ")}</p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .production {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    font-size: 13px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px 6px;
  }

  h3 {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vs-text-secondary, #888);
  }

  .pipeline {
    font-size: 11px;
    color: var(--vs-text-secondary, #999);
    font-family: var(--vs-font-mono, monospace);
  }

  .note,
  .error,
  .said {
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
  }

  .note {
    color: var(--vs-text-secondary, #777);
  }

  .error {
    color: var(--vs-danger, #c0392b);
    background: var(--vs-danger-subtle, #fdeceb);
    font-family: var(--vs-font-mono, monospace);
    white-space: pre-wrap;
  }

  .said {
    color: var(--vs-text-secondary, #555);
    background: var(--vs-bg-hover, #f5f5f5);
  }

  .unresolved {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }

  .unresolved p {
    margin: 0;
  }

  .hint {
    font-size: 12px;
    color: var(--vs-text-secondary, #888);
  }

  .stages {
    list-style: none;
    margin: 0;
    padding: 0 0 10px;
  }

  .stages li {
    padding: 5px 12px;
    border-top: 1px solid var(--vs-border-subtle, #f0f0f0);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .id {
    flex: 1;
    font-family: var(--vs-font-mono, monospace);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .state {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--vs-bg-hover, #eee);
    color: var(--vs-text-secondary, #777);
    flex-shrink: 0;
    min-width: 62px;
    text-align: center;
  }

  .s-runnable { background: #e8f0fb; color: #2c5aa0; }
  .s-completed { background: #eaf5ec; color: #2e7d4f; }
  .s-awaiting_review { background: #fdf3e2; color: #8a5a0b; }
  .s-blocked, .s-failed { background: #fdeceb; color: #c0392b; }
  .s-stale { background: #f3ecfa; color: #6a3fa0; }

  .acts {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .acts button,
  .primary {
    font: inherit;
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid var(--vs-border-subtle, #d4d4d4);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: var(--vs-text-secondary, #555);
  }

  .acts button:hover:not(:disabled),
  .primary:hover:not(:disabled) {
    background: var(--vs-bg-hover, #f0f0f0);
  }

  .acts button:disabled,
  .primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .primary {
    border-color: var(--vs-accent, #b3510a);
    color: var(--vs-accent, #b3510a);
    padding: 3px 12px;
    font-size: 12px;
  }

  .produces,
  .deps,
  .why {
    margin: 1px 0 0 70px;
    font-size: 11px;
    color: var(--vs-text-secondary, #999);
  }

  .why {
    color: var(--vs-text-secondary, #777);
  }

  .reject-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0 0 70px;
  }

  .reject-note {
    font: inherit;
    font-size: 11px;
    padding: 4px 6px;
    border: 1px solid var(--vs-border-subtle, #d4d4d4);
    border-radius: 4px;
    resize: vertical;
    min-height: 40px;
  }

  .reject-buttons {
    display: flex;
    gap: 4px;
  }
</style>
