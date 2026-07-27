import { expect, test } from "vitest";
import { episode } from "$lib/episode-store.svelte.ts";
import { EPISODE_FIXTURE } from "$lib/episode-fixtures";

test("initial state is unselected", () => {
  expect(episode.state.phase).toBe("unselected");
});

test("load sets ready state", () => {
  episode.load(EPISODE_FIXTURE);
  expect(episode.state.phase).toBe("ready");
  if (episode.state.phase === "ready") {
    expect(episode.state.episode.title).toBe("Memory Hierarchies Explained");
  }
});

test("load auto-selects the running stage", () => {
  episode.load(EPISODE_FIXTURE);
  expect(episode.selectedStageId).toBe("illustrations");
});

test("loadError sets error state", () => {
  episode.loadError("gateway timeout");
  expect(episode.state.phase).toBe("error");
  if (episode.state.phase === "error") {
    expect(episode.state.message).toBe("gateway timeout");
  }
});

test("selectStage updates selection", () => {
  episode.load(EPISODE_FIXTURE);
  episode.selectStage("script");
  expect(episode.selectedStageId).toBe("script");
});

test("patch updates episode without changing selection", () => {
  episode.load(EPISODE_FIXTURE);
  episode.selectStage("narration");
  episode.patch({ title: "Updated Title" });
  if (episode.state.phase === "ready") {
    expect(episode.state.episode.title).toBe("Updated Title");
  }
  expect(episode.selectedStageId).toBe("narration");
});
