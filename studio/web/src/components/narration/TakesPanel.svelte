<script lang="ts">
  /**
   * The Narration of a spec-driven episode (avg-goz): its registered takes,
   * unit by unit with the pause before each, each with its voice, its text and
   * whether it is aligned — and played, its words lit as they are said. The
   * pinned source's takes follow, read-only. Nothing here synthesizes or
   * registers a take: that stays Pi's.
   */
  import { onDestroy } from "svelte";
  import { mediaUrl } from "$lib/episode-media";
  import { inOrder, wordAt, type NarrationTakesAnswer, type TakeView } from "$lib/narration-takes";

  let { answer }: { answer: NarrationTakesAnswer } = $props();

  let playing = $state<string | null>(null);
  let current = $state(-1);
  let loading = $state<string | null>(null);
  let error = $state<string | null>(null);
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  /** Each play asks for a generation; a fetch that comes back after another click, or after the tab closed, is dropped. */
  let generation = 0;

  const keyOf = (take: TakeView) => {
    const a = take.audio as Record<string, string> | null;
    return `${a?.series ?? ""}/${a?.episode ?? a?.source ?? ""}/${take.id}`;
  };
  const own = $derived(inOrder(answer.units, answer.takes));
  const totalSeconds = $derived(own.reduce((sum, row) => sum + (row.take.durationSeconds ?? 0) + (row.pauseBefore ?? 0), 0));

  function stop() {
    generation += 1;
    if (audio) {
      audio.ontimeupdate = null;
      audio.onended = null;
      audio.pause();
    }
    audio = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    playing = null;
    current = -1;
  }

  async function toggle(take: TakeView) {
    const key = keyOf(take);
    if (playing === key) return stop();
    stop();
    if (!take.audio) return;
    error = null;
    loading = key;
    const mine = generation;
    const made = await mediaUrl(take.audio, take.audio.path);
    if (mine !== generation) {
      if (made) URL.revokeObjectURL(made);
      return;
    }
    loading = null;
    if (!made) {
      error = `${take.id}: its audio could not be read (${take.audio.path})`;
      return;
    }
    url = made;
    const player = new Audio(made);
    audio = player;
    playing = key;
    player.ontimeupdate = () => (current = wordAt(take.words, player.currentTime));
    player.onended = () => stop();
    player.play().catch((err: unknown) => {
      if (audio !== player) return;
      stop();
      error = `${take.id}: it cannot be played here (${err instanceof Error ? err.message : String(err)})`;
    });
  }

  const seconds = (s: number | null) => (s === null ? "—" : `${s.toFixed(2)} s`);
  onDestroy(stop);
</script>

