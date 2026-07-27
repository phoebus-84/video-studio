import { expect, test } from "vitest";
import { library } from "$lib/library-store.svelte.ts";
import { buildFixtureTree, DEFAULT_FIXTURE, EMPTY_FIXTURE } from "$lib/fixtures";

test("initial state is loading", () => {
  expect(library.phase).toBe("loading");
});

test("loadFixture sets ready state", () => {
  const tree = buildFixtureTree(DEFAULT_FIXTURE);
  library.loadFixture(tree);
  expect(library.phase).toBe("ready");
  expect(library.tree.channels.length).toBe(2);
});

test("loadFixture with empty tree sets empty state", () => {
  library.loadFixture(buildFixtureTree(EMPTY_FIXTURE));
  expect(library.phase).toBe("empty");
});

test("loadError sets error state", () => {
  library.loadError("connection refused");
  expect(library.phase).toBe("error");
  expect(library.message).toBe("connection refused");
});

test("select updates selectedEpisode", () => {
  library.loadFixture(buildFixtureTree(DEFAULT_FIXTURE));
  library.select("tech-explainer", "how-it-works", "ep-02-memory");
  expect(library.selectedEpisode).toBe("tech-explainer/ep-02-memory");
});
