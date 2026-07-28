<script lang="ts">
  import { library } from "$lib/library-store.svelte.ts";
  import { editor } from "$lib/editor-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import EditorPane from "../editor/EditorPane.svelte";

  interface Props {
    level: "channel" | "series";
    label: string;
    channel: string;
    series?: string;
  }

  let { level, label, channel, series }: Props = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);
  let files = $state<string[]>([]);
  let selectedFile = $state<string | null>(null);

  /** Discover files at this level */
  async function discoverFiles() {
    loading = true;
    error = null;
    // Common files to try at channel/series level
    const candidates = ["README.md", "style-guide.md", "pipeline.yaml", "art-direction.md"];
    const found: string[] = [];
    const client = getGatewayClient();

    for (const f of candidates) {
      try {
        const url = level === "channel"
          ? `/api/channels/${channel}/file/${f}`
          : `/api/channels/${channel}/series/${series}/file/${f}`;
        await client.fetchJSON(url);
        found.push(f);
      } catch { /* file doesn't exist */ }
    }
    files = found;
    loading = false;

    // Auto-select first file
    if (found.length > 0 && !selectedFile) {
      selectFile(found[0]!);
    }
  }

  async function selectFile(fileName: string) {
    selectedFile = fileName;
    const client = getGatewayClient();
    const url = level === "channel"
      ? `/api/channels/${channel}/file/${fileName}`
      : `/api/channels/${channel}/series/${series}/file/${fileName}`;

    try {
      const data = await client.fetchJSON(url) as { content?: string; revision?: string; mtime?: string };
      editor.open({
        kind: fileName.endsWith(".yaml") || fileName.endsWith(".yml") ? "yaml" : "markdown",
        text: data.content ?? "",
        revision: { etag: data.revision ?? "", updatedAt: data.mtime ?? new Date().toISOString() },
        filePath: fileName,
        channel,
        series: series ?? "",
        episode: "",
      } as any);
    } catch (err) {
      editor.open({
        kind: "markdown",
        text: "",
        revision: { etag: "", updatedAt: new Date().toISOString() },
        filePath: fileName,
        channel,
        series: series ?? "",
        episode: "",
      } as any);
    }
  }

  // Discover files on mount
  $effect(() => {
    discoverFiles();
  });
</script>

<div class="level-workspace">
  <div class="lw-header">
    <h3 class="lw-title">{label}</h3>
    <span class="lw-badge">{level}</span>
  </div>

  {#if loading}
    <div class="lw-loading">Discovering files…</div>
  {:else}
    <div class="lw-layout">
      <nav class="lw-file-list">
        <h4 class="lw-files-heading">Files</h4>
        {#if files.length === 0}
          <p class="lw-no-files">No editable files found.<br />Create a README.md in this {level}.</p>
        {:else}
          {#each files as file (file)}
            <button
              class="lw-file-btn"
              class:active={selectedFile === file}
              onclick={() => selectFile(file)}
            >
              {file}
            </button>
          {/each}
        {/if}
      </nav>

      <div class="lw-editor">
        {#if selectedFile}
          <div class="lw-editor-header">
            <span>{selectedFile}</span>
            <button class="lw-save-btn" onclick={() => {
              const art = editor.artifact as any;
              if (!art) return;
              const client = getGatewayClient();
              const url = level === "channel"
                ? `/api/channels/${channel}/file/${selectedFile}`
                : `/api/channels/${channel}/series/${series}/file/${selectedFile}`;
              client.fetchJSON(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: editor.buffer }),
              }).then(() => editor.save(async () => ({
                ok: true,
                revision: { etag: "", updatedAt: new Date().toISOString() },
              }))).catch((e: any) => {
                error = e?.message ?? "Save failed";
              });
            }}>
              Save
            </button>
          </div>
          <EditorPane label={selectedFile} placeholder="Edit…" />
        {:else}
          <div class="lw-empty">
            <p>Select a file from the list to edit.</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if error}
    <div class="lw-error">{error}</div>
  {/if}
</div>

<style>
  .level-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .lw-header {
    display: flex;
    align-items: center;
    gap: var(--vs-space-3);
    padding: var(--vs-space-3) var(--vs-space-4);
    border-bottom: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
  }

  .lw-title {
    font-size: var(--vs-text-lg);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0;
  }

  .lw-badge {
    font-size: var(--vs-text-xs);
    text-transform: uppercase;
    padding: 1px var(--vs-space-2);
    background: var(--vs-bg-inset);
    border-radius: var(--vs-radius-sm);
    color: var(--vs-text-tertiary);
  }

  .lw-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .lw-file-list {
    width: 200px;
    border-right: 1px solid var(--vs-border);
    padding: var(--vs-space-3);
    overflow-y: auto;
    flex-shrink: 0;
  }

  .lw-files-heading {
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 var(--vs-space-2);
  }

  .lw-file-btn {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--vs-space-1) var(--vs-space-2);
    border: none;
    background: none;
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    cursor: pointer;
    border-radius: var(--vs-radius-sm);
  }

  .lw-file-btn:hover, .lw-file-btn.active {
    background: var(--vs-bg-hover);
    color: var(--vs-text-primary);
  }

  .lw-file-btn.active {
    background: var(--vs-accent-subtle);
    color: var(--vs-accent);
  }

  .lw-no-files {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    line-height: 1.5;
  }

  .lw-editor {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .lw-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--vs-space-2) var(--vs-space-4);
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    border-bottom: 1px solid var(--vs-border);
  }

  .lw-save-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border: 1px solid var(--vs-accent);
    border-radius: var(--vs-radius-sm);
    background: var(--vs-accent);
    color: var(--vs-accent-text);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
  }

  .lw-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vs-text-tertiary);
    font-size: var(--vs-text-sm);
  }

  .lw-loading {
    padding: var(--vs-space-6);
    text-align: center;
    color: var(--vs-text-tertiary);
  }

  .lw-error {
    padding: var(--vs-space-2);
    background: var(--vs-state-blocked-bg);
    color: var(--vs-state-blocked);
    font-size: var(--vs-text-xs);
  }
</style>
