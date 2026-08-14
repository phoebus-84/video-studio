<script lang="ts">
  import type { ViewerProps } from "$lib/viewer-registry";
  let { content, readOnly, onEdit }: ViewerProps = $props();
</script>

<textarea
  class="tv"
  value={content}
  oninput={(e) => onEdit((e.target as HTMLTextAreaElement).value)}
  readonly={readOnly}
  spellcheck="true"
  aria-label="File content"
></textarea>

<style>
  .tv {
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
</style>
