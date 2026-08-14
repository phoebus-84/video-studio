import type {
  ChannelSummary,
  SeriesSummary,
  EpisodeSummary,
} from "$contracts/gateway";
import type { LibraryTree } from "$lib/library-types";

export interface LibraryFixture {
  channels: ChannelSummary[];
  seriesByChannel: Record<string, SeriesSummary[]>;
  episodesBySeries: Record<string, EpisodeSummary[]>;
  malformed?: boolean;
}

/** Produce a deterministic fixture tree for tests. */
export function buildFixtureTree(fixture: LibraryFixture): LibraryTree {
  return {
    channels: fixture.channels.map((ch) => {
      const series = fixture.seriesByChannel[ch.slug] ?? [];
      return {
        slug: ch.slug,
        title: ch.title,
        series: series.map((ser) => {
          const key = `${ch.slug}/${ser.slug}`;
          const episodes = fixture.episodesBySeries[key] ?? [];
          const isMalformed = fixture.malformed === true;
          return {
            slug: ser.slug,
            title: ser.title,
            channel: ch.slug,
            episodes: episodes.map((ep) => {
              const base = {
                slug: ep.slug,
                title: ep.title,
                channel: ch.slug,
                series: ser.slug,
                status: ep.status,
                currentDeliverable: ep.currentDeliverable,
                blocked: ep.blocked,
                staleCount: 0,
                lastActivity: ep.lastActivity,
              };
              return isMalformed
                ? { ...base, error: "corrupt episode manifest" as const }
                : base;
            }),
          };
        }),
      };
    }),
  };
}

/** Default fixture used across storybook and tests. */
export const DEFAULT_FIXTURE: LibraryFixture = {
  channels: [
    { slug: "tech-explainer", title: "Tech Explainer", seriesCount: 2 },
    { slug: "tutorials", title: "Tutorials", seriesCount: 1 },
  ],
  seriesByChannel: {
    "tech-explainer": [
      { slug: "how-it-works", title: "How It Works", episodeCount: 3 },
      { slug: "deep-dives", title: "Deep Dives", episodeCount: 1 },
    ],
    tutorials: [
      { slug: "rust-101", title: "Rust 101", episodeCount: 2 },
    ],
  },
  episodesBySeries: {
    "tech-explainer/how-it-works": [
      {
        slug: "ep-01-cpu",
        title: "How a CPU Executes Code",
        status: "completed",
        currentDeliverable: true,
        blocked: false,
        lastActivity: "2026-07-27T10:00:00Z",
      },
      {
        slug: "ep-02-memory",
        title: "Memory Hierarchies Explained",
        status: "running",
        currentDeliverable: false,
        blocked: false,
        lastActivity: "2026-07-27T11:00:00Z",
      },
      {
        slug: "ep-03-pipelines",
        title: "CPU Pipelines and Branch Prediction",
        status: "idle",
        currentDeliverable: false,
        blocked: false,
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
        lastActivity: "2026-07-26T16:00:00Z",
      },
      {
        slug: "ep-02-borrowing",
        title: "Borrowing and Lifetimes",
        status: "awaiting_review",
        currentDeliverable: false,
        blocked: false,
        lastActivity: "2026-07-27T12:00:00Z",
      },
    ],
  },
};

export const EMPTY_FIXTURE: LibraryFixture = {
  channels: [],
  seriesByChannel: {},
  episodesBySeries: {},
};
