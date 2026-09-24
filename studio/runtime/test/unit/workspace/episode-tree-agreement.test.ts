// ── One episode tree, one creator's output ──────────────────────────────────
//
// Two creators used to build different episodes: the agent's made
// `episode.json`, `artifacts/episode.json` and `production/`; the runtime's
// made none of them. EPISODE_TREE described only the runtime's, so an episode
// from either creator disagreed with the contract in a different direction.
//
// This pins that what the runtime creates is exactly what the contract
// declares. The agent's half is pinned in studio/agent's own suite.

import { describe, expect, it, beforeEach } from "vitest";
import { EPISODE_TREE as CONTRACT_TREE } from "@studio/contracts/src/layout.mjs";
import { EPISODE_TREE } from "../../../src/workspace/tree.js";
import { FakeFileSystem, FakeClock } from "../../fixtures/index.js";
import { initChannel, initSeries, initEpisode } from "../../../src/workspace/init.js";
import type { InitOptions } from "../../../src/workspace/init.js";

function makeOpts(fs: FakeFileSystem): InitOptions {
  return { fs, clock: new FakeClock() };
}

/** Build a channel, a series and one episode; return the episode's path. */
async function makeEpisode(fs: FakeFileSystem): Promise<string> {
  const opts = makeOpts(fs);
  const chR = await initChannel("/library", "ch", {}, opts);
  if (!chR.ok) throw new Error("channel failed");
  const srR = await initSeries(chR.value.path, "s1", {}, opts);
  if (!srR.ok) throw new Error("series failed");
  const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
  if (!epR.ok) throw new Error("episode failed");
  return epR.value.path;
}

describe("the episode tree", () => {
  let fs: FakeFileSystem;

  beforeEach(() => {
    fs = new FakeFileSystem();
    fs.seed({ "/library/.keep": "" });
  });

  it("is the contract's list, not a second copy", () => {
    expect([...EPISODE_TREE]).toEqual([...CONTRACT_TREE]);
  });

  it("is exactly what initEpisode creates", async () => {
    const episodePath = await makeEpisode(fs);
    for (const relPath of EPISODE_TREE) {
      const existsR = await fs.exists(`${episodePath}/${relPath}`);
      expect(existsR.ok && existsR.value, `missing ${relPath}`).toBe(true);
    }
  });

  it("writes a manifest that names the episode", async () => {
    const episodePath = await makeEpisode(fs);
    const read = await fs.readText(`${episodePath}/episode.yaml`);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toContain("kind: Episode");
    expect(read.value).toContain('slug: "ep-01"');
  });
});
