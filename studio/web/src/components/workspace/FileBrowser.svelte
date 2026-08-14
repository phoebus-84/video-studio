<script lang="ts">
  /**
   * Everything at a level, as a tree.
   *
   * Replaces probing five hardcoded filenames. Folders collapse, files show
   * their kind and size, and anything can be created, uploaded, or removed.
   */
  import { files, type FileEntry } from "$lib/files-store.svelte.ts";

  interface Props {
    /** Folders to show expanded on first load, e.g. a channel's knowledge dirs. */
    initiallyOpen?: string[];
  }

  let { initiallyOpen = [] }: Props = $props();

  // Seeded once on mount; afterwards the user's expansion state owns this.
  let expanded = $state<Set<string>>(new Set(initiallyOpen as string[]));
  let creating = $state<null | "file" | "directory">(null);
  let newName = $state("");
  let uploadInput = $state<HTMLInputElement | null>(null);

  /** Immediate children of a folder, from the recursive listing. */
  function childrenOf(prefix: string): FileEntry[] {
    const depth = prefix === "" ? 1 : prefix.split("/").length + 1;
    return files.entries.filter((e) => {
      if (prefix !== "" && !e.path.startsWith(prefix + "/")) return false;
      if (prefix === "" && e.path.includes("/")) return false;
      return e.path.split("/").length === depth;
    });
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    next.has(path) ? next.delete(path) : next.add(path);
    expanded = next;
  }

  function formatSize(bytes: number | null): string {
    if (bytes === null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /** A short label for the kind of thing a file is. */
  function kindLabel(entry: FileEntry): string {
    const t = entry.contentType ?? "";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    if (t.startsWith("audio/")) return "audio";
    if (t.startsWith("model/")) return "3d";
    if (t.startsWith("text/") || t.startsWith("application/json")) return "text";
    return "";
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name || !creating) return;
    await files.create(name, creating);
    newName = "";
    creating = null;
  }

  async function onUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) await files.upload("", input.files);
    input.value = "";
  }

  async function remove(entry: FileEntry) {
    const recursive = entry.kind === "directory";
    const what = recursive ? `"${entry.path}" and everything inside it` : `"${entry.path}"`;
    if (!confirm(`Delete ${what}?\n\nFiles can be recovered from their version history.`)) return;
    await files.remove(entry.path, recursive);
  }
</script>

{#snippet tree(prefix: string, depth: number)}
  {#each childrenOf(prefix) as entry (entry.path)}
    <li>
      <div
        class="fb-row"
        class:selected={files.selectedPath === entry.path}
        style="padding-left: {depth * 14 + 8}px"
      >
        {#if entry.kind === "directory"}
          <button
            class="fb-item fb-dir"
            onclick={() => toggle(entry.path)}
            aria-expanded={expanded.has(entry.path)}
          >
            <span class="fb-caret" class:open={expanded.has(entry.path)} aria-hidden="true">▸</span>
            <span class="fb-name">{entry.name}</span>
          </button>
        {:else}
          <button class="fb-item" onclick={() => files.open(entry)}>
            <span class="fb-name">{entry.name}</span>
            {#if kindLabel(entry)}<span class="fb-kind">{kindLabel(entry)}</span>{/if}
            <span class="fb-size">{formatSize(entry.size)}</span>
          </button>
        {/if}
        <button class="fb-del" onclick={() => remove(entry)} title="Delete {entry.name}">×</button>
      </div>

      {#if entry.kind === "directory" && expanded.has(entry.path)}
        <ul class="fb-children">{@render tree(entry.path, depth + 1)}</ul>
      {/if}
    </li>
  {/each}
{/snippet}

<div class="file-browser">
  <div class="fb-toolbar">
    <button onclick={() => { creating = "file"; newName = ""; }} title="New file">+ File</button>
    <button onclick={() => { creating = "directory"; newName = ""; }} title="New folder">+ Folder</button>
    <button onclick={() => uploadInput?.click()} title="Upload files of any type">Upload</button>
    <input
      bind:this={uploadInput}
      type="file"
      multiple
      onchange={onUpload}
      hidden
      aria-label="Upload files"
    />
  </div>

  {#if creating}
    <form class="fb-create" onsubmit={(e) => { e.preventDefault(); submitCreate(); }}>
      <input
        bind:value={newName}
        placeholder={creating === "file" ? "notes/idea.md" : "characters"}
        aria-label="New {creating} path"
      />
      <button type="submit">Create</button>
      <button type="button" onclick={() => (creating = null)}>Cancel</button>
    </form>
  {/if}

  {#if files.loading}
    <p class="fb-note">Loading…</p>
  {:else if files.error}
    <p class="fb-note fb-error" role="alert">{files.error}</p>
  {:else if files.entries.length === 0}
    <p class="fb-note">Nothing here yet. Create a file or upload something.</p>
  {:else}
    <ul class="fb-tree">{@render tree("", 0)}</ul>
  {/if}
</div>

<style>
  .file-browser {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: auto;
  }

  .fb-toolbar {
    display: flex;
    gap: 4px;
    padding: 8px;
    position: sticky;
    top: 0;
    background: var(--vs-bg-panel, #fff);
    border-bottom: 1px solid var(--vs-border-subtle, #e5e5e5);
  }

  .fb-toolbar button,
  .fb-create button {
    font: inherit;
    font-size: 12px;
    padding: 3px 8px;
    border: 1px solid var(--vs-border-subtle, #d4d4d4);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: var(--vs-text-secondary, #555);
  }

  .fb-toolbar button:hover,
  .fb-create button:hover {
    background: var(--vs-bg-hover, #f0f0f0);
  }

  .fb-create {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--vs-border-subtle, #e5e5e5);
  }

  .fb-create input {
    flex: 1;
    font: inherit;
    font-size: 12px;
    padding: 3px 6px;
    border: 1px solid var(--vs-border-subtle, #d4d4d4);
    border-radius: 4px;
  }

  .fb-tree,
  .fb-children {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .fb-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 4px;
  }

  .fb-row:hover {
    background: var(--vs-bg-hover, #f5f5f5);
  }

  .fb-row.selected {
    background: var(--vs-bg-selected, #fdf0e6);
  }

  .fb-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    text-align: left;
    padding: 3px 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vs-text-primary, #222);
  }

  .fb-dir .fb-name {
    font-weight: 600;
  }

  .fb-caret {
    display: inline-block;
    width: 10px;
    font-size: 9px;
    transition: transform 0.12s ease;
    color: var(--vs-text-secondary, #888);
  }

  .fb-caret.open {
    transform: rotate(90deg);
  }

  .fb-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fb-kind,
  .fb-size {
    font-size: 10px;
    color: var(--vs-text-secondary, #999);
    flex-shrink: 0;
  }

  .fb-kind {
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .fb-del {
    opacity: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 4px;
    color: var(--vs-text-secondary, #999);
  }

  .fb-row:hover .fb-del {
    opacity: 1;
  }

  .fb-del:hover {
    color: var(--vs-danger, #c0392b);
  }

  .fb-note {
    padding: 12px;
    font-size: 13px;
    color: var(--vs-text-secondary, #777);
  }

  .fb-error {
    color: var(--vs-danger, #c0392b);
  }
</style>
