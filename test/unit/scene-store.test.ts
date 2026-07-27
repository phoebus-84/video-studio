import { expect, test } from "vitest";
import { scenes } from "$lib/scene-store.svelte.ts";
import { SCENES_FIXTURE } from "$lib/scene-fixtures";

test("load populates scenes", () => {
  scenes.load(SCENES_FIXTURE);
  expect(scenes.scenes.length).toBe(6);
});

test("totalDuration sums all scene durations", () => {
  scenes.load(SCENES_FIXTURE);
  expect(scenes.totalDuration).toBe(260);
});

test("select updates selectedSceneId", () => {
  scenes.load(SCENES_FIXTURE);
  scenes.select("scene-3");
  expect(scenes.selectedSceneId).toBe("scene-3");
});

test("load resets selection", () => {
  scenes.load(SCENES_FIXTURE);
  scenes.select("scene-1");
  scenes.load(SCENES_FIXTURE);
  expect(scenes.selectedSceneId).toBeNull();
});
