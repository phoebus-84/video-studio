// ---------------------------------------------------------------------------
// End-to-end: initialize full canonical workspace tree
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { FakeFileSystem, FakeClock, SpyLogger } from "../fixtures/index.js";
import {
  initChannel,
  initSeries,
  initEpisode,
} from "../../src/workspace/init.js";
import type { InitOptions } from "../../src/workspace/init.js";

function makeOpts(
  fs: FakeFileSystem = new FakeFileSystem(),
): InitOptions & { fs: FakeFileSystem; clock: FakeClock; logger: SpyLogger } {
  return {
    fs,
    clock: new FakeClock(),
    logger: new SpyLogger(),
  };
}

const CHANNEL_FILES = [
  "channel.md",
  "settings.yaml",
  ".workspace/contract.json",
  ".workspace/metadata.json",
];

const SERIES_FILES = [
  "series.md",
  "settings.yaml",
  "visual-bible.md",
  "voice-profiles",
  "pipelines",
  "skills",
  "sources",
  ".workspace/contract.json",
  ".workspace/metadata.json",
];

const EPISODE_FILES = [
  "episode.yaml",
  "source",
  "artifacts",
  "prompts",
  "assets/images",
  "assets/graphics",
  "assets/audio",
  "assets/manifest.json",
  "attempts",
  "reviews/threads.jsonl",
  "journal/events.jsonl",
  "output",
  "output/current.json",
  ".workspace/contract.json",
  ".workspace/metadata.json",
];

async function assertPathsExist(
  fs: FakeFileSystem,
  root: string,
  expected: string[],
): Promise<void> {
  for (const rel of expected) {
    const fullPath = `${root}/${rel}`;
    const existsR = await fs.exists(fullPath);
    expect(
      existsR.ok && existsR.value,
      `Missing expected path: ${rel} (${fullPath})`,
    ).toBe(true);
  }
}

describe("canonical workspace tree", () => {
  let fs: FakeFileSystem;

  beforeEach(() => {
    fs = new FakeFileSystem();
    fs.seed({ "/library/.keep": "" });
  });

  it("creates the full canonical tree: channel → series → episode", async () => {
    const opts = makeOpts(fs);

    // 1. Init channel
    const chR = await initChannel("/library", "my-channel", { title: "My Channel" }, opts);
    expect(chR.ok).toBe(true);
    if (!chR.ok) throw new Error("channel init failed");
    await assertPathsExist(fs, chR.value.path, CHANNEL_FILES);

    // 2. Init series
    const srR = await initSeries(chR.value.path, "my-series", { title: "My Series" }, opts);
    expect(srR.ok).toBe(true);
    if (!srR.ok) throw new Error("series init failed");
    await assertPathsExist(fs, srR.value.path, SERIES_FILES);

    // 3. Init episode
    const epR = await initEpisode(srR.value.path, "ep-01", { title: "Episode One" }, opts);
    expect(epR.ok).toBe(true);
    if (!epR.ok) throw new Error("episode init failed");
    await assertPathsExist(fs, epR.value.path, EPISODE_FILES);
  });

  it("is idempotent: re-init does not change existing tree", async () => {
    const opts = makeOpts(fs);

    const chR = await initChannel("/library", "ch", {}, opts);
    expect(chR.ok).toBe(true);
    if (!chR.ok) return;

    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    expect(srR.ok).toBe(true);
    if (!srR.ok) return;

    await initEpisode(srR.value.path, "ep-01", {}, opts);
    const epR2 = await initEpisode(srR.value.path, "ep-01", {}, opts);
    expect(epR2.ok).toBe(true);
    if (epR2.ok) expect(epR2.value.existed).toBe(true);

    // All episode files should still exist
    await assertPathsExist(fs, `${srR.value.path}/ep-01`, EPISODE_FILES);
  });

  it("output/current.json has correct structure", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    const content = fs.readTextSync(`${epR.value.path}/output/current.json`);
    const parsed = JSON.parse(content);
    expect(parsed.apiVersion).toBe("v1alpha1");
    expect(parsed.kind).toBe("CurrentDeliverable");
    expect(parsed.renderId).toBeNull();
  });

  it("assets/manifest.json has correct structure", async () => {
    const opts = makeOpts(fs);
    const chR = await initChannel("/library", "ch", {}, opts);
    if (!chR.ok) throw new Error("channel failed");
    const srR = await initSeries(chR.value.path, "s1", {}, opts);
    if (!srR.ok) throw new Error("series failed");
    const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
    if (!epR.ok) throw new Error("episode failed");

    const content = fs.readTextSync(`${epR.value.path}/assets/manifest.json`);
    const parsed = JSON.parse(content);
    expect(parsed.apiVersion).toBe("v1alpha1");
    expect(parsed.kind).toBe("AssetManifest");
    expect(parsed.assets).toEqual([]);
  });
});
