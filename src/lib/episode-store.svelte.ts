import type { EpisodeWorkspace } from "$lib/episode-types";
import type { GatewayClient } from "$contracts/client";

/** Asset paths derived from episode structure — resolved by the gateway. */
export interface EpisodeAssets {
  images: Record<string, string>;   // sceneId → image URL (only files that exist)
  videos: Record<string, string>;   // sceneId → video URL (only files that exist)
  narration: Record<string, string>; // sceneId → WAV URL (only completed narration)
  video: string | null;              // current render URL, null when no render exists
}

export interface EpisodeRender {
  url: string;
  file: string;
  size: number;
  generatedAt: string;
}

export type EpisodeLoadState =
  | { phase: "unselected" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; episode: EpisodeWorkspace };

class EpisodeStore {
  state = $state<EpisodeLoadState>({ phase: "unselected" });
  selectedStageId = $state<string | null>(null);
  assets = $state<EpisodeAssets>({ images: {}, videos: {}, narration: {}, video: null });
  render = $state<EpisodeRender | null>(null);
  qaReport = $state<Record<string, any> | null>(null);
  /** Real narration text per scene id (from artifacts/narration-script.json). */
  narrationTexts = $state<Record<string, string>>({});
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
      // Build asset URLs from the gateway's enriched scene data. Never guess
      // URLs: an asset exists only when the gateway found the file on disk.
      const libraryBase = this._gatewayBaseUrl || "http://127.0.0.1:5198";
      const abs = (u: string | null | undefined) => (u ? `${libraryBase}${u}` : null);
      const imgUrls: Record<string, string> = {};
      const vidUrls: Record<string, string> = {};
      const narUrls: Record<string, string> = {};

      for (const scene of detail.scenes ?? []) {
        if (scene.asset?.kind === "image" && scene.asset.url) {
          imgUrls[scene.id] = abs(scene.asset.url)!;
        }
        if (scene.asset?.kind === "video" && scene.asset.url) {
          vidUrls[scene.id] = abs(scene.asset.url)!;
        }
        if (scene.narration?.status === "completed" && scene.narration.url) {
          narUrls[scene.id] = abs(scene.narration.url)!;
        }
      }

      this.render = detail.render ? { ...detail.render, url: abs(detail.render.url)! } : null;
      this.qaReport = detail.qaReport ?? null;

      this.assets = {
        images: imgUrls,
        videos: vidUrls,
        narration: narUrls,
        video: this.render?.url ?? null,
      };

      // Augment scenes with image URLs before loading
      const augmentedScenes = (detail.scenes ?? []).map((s: any) => ({
        ...s,
        imageUrl: imgUrls[s.id] ?? null,
      }));

      // Real staleness from the gateway/runtime. Pending or runnable stages
      // are NOT stale; stale means previously produced inputs changed.
      let realStale: string[] = [];
      let realAffected: string[] = [];
      try {
        const st = await client.fetchJSON(
          `/api/channels/${channel}/series/${series}/episodes/${epSlug}/staleness`
        ) as { stale?: string[]; affected?: string[] };
        realStale = st.stale ?? [];
        realAffected = st.affected ?? [];
      } catch { /* staleness endpoint unavailable; report none */ }

      // Build stages with staleness from API
      const enrichedStages = (detail.stages ?? []).map((s: any) => {
        const state = s.status ?? s.state ?? "pending";
        return {
          id: s.id ?? s,
          name: s.name ?? s.id ?? s,
          status: state as any,
          blocked: s.blocked ?? false,
          progress: state === "completed" ? 1 : state === "running" ? 0.5 : 0,
          attemptCount: 0,
          stale: realStale.includes(s.id ?? s),
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
        staleness: { stale: realStale, affected: realAffected },
        blockers: detail.blockers ?? [],
      };
      this.load(workspace);

      // Real narration text from the episode's narration script artifact.
      const narrationTexts: Record<string, string> = {};
      try {
        const scriptFile = await client.fetchJSON(
          `/api/channels/${channel}/series/${series}/episodes/${epSlug}/file/artifacts/narration-script.json`
        ) as { content?: string };
        const entries = JSON.parse(scriptFile.content ?? "[]") as Array<{ id: string; text: string }>;
        for (const e of entries) narrationTexts[e.id] = e.text;
      } catch { /* no narration script yet; texts stay empty */ }
      this.narrationTexts = narrationTexts;

      // Build narration segments from scenes (each scene = one narration segment)
      const segments = (detail.scenes ?? []).map((s: any, i: number) => {
        const role = s.role ?? "narrator";
        return {
          id: s.id ?? `n${i + 1}`,
          index: i,
          text: narrationTexts[s.id] ?? "",
          status: (narUrls[s.id] ? "ready" : "idle") as any,
          durationSeconds: s.narration?.durationSeconds ?? s.durationSeconds ?? 10,
          wavPath: narUrls[s.id ?? `n${i + 1}`],
          voice: s.narration?.voice ?? s.voice ?? "default",
          instruct: s.instruct ?? null,
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
          assetUrl: s.asset?.url ? abs(s.asset.url) : null,
          narrationUrl: narUrls[s.id] ?? null,
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
