<script lang="ts">
  /**
   * The workspace for a channel or a series.
   *
   * These are deliberately not the episode view. A channel is an identity —
   * brand, characters, references, the voices it uses. A series is a format —
   * its visual bible, templates, pipelines. An episode is a production. They
   * were previously the same component, gated behind episode state, so
   * selecting a channel showed "No episode selected".
   */
  import { files, type LevelRef } from "$lib/files-store.svelte.ts";
  import FileBrowser from "./FileBrowser.svelte";
  import FileViewer from "./FileViewer.svelte";

  interface Props {
    ref: LevelRef;
    title: string;
    /** Immediate children of this level, e.g. the series in a channel. */
    childCount?: number | undefined;
  }

  let { ref, title, childCount }: Props = $props();

  /** What each level is for, in one line, so the two never feel identical. */
  const BLURB: Record<string, string> = {
    channel: "Who this channel is: its brand, characters, references, voices and skills.",
    series: "How this series is made: its visual language, templates and pipelines.",
    episode: "One production.",
  };

  /** Folders worth opening on arrival, per level. */
  const OPEN: Record<string, string[]> = {
    channel: ["brand", "characters", "references"],
    series: ["visual-bible", "templates"],
    episode: ["artifacts"],
  };

  const childLabel = $derived(ref.level === "channel" ? "series" : "episodes");

  /* Load whenever the selected level changes. */
  $effect(() => {
    files.load({ ...ref });
  });
</script>

<div class="level-workspace" data-level={ref.level}>
  <header class="lw-head">
    <div>
      <span class="lw-level">{ref.level}</span>
      <h2>{title}</h2>
      <p class="lw-blurb">{BLURB[ref.level]}</p>
    </div>
    {#if childCount !== undefined}
      <div class="lw-stat">
        <strong>{childCount}</strong>
        <span>{childLabel}</span>
      </div>
    {/if}
  </header>

  <div class="lw-body">
    <aside class="lw-files">
      <FileBrowser initiallyOpen={OPEN[ref.level] ?? []} />
    </aside>
    <section class="lw-viewer">
      <FileViewer />
    </section>
  </div>
</div>

<style>
  .level-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .lw-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--vs-border-subtle, #e5e5e5);
    flex-shrink: 0;
  }

  /* Each level gets its own accent so you always know where you are. */
  .lw-level {
    display: inline-block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 7px;
    border-radius: 3px;
    margin-bottom: 6px;
    background: var(--vs-bg-hover, #eee);
    color: var(--vs-text-secondary, #666);
  }

  [data-level="channel"] .lw-level {
    background: #e8f0fb;
    color: #2c5aa0;
  }

  [data-level="series"] .lw-level {
    background: #eaf5ec;
    color: #2e7d4f;
  }

  .lw-head h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.2;
  }

  .lw-blurb {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--vs-text-secondary, #777);
    max-width: 60ch;
  }

  .lw-stat {
    text-align: right;
    flex-shrink: 0;
  }

  .lw-stat strong {
    display: block;
    font-size: 22px;
    line-height: 1;
  }

  .lw-stat span {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vs-text-secondary, #888);
  }

  .lw-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(200px, 300px) 1fr;
  }

  .lw-files {
    border-right: 1px solid var(--vs-border-subtle, #e5e5e5);
    min-height: 0;
    overflow: hidden;
  }

  .lw-viewer {
    min-height: 0;
    overflow: hidden;
  }

  @media (max-width: 900px) {
    .lw-body {
      grid-template-columns: 1fr;
      grid-template-rows: 200px 1fr;
    }

    .lw-files {
      border-right: none;
      border-bottom: 1px solid var(--vs-border-subtle, #e5e5e5);
    }
  }
</style>
