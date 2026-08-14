<script lang="ts">
  import type { ViewerProps } from "$lib/viewer-registry";
  let { path, mediaSrc }: ViewerProps = $props();
</script>

<div class="frame">
  {#if mediaSrc}
    <img src={mediaSrc} alt={path} />
  {:else}
    <p class="note">Loading preview…</p>
  {/if}
</div>

<style>
  .frame {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    overflow: auto;
  }
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .note { font-size: 13px; color: var(--vs-text-secondary, #777); }
</style>
