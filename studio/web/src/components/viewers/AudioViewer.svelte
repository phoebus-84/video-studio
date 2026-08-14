<script lang="ts">
  import type { ViewerProps } from "$lib/viewer-registry";
  let { path, mediaSrc }: ViewerProps = $props();
</script>

<div class="frame">
  {#if mediaSrc}
    <div class="stack">
      <p class="name">{path}</p>
      <audio src={mediaSrc} controls></audio>
    </div>
  {:else}
    <p class="note">Loading preview…</p>
  {/if}
</div>

<style>
  .frame { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .stack { display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .name { margin: 0; font-size: 12px; color: var(--vs-text-secondary, #777); }
  .note { font-size: 13px; color: var(--vs-text-secondary, #777); }
</style>
