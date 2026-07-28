<script lang="ts">
  import { editor } from "$lib/editor-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { SAVE_LABELS } from "$lib/editor-types";

  const label = $derived(SAVE_LABELS[editor.saveState]);
  const revisionLabel = $derived(
    editor.artifact
      ? `rev ${editor.artifact.revision.etag.slice(0, 7)}`
      : "",
  );

  function onSave() {
    const artifact = editor.artifact;
    if (!artifact) return;
    const extra = artifact as any;
    const client = getGatewayClient();

    editor.save(async (text, _rev) => {
      try {
        const result = await client.fetchJSON(
          `/api/channels/${extra.channel}/series/${extra.series}/episodes/${extra.episode}/file/${extra.filePath}`,
          {
            method: "PUT",
            headers: { "Content-Type": "text/plain" },
            body: text,
          }
        ) as any;
        return {
          ok: true,
          revision: {
            etag: result.etag ?? crypto.randomUUID(),
            updatedAt: result.updatedAt ?? new Date().toISOString(),
          },
        };
      } catch (err: any) {
        if (err?.status === 409) {
          // Conflict — fetch current and show resolver
          const current = await client.fetchJSON(
            `/api/channels/${extra.channel}/series/${extra.series}/episodes/${extra.episode}/file/${extra.filePath}`
          ) as any;
          return {
            ok: false,
            conflict: {
              ours: text,
              theirs: current.text ?? "",
              base: artifact.text,
              serverRevision: {
                etag: current.etag ?? "",
                updatedAt: current.updatedAt ?? new Date().toISOString(),
              },
            },
          };
        }
        return { ok: false, error: err?.message ?? "Save failed" };
      }
    });
  }

  function onDiscard() {
    editor.discard();
  }
</script>

<div class="editor-toolbar" aria-label="Editor toolbar">
  <div class="et-left">
    <span class="et-revision" aria-label="Revision">{revisionLabel}</span>
    <span
      class="et-save-state"
      data-state={editor.saveState}
      role="status"
      aria-live="polite"
    >
      {label}
    </span>
  </div>
  <div class="et-right">
    {#if editor.saveState === "dirty" || editor.saveState === "error"}
      <button class="et-btn et-btn-discard" onclick={onDiscard}>
        Discard
      </button>
    {/if}
    <button
      class="et-btn et-btn-save"
      disabled={editor.saveState === "saving" || editor.saveState === "clean" || editor.saveState === "conflict"}
      onclick={onSave}
    >
      Save
    </button>
  </div>
</div>

{#if editor.saveState === "error" && editor.errorMessage}
  <div class="et-error" role="alert">
    {editor.errorMessage}
  </div>
{/if}

<style>
  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--vs-space-2) var(--vs-space-4);
    background: var(--vs-bg-surface);
    border-bottom: 1px solid var(--vs-border);
    font-size: var(--vs-text-xs);
  }

  .et-left, .et-right {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
  }

  .et-revision {
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
  }

  .et-save-state {
    font-weight: var(--vs-font-weight-medium);
  }

  .et-save-state[data-state="dirty"] {
    color: var(--vs-state-attention);
  }

  .et-save-state[data-state="conflict"] {
    color: var(--vs-state-blocked);
  }

  .et-save-state[data-state="error"] {
    color: var(--vs-state-blocked);
  }

  .et-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-bg-surface);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-primary);
    cursor: pointer;
  }

  .et-btn:hover {
    background: var(--vs-bg-hover);
  }

  .et-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .et-btn-save:not(:disabled) {
    background: var(--vs-accent);
    border-color: var(--vs-accent);
    color: var(--vs-accent-text);
  }

  .et-error {
    padding: var(--vs-space-2) var(--vs-space-4);
    background: var(--vs-state-blocked-bg);
    border-bottom: 1px solid var(--vs-state-blocked);
    font-size: var(--vs-text-xs);
    color: var(--vs-state-blocked);
  }
</style>