{#snippet takeRow(take: TakeView, pauseBefore: number | null, readOnly: boolean)}
  {@const key = keyOf(take)}
  <li class="tp-take" data-playing={playing === key}>
    {#if pauseBefore}<span class="tp-pause">pause {pauseBefore} s</span>{/if}
    <div class="tp-head">
      <button class="tp-play" disabled={!take.audio || loading === key} onclick={() => toggle(take)}
        aria-label={playing === key ? `Stop ${take.id}` : `Play ${take.id}`}>
        {loading === key ? "…" : playing === key ? "■" : "▶"}
      </button>
      <span class="tp-id">{take.id}</span>
      <span class="tp-duration">{seconds(take.durationSeconds)}</span>
      <span class="tp-voice" title={take.voice?.direction ?? ""}>{take.voice?.provider ?? "—"}{take.voice?.voiceId ? ` · ${take.voice.voiceId}` : ""}</span>
      <span class="tp-badge" data-aligned={take.words !== null}>{take.words !== null ? `aligned · ${take.words.length} words` : "not aligned"}</span>
      {#if readOnly}<span class="tp-badge">pinned · read-only</span>{/if}
    </div>
    <p class="tp-text" lang={take.language ?? null}>
      {#if take.words && playing === key}
        {#each take.words as word, i (i)}<span class="tp-word" data-current={i === current}>{word.text}</span>{" "}{/each}
      {:else}
        {take.text}
      {/if}
    </p>
    {#if take.spokenText && take.spokenText !== take.text}
      <p class="tp-spoken"><span>said as</span> {take.spokenText}</p>
    {/if}
  </li>
{/snippet}

<section class="takes-panel" aria-label="Narration takes">
  <header class="tp-header">
    <h4 class="tp-title">Narration takes</h4>
    <span class="tp-summary">{answer.takes.length} takes · {Math.floor(totalSeconds / 60)}:{String(Math.round(totalSeconds % 60)).padStart(2, "0")} with pauses</span>
  </header>
  {#if error}<p class="tp-error" role="alert">{error}</p>{/if}

  {#if !answer.takes.length}
    <p class="tp-note">No registered takes yet: Pi makes them (pva_synthesize_speech, then pva_register_take and pva_align_take).</p>
  {:else}
    <ol class="tp-list">
      {#each own as row, i (`${row.unit ?? ""}#${i}`)}
        {@render takeRow(row.take, row.pauseBefore, false)}
      {/each}
    </ol>
  {/if}

  {#each answer.sources as source, s (`${source.pin}#${s}`)}
    <h5 class="tp-source">From {source.pin} <span>({source.episode ? `${source.episode.series}/${source.episode.episode}` : `sources/${source.source?.name}`})</span></h5>
    <ol class="tp-list">
      {#each inOrder(source.units, source.takes) as row, i (`${row.unit ?? ""}#${i}`)}
        {@render takeRow(row.take, row.pauseBefore, true)}
      {/each}
    </ol>
  {/each}
</section>

<style>
  .takes-panel { display: flex; flex-direction: column; gap: var(--vs-space-3); padding: var(--vs-space-4); overflow: auto; height: 100%; }
  .tp-header { display: flex; align-items: baseline; gap: var(--vs-space-3); }
  .tp-title { margin: 0; font-size: var(--vs-text-md); font-weight: var(--vs-font-weight-semibold); color: var(--vs-text-primary); }
  .tp-summary, .tp-duration, .tp-pause { font-family: var(--vs-font-mono); font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); }
  .tp-note { margin: 0; color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
  .tp-error { margin: 0; color: var(--vs-danger); font-size: var(--vs-text-sm); }
  .tp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .tp-take { display: flex; flex-direction: column; gap: var(--vs-space-1); padding: var(--vs-space-2) 0; border-bottom: 1px solid var(--vs-border-subtle); }
  .tp-take[data-playing="true"] { background: var(--vs-bg-selected); }
  .tp-head { display: flex; align-items: center; gap: var(--vs-space-3); flex-wrap: wrap; }
  .tp-play { font: inherit; width: 2rem; height: 1.75rem; border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-raised); color: var(--vs-text-primary); cursor: pointer; }
  .tp-play:disabled { color: var(--vs-text-disabled); cursor: default; }
  .tp-play:focus-visible { outline: 2px solid var(--vs-border-focus); outline-offset: 1px; }
  .tp-id { font-family: var(--vs-font-mono); font-size: var(--vs-text-sm); color: var(--vs-text-primary); font-weight: var(--vs-font-weight-medium); }
  .tp-voice { font-size: var(--vs-text-xs); color: var(--vs-text-secondary); }
  .tp-badge { font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); border: 1px solid var(--vs-border-subtle); border-radius: var(--vs-radius-sm); padding: 0 var(--vs-space-1); }
  .tp-badge[data-aligned="false"] { color: var(--vs-state-stale); border-color: var(--vs-state-stale); }
  .tp-text { margin: 0; font-size: var(--vs-text-sm); color: var(--vs-text-secondary); max-width: 80ch; line-height: var(--vs-leading-normal); }
  .tp-word[data-current="true"] { color: var(--vs-text-primary); background: var(--vs-accent-subtle); border-radius: 2px; }
  .tp-spoken { margin: 0; font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); max-width: 80ch; }
  .tp-spoken span { font-family: var(--vs-font-mono); }
  .tp-source { margin: var(--vs-space-3) 0 0; font-size: var(--vs-text-sm); font-weight: var(--vs-font-weight-semibold); color: var(--vs-text-primary); }
  .tp-source span { font-family: var(--vs-font-mono); font-weight: var(--vs-font-weight-normal); color: var(--vs-text-tertiary); }
</style>
