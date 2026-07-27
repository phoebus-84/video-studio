<script lang="ts">
  import { editor } from "$lib/editor-store.svelte.ts";
  import { computeDiff, type DiffLine } from "$lib/diff";

  const conflict = $derived(editor.conflict);

  const theirsDiff = $derived(
    conflict ? computeDiff(conflict.base, conflict.theirs) : [],
  );
  const oursDiff = $derived(
    conflict ? computeDiff(conflict.base, conflict.ours) : [],
  );

  function lineClass(line: DiffLine): string {
    if (line.tag === "added") return "diff-added";
    if (line.tag === "removed") return "diff-removed";
    return "";
  }

  function prefix(line: DiffLine): string {
    if (line.tag === "added") return "+";
    if (line.tag === "removed") return "−";
    return " ";
  }

  function acceptTheirs() {
    if (!conflict) return;
    editor.resolveConflict(conflict.theirs);
  }

  function acceptOurs() {
    if (!conflict) return;
    editor.resolveConflict(conflict.ours);
  }
</script>

{#if conflict}
  <div class="conflict-resolver" role="alert" aria-label="Revision conflict">
    <div class="cr-header">
      <h3>Revision conflict</h3>
      <p>
        The artifact was modified while you were editing.
        Choose which version to keep, then save.
      </p>
    </div>

    <div class="cr-panes">
      <div class="cr-pane">
        <div class="cr-pane-header">
          <span class="cr-label">Server version</span>
          <button class="cr-accept" onclick={acceptTheirs}>
            Use this
          </button>
        </div>
        <pre class="cr-content">{#each theirsDiff as hunk}
          {#each hunk.lines as line}
            <span class={lineClass(line)}>{prefix(line)}{line.text}\n</span>
          {/each}
        {/each}</pre>
      </div>

      <div class="cr-pane">
        <div class="cr-pane-header">
          <span class="cr-label">Your version</span>
          <button class="cr-accept" onclick={acceptOurs}>
            Use this
          </button>
        </div>
        <pre class="cr-content">{#each oursDiff as hunk}
          {#each hunk.lines as line}
            <span class={lineClass(line)}>{prefix(line)}{line.text}\n</span>
          {/each}
        {/each}</pre>
      </div>
    </div>
  </div>
{/if}

<style>
  .conflict-resolver {
    padding: var(--vs-space-4);
  }

  .cr-header h3 {
    font-size: var(--vs-text-md);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0 0 var(--vs-space-1);
    color: var(--vs-state-blocked);
  }

  .cr-header p {
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    margin: 0 0 var(--vs-space-4);
  }

  .cr-panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--vs-space-4);
  }

  .cr-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--vs-space-2);
    font-size: var(--vs-text-xs);
  }

  .cr-label {
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-secondary);
  }

  .cr-accept {
    padding: var(--vs-space-1) var(--vs-space-2);
    border: 1px solid var(--vs-accent);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-accent);
    color: var(--vs-accent-text);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .cr-content {
    padding: var(--vs-space-3);
    background: var(--vs-bg-inset);
    border-radius: var(--vs-radius-md);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    line-height: 1.5;
    overflow-x: auto;
    max-height: 40vh;
    overflow-y: auto;
    margin: 0;
    white-space: pre;
    tab-size: 2;
  }

  :global(.diff-added) {
    background: oklch(58% 0.14 160 / 0.15);
    color: var(--vs-state-current);
  }

  :global(.diff-removed) {
    background: oklch(52% 0.18 24 / 0.12);
    color: var(--vs-state-blocked);
  }
</style>
