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
  const labels = Object.keys(STAGE_LABELS);
  expect(labels.length).toBe(10);
  for (const val of Object.values(STAGE_LABELS)) {
    expect(val.length).toBeGreaterThan(0);
  }
});
