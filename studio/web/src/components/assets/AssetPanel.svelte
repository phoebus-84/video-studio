<script lang="ts">
  import { assets } from "$lib/asset-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { reviews as refresh } from "$lib/refresh.svelte.ts";
  import type { AssetAttempt } from "$lib/asset-types";

  const group = $derived(assets.selectedGroup);

  function select(attempt: AssetAttempt) {
    if (group) {
      for (const a of group.attempts) {
        a.selected = a.id === attempt.id;
      }
    }
  }

  function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    return new Date(iso).toLocaleString();
  }

  function formatBytes(bytes: number | null): string | null {
    if (bytes === null) return null;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(sec: number | null): string | null {
    if (sec === null) return null;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  }

  const KIND_LABELS: Record<AssetAttempt["kind"], string> = {
    image: "Image",
    video: "Video",
    audio: "Narration",
  };

  /* ── prompt / text / instruct editing ─────────────────────────────── */

  let saving = $state(false);
  let saveError = $state<string | null>(null);

  function episodeRef() {
    if (episode.state.phase !== "ready") return null;
    return episode.state.episode;
  }

  /** Persist the image intent prompt into episode.json (scene.intent). */
  async function saveImagePrompt(attempt: AssetAttempt, newText: string) {
    const ep = episodeRef();
    const text = newText.trim();
    if (!ep || text === attempt.prompt) return;
    const client = getGatewayClient();
    saving = true;
    saveError = null;
    try {
      const path = `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/file/artifacts/episode.json`;
      const data = await client.fetchJSON(path) as { content?: string };
      const epJson = JSON.parse(data.content ?? "[]");
      const scenes = Array.isArray(epJson) ? epJson : (epJson.scenes ?? []);
      const scene = scenes.find((s: any) => s.id === attempt.sceneId);
      if (scene) scene.intent = text;
      const body = Array.isArray(epJson) ? scenes : { ...epJson, scenes };
      await client.fetchJSON(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(body, null, 2) }),
      });
      attempt.prompt = text;
      refresh.refresh();
    } catch (err) {
      saveError = err instanceof Error ? err.message : "Failed to save prompt";
    } finally {
      saving = false;
    }
  }

  /** Persist narration text into artifacts/narration-script.json. */
  async function saveNarrationText(attempt: AssetAttempt, newText: string) {
    const ep = episodeRef();
    const text = newText.trim();
    if (!ep || text === attempt.prompt) return;
    const client = getGatewayClient();
    saving = true;
    saveError = null;
    try {
      const path = `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/file/artifacts/narration-script.json`;
      const data = await client.fetchJSON(path) as { content?: string };
      const entries = JSON.parse(data.content ?? "[]") as Array<{ id: string; text: string }>;
      const entry = entries.find((e) => e.id === attempt.sceneId);
      if (entry) entry.text = text;
      else entries.push({ id: attempt.sceneId, text });
      await client.fetchJSON(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(entries, null, 2) }),
      });
      attempt.prompt = text;
      episode.narrationTexts[attempt.sceneId] = text;
      refresh.refresh();
    } catch (err) {
      saveError = err instanceof Error ? err.message : "Failed to save narration text";
    } finally {
      saving = false;
    }
  }

  /** Persist the TTS instruct into episode.json (scene.instruct). */
  async function saveInstruct(attempt: AssetAttempt, newText: string) {
    const ep = episodeRef();
    const text = newText.trim();
    if (!ep || text === (attempt.instruct ?? "")) return;
    const client = getGatewayClient();
    saving = true;
    saveError = null;
    try {
      const path = `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/file/artifacts/episode.json`;
      const data = await client.fetchJSON(path) as { content?: string };
      const epJson = JSON.parse(data.content ?? "[]");
      const scenes = Array.isArray(epJson) ? epJson : (epJson.scenes ?? []);
      const scene = scenes.find((s: any) => s.id === attempt.sceneId);
      if (scene) scene.instruct = text || null;
      const body = Array.isArray(epJson) ? scenes : { ...epJson, scenes };
      await client.fetchJSON(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(body, null, 2) }),
      });
      attempt.instruct = text || null;
      refresh.refresh();
    } catch (err) {
      saveError = err instanceof Error ? err.message : "Failed to save instruct";
    } finally {
      saving = false;
    }
  }

  /* ── regeneration request with consequence preview ────────────────── */

  let confirmFor = $state<string | null>(null);
  let requesting = $state(false);
  let requestError = $state<string | null>(null);
  let requestedFor = $state<string | null>(null);

  const CONSEQUENCES: Record<AssetAttempt["kind"], string[]> = {
    image: [
      "Pi generates a new image attempt for this scene.",
      "The current file is preserved on disk as an earlier attempt.",
      "The edit timeline keeps the selected attempt until you pick the new one.",
    ],
    video: [
      "Pi re-records the terminal/video asset for this scene.",
      "The current file is preserved on disk as an earlier attempt.",
      "Compose becomes stale until the new recording is selected.",
    ],
    audio: [
      "Pi synthesizes new narration using the saved text and instruct.",
      "The current WAV is preserved on disk as an earlier attempt.",
      "Captions and timing for this scene become stale.",
    ],
  };

  async function confirmRegenerate(attempt: AssetAttempt) {
    if (!group || episode.state.phase !== "ready") return;
    const ep = episode.state.episode;
    const client = getGatewayClient();
    requesting = true;
    requestError = null;
    const kindLabel = KIND_LABELS[attempt.kind].toLowerCase();
    try {
      await client.fetchJSON(
        `/api/channels/${ep.channel}/series/${ep.series}/episodes/${ep.slug}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchor: `${attempt.anchorType}/${group.sceneId}`,
            body: `Regenerate ${kindLabel} for scene "${group.sceneTitle}".${attempt.kind === "audio" && attempt.prompt ? ` Text: "${attempt.prompt.slice(0, 200)}${attempt.prompt.length > 200 ? "…" : ""}"` : ""}${attempt.kind === "audio" && attempt.instruct ? ` Instruct: "${attempt.instruct}"` : ""}${attempt.kind === "image" && attempt.prompt ? ` Prompt: "${attempt.prompt.slice(0, 200)}${attempt.prompt.length > 200 ? "…" : ""}"` : ""}`,
          }),
        }
      );
      confirmFor = null;
      requestedFor = attempt.id;
      refresh.refresh();
    } catch (err) {
      requestError = err instanceof Error ? err.message : "Failed to request regeneration";
    } finally {
      requesting = false;
    }
  }
</script>

{#if group}
  <div class="asset-panel" aria-label="Asset attempts for {group.sceneTitle}">
    <h4 class="ap-title">Assets — {group.sceneTitle}</h4>

    <ol class="ap-list">
      {#each group.attempts as attempt (attempt.id)}
        <li class="ap-item">
        <article
          class="ap-card"
          class:selected={attempt.selected}
          class:unavailable={!attempt.fileAvailable}
          aria-label="{KIND_LABELS[attempt.kind]} {attempt.id} — {attempt.selected ? 'selected' : ''} — {attempt.fileAvailable ? 'available' : 'not generated'}"
        >
          <div class="ap-card-header">
            <span class="ap-kind-badge" data-kind={attempt.kind}>{KIND_LABELS[attempt.kind]}</span>
            <span class="ap-id">{attempt.id}</span>
            {#if attempt.selected}
              <span class="ap-selected-badge">Selected</span>
            {/if}
            <button class="ap-select-btn" onclick={() => select(attempt)}>
              {attempt.selected ? "Deselect" : "Select"}
            </button>
          </div>

          {#if attempt.kind === "image"}
            {#if attempt.imageUrl}
              <div class="ap-thumb">
                <img src={attempt.imageUrl} alt="Generated image for scene {group.sceneTitle}" loading="lazy" />
              </div>
            {:else}
              <div class="ap-missing">No image generated for this scene yet.</div>
            {/if}
          {:else if attempt.kind === "video"}
            {#if attempt.videoUrl}
              <div class="ap-thumb">
                <!-- svelte-ignore a11y_media_has_caption -->
                <!-- Terminal recordings carry no spoken track; captions are not applicable. -->
                <video src={attempt.videoUrl} controls preload="metadata"></video>
              </div>
            {:else}
              <div class="ap-missing">No video recorded for this scene yet.</div>
            {/if}
          {:else if attempt.kind === "audio"}
            {#if attempt.audioUrl}
              <div class="ap-audio">
                <audio controls src={attempt.audioUrl} preload="metadata">
                  Your browser cannot play audio.
                </audio>
              </div>
            {:else}
              <div class="ap-missing">No narration synthesized for this scene yet.</div>
            {/if}
          {/if}

          <!-- Editable generation inputs -->
          {#if attempt.kind === "image"}
            <label class="ap-field">
              <span class="ap-field-label">Image prompt</span>
              <textarea
                class="ap-field-input"
                rows={3}
                value={attempt.prompt}
                placeholder="No prompt recorded for this scene."
                disabled={saving}
                onblur={(e) => saveImagePrompt(attempt, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          {:else if attempt.kind === "audio"}
            <label class="ap-field">
              <span class="ap-field-label">Narration text</span>
              <textarea
                class="ap-field-input"
                rows={4}
                value={attempt.prompt}
                placeholder="No narration script for this scene yet."
                disabled={saving}
                onblur={(e) => saveNarrationText(attempt, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
            <label class="ap-field">
              <span class="ap-field-label">Voice instruct</span>
              <textarea
                class="ap-field-input"
                rows={2}
                value={attempt.instruct ?? ""}
                placeholder="e.g. Warm, unhurried narrator"
                disabled={saving}
                onblur={(e) => saveInstruct(attempt, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          {/if}
          {#if saving}
            <p class="ap-saving" role="status">Saving…</p>
          {/if}

          <!-- Provenance: only fields with real values are shown -->
          <div class="ap-meta">
            {#if attempt.provider}<span>{attempt.provider}</span>{/if}
            {#if attempt.model}<span>{attempt.model}</span>{/if}
            {#if attempt.seed !== null}<span>Seed {attempt.seed}</span>{/if}
            {#if attempt.dimensions}<span>{attempt.dimensions.width}×{attempt.dimensions.height}</span>{/if}
            {#if formatDuration(attempt.durationSeconds)}<span>{formatDuration(attempt.durationSeconds)}</span>{/if}
            {#if formatBytes(attempt.fileSize)}<span>{formatBytes(attempt.fileSize)}</span>{/if}
            {#if attempt.cost !== null}<span>${attempt.cost.toFixed(3)}</span>{/if}
            {#if formatDate(attempt.createdAt)}<span>{formatDate(attempt.createdAt)}</span>{/if}
          </div>

          <div class="ap-actions">
            {#if requestedFor === attempt.id}
              <p class="ap-requested" role="status">Regeneration requested — Pi will pick it up from the Reviews inbox.</p>
            {:else if confirmFor === attempt.id}
              <div class="ap-confirm" role="group" aria-label="Confirm regeneration">
                <p class="ap-confirm-title">Request regeneration from Pi:</p>
                <ul class="ap-confirm-list">
                  {#each CONSEQUENCES[attempt.kind] as c}
                    <li>{c}</li>
                  {/each}
                </ul>
                <div class="ap-confirm-actions">
                  <button
                    class="ap-btn ap-btn-primary"
                    disabled={requesting}
                    onclick={() => confirmRegenerate(attempt)}
                  >
                    {requesting ? "Requesting…" : "Request regeneration"}
                  </button>
                  <button class="ap-btn" onclick={() => (confirmFor = null)} disabled={requesting}>
                    Cancel
                  </button>
                </div>
                {#if requestError}
                  <p class="ap-error" role="alert">{requestError}</p>
                {/if}
              </div>
            {:else}
              <button class="ap-btn ap-btn-outline" onclick={() => { confirmFor = attempt.id; requestError = null; }}>
                Regenerate {KIND_LABELS[attempt.kind].toLowerCase()}…
              </button>
            {/if}
          </div>
          {#if saveError}
            <p class="ap-error" role="alert">{saveError}</p>
          {/if}
        </article>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .asset-panel {
    padding: var(--vs-space-3);
  }

  .ap-title {
    font-size: var(--vs-text-sm);
    font-weight: var(--vs-font-weight-semibold);
    margin: 0 0 var(--vs-space-3);
    color: var(--vs-text-primary);
  }

  .ap-list {
    display: flex;
    flex-direction: column;
    gap: var(--vs-space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .ap-item {
    list-style: none;
  }

  .ap-card {
    padding: var(--vs-space-3);
    background: var(--vs-bg-surface);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-md);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-primary);
  }

  .ap-card.selected {
    border-color: var(--vs-accent);
    background: var(--vs-accent-subtle);
  }

  .ap-card.unavailable {
    border-style: dashed;
  }

  .ap-card-header {
    display: flex;
    align-items: center;
    gap: var(--vs-space-2);
    margin-bottom: var(--vs-space-2);
  }

  .ap-kind-badge {
    font-size: 10px;
    font-weight: var(--vs-font-weight-semibold);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-secondary);
    background: var(--vs-bg-raised);
    border: 1px solid var(--vs-border);
    padding: 1px var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .ap-id {
    font-family: var(--vs-font-mono);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    font-weight: var(--vs-font-weight-semibold);
    flex: 1;
  }

  .ap-selected-badge {
    font-size: var(--vs-text-xs);
    color: var(--vs-accent);
    background: var(--vs-accent-subtle);
    padding: 0 var(--vs-space-1);
    border-radius: var(--vs-radius-sm);
  }

  .ap-select-btn {
    border: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    color: var(--vs-text-secondary);
    font-family: var(--vs-font-sans);
    font-size: 10px;
    padding: 1px var(--vs-space-2);
    border-radius: var(--vs-radius-sm);
    cursor: pointer;
  }

  .ap-select-btn:hover {
    color: var(--vs-text-primary);
    background: var(--vs-bg-hover);
  }

  .ap-thumb {
    width: 100%;
    aspect-ratio: 16/9;
    border-radius: var(--vs-radius-sm);
    overflow: hidden;
    margin-bottom: var(--vs-space-2);
    background: var(--vs-bg-inset);
  }

  .ap-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .ap-thumb video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .ap-audio {
    margin-bottom: var(--vs-space-2);
  }

  .ap-audio audio {
    width: 100%;
    height: 32px;
  }

  .ap-missing {
    font-size: var(--vs-text-xs);
    color: var(--vs-text-tertiary);
    background: var(--vs-bg-raised);
    border-radius: var(--vs-radius-sm);
    padding: var(--vs-space-2) var(--vs-space-3);
    margin-bottom: var(--vs-space-2);
  }

  .ap-field {
    display: block;
    margin-bottom: var(--vs-space-2);
  }

  .ap-field-label {
    display: block;
    font-size: 10px;
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-tertiary);
    margin-bottom: 2px;
  }

  .ap-field-input {
    width: 100%;
    padding: var(--vs-space-1) var(--vs-space-2);
    border: 1px solid var(--vs-border);
    border-radius: var(--vs-radius-sm);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    background: var(--vs-bg-canvas);
    color: var(--vs-text-primary);
    resize: vertical;
    line-height: 1.4;
    box-sizing: border-box;
  }

  .ap-field-input:focus-visible {
    outline: 2px solid var(--vs-border-focus);
    outline-offset: -1px;
    border-color: var(--vs-accent);
  }

  .ap-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--vs-space-2);
    font-size: var(--vs-text-xs);
    font-family: var(--vs-font-mono);
    color: var(--vs-text-tertiary);
    margin-bottom: var(--vs-space-1);
  }

  .ap-actions {
    margin-top: var(--vs-space-2);
    padding-top: var(--vs-space-2);
    border-top: 1px solid var(--vs-border);
  }

  .ap-btn {
    padding: var(--vs-space-1) var(--vs-space-3);
    border-radius: var(--vs-radius-sm);
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    cursor: pointer;
    border: 1px solid var(--vs-border);
    background: var(--vs-bg-surface);
    color: var(--vs-text-primary);
  }

  .ap-btn:hover {
    background: var(--vs-bg-hover);
  }

  .ap-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ap-btn-outline {
    width: 100%;
    border-color: var(--vs-accent-strong);
    color: var(--vs-accent-strong);
    background: transparent;
  }

  .ap-btn-outline:hover {
    background: var(--vs-accent-subtle);
  }

  .ap-btn-primary {
    background: var(--vs-accent-strong);
    border-color: var(--vs-accent-strong);
    color: var(--vs-accent-text);
  }

  .ap-btn-primary:hover:not(:disabled) {
    background: var(--vs-accent-strong-hover);
  }

  .ap-confirm-title {
    font-size: var(--vs-text-xs);
    font-weight: var(--vs-font-weight-semibold);
    color: var(--vs-text-primary);
    margin: 0 0 var(--vs-space-1);
  }

  .ap-confirm-list {
    margin: 0 0 var(--vs-space-2);
    padding-left: var(--vs-space-4);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
  }

  .ap-confirm-list li {
    padding: 1px 0;
  }

  .ap-confirm-actions {
    display: flex;
    gap: var(--vs-space-2);
  }

  .ap-requested {
    font-size: var(--vs-text-xs);
    color: var(--vs-state-current);
    margin: 0;
  }

  .ap-error {
    margin-top: var(--vs-space-1);
    padding: var(--vs-space-1) var(--vs-space-2);
    background: var(--vs-state-blocked-bg);
    color: var(--vs-state-blocked);
    border-radius: var(--vs-radius-sm);
    font-size: 11px;
  }

  .ap-saving {
    font-size: 10px;
    color: var(--vs-text-tertiary);
    margin: 0 0 var(--vs-space-1);
  }

  .ap-field-input:disabled {
    opacity: 0.6;
  }
</style>
