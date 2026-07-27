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
      const detail = await client.getEpisode(channel, series, epSlug);
      const workspace: EpisodeWorkspace = {
        slug: epSlug,
        channel,
        series,
        title: detail.title ?? epSlug,
        pipeline: detail.pipeline ?? "narrated-illustrated-video",
        stages: (detail.stages ?? []).map((s: any) => ({
          id: s.id ?? s,
          name: s.name ?? s.id ?? s,
          status: (s.status ?? s.state ?? "pending") as any,
          blocked: s.blocked ?? false,
        })),
        budget: detail.budget ?? { currency: "USD", limit: 0, consumed: 0 },
        reviews: detail.reviews ?? [],
        staleness: detail.staleness ?? { stale: [], affected: [] },
        blockers: detail.blockers ?? [],
      };
      this.load(workspace);
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
