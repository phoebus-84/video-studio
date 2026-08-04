<script lang="ts">
  import { episode } from "$lib/episode-store.svelte.ts";
  import { editor } from "$lib/editor-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import EditorToolbar from "./EditorToolbar.svelte";
  import EditorPane from "./EditorPane.svelte";
  import ConflictResolver from "./ConflictResolver.svelte";

  import type { ArtifactContent } from "$lib/editor-types";

  let loading = $state(false);
  let error = $state<string | null>(null);

  /** Load file from gateway when stage changes. */
  $effect(() => {
    const stageId = episode.selectedStageId;
    if (!stageId || episode.state.phase !== "ready") return;
    const ep = episode.state.episode;

    // Map stage IDs to artifact file paths
    const fileMap: Record<string, string> = {
      "brief": "artifacts/brief.md",
      "write-brief": "artifacts/brief.md",
      "script": "artifacts/narration-script.json",
      "write-script": "artifacts/narration-script.json",
      "art-direction": "artifacts/art-direction.json",
      "narration": "artifacts/narration-script.json",
      "safety-review": "artifacts/safety-review.json",
    };

    const filePath = fileMap[stageId];
    if (!filePath) {
      // Stages like "render" don't have a text file to edit
      editor.open(null);
      return;
    }

    loadFile(ep.channel, ep.series, ep.slug, filePath);
  });

  async function loadFile(channel: string, series: string, episodeSlug: string, filePath: string) {
    loading = true;
    error = null;
    const client = getGatewayClient();
    try {
      const data = await client.fetchJSON(
        `/api/channels/${channel}/series/${series}/episodes/${episodeSlug}/file/${filePath}`
      ) as { content?: string; revision?: string; mtime?: string; size?: number };

      const text = data.content ?? "";
      const ext = filePath.split(".").pop() ?? "md";
      const kindMap: Record<string, ArtifactContent["kind"]> = {
        md: "markdown", yaml: "yaml", yml: "yaml", json: "json",
        txt: "plaintext", html: "html",
      };

      editor.open({
        kind: kindMap[ext] ?? "markdown",
        text,
        revision: {
          etag: data.revision ?? "",
          updatedAt: data.mtime ?? new Date().toISOString(),
        },
        filePath,
        channel,
        series,
        episode: episodeSlug,
      });
    } catch {
      // File might not exist yet — create empty artifact
      const ext = filePath.split(".").pop() ?? "md";
      const kindMap: Record<string, ArtifactContent["kind"]> = {
        md: "markdown", yaml: "yaml", yml: "yaml", json: "json",
        txt: "plaintext", html: "html",
      };
      error = null; // Not an error — just empty
      editor.open({
        kind: kindMap[ext] ?? "markdown",
        text: "",
        revision: { etag: "", updatedAt: new Date().toISOString() },
        filePath,
        channel,
        series,
        episode: episodeSlug,
      });
    } finally {
      loading = false;
    }
  }
</script>

{#if loading}
  <div class="editor-workspace">
    <div class="editor-loading">Loading {episode.selectedStageId}…</div>
  </div>
{:else if error}
  <div class="editor-workspace">
    <div class="editor-error">{error}</div>
  </div>
{:else if editor.saveState === "conflict"}
  <ConflictResolver />
{:else if editor.artifact}
  <div class="editor-workspace">
    <EditorToolbar />
    <EditorPane
      label={episode.selectedStageId ?? "artifact"}
      placeholder="Edit content…"
    />
  </div>
{:else}
  <div class="editor-workspace">
    <div class="editor-empty">
      <p>Select a stage from the rail above to view or edit its content.</p>
    </div>
  </div>
{/if}

<style>
  .editor-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .editor-loading, .editor-error, .editor-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vs-text-tertiary);
    font-size: var(--vs-text-sm);
  }

  .editor-error {
    color: var(--vs-state-blocked);
  }
</style>
