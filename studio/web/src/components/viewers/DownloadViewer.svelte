<script lang="ts">
  /**
   * The fallback for anything with no registered viewer.
   *
   * An artifact whose contract names a viewer the studio has not shipped yet —
   * a 3D scene, say — lands here and says so, rather than rendering nothing.
   */
  import type { ViewerProps } from "$lib/viewer-registry";
  let { path, contentType, mediaSrc }: ViewerProps = $props();
</script>

<div class="frame">
  <p class="kind">{contentType ?? "unknown type"}</p>
  <p class="note">No viewer is registered for this kind yet.</p>
  {#if mediaSrc}
    <a href={mediaSrc} download={path}>Download</a>
  {/if}
</div>

<style>
  .frame {
    margin: auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--vs-text-secondary, #777);
  }
  .kind { margin: 0; font-family: var(--vs-font-mono, monospace); font-size: 12px; }
  .note { margin: 0; }
</style>
