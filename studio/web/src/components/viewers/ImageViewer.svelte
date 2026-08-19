<script lang="ts">
  /**
   * The image workspace: the current frame, and a way to hold it against an
   * earlier one.
   *
   * Generated images are chosen, not just produced — the question at this
   * screen is almost always "is this better than the last one". A slider that
   * wipes between two versions in place answers that far better than two
   * thumbnails side by side, because the eye can only judge a small change when
   * the two images occupy the same pixels.
   *
   * The versions offered are the file's real revisions. When there is only one,
   * there is nothing to compare and the strip does not appear.
   */
  import type { ViewerProps } from "$lib/viewer-registry";
  import { files } from "$lib/files-store.svelte.ts";

  let { path, mediaSrc }: ViewerProps = $props();

  /** Revisions whose bytes were actually kept. */
  const comparable = $derived(files.revisions.filter((r) => r.contentAvailable));

  let againstId = $state<string | null>(null);
  let againstSrc = $state<string | null>(null);
  let loadingAgainst = $state(false);
  /** Percentage of the frame showing the *current* version. */
  let split = $state(50);

  /* Reset when the open file changes, so a comparison never carries over onto
     a different image. */
  $effect(() => {
    files.selectedPath;
    againstId = null;
    againstSrc = null;
    split = 50;
  });

  /* Fetch the chosen version's bytes. */
  $effect(() => {
    const id = againstId;
    const filePath = files.selectedPath;
    if (!id || !filePath) {
      againstSrc = null;
      return;
    }

    let cancelled = false;
    let url: string | null = null;
    loadingAgainst = true;

    files.revisionMediaUrl(filePath, id).then((result) => {
      if (cancelled) {
        if (result) URL.revokeObjectURL(result);
        return;
      }
      url = result;
      againstSrc = result;
      loadingAgainst = false;
    });

    return () => {
      cancelled = true;
      loadingAgainst = false;
      if (url) URL.revokeObjectURL(url);
    };
  });

  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function shortWhen(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
</script>

<div class="image">
  {#if comparable.length > 0}
    <div class="im-versions">
      <span class="im-label">Compare with</span>
      <button
        class="im-chip"
        class:active={againstId === null}
        onclick={() => (againstId = null)}
      >
        off
      </button>
      {#each comparable as rev (rev.id)}
        <button
          class="im-chip"
          class:active={againstId === rev.id}
          onclick={() => (againstId = rev.id)}
          title={when(rev.createdAt)}
        >
          {shortWhen(rev.createdAt)}
          <span class="im-chip-reason">{rev.reason}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="im-stage">
    {#if !mediaSrc}
      <p class="im-note">Loading preview…</p>
    {:else}
      <div class="im-frame">
        <!-- The older version sits underneath; the current one is clipped over
             it, so both occupy exactly the same box. -->
        {#if againstSrc}
          <img class="im-under" src={againstSrc} alt="Earlier version of {path}" />
        {/if}

        <img
          class="im-over"
          class:split={againstSrc !== null}
          style={againstSrc ? `clip-path: inset(0 ${100 - split}% 0 0)` : ""}
          src={mediaSrc}
          alt={path}
        />

        {#if againstSrc}
          <span class="im-divider" style="left: {split}%"></span>
          <span class="im-tag im-tag-left">current</span>
          <span class="im-tag im-tag-right">earlier</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if againstId}
    <div class="im-slider">
      <span class="im-end">earlier</span>
      <input
        type="range"
        min="0"
        max="100"
        bind:value={split}
        aria-label="Comparison position"
      />
      <span class="im-end">current</span>
    </div>
  {:else if loadingAgainst}
    <p class="im-note im-foot" role="status">Loading that version…</p>
  {/if}
</div>

<style>
  .image {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .im-versions {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    padding: var(--vs-space-2) var(--vs-space-3);
    border-bottom: 1px solid var(--vs-border);
    overflow-x: auto;
    flex-shrink: 0;
  }

  .im-label {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .im-chip {
    display: flex;
    align-items: baseline;
    gap: var(--vs-space-1);
    padding: 3px 9px;
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
    white-space: nowrap;
  }

  .im-chip:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .im-chip.active {
    border-color: var(--vs-accent);
    background: var(--vs-accent-subtle);
    color: var(--vs-accent-strong);
  }

  .im-chip-reason {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }

  .im-stage {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--vs-space-4);
    background: var(--vs-bg-inset);
    overflow: hidden;
  }

  .im-frame {
    position: relative;
    display: inline-flex;
    max-width: 100%;
    max-height: 100%;
  }

  .im-frame img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  /* The two images must overlap exactly, so the one on top leaves the flow. */
  .im-under {
    position: relative;
  }

  .im-over.split {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .im-divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--vs-accent);
    pointer-events: none;
  }

  .im-tag {
    position: absolute;
    bottom: var(--vs-space-2);
    padding: 2px 6px;
    border-radius: var(--vs-radius-sm);
    background: oklch(0% 0 0 / 0.6);
    color: oklch(100% 0 0);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    pointer-events: none;
  }

  .im-tag-left { left: var(--vs-space-2); }
  .im-tag-right { right: var(--vs-space-2); }

  .im-slider {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
    padding: var(--vs-space-2) var(--vs-space-4);
    border-top: 1px solid var(--vs-border);
    flex-shrink: 0;
  }

  .im-slider input {
    flex: 1;
    accent-color: var(--vs-accent);
  }

  .im-end {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    width: 52px;
    flex-shrink: 0;
  }

  .im-end:last-child {
    text-align: right;
  }

  .im-note {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
  }

  .im-foot {
    padding: var(--vs-space-2) var(--vs-space-4);
  }
</style>
