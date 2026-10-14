<script lang="ts">
  /**
   * The Audio tab (avg-8hs.5): the audio edits of an episode and of the
   * sources it pins, read-only. Editing stays the recipe's, made by Pi
   * (pva_edit_audio); here they are seen and heard.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { episodeApi, parseEpisodeKey } from "$lib/sheet-review";
  import { whereLabel, type AudioEditsAnswer } from "$lib/audio-edits";
  import AudioEditView from "./AudioEditView.svelte";

  const ref = $derived(parseEpisodeKey(library.selectedEpisode));
  let answer = $state<AudioEditsAnswer | null>(null);
  let error = $state<string | null>(null);
  let selected = $state(0);

  $effect(() => {
    const at = ref;
    answer = null;
    error = null;
    selected = 0;
    if (!at) return;
    let live = true;
    getGatewayClient().fetchJSON<AudioEditsAnswer>(`${episodeApi(at)}/audio-edits`)
      .then((a) => { if (live) answer = a; })
      .catch((err) => { if (live) error = err instanceof Error ? err.message : String(err); });
    return () => { live = false; };
  });
</script>

{#if !ref}
  <p class="at-note">No episode selected.</p>
{:else if error}
  <p class="at-note" role="alert">{error}</p>
{:else if !answer}
  <p class="at-note" role="status">Loading…</p>
{:else if answer.edits.length === 0}
  <p class="at-note">No audio edits yet. Pi makes them with pva_edit_audio (a montage of takes, reshaped pauses, a sound bed); they appear here.</p>
{:else}
  <div class="at">
    <ul class="at-list" aria-label="Audio edits">
      {#each answer.edits as edit, i (`${edit.recordPath}#${i}`)}
        <li>
          <button class:at-on={i === selected} onclick={() => (selected = i)}>
            <span class="at-path">{edit.record.output.path}</span>
            <span class="at-where">{whereLabel(edit.where)}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if answer.invalid.length > 0}
      <p class="at-note" role="alert">Unreadable edit records: {answer.invalid.join(", ")}</p>
    {/if}
    {#key selected}
      <AudioEditView entry={answer.edits[selected]!} />
    {/key}
  </div>
{/if}

<style>
  .at { display: flex; flex-direction: column; gap: var(--vs-space-3); padding: var(--vs-space-4); }
  .at-note { padding: var(--vs-space-4); color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
  .at-list { display: flex; flex-wrap: wrap; gap: var(--vs-space-2); list-style: none; margin: 0; padding: 0; }
  .at-list button {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: var(--vs-space-2) var(--vs-space-3);
    border: 1px solid var(--vs-border-subtle); border-radius: var(--vs-radius-md); background: var(--vs-bg-surface); cursor: pointer;
  }
  .at-list button.at-on { border-color: var(--vs-accent); background: var(--vs-accent-subtle); }
  .at-path { font-family: var(--vs-font-mono); font-size: var(--vs-text-sm); color: var(--vs-text-primary); }
  .at-where { font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); }
</style>
