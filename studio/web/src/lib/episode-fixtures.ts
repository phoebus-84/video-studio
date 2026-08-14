import type { EpisodeWorkspace } from "$lib/episode-types";

export const EPISODE_FIXTURE: EpisodeWorkspace = {
  slug: "ep-02-memory",
  title: "Memory Hierarchies Explained",
  channel: "tech-explainer",
  series: "how-it-works",
  status: "running",
  approvalMode: "autopilot",
  budgetLimit: 2.5,
  budgetSpent: 0.84,
  stages: [
    {
      id: "brief",
      name: "Brief",
      status: "completed",
      attemptCount: 1,
      blocked: false,
      stale: false,
      dependsOn: [],
      progress: 1,
    },
    {
      id: "script",
      name: "Script",
      status: "completed",
      attemptCount: 2,
      blocked: false,
      stale: false,
      dependsOn: ["brief"],
      progress: 1,
    },
    {
      id: "art-direction",
      name: "Art Direction",
      status: "completed",
      attemptCount: 1,
      blocked: false,
      stale: false,
      dependsOn: ["script"],
      progress: 1,
    },
    {
      id: "illustrations",
      name: "Illustrations",
      status: "running",
      attemptCount: 3,
      blocked: false,
      stale: false,
      dependsOn: ["art-direction"],
      progress: 0.62,
    },
    {
      id: "narration",
      name: "Narration",
      status: "completed",
      attemptCount: 1,
      blocked: false,
      stale: false,
      dependsOn: ["script"],
      progress: 1,
    },
    {
      id: "captions",
      name: "Captions",
      status: "pending",
      attemptCount: 0,
      blocked: false,
      stale: false,
      dependsOn: ["narration"],
      progress: 0,
    },
    {
      id: "compose",
      name: "Compose",
      status: "pending",
      attemptCount: 0,
      blocked: false,
      stale: false,
      dependsOn: ["illustrations", "narration", "captions"],
      progress: 0,
    },
  ],
  currentDeliverable: null,
  currentDeliverableValidated: false,
  blocked: false,
  staleCount: 0,
  createdAt: "2026-07-27T10:00:00Z",
  updatedAt: "2026-07-27T11:00:00Z",
};

export const BLOCKED_EPISODE_FIXTURE: EpisodeWorkspace = {
  ...EPISODE_FIXTURE,
  slug: "ep-01-cache",
  title: "Cache Coherence Protocols",
  status: "blocked",
  blocked: true,
  blockedReason: "fal.ai image.generate quota exceeded — 4.78 / 5.00 USD spent",
  stages: EPISODE_FIXTURE.stages.map((s) =>
    s.id === "illustrations"
      ? {
          ...s,
          status: "running" as const,
          blocked: true,
          blockedCode: "PROVIDER_QUOTA_EXCEEDED",
          progress: 0.45,
        }
      : s,
  ),
};

export const STALE_EPISODE_FIXTURE: EpisodeWorkspace = {
  ...EPISODE_FIXTURE,
  slug: "ep-03-pipelines",
  title: "CPU Pipelines and Branch Prediction",
  status: "completed",
  staleCount: 2,
  stages: EPISODE_FIXTURE.stages.map((s) =>
    s.id === "script"
      ? { ...s, stale: true }
      : s.id === "compose"
        ? { ...s, stale: true }
        : s,
  ),
};
