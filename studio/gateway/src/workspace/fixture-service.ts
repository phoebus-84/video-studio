import type { WorkspaceService } from "./service";
import type {
  ChannelSummary,
  SeriesSummary,
  EpisodeSummary,
  EpisodeDetail,
} from "../contracts/types";

/**
 * Fixture workspace service for deterministic testing.
 * Returns hardcoded data matching the web UI fixtures.
 */
export class FixtureWorkspaceService implements WorkspaceService {
  async listChannels(): Promise<ChannelSummary[]> {
    return [
      { slug: "tech-explainer", title: "Tech Explainer", seriesCount: 2 },
      { slug: "tutorials", title: "Tutorials", seriesCount: 1 },
    ];
  }

  async listSeries(channelSlug: string): Promise<SeriesSummary[]> {
    const byChannel: Record<string, SeriesSummary[]> = {
      "tech-explainer": [
        { slug: "how-it-works", title: "How It Works", episodeCount: 3 },
        { slug: "deep-dives", title: "Deep Dives", episodeCount: 1 },
      ],
      tutorials: [
        { slug: "rust-101", title: "Rust 101", episodeCount: 2 },
      ],
    };
    return byChannel[channelSlug] ?? [];
  }

  async listEpisodes(
    channelSlug: string,
    seriesSlug: string,
  ): Promise<EpisodeSummary[]> {
    const key = `${channelSlug}/${seriesSlug}`;
    const bySeries: Record<string, EpisodeSummary[]> = {
      "tech-explainer/how-it-works": [
        {
          slug: "ep-01-cpu",
          title: "How a CPU Executes Code",
          status: "completed",
          currentDeliverable: true,
          blocked: false,
          staleCount: 0,
          lastActivity: "2026-07-27T10:00:00Z",
        },
        {
          slug: "ep-02-memory",
          title: "Memory Hierarchies Explained",
          status: "running",
          currentDeliverable: false,
          blocked: false,
          staleCount: 0,
          lastActivity: "2026-07-27T11:00:00Z",
        },
        {
          slug: "ep-03-pipelines",
          title: "CPU Pipelines and Branch Prediction",
          status: "completed",
          currentDeliverable: false,
          blocked: false,
          staleCount: 2,
          lastActivity: "2026-07-27T09:00:00Z",
        },
      ],
      "tech-explainer/deep-dives": [
        {
          slug: "ep-01-cache",
          title: "Cache Coherence Protocols",
          status: "blocked",
          currentDeliverable: false,
          blocked: true,
          staleCount: 0,
          lastActivity: "2026-07-27T08:30:00Z",
        },
      ],
      "tutorials/rust-101": [
        {
          slug: "ep-01-ownership",
          title: "Understanding Ownership",
          status: "failed",
          currentDeliverable: false,
          blocked: false,
          staleCount: 0,
          lastActivity: "2026-07-26T16:00:00Z",
        },
        {
          slug: "ep-02-borrowing",
          title: "Borrowing and Lifetimes",
          status: "awaiting_review",
          currentDeliverable: false,
          blocked: false,
          staleCount: 0,
          lastActivity: "2026-07-27T12:00:00Z",
        },
      ],
    };
    return bySeries[key] ?? [];
  }

  async getEpisode(
    channelSlug: string,
    seriesSlug: string,
    episodeSlug: string,
  ): Promise<EpisodeDetail> {
    const detailBySlug: Record<string, EpisodeDetail> = {
      "ep-02-memory": {
        slug: "ep-02-memory",
        title: "Memory Hierarchies Explained",
        channel: channelSlug,
        series: seriesSlug,
        status: "running",
        approvalMode: "autopilot",
        budgetLimit: 2.5,
        budgetSpent: 0.84,
        stages: [
          { id: "brief", name: "Brief", status: "completed", attemptCount: 1, blocked: false, stale: false, dependsOn: [], progress: 1 },
          { id: "script", name: "Script", status: "completed", attemptCount: 2, blocked: false, stale: false, dependsOn: ["brief"], progress: 1 },
          { id: "illustrations", name: "Illustrations", status: "running", attemptCount: 3, blocked: false, stale: false, dependsOn: ["script"], progress: 0.62 },
          { id: "narration", name: "Narration", status: "completed", attemptCount: 1, blocked: false, stale: false, dependsOn: ["script"], progress: 1 },
          { id: "compose", name: "Compose", status: "pending", attemptCount: 0, blocked: false, stale: false, dependsOn: ["illustrations", "narration"], progress: 0 },
        ],
        currentDeliverable: null,
        currentDeliverableValidated: false,
        staleCount: 0,
        blocked: false,
        createdAt: "2026-07-27T10:00:00Z",
        updatedAt: "2026-07-27T11:00:00Z",
      },
    };

    /* Generate a basic detail for any other episode. */
    return (
      detailBySlug[episodeSlug] ?? {
        slug: episodeSlug,
        title: episodeSlug,
        channel: channelSlug,
        series: seriesSlug,
        status: "idle",
        approvalMode: "autopilot",
        budgetLimit: null,
        budgetSpent: null,
        stages: [],
        currentDeliverable: null,
        currentDeliverableValidated: false,
        staleCount: 0,
        blocked: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }
    );
  }

  async findEvents(
    _ref: { channel: string; series: string; episode: string },
    _query: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    return [];
  }
}
