import type { EpisodeWorkspace } from "$lib/episode-types";
import type { GatewayClient } from "$contracts/client";

export type EpisodeLoadState =
  | { phase: "unselected" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; episode: EpisodeWorkspace };

class EpisodeStore {
  state = $state<EpisodeLoadState>({ phase: "unselected" });
  selectedStageId = $state<string | null>(null);

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
        scenes: detail.scenes ?? [],
        budget: detail.budget,
        reviews: detail.reviews ?? [],
        staleness: detail.staleness ?? { stale: [], affected: [] },
        blockers: detail.blockers ?? [],
      };
      this.load(workspace);

      // Also load narration segments if available
      if (detail.narration && detail.narration.length > 0) {
        const { narration } = await import("$lib/narration-store.svelte.ts");
        narration.load(detail.narration, {
          name: "Qwen3-TTS",
          modelSize: "0.6B",
          installed: true,
          sampleRate: 24000,
        });
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
