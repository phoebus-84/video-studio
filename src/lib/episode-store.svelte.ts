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

      // Build stages with staleness from API
      const enrichedStages = (detail.stages ?? []).map((s: any) => {
        const state = s.status ?? s.state ?? "pending";
        const isStale = state === "pending" || state === "runnable";
        return {
          id: s.id ?? s,
          name: s.name ?? s.id ?? s,
          status: state as any,
          blocked: s.blocked ?? false,
          progress: state === "completed" ? 1 : state === "running" ? 0.5 : 0,
          attemptCount: 0,
          stale: isStale,
          dependsOn: s.dependsOn ?? [],
        };
      });

      const workspace: EpisodeWorkspace = {
        slug: epSlug,
        channel,
        series,
        title: detail.title ?? epSlug,
        status: (detail.status ?? "pending") as any,
        approvalMode: "guided",
        budgetLimit: (detail.budget?.limitMicros ?? 0) / 1_000_000,
        budgetSpent: (detail.budget?.consumedMicros ?? 0) / 1_000_000,
        stages: enrichedStages,
        currentDeliverable: null,
        currentDeliverableValidated: false,
        blocked: false,
        staleCount: enrichedStages.filter((s: any) => s.stale).length,
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
      const segments = (detail.scenes ?? []).map((s: any, i: number) => {
        const role = s.role ?? "narrator";
        // Character-specific voice and instruction mappings
        const charVoices: Record<string, { voice: string; instruct: string | null }> = {
          narrator: { voice: "default", instruct: "Speak warmly and gently like a grandmother telling a bedtime story to a child. Soft, soothing, and full of love." },
          wolf: { voice: "default", instruct: "Speak with a sly, smooth, cunning voice. Charming but dangerous. A wolf in sheep's clothing." },
          woodcutter: { voice: "default", instruct: "Speak with a deep, strong, heroic voice. Brave and reassuring." },
          grandmother: { voice: "default", instruct: "Speak with a frail, elderly female voice. Kind, gentle, and loving." },
          girl: { voice: "default", instruct: "Speak with a young, innocent, sweet little girl's voice. Curious and trusting." },
        };
        const charConfig = charVoices[role] || charVoices["narrator"]!;

        return {
          id: s.id ?? `n${i + 1}`,
          index: i,
          text: `Scene ${i + 1}: ${s.title ?? ""}`,
          status: "idle" as const,
          durationSeconds: s.durationSeconds ?? 10,
          wavPath: narUrls[s.id ?? `n${i + 1}`],
          voice: charConfig.voice,
          instruct: charConfig.instruct,
          role,
        };
      });

      // Read TTS model from series pipeline config
      let ttsModelSize = "0.6B";
      try {
        const pipelineData = await client.fetchJSON(
          `/api/channels/${channel}/series/${series}/file/pipeline.yaml`
        ) as { content?: string };
        if (pipelineData.content) {
          const match = pipelineData.content.match(/model:\s*(\S+)/);
          if (match) {
            const modelName = match[1]!;
            ttsModelSize = modelName.includes("1.7") ? "1.7B" : modelName.includes("0.6") ? "0.6B" : "0.6B";
          }
        }
      } catch { /* use default */ }

      const { narration } = await import("$lib/narration-store.svelte.ts");
      narration.load(segments, {
        name: "Qwen3-TTS",
        modelSize: ttsModelSize,
        installed: true,
        sampleRate: 24000,
      });

      // Load scenes into scene store with enriched fields from gateway
      const { scenes: sceneStore } = await import("$lib/scene-store.svelte.ts");
      if (detail.scenes && detail.scenes.length > 0) {
        sceneStore.load(detail.scenes.map((s: any, i: number) => ({
          id: s.id ?? `s${i + 1}`,
          index: i,
          title: s.title ?? s.id ?? `Scene ${i + 1}`,
          intent: s.intent ?? "",
          role: (s.role ?? "narrator") as any,
          durationSeconds: s.durationSeconds ?? 10,
          status: (s.narration?.status === "completed" ? "completed" : "idle") as any,
          stale: s.stale ?? false,
          selectedAssetId: s.id ?? `s${i + 1}`,
          attemptCount: s.attemptCount ?? 0,
          // Enriched fields from gateway Phase 1
          narrationStatus: (s.narration?.status ?? "idle") as any,
          captionsStatus: (s.captions?.count > 0 ? "completed" : "idle") as any,
          transition: (s.transition ?? "cut") as any,
          // Asset info
          assetUrl: s.asset?.url ?? imgUrls[s.id] ?? null,
          narrationUrl: s.narration?.url ?? narUrls[s.id] ?? null,
          narrationDuration: s.narration?.durationSeconds ?? s.durationSeconds ?? 10,
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
