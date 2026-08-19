/**
 * Turning the gateway's scene records into asset groups for the inspector.
 *
 * This was inline in `ContextInspector`, which meant a hundred lines of data
 * shaping had to be read past to find out what the inspector rendered, and none
 * of it could be tested without mounting a component.
 *
 * The rule it enforces is worth stating plainly: an asset exists only when the
 * gateway reported a file for it. Missing images are listed with no URL and an
 * "idle" state so the gap is visible, rather than omitted so the scene looks
 * complete.
 */

import type { AssetAttempt, AssetGroup } from "$lib/asset-types";
import type { EpisodeAssets } from "$lib/episode-store.svelte.ts";

interface SceneAsset {
  kind: string;
  url: string;
  size: number;
  generatedAt: string;
}

interface SceneNarration {
  url: string;
  durationSeconds: number;
  voice: string;
  status: string;
  generatedAt: string | null;
  size: number | null;
}

/** Fields every attempt carries, so each builder below states only what differs. */
function baseAttempt(id: string, sceneId: string): Omit<AssetAttempt, "kind" | "state" | "anchorType"> {
  return {
    id,
    sceneId,
    prompt: "",
    instruct: null,
    referenceImages: [],
    provider: null,
    model: null,
    seed: null,
    dimensions: null,
    durationSeconds: null,
    fileSize: null,
    cost: null,
    license: "",
    createdAt: null,
    selected: false,
    imageUrl: null,
    videoUrl: null,
    audioUrl: null,
    filePath: null,
    fileAvailable: false,
  };
}

export function buildAssetGroups(
  scenes: readonly Record<string, unknown>[],
  narrationTexts: Record<string, string>,
  assets: EpisodeAssets,
): AssetGroup[] {
  return scenes.map((scene) => {
    const sceneId = scene["id"] as string;
    const asset = (scene["asset"] ?? null) as SceneAsset | null;
    const narration = (scene["narration"] ?? null) as SceneNarration | null;
    const intent = (scene["intent"] as string) ?? "";

    const attempts: AssetAttempt[] = [];

    /* Video, only when a file exists — terminal recordings and the like. */
    if (asset?.kind === "video") {
      attempts.push({
        ...baseAttempt(`vid-${sceneId}`, sceneId),
        kind: "video",
        prompt: intent,
        fileSize: asset.size ?? null,
        createdAt: asset.generatedAt ?? null,
        videoUrl: assets.videos[sceneId] ?? null,
        fileAvailable: true,
        state: "ready",
        anchorType: "assets",
      });
    }

    /* Image, always listed so a missing one is visible rather than absent. */
    const imageUrl = asset?.kind === "image" ? (assets.images[sceneId] ?? null) : null;
    attempts.push({
      ...baseAttempt(`img-${sceneId}`, sceneId),
      kind: "image",
      prompt: intent,
      fileSize: asset?.kind === "image" ? (asset.size ?? null) : null,
      createdAt: asset?.kind === "image" ? (asset.generatedAt ?? null) : null,
      selected: true,
      imageUrl,
      fileAvailable: imageUrl !== null,
      state: imageUrl ? "ready" : "idle",
      anchorType: "assets",
    });

    /* Narration audio, always listed, with its text editable. */
    const narrationReady = narration?.status === "completed" && Boolean(narration.url);
    attempts.push({
      ...baseAttempt(`nar-${sceneId}`, sceneId),
      kind: "audio",
      prompt: narrationTexts[sceneId] ?? "",
      instruct: (scene["instruct"] as string) ?? null,
      provider: "Qwen3-TTS",
      durationSeconds: narration?.durationSeconds ?? null,
      fileSize: narration?.size ?? null,
      createdAt: narration?.generatedAt ?? null,
      audioUrl: narrationReady ? (assets.narration[sceneId] ?? null) : null,
      fileAvailable: narrationReady,
      state: narrationReady ? "ready" : "idle",
      anchorType: "narration",
    });

    return {
      sceneId,
      sceneTitle: (scene["title"] as string) ?? sceneId,
      attempts,
    };
  });
}
