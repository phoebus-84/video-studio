import { expect, test, describe } from "vitest";
import { deriveStatusStrip } from "../../src/lib/production-status";
import type { EpisodeWorkspace, ResolvedStage } from "../../src/lib/episode-types";

function stage(over: Partial<ResolvedStage> = {}): ResolvedStage {
  return {
    id: "illustrations",
    name: "Illustrations",
    status: "pending",
    attemptCount: 0,
    blocked: false,
    stale: false,
    dependsOn: [],
    progress: 0,
    ...over,
  };
}

function episode(over: Partial<EpisodeWorkspace> = {}): EpisodeWorkspace {
  return {
    slug: "ep-01-cpu",
    title: "How a CPU works",
    channel: "tech-explainer",
    series: "cpu-internals",
    /* Quiet by default so each test states the state it is exercising. */
    status: "idle",
    approvalMode: "guided",
    budgetLimit: 5,
    budgetSpent: 1.84,
    stages: [stage()],
    currentDeliverable: null,
    currentDeliverableValidated: false,
    blocked: false,
    staleCount: 0,
    createdAt: "2026-08-18T09:00:00Z",
    updatedAt: "2026-08-18T13:58:00Z",
    ...over,
  };
}

describe("status strip precedence", () => {
  test("offline outranks every other state", () => {
    /* Everything below offline would be reported from memory, not fact. */
    const strip = deriveStatusStrip({
      connected: false,
      episode: episode({
        blocked: true,
        staleCount: 3,
        stages: [stage({ status: "running", blocked: true })],
      }),
    });
    expect(strip.kind).toBe("offline");
  });

  test("blocked outranks running", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        stages: [
          stage({ id: "narration", name: "Narration", status: "running" }),
          stage({ blocked: true, blockedCode: "E_PROVIDER_QUOTA" }),
        ],
      }),
    });
    expect(strip.kind).toBe("blocked");
    expect(strip.title).toBe("Illustrations blocked");
    expect(strip.detail).toBe("E_PROVIDER_QUOTA");
  });

  test("running outranks stale", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        staleCount: 3,
        stages: [stage({ status: "running", progress: 0.62 })],
      }),
    });
    expect(strip.kind).toBe("running");
    expect(strip.progress).toBe(0.62);
  });

  test("stale outranks a current deliverable", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        staleCount: 2,
        currentDeliverable: "renders/ep-01.v4.mp4",
        stages: [stage({ status: "completed" })],
      }),
    });
    expect(strip.kind).toBe("stale");
    expect(strip.title).toBe("2 outputs are stale");
  });

  test("a validated deliverable with nothing stale reads as current", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        currentDeliverable: "renders/ep-01.v4.mp4",
        currentDeliverableValidated: true,
        stages: [stage({ status: "completed" })],
      }),
    });
    expect(strip.kind).toBe("current");
    expect(strip.detail).toContain("renders/ep-01.v4.mp4");
  });
});

describe("status strip content", () => {
  test("no episode is idle, not an error", () => {
    const strip = deriveStatusStrip({ connected: true, episode: null });
    expect(strip.kind).toBe("idle");
    expect(strip.actions).toEqual([]);
  });

  test("a single stale output is singular", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({ staleCount: 1, stages: [stage({ status: "completed" })] }),
    });
    expect(strip.title).toBe("1 output is stale");
  });

  test("stale detail names the changed artifacts when the gateway reports them", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        staleCount: 1,
        staleness: { stale: ["script.md"], affected: ["narration"] },
        stages: [stage({ status: "completed" })],
      }),
    });
    expect(strip.detail).toContain("script.md");
  });

  test("at most one action is primary", () => {
    for (const input of [
      { connected: false, episode: null },
      { connected: true, episode: episode({ blocked: true }) },
      { connected: true, episode: episode({ staleCount: 2 }) },
      { connected: true, episode: episode({ currentDeliverable: "a.mp4" }) },
    ]) {
      const strip = deriveStatusStrip(input);
      expect(strip.actions.filter((a) => a.primary).length).toBeLessThanOrEqual(1);
    }
  });

  test("with no episode, a level rollup replaces the empty message", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: null,
      rollup: { label: "Fairy Tales", total: 7, running: 4, blocked: 0, stale: 0 },
    });
    expect(strip.kind).toBe("running");
    expect(strip.title).toBe("Fairy Tales");
    expect(strip.detail).toBe("7 episodes · 4 running");
  });

  test("a rollup reports the worst state underneath", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: null,
      rollup: { label: "Fairy Tales", total: 7, running: 4, blocked: 1, stale: 2 },
    });
    expect(strip.kind).toBe("blocked");
    expect(strip.detail).toBe("7 episodes · 4 running, 1 blocked, 2 stale");
  });

  test("a quiet rollup says so rather than staying blank", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: null,
      rollup: { label: "Fairy Tales", total: 1, running: 0, blocked: 0, stale: 0 },
    });
    expect(strip.kind).toBe("idle");
    expect(strip.detail).toBe("1 episode · nothing running");
  });

  test("offline still outranks a rollup", () => {
    const strip = deriveStatusStrip({
      connected: false,
      episode: null,
      rollup: { label: "Fairy Tales", total: 7, running: 4, blocked: 0, stale: 0 },
    });
    expect(strip.kind).toBe("offline");
  });

  test("an unblocked episode with no deliverable offers a way to start", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({ status: "idle", stages: [stage({ status: "pending" })] }),
    });
    expect(strip.kind).toBe("idle");
    expect(strip.actions[0]?.id).toBe("run");
  });

  test("an episode running with no active stage still reads as running", () => {
    /* The runtime can report the episode as running between stages. Calling
       that idle would contradict the library rail beside it. */
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        status: "running",
        stages: [stage({ status: "completed" }), stage({ id: "render", status: "pending" })],
      }),
    });
    expect(strip.kind).toBe("running");
    expect(strip.title).toBe("Episode running");
    expect(strip.detail).toContain("1 of 2 stages complete");
  });

  test("a running stage still wins over the episode-level fallback", () => {
    const strip = deriveStatusStrip({
      connected: true,
      episode: episode({
        status: "running",
        stages: [stage({ status: "running", progress: 0.4 })],
      }),
    });
    expect(strip.title).toBe("Illustrations running");
    expect(strip.progress).toBe(0.4);
  });
});
