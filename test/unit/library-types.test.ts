import { expect, test } from "vitest";
import { displayStatus, STATUS_LABELS } from "$lib/library-types";
import type { ResolvedEpisode } from "$lib/library-types";

function ep(overrides: Partial<ResolvedEpisode> = {}): ResolvedEpisode {
  return {
    slug: "ep-1",
    title: "Test",
    channel: "ch",
    series: "ser",
    status: "idle",
    currentDeliverable: false,
    blocked: false,
    staleCount: 0,
    lastActivity: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("displayStatus for idle episode", () => {
  expect(displayStatus(ep({ status: "idle" }))).toBe("idle");
});

test("displayStatus for running episode", () => {
  expect(displayStatus(ep({ status: "running" }))).toBe("running");
});

test("displayStatus for blocked episode", () => {
  expect(displayStatus(ep({ status: "blocked", blocked: true }))).toBe("blocked");
});

test("displayStatus for failed episode", () => {
  expect(displayStatus(ep({ status: "failed" }))).toBe("failed");
});

test("displayStatus for completed episode", () => {
  expect(displayStatus(ep({ status: "completed", currentDeliverable: true }))).toBe(
    "completed",
  );
});

test("displayStatus for stale episode — stale overrides idle", () => {
  expect(displayStatus(ep({ status: "idle", staleCount: 3 }))).toBe("stale");
});

test("displayStatus for stale cannot override running", () => {
  expect(displayStatus(ep({ status: "running", staleCount: 1 }))).toBe("running");
});

test("displayStatus for malformed episode", () => {
  expect(displayStatus(ep({ error: "corrupt" }))).toBe("malformed");
});

test("malformed trumps all other states", () => {
  expect(
    displayStatus(ep({ status: "running", staleCount: 5, error: "corrupt" })),
  ).toBe("malformed");
});

test("every display status has a label", () => {
  const statuses: ReturnType<typeof displayStatus>[] = [
    "idle",
    "running",
    "awaiting_review",
    "blocked",
    "completed",
    "failed",
    "cancelled",
    "stale",
    "malformed",
  ];
  for (const s of statuses) {
    expect(STATUS_LABELS[s]).toBeTruthy();
  }
});
