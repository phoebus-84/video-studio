<script lang="ts">
  /**
   * Open files, as tabs.
   *
   * The dot on a tab means unsaved work, so you can see that a file you are not
   * looking at still has changes in it before you navigate away from the level
   * and lose them.
   */
  import { files } from "$lib/files-store.svelte.ts";
  import { studio } from "$lib/studio-store.svelte.ts";

  function basename(path: string): string {
    return path.split("/").pop() || path;
  }

  function open(path: string) {
    const entry = files.entries.find((e) => e.path === path);
    if (entry) void files.open(entry);
    studio.openFile(path);
  }

  function close(path: string, event: MouseEvent) {
    event.stopPropagation();
    studio.closeFile(path);

    /* Closing the file you are looking at moves you to the neighbouring tab,
       or clears the viewer when that was the last one. */
    if (files.selectedPath === path) {
      const next = studio.openPaths[studio.openPaths.length - 1];
      if (next) open(next);
      else files.clearSelection();
    }
  }
</script>

{#if studio.openPaths.length > 0}
  <div class="file-tabs" role="tablist" aria-label="Open files">
    {#each studio.openPaths as path (path)}
      {@const active = files.selectedPath === path}
      <div class="file-tab" class:active>
        <button
          class="file-tab-open"
          role="tab"
          aria-selected={active}
          title={path}
          onclick={() => open(path)}
        >
          <span class="file-dot" class:dirty={active && files.dirty} aria-hidden="true"></span>
          {basename(path)}
        </button>
        <button
          class="file-tab-close"
          aria-label="Close {basename(path)}"
          onclick={(e) => close(path, e)}
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .file-tabs {
    display: flex;
    align-items: stretch;
    background: var(--vs-bg-canvas);
    border-bottom: 1px solid var(--vs-border);
    overflow-x: auto;
    flex-shrink: 0;
  }

  .file-tab {
    display: flex;
    align-items: center;
    background: var(--vs-bg-raised);
    border-right: 1px solid var(--vs-border);
    border-top: 2px solid transparent;
  }

  .file-tab.active {
    background: var(--vs-bg-canvas);
    border-top-color: var(--vs-accent);
  }

  .file-tab-open {
    display: flex;
    align-items: center;
    gap: var(--vs-space-1);
    padding: 6px var(--vs-space-2) 6px var(--vs-space-3);
    background: none;
    border: none;
    color: var(--vs-text-tertiary);
    font: inherit;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    cursor: pointer;
    white-space: nowrap;
  }

  .file-tab.active .file-tab-open {
    color: var(--vs-text-primary);
  }

  .file-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: transparent;
    flex-shrink: 0;
  }

  .file-dot.dirty {
    background: var(--vs-accent);
  }

  .file-tab-close {
    padding: 0 var(--vs-space-2) 0 0;
    background: none;
    border: none;
    color: var(--vs-text-disabled);
    font: inherit;
    font-size: var(--vs-text-base);
    line-height: 1;
    cursor: pointer;
  }

  .file-tab-close:hover {
    color: var(--vs-text-primary);
  }
</style>
