import type { EpisodeWorkspace } from "$lib/episode-types";
import type { GatewayClient } from "$contracts/client";

/** Asset paths derived from episode structure — resolved by the gateway. */
export interface EpisodeAssets {
  images: Record<string, string>;   // sceneId → image URL
  narration: Record<string, string>; // segmentId → WAV URL
  video: string | null;              // final.mp4 URL
}

export type EpisodeLoadState =
  | { phase: "unselected" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; episode: EpisodeWorkspace };

class EpisodeStore {
  state = $state<EpisodeLoadState>({ phase: "unselected" });
  selectedStageId = $state<string | null>(null);
  assets = $state<EpisodeAssets>({ images: {}, narration: {}, video: null });
  private _gatewayBaseUrl = $state("");

  load(episode: EpisodeWorkspace) {
    this.state = { phase: "ready", episode };
    const active =
      episode.stages.find((s) => s.status === "running" || s.blocked) ??
      episode.stages[0];
    this.selectedStageId = active?.id ?? null;
  }

  /** Load episode from gateway API (for live data). */
  async loadFromGateway(client: GatewayClient, channel: string, series: string, epSlug: string) {
    this.state = { phase: "loading" };
    try {
      const detail = await client.getEpisode(channel, series, epSlug) as any;
      const now = new Date().toISOString();
      // Build asset URLs FIRST (before loading workspace, so effects see them)
      const libraryBase = this._gatewayBaseUrl || "http://127.0.0.1:5198";
      const epBase = `${libraryBase}/library/${channel}/${series}/${epSlug}`;
      const imgUrls: Record<string, string> = {};
      const narUrls: Record<string, string> = {};

      for (const scene of detail.scenes ?? []) {
        imgUrls[scene.id] = `${epBase}/assets/images/${scene.id}.jpg`;
        narUrls[scene.id] = `${epBase}/artifacts/narration/${scene.id}.wav`;
      }

      this.assets = {
        images: imgUrls,
        narration: narUrls,
        video: `${epBase}/artifacts/final.mp4`,
      };

      // Augment scenes with image URLs before loading
      const augmentedScenes = (detail.scenes ?? []).map((s: any) => ({
        ...s,
        imageUrl: imgUrls[s.id] ?? null,
      }));

      const workspace: EpisodeWorkspace = {
        slug: epSlug,
        channel,
        series,
        title: detail.title ?? epSlug,
        status: (detail.status ?? "pending") as any,
        approvalMode: "guided",
        budgetLimit: (detail.budget?.limitMicros ?? 0) / 1_000_000,
        budgetSpent: (detail.budget?.consumedMicros ?? 0) / 1_000_000,
        stages: (detail.stages ?? []).map((s: any) => ({
          id: s.id ?? s,
          name: s.name ?? s.id ?? s,
          status: (s.status ?? s.state ?? "pending") as any,
          blocked: s.blocked ?? false,
          progress: s.status === "completed" ? 1 : s.status === "running" ? 0.5 : 0,
          attemptCount: 0,
          stale: false,
          dependsOn: [],
        })),
        currentDeliverable: null,
        currentDeliverableValidated: false,
        blocked: false,
        staleCount: detail.staleness?.stale?.length ?? 0,
        createdAt: now,
        updatedAt: now,
        pipeline: detail.pipeline ?? "narrated-illustrated-video",
        scenes: augmentedScenes,
        budget: detail.budget,
        reviews: detail.reviews ?? [],
        staleness: detail.staleness ?? { stale: [], affected: [] },
        blockers: detail.blockers ?? [],
      };
      this.load(workspace);
      // Build narration segments from scenes (each scene = one narration segment)
      const segments = (detail.scenes ?? []).map((s: any, i: number) => ({
        id: s.id ?? `n${i + 1}`,
        index: i,
        text: `Scene ${i + 1}: ${s.title ?? ""}`,
        status: "idle" as const,
        durationSeconds: s.durationSeconds ?? 10,
        wavPath: narUrls[s.id ?? `n${i + 1}`],
      }));

      const { narration } = await import("$lib/narration-store.svelte.ts");
      narration.load(segments, {
        name: "Qwen3-TTS",
        modelSize: "0.6B",
        installed: true,
        sampleRate: 24000,
      });

      // Load scenes into scene store
      const { scenes: sceneStore } = await import("$lib/scene-store.svelte.ts");
      if (detail.scenes && detail.scenes.length > 0) {
        sceneStore.load(detail.scenes.map((s: any, i: number) => ({
          id: s.id ?? `s${i + 1}`,
          index: i,
          title: s.title ?? s.id ?? `Scene ${i + 1}`,
          intent: s.intent ?? "",
          role: (s.role ?? "narrator") as any,
          durationSeconds: s.durationSeconds ?? 10,
          status: "idle" as const,
          stale: false,
          selectedAssetId: s.id ?? `s${i + 1}`,
          attemptCount: 0,
          narrationStatus: "idle" as const,
          captionsStatus: "idle" as const,
          transition: "cut" as const,
        })));
      }
    } catch (err) {
      this.loadError(err instanceof Error ? err.message : "Failed to load episode");
    }
  }

  loadError(message: string) {
    this.state = { phase: "error", message };
  }

  selectStage(stageId: string) {
    this.selectedStageId = stageId;
  }

  patch(_delta: Partial<EpisodeWorkspace>) {
    if (this.state.phase !== "ready") return;
    this.state = {
      phase: "ready",
      episode: { ...this.state.episode, ..._delta },
    };
  }
}

export const episode = new EpisodeStore();
