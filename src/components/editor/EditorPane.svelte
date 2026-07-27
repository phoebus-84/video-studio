<script lang="ts">
  import { editor } from "$lib/editor-store.svelte.ts";
  import type { EditorDiagnostic } from "$lib/editor-types";

  interface Props {
    label: string;
    placeholder?: string;
    diagnostics?: EditorDiagnostic[];
  }

  let { label, placeholder = "" }: Props = $props();

  function onInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    editor.edit(target.value);
  }
</script>

<div class="editor-pane" aria-label="{label} editor">
  <div class="ep-body">
    <textarea
      class="ep-textarea"
      value={editor.buffer}
      oninput={onInput}
      aria-label={label}
      placeholder={placeholder}
      spellcheck="true"
      wrap="soft"
    ></textarea>
  </div>

  {#if editor.diagnostics.length > 0}
    <div class="ep-diagnostics" role="alert" aria-label="Validation issues">
      {#each editor.diagnostics as diag (diag.code + diag.line)}
        <div class="ep-diag-row" data-severity={diag.severity}>
          <span class="ep-diag-code" aria-label="Code">{diag.code}</span>
          {#if diag.line}
            <span class="ep-diag-loc">L{diag.line}{#if diag.column}:{diag.column}{/if}</span>
          {/if}
          <span class="ep-diag-msg">{diag.message}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .ep-body {
    flex: 1;
    overflow: hidden;
  }

  .ep-textarea {
    width: 100%;
    height: 100%;
    padding: var(--vs-space-4);
    border: none;
    outline: none;
    resize: none;
    background: var(--vs-bg-canvas);
    color: var(--vs-text-primary);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-sm);
    line-height: 1.6;
    tab-size: 2;
  }

  .ep-textarea:focus {
    background: var(--vs-bg-surface);
  }

  .ep-diagnostics {
    padding: var(--vs-space-3) var(--vs-space-4);
    background: var(--vs-bg-surface);
    border-top: 1px solid var(--vs-border);
    max-height: 120px;
    overflow-y: auto;
  }

  .ep-diag-row {
    display: flex;
    gap: var(--vs-space-2);
    align-items: baseline;
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    padding: 2px 0;
  }

  .ep-diag-row[data-severity="error"] {
    color: var(--vs-state-blocked);
  }

  .ep-diag-row[data-severity="warning"] {
    color: var(--vs-state-attention);
  }

  .ep-diag-code {
    font-weight: var(--vs-font-weight-semibold);
    flex-shrink: 0;
  }

  .ep-diag-loc {
    color: var(--vs-text-tertiary);
    flex-shrink: 0;
  }

  .ep-diag-msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
