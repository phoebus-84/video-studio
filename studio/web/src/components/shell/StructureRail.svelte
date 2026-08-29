<script lang="ts">
  /**
   * The library rail: a filter, the tree, and the two ways to put something new
   * into the current level.
   */
  import LibraryNav from "../library/LibraryNav.svelte";
  import { studio } from "$lib/studio-store.svelte.ts";
  import { files } from "$lib/files-store.svelte.ts";

  let uploadEl = $state<HTMLInputElement | null>(null);

  /* Creating and uploading act on whichever level is loaded. With none loaded
     there is nowhere to put the file, so the buttons say so by being disabled
     rather than failing after the click. */
  const target = $derived(files.ref);

  async function newFile() {
    const name = prompt("New file, relative to this level:");
    if (!name?.trim()) return;
    await files.create(name.trim(), "file");
  }

  async function onUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      await files.upload("", input.files);
    }
    /* Clear so re-picking the same file fires change again. */
    input.value = "";
  }
</script>

<nav class="structure-rail" aria-label="Library structure">
  <div class="rail-filter">
    <input
      type="search"
      placeholder="Filter library"
      aria-label="Filter library"
      bind:value={studio.libraryFilter}
    />
  </div>

  <LibraryNav />

  <div class="rail-actions">
    <button onclick={newFile} disabled={!target} title={target ? "" : "Select a channel, series or episode first"}>
      New file
    </button>
    <button onclick={() => uploadEl?.click()} disabled={!target} title={target ? "" : "Select a channel, series or episode first"}>
      Upload
    </button>
    <input
      bind:this={uploadEl}
      class="rail-upload"
      type="file"
      multiple
      aria-hidden="true"
      tabindex="-1"
      onchange={onUpload}
    />
  </div>
</nav>

<style>
  .structure-rail {
    background: var(--vs-bg-surface);
    border-right: 1px solid var(--vs-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .rail-filter {
    padding: var(--vs-space-2);
    flex-shrink: 0;
  }

  .rail-filter input {
    width: 100%;
    padding: 5px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-primary);
    font: inherit;
    font-size: var(--vs-text-sm);
    outline: none;
  }

  .rail-filter input:focus {
    border-color: var(--vs-border-focus);
  }

  .rail-actions {
    display: flex;
    gap: var(--vs-space-1);
    padding: var(--vs-space-2);
    border-top: 1px solid var(--vs-border);
    flex-shrink: 0;
  }

  .rail-actions button {
    flex: 1;
    padding: 4px var(--vs-space-2);
    background: none;
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    color: var(--vs-text-secondary);
    font: inherit;
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .rail-actions button:hover:not(:disabled) {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .rail-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .rail-upload {
    display: none;
  }

  @media (max-width: 1024px) {
    .structure-rail {
      display: none;
    }
  }
</style>
