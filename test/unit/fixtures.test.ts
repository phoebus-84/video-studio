import { expect, test } from "vitest";
import {
  buildFixtureTree,
  DEFAULT_FIXTURE,
  EMPTY_FIXTURE,
} from "$lib/fixtures";

test("DEFAULT_FIXTURE resolves to a tree with channels", () => {
  const tree = buildFixtureTree(DEFAULT_FIXTURE);
  expect(tree.channels.length).toBe(2);
  expect(tree.channels[0]!.title).toBe("Tech Explainer");
});

test("channel contains series", () => {
  const tree = buildFixtureTree(DEFAULT_FIXTURE);
  const ch = tree.channels[0]!;
  expect(ch.series.length).toBe(2);
  expect(ch.series[0]!.title).toBe("How It Works");
});

test("series contains episodes", () => {
  const tree = buildFixtureTree(DEFAULT_FIXTURE);
  const episodes = tree.channels[0]!.series[0]!.episodes;
  expect(episodes.length).toBe(3);
  expect(episodes[0]!.title).toBe("How a CPU Executes Code");
});

test("EMPTY_FIXTURE resolves to empty tree", () => {
  const tree = buildFixtureTree(EMPTY_FIXTURE);
  expect(tree.channels).toEqual([]);
});

test("malformed flag applies error to all episodes", () => {
  const tree = buildFixtureTree({ ...DEFAULT_FIXTURE, malformed: true });
  const ep0 = tree.channels[0]!.series[0]!.episodes[0]!;
  expect(ep0.error).toBeTruthy();
  expect(ep0.error).toContain("corrupt");
});
