<script lang="ts">
  import { assets as assetStore } from "$lib/asset-store.svelte.ts";
  import { episode } from "$lib/episode-store.svelte.ts";
  import type { AssetGroup } from "$lib/asset-types";
  import { scenes } from "$lib/scene-store.svelte.ts";
  import AssetPanel from "../assets/AssetPanel.svelte";
  import ReviewInbox from "../review/ReviewInbox.svelte";
  import ProgressPanel from "../status/ProgressPanel.svelte";
  import StalenessPanel from "../status/StalenessPanel.svelte";

  import { untrack } from "svelte";

  type Tab = "assets" | "reviews" | "status";
  let tab = $state<Tab>("assets");

  // Build asset groups from the gateway-enriched episode scenes. Every field
  // comes from disk truth: files the gateway found, real mtimes, real
  // narration text. Nothing is fabricated; unknown fields stay null and the
  // panel hides them.
  $effect(() => {
    if (episode.state.phase !== "ready") return;
    const epScenes = episode.state.episode.scenes as any[];
    if (epScenes.length === 0) return;

    const texts = episode.narrationTexts;
    untrack(() => {
      const generated: AssetGroup[] = epScenes.map((scene) => {
        const sid = scene.id as string;
        const attempts: import("$lib/asset-types").AssetAttempt[] = [];
        const asset = scene.asset as { kind: string; url: string; size: number; generatedAt: string } | null;
        const nar = scene.narration as { url: string; durationSeconds: number; voice: string; status: string; generatedAt: string | null; size: number | null } | null;
        const base = episode.assets;

        // Video attempt (terminal recordings etc.) — only when a file exists.
        if (asset?.kind === "video") {
          attempts.push({
            id: `vid-${sid}`,
            sceneId: sid,
            kind: "video" as const,
            prompt: (scene.intent as string) ?? "",
            instruct: null,
            referenceImages: [],
            provider: null,
            model: null,
            seed: null,
            dimensions: null,
            durationSeconds: null,
            fileSize: asset.size ?? null,
            cost: null,
            license: "",
            createdAt: asset.generatedAt ?? null,
            selected: false,
            imageUrl: null,
            videoUrl: base.videos[sid] ?? null,
            audioUrl: null,
            filePath: null,
            fileAvailable: true,
            state: "ready" as const,
            anchorType: "assets" as const,
          });
        }

        // Image attempt — always listed so a missing image is visible.
        const imgUrl = asset?.kind === "image" ? (base.images[sid] ?? null) : null;
        attempts.push({
          id: `img-${sid}`,
          sceneId: sid,
          kind: "image" as const,
          prompt: (scene.intent as string) ?? "",
          instruct: null,
          referenceImages: [],
          provider: null,
          model: null,
          seed: null,
          dimensions: null,
          durationSeconds: null,
          fileSize: asset?.kind === "image" ? (asset.size ?? null) : null,
          cost: null,
          license: "",
          createdAt: asset?.kind === "image" ? (asset.generatedAt ?? null) : null,
          selected: true,
          imageUrl: imgUrl,
          videoUrl: null,
          audioUrl: null,
          filePath: null,
          fileAvailable: imgUrl != null,
          state: imgUrl ? ("ready" as const) : ("idle" as const),
          anchorType: "assets" as const,
        });

        // Narration audio attempt — always listed, text/instruct editable.
        const narReady = nar?.status === "completed" && nar.url;
        attempts.push({
          id: `nar-${sid}`,
          sceneId: sid,
          kind: "audio" as const,
          prompt: texts[sid] ?? "",
          instruct: (scene.instruct as string) ?? null,
          referenceImages: [],
          provider: "Qwen3-TTS",
          model: null,
          seed: null,
          dimensions: null,
          durationSeconds: nar?.durationSeconds ?? null,
          fileSize: nar?.size ?? null,
          cost: null,
          license: "",
          createdAt: nar?.generatedAt ?? null,
          selected: false,
          imageUrl: null,
          videoUrl: null,
          audioUrl: narReady ? (base.narration[sid] ?? null) : null,
          filePath: null,
          fileAvailable: Boolean(narReady),
          state: narReady ? ("ready" as const) : ("idle" as const),
          anchorType: "narration" as const,
        });

        return { sceneId: sid, sceneTitle: scene.title ?? sid, attempts };
      });
      assetStore.load(generated);
    });
  });

  // Select the asset group when a scene is selected
  $effect(() => {
    const sceneId = scenes.selectedSceneId;
    if (sceneId) {
      untrack(() => {
        assetStore.selectGroup(sceneId);
        tab = "assets";
      });
    }
  });
</script>

<aside class="context-inspector" aria-label="Contextual inspector">
  <div class="ci-tabs" role="tablist" aria-label="Inspector panels">
    <button
      class="ci-tab"
      role="tab"
      aria-selected={tab === "assets"}
      onclick={() => tab = "assets"}
    >
      Assets
    </button>
    <button
      class="ci-tab"
      role="tab"
      aria-selected={tab === "reviews"}
      onclick={() => tab = "reviews"}
    >
      Reviews
    </button>
    <button
      class="ci-tab"
      role="tab"
      aria-selected={tab === "status"}
      onclick={() => tab = "status"}
    >
      Status
    </button>
  </div>

  <div class="ci-content">
    {#if tab === "assets" && assetStore.selectedGroup}
      <AssetPanel />
    {:else if tab === "reviews"}
      <ReviewInbox />
    {:else if tab === "status"}
      <ProgressPanel />
      <StalenessPanel />
    {:else}
      <div class="inspector-empty">
        <p>Select a scene to inspect assets.</p>
      </div>
    {/if}
  </div>
</aside>

<style>
  .context-inspector {
    background: var(--vs-bg-surface);
    border-left: 1px solid var(--vs-border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .ci-tabs {
    display: flex;
    border-bottom: 1px solid var(--vs-border);
  }

  .ci-tab {
    flex: 1;
    padding: var(--vs-space-2);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-family: var(--vs-font-sans);
    font-size: var(--vs-text-xs);
    color: var(--vs-text-secondary);
    cursor: pointer;
    margin-bottom: -1px;
  }

  .ci-tab:hover {
    color: var(--vs-text-primary);
  }

  .ci-tab[aria-selected="true"] {
    color: var(--vs-accent);
    border-bottom-color: var(--vs-accent);
  }

  .ci-content {
    flex: 1;
    overflow-y: auto;
  }

  .inspector-empty {
    padding: var(--vs-space-4);
    font-size: var(--vs-text-sm);
    color: var(--vs-text-secondary);
    text-align: center;
  }

  @media (max-width: 1024px) {
    .context-inspector {
      display: none;
    }
  }
</style>
