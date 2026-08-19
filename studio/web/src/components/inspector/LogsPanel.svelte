<script lang="ts">
  /**
   * The episode journal.
   *
   * This is evidence, so it is monospaced, in order, and not summarised. When
   * the journal is empty that is stated as a fact about the journal rather than
   * dressed up as "all clear" — an empty journal and a healthy run are not the
   * same thing.
   */
  import { journal } from "$lib/journal-store.svelte.ts";
  import { library } from "$lib/library-store.svelte.ts";

  /* Follow the selected episode. Loading in the panel rather than the shell
     keeps the request from firing for creators who never open this tab. */
  $effect(() => {
    const key = library.selectedEpisode;
    if (!key) {
      journal.clear();
      return;
    }
    if (journal.loadedFor !== key) void journal.load(key);
  });
</script>

<div class="logs">
  {#if !library.selectedEpisode}
    <p class="log-note">Select an episode to read its journal.</p>
  {:else if journal.loading}
    <p class="log-note" role="status">Reading the journal…</p>
  {:else if journal.error}
    <p class="log-note log-error" role="alert">{journal.error}</p>
  {:else if journal.entries.length === 0}
    <p class="log-note">
      The journal has no entries for this episode yet.
    </p>
  {:else}
    <ol class="log-list">
      {#each journal.entries as entry (entry.id)}
        <li class="log-row">
          <span class="log-time">{entry.time ?? "--:--:--"}</span>
          <span class="log-level" data-level={entry.level}>{entry.level}</span>
          <span class="log-message">{entry.message}</span>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .logs {
    padding: var(--vs-space-3);
  }

  .log-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    text-align: center;
    line-height: var(--vs-leading-normal);
  }

  .log-error {
    color: var(--vs-state-blocked);
  }

  .log-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .log-row {
    display: flex;
    gap: var(--vs-space-2);
    padding: 3px 0;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    line-height: var(--vs-leading-normal);
  }

  .log-time {
    color: var(--vs-text-disabled);
    flex-shrink: 0;
  }

  .log-level {
    width: 38px;
    flex-shrink: 0;
    color: var(--vs-text-tertiary);
  }

  .log-level[data-level="WARN"] { color: var(--vs-state-attention); }
  .log-level[data-level="ERROR"] { color: var(--vs-state-blocked); }

  .log-message {
    color: var(--vs-text-secondary);
    word-break: break-word;
  }
</style>
