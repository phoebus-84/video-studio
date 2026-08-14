<script lang="ts">
  import type { ViewerProps } from "$lib/viewer-registry";
  let { mediaSrc }: ViewerProps = $props();
</script>

<div class="frame">
  {#if mediaSrc}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={mediaSrc} controls></video>
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
  video { max-width: 100%; max-height: 100%; }
  .note { font-size: 13px; color: var(--vs-text-secondary, #777); }
</style>
