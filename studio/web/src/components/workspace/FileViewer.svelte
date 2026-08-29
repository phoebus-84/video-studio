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
  import { viewerComponent, needsBytes, resolveViewer } from "$lib/viewer-registry";
  import { isEditableViewer } from "@studio/contracts/src/presentation.mjs";
  import DiffViewer from "../viewers/DiffViewer.svelte";

  /* The artifact names its viewer; this resolves the name to a component,
     narrowing a generic "text" when the file is unmistakably something more
     specific. */
  const viewer = $derived(
    resolveViewer(
      files.selectedPresentation?.viewer,
      files.selectedType,
      files.selectedPath,
    ),
  );

  /* The media URL points at the gateway's streaming route, so there is no blob
     to build, hold or revoke — and nothing to wait for before rendering. */
  const mediaSrc = $derived(
    files.selectedPath && needsBytes(viewer)
      ? files.mediaUrl(files.selectedPath)
      : null,
  );
  const actions = $derived(files.selectedPresentation?.actions ?? []);
  const Viewer = $derived(viewerComponent(viewer));
  const editable = $derived(isEditableViewer(viewer ?? "") && actions.includes("edit"));

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

        <!-- Chips state what this file is and what is true of it right now.
             Each one is read off the artifact; none is decorative. -->
        {#if files.viewingRevision}
          <span class="fv-badge fv-warn">viewing an older version</span>
        {:else if files.dirty}
          <span class="fv-badge fv-dirty">unsaved</span>
        {/if}

        {#if viewer}
          <span class="fv-badge">{viewer}</span>
        {/if}

        {#if files.revisions.length > 0}
          <span class="fv-badge">
            {files.revisions.length} version{files.revisions.length === 1 ? "" : "s"}
          </span>
        {/if}

        {#if files.selectedRevision}
          <span class="fv-badge fv-mono">{files.selectedRevision.slice(0, 8)}</span>
        {/if}
      </div>

      <div class="fv-actions">
        {#if files.comparingRevision}
          <button onclick={() => files.stopComparing()}>Close comparison</button>
          <button
            class="fv-primary"
            onclick={() => files.restore(files.comparingRevision!)}
            title="Restore the older version. The current content is kept, so this is undoable."
          >
            Restore the older version
          </button>
        {:else if files.viewingRevision}
          <button onclick={() => files.viewLive()}>Back to current</button>
          <button
            class="fv-primary"
            onclick={() => files.restore(files.viewingRevision!)}
            title="Restore this version. The current content is kept, so this is undoable."
          >
            Restore this version
          </button>
        {:else if editable}
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
      {#if files.comparingRevision}
        <DiffViewer
          left={files.comparisonContent}
          right={files.liveContent}
          leftLabel="version {formatWhen(files.revisions.find((r) => r.id === files.comparingRevision)?.createdAt ?? '')}"
          rightLabel="current"
        />
      {:else}
        <Viewer
          path={files.selectedPath}
          contentType={files.selectedType}
          content={files.selectedContent}
          {mediaSrc}
          readOnly={!!files.viewingRevision}
          onEdit={(text) => files.edit(text)}
        />
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
              {#if rev.contentAvailable && editable}
                <button
                  class="fv-compare"
                  onclick={() => files.compare(rev.id)}
                  title="Compare this version with the current file"
                >
                  compare
                </button>
              {/if}
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
    background: var(--vs-accent-subtle);
    color: var(--vs-accent-strong);
  }

  .fv-warn {
    background: var(--vs-state-attention-bg);
    color: var(--vs-state-attention);
  }

  .fv-mono {
    font-family: var(--vs-font-mono);
    text-transform: none;
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




  .fv-note {
    margin: auto;
    text-align: center;
    font-size: 13px;
    color: var(--vs-text-secondary, #777);
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

  .fv-history li {
    display: flex;
    align-items: center;
  }

  .fv-compare {
    flex-shrink: 0;
    margin-right: 10px;
    font-size: 10px;
    padding: 1px 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .fv-history li.active > button:first-child {
    background: var(--vs-bg-selected, #fdf0e6);
  }

  /* The timestamp button takes the space; compare sits beside it. */
  .fv-history li > button:first-child {
    flex: 1;
    display: flex;
    gap: 10px;
    min-width: 0;
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
