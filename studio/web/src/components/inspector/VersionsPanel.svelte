<script lang="ts">
  /**
   * Every saved version of the open file, with a way to see and undo the change.
   *
   * "Compare" is the useful verb, not "restore": a version list answers when
   * something changed, and only a comparison answers what changed. Restore is
   * offered beside it and is itself undoable, since the current content is kept
   * as a new version rather than overwritten.
   */
  import { files } from "$lib/files-store.svelte.ts";

  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  function size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<div class="versions">
  {#if !files.selectedPath}
    <p class="v-empty">Open a file to see its versions.</p>
  {:else if files.revisions.length === 0}
    <p class="v-empty">
      No saved versions yet. One is written each time this file is saved,
      restored or deleted.
    </p>
  {:else}
    {#if files.comparingRevision}
      <div class="v-comparing">
        <span>Comparing with the version from {when(files.revisions.find((r) => r.id === files.comparingRevision)?.createdAt ?? "")}.</span>
        <button onclick={() => files.stopComparing()}>Close comparison</button>
      </div>
    {/if}

    <ul class="v-list">
      {#each files.revisions as rev (rev.id)}
        <li class="v-item" class:active={files.viewingRevision === rev.id}>
          <div class="v-head">
            <span class="v-when">{when(rev.createdAt)}</span>
            <span class="v-reason">{rev.reason}</span>
          </div>
          <div class="v-meta">{size(rev.size)} · {rev.revision}</div>

          {#if rev.contentAvailable}
            <div class="v-actions">
              <button onclick={() => files.compare(rev.id)}>Compare</button>
              <button onclick={() => files.viewRevision(rev.id)}>Preview</button>
              <button
                onclick={() => files.restore(rev.id)}
                title="The current content is kept as a new version, so this is undoable."
              >
                Restore
              </button>
            </div>
          {:else}
            <!-- Some versions record only that a change happened; the content
                 was too large to keep a copy of. Saying so beats a Compare
                 button that cannot work. -->
            <p class="v-unavailable">Too large to keep a copy — metadata only.</p>
          {/if}
        </li>
      {/each}
    </ul>

    {#if files.viewingRevision}
      <button class="v-back" onclick={() => files.viewLive()}>
        Back to the current version
      </button>
    {/if}
  {/if}
</div>

<style>
  .versions {
    padding: var(--vs-space-3);
  }

  .v-empty {
    margin: 0;
    font-size: var(--vs-text-sm);
    color: var(--vs-text-tertiary);
    text-align: center;
    line-height: var(--vs-leading-normal);
  }

  .v-comparing {
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-1);
    padding: var(--vs-space-2);
    margin-bottom: var(--vs-space-2);
    border-radius: var(--vs-radius-md);
    background: var(--vs-accent-subtle);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
  }

  .v-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .v-item {
    padding: var(--vs-space-2);
    border: 1px solid var(--vs-border-subtle);
    border-radius: var(--vs-radius-lg);
    margin-bottom: var(--vs-space-2);
  }

  /* The version you are previewing is the one the canvas is showing, so it is
     marked here rather than only in the canvas. */
  .v-item.active {
    border-color: var(--vs-accent);
    background: var(--vs-accent-subtle);
  }

  .v-head {
    display: flex;
    align-items: baseline;
    gap: var(--vs-space-2);
  }

  .v-when {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-medium);
  }

  .v-reason {
    margin-left: auto;
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vs-text-tertiary);
  }

  .v-meta {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    padding-top: 2px;
  }

  .v-actions {
    display: flex;
    gap: var(--vs-space-1);
    padding-top: var(--vs-space-2);
  }

  .v-actions button,
  .v-back {
    padding: 2px var(--vs-space-2);
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .v-actions button:hover,
  .v-back:hover {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .v-back {
    width: 100%;
    padding: var(--vs-space-2);
  }

  .v-unavailable {
    margin: var(--vs-space-1) 0 0;
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
  }
</style>
