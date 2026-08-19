<script lang="ts">
  /**
   * Text, with a line gutter.
   *
   * Line numbers are not decoration here: reviews, validation warnings and Pi's
   * own edits are all anchored to lines, so a number you can point at is the
   * shared address for a conversation about the file.
   *
   * The gutter is a separate element scroll-synced to the textarea rather than
   * a background trick, so it stays aligned at any font size and the textarea
   * keeps native editing, selection and spellcheck.
   */
  import type { ViewerProps } from "$lib/viewer-registry";

  let { content, readOnly, onEdit }: ViewerProps = $props();

  let textEl = $state<HTMLTextAreaElement | null>(null);
  let gutterEl = $state<HTMLDivElement | null>(null);

  const lineCount = $derived(content.split("\n").length);

  function syncScroll() {
    if (gutterEl && textEl) gutterEl.scrollTop = textEl.scrollTop;
  }
</script>

<div class="tv-wrap">
  <div class="tv-gutter" bind:this={gutterEl} aria-hidden="true">
    {#each { length: lineCount } as _, i (i)}
      <div class="tv-n">{i + 1}</div>
    {/each}
  </div>

  <textarea
    bind:this={textEl}
    class="tv"
    value={content}
    oninput={(e) => onEdit((e.target as HTMLTextAreaElement).value)}
    onscroll={syncScroll}
    readonly={readOnly}
    spellcheck="true"
    aria-label="File content"
  ></textarea>
</div>

<style>
  .tv-wrap {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    overflow: hidden;
    background: var(--vs-bg-inset);
  }

  .tv-gutter {
    flex-shrink: 0;
    width: 48px;
    overflow: hidden;
    padding: var(--vs-space-3) var(--vs-space-2) var(--vs-space-3) 0;
    text-align: right;
    user-select: none;
    background: var(--vs-bg-inset);
  }

  /* The gutter and the textarea must share identical metrics or the numbers
     drift out of line as the file gets longer. */
  .tv-n,
  .tv {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-sm);
    line-height: 1.65;
  }

  .tv-n {
    color: var(--vs-text-disabled);
  }

  .tv {
    flex: 1;
    min-width: 0;
    resize: none;
    border: none;
    outline: none;
    padding: var(--vs-space-3) var(--vs-space-3) var(--vs-space-3) 0;
    background: transparent;
    color: var(--vs-text-primary);
  }
</style>
