import { expect, test } from "vitest";
import { stageDisplayState, STAGE_LABELS } from "$lib/episode-types";
import type { ResolvedStage } from "$lib/episode-types";

function stage(overrides: Partial<ResolvedStage> = {}): ResolvedStage {
  return {
    id: "test",
    name: "Test",
    status: "pending",
    attemptCount: 0,
    blocked: false,
    stale: false,
    dependsOn: [],
    progress: 0,
    ...overrides,
  };
}

test("stageDisplayState for pending", () => {
  expect(stageDisplayState(stage({ status: "pending" }))).toBe("pending");
});

test("stageDisplayState for running", () => {
  expect(stageDisplayState(stage({ status: "running" }))).toBe("running");
});

test("stageDisplayState for completed", () => {
  expect(stageDisplayState(stage({ status: "completed" }))).toBe("completed");
});

test("stageDisplayState returns blocked when blocked flag is true", () => {
  expect(
    stageDisplayState(stage({ status: "running", blocked: true })),
  ).toBe("blocked");
});

test("stageDisplayState returns stale when stale flag is true", () => {
  expect(
    stageDisplayState(stage({ status: "completed", stale: true })),
  ).toBe("stale");
});

test("blocked takes priority over stale", () => {
  expect(
    stageDisplayState(stage({ status: "completed", blocked: true, stale: true })),
  ).toBe("blocked");
});

test("every display state has a label", () => {
  // Asserted as the set rather than as a count. It was `toBe(10)`, which said
  // nothing about WHICH ten and had to be re-guessed the moment the
  // vocabulary changed: `awaiting_approval` and `skipped` left it when the
  // gateway's stage-status union dropped them — nothing has ever produced
  // either — and `awaiting_review` and `runnable`, which the service does
  // emit, took their place.
  expect(Object.keys(STAGE_LABELS).sort()).toEqual([
    "awaiting_review",
    "blocked",
    "cancelled",
    "completed",
    "failed",
    "pending",
    "queued",
    "runnable",
    "running",
    "stale",
  ]);
  for (const val of Object.values(STAGE_LABELS)) {
    expect(val.length).toBeGreaterThan(0);
  }
});
