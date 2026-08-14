<script lang="ts">
  /**
   * The open file: edit it if it is text, preview it if it is media, and move
   * between its versions.
   *
   * The viewer is chosen from the file's content type rather than a hardcoded
   * branch per artifact, so adding a kind — a 3D render, say — is a matter of
   * adding a case here and declaring the type, not rewriting the workspace.
   */
  import { files } from "$lib/files-store.svelte.ts";

  let mediaSrc = $state<string | null>(null);
  let mediaLoading = $state(false);

  const type = $derived(files.selectedType ?? "");
  const isText = $derived(/^(text\/|application\/(json|jsonl|xml|yaml))/.test(type));
  const isImage = $derived(type.startsWith("image/"));
  const isVideo = $derived(type.startsWith("video/"));
  const isAudio = $derived(type.startsWith("audio/"));
  const is3d = $derived(type.startsWith("model/"));

  /* Load media as a blob so the bearer token never lands in a URL. */
  $effect(() => {
    const path = files.selectedPath;
    const needsMedia = !!path && !isText;

    if (!needsMedia) {
      mediaSrc = null;
      return;
    }

    let revoked = false;
    let url: string | null = null;
    mediaLoading = true;

    files.mediaUrl(path).then((result) => {
      if (revoked) {
        if (result) URL.revokeObjectURL(result);
        return;
      }
      url = result;
      mediaSrc = result;
      mediaLoading = false;
    });

    return () => {
      revoked = true;
      mediaLoading = false;
      if (url) URL.revokeObjectURL(url);
    };
  });

  function formatWhen(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

{#if !files.selectedPath}
  <div class="fv-empty">
    <p>Select a file to view or edit it.</p>
  </div>
{:else}
  <div class="file-viewer">
    <header class="fv-head">
      <div class="fv-title">
        <span class="fv-path">{files.selectedPath}</span>
        {#if files.viewingRevision}
          <span class="fv-badge">viewing an older version</span>
        {:else if files.dirty}
          <span class="fv-badge fv-dirty">unsaved</span>
        {/if}
      </div>

      <div class="fv-actions">
        {#if files.viewingRevision}
          <button onclick={() => files.viewLive()}>Back to current</button>
          <button
            class="fv-primary"
            onclick={() => files.restore(files.viewingRevision!)}
            title="Restore this version. The current content is kept, so this is undoable."
          >
            Restore this version
          </button>
        {:else if isText}
          <button class="fv-primary" onclick={() => files.save()} disabled={!files.dirty || files.saving}>
            {files.saving ? "Saving…" : "Save"}
          </button>
        {/if}
      </div>
    </header>

    {#if files.error}
      <p class="fv-error" role="alert">{files.error}</p>
    {/if}

    <div class="fv-body">
      {#if isText}
        <textarea
          class="fv-text"
          value={files.selectedContent}
          oninput={(e) => files.edit((e.target as HTMLTextAreaElement).value)}
          readonly={!!files.viewingRevision}
          spellcheck="true"
          aria-label="File content"
        ></textarea>
      {:else if mediaLoading}
        <p class="fv-note">Loading preview…</p>
      {:else if isImage && mediaSrc}
        <div class="fv-media"><img src={mediaSrc} alt={files.selectedPath} /></div>
      {:else if isVideo && mediaSrc}
        <div class="fv-media"><!-- svelte-ignore a11y_media_has_caption --><video src={mediaSrc} controls></video></div>
      {:else if isAudio && mediaSrc}
        <div class="fv-media"><audio src={mediaSrc} controls></audio></div>
      {:else if is3d}
        <div class="fv-note">
          <p>3D model ({type}).</p>
          <p class="fv-hint">
            No viewer is registered for this type yet. It will render here once one is.
          </p>
          {#if mediaSrc}<a href={mediaSrc} download={files.selectedPath}>Download</a>{/if}
        </div>
      {:else}
        <div class="fv-note">
          <p>No preview for {type || "this file type"}.</p>
          {#if mediaSrc}<a href={mediaSrc} download={files.selectedPath}>Download</a>{/if}
        </div>
      {/if}
    </div>

    {#if files.revisions.length > 0}
      <section class="fv-history">
        <h3>Versions <span class="fv-count">{files.revisions.length}</span></h3>
        <ul>
          {#each files.revisions as rev (rev.id)}
            <li class:active={files.viewingRevision === rev.id}>
              <button
                onclick={() => files.viewRevision(rev.id)}
                disabled={!rev.contentAvailable}
                title={rev.contentAvailable
                  ? "Preview this version"
                  : "Too large to keep a copy; metadata only"}
              >
                <span class="fv-when">{formatWhen(rev.createdAt)}</span>
                <span class="fv-meta">{formatSize(rev.size)}</span>
                <span class="fv-reason">{rev.reason}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}

<style>
  .file-viewer,
  .fv-empty {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .fv-empty {
    align-items: center;
    justify-content: center;
    color: var(--vs-text-secondary, #888);
    font-size: 14px;
  }

  .fv-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vs-border-subtle, #e5e5e5);
    flex-shrink: 0;
  }

  .fv-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .fv-path {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fv-badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--vs-bg-hover, #eee);
    color: var(--vs-text-secondary, #666);
    flex-shrink: 0;
  }

  .fv-dirty {
    background: var(--vs-accent-subtle, #fdf0e6);
    color: var(--vs-accent, #b3510a);
  }

  .fv-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .fv-actions button,
  .fv-history button {
    font: inherit;
    font-size: 12px;
    padding: 3px 10px;
    border: 1px solid var(--vs-border-subtle, #d4d4d4);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: var(--vs-text-secondary, #555);
  }

  .fv-actions button:hover:not(:disabled) {
    background: var(--vs-bg-hover, #f0f0f0);
  }

  .fv-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .fv-primary {
    border-color: var(--vs-accent, #b3510a);
    color: var(--vs-accent, #b3510a);
  }

  .fv-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .fv-text {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    padding: 12px;
    font-family: var(--vs-font-mono, ui-monospace, monospace);
    font-size: 13px;
    line-height: 1.55;
    background: transparent;
    color: var(--vs-text-primary, #222);
  }

  .fv-media {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    overflow: auto;
  }

  .fv-media img,
  .fv-media video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .fv-note {
    margin: auto;
    text-align: center;
    font-size: 13px;
    color: var(--vs-text-secondary, #777);
  }

  .fv-hint {
    font-size: 12px;
    opacity: 0.8;
  }

  .fv-error {
    margin: 0;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--vs-danger, #c0392b);
  }

  .fv-history {
    border-top: 1px solid var(--vs-border-subtle, #e5e5e5);
    max-height: 30%;
    overflow: auto;
    flex-shrink: 0;
  }

  .fv-history h3 {
    margin: 0;
    padding: 8px 12px 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vs-text-secondary, #888);
  }

  .fv-count {
    opacity: 0.7;
  }

  .fv-history ul {
    list-style: none;
    margin: 0;
    padding: 0 0 8px;
  }

  .fv-history li.active button {
    background: var(--vs-bg-selected, #fdf0e6);
  }

  .fv-history button {
    display: flex;
    gap: 10px;
    width: 100%;
    border: none;
    border-radius: 0;
    padding: 4px 12px;
    text-align: left;
  }

  .fv-when {
    flex: 1;
  }

  .fv-meta,
  .fv-reason {
    font-size: 10px;
    opacity: 0.7;
  }

  .fv-reason {
    text-transform: uppercase;
  }
</style>
