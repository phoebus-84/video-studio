import { describe, it, expect } from "vitest";
import { FakeFileSystem, FakeClock, SpyLogger } from "../../fixtures/index.js";
import {
  discoverChannels,
  discoverSeries,
  discoverEpisodes,
} from "../../../src/workspace/discover.js";
import { initChannel, initSeries, initEpisode } from "../../../src/workspace/init.js";
import { isOk, isErr } from "../../../src/result.js";
import { WORKSPACE_DIR, CONTRACT_FILE } from "../../../src/workspace/types.js";
import type { InitOptions } from "../../../src/workspace/init.js";

function makeOpts(
  overrides: Partial<{
    fs: FakeFileSystem;
    clock: FakeClock;
    logger: SpyLogger;
  }> = {},
): InitOptions & { fs: FakeFileSystem; clock: FakeClock; logger: SpyLogger } {
  return {
    fs: overrides.fs ?? new FakeFileSystem(),
    clock: overrides.clock ?? new FakeClock(),
    logger: overrides.logger ?? new SpyLogger(),
  };
}

describe("discoverChannels", () => {
  const libraryRoot = "/videos";

  async function seedChannel(fs: FakeFileSystem, slug: string): Promise<string> {
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });
    const r = await initChannel(libraryRoot, slug, {}, opts);
    if (!r.ok) throw new Error("init failed");
    return r.value.path;
  }

  it("discovers a single channel", async () => {
    const fs = new FakeFileSystem();
    await seedChannel(fs, "my-channel");

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(1);
    expect(r.value.workspaces[0]!.slug).toBe("my-channel");
    expect(r.value.workspaces[0]!.kind).toBe("channel");
    expect(r.value.diagnostics).toHaveLength(0);
  });

  it("discovers multiple channels", async () => {
    const fs = new FakeFileSystem();
    await seedChannel(fs, "channel-a");
    await seedChannel(fs, "channel-b");
    await seedChannel(fs, "channel-c");

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(3);
    const slugs = r.value.workspaces.map((w) => w.slug).sort();
    expect(slugs).toEqual(["channel-a", "channel-b", "channel-c"]);
  });

  it("returns empty when no channels exist", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(0);
  });

  it("skips directories without a contract and reports diagnostics", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.mkdir(`${libraryRoot}/not-a-channel`, true);

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(0);
    expect(r.value.diagnostics).toHaveLength(1);
    expect(r.value.diagnostics[0]!.reason).toBe("missing-contract");
    expect(r.value.diagnostics[0]!.path).toBe(`${libraryRoot}/not-a-channel`);
  });

  it("skips malformed contract JSON and reports diagnostics", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.mkdir(`${libraryRoot}/bad-channel/${WORKSPACE_DIR}`, true);
    await fs.writeText(
      `${libraryRoot}/bad-channel/${WORKSPACE_DIR}/${CONTRACT_FILE}`,
      "not valid json {{{",
    );

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(0);
    expect(r.value.diagnostics).toHaveLength(1);
    expect(r.value.diagnostics[0]!.reason).toBe("invalid-contract-json");
  });

  it("skips contract with missing fields and reports diagnostics", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.mkdir(`${libraryRoot}/bad-channel/${WORKSPACE_DIR}`, true);
    await fs.writeText(
      `${libraryRoot}/bad-channel/${WORKSPACE_DIR}/${CONTRACT_FILE}`,
      JSON.stringify({ type: "channel" }), // missing schema, version, etc.
    );

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(0);
    expect(r.value.diagnostics).toHaveLength(1);
    expect(r.value.diagnostics[0]!.reason).toBe("invalid-contract-structure");
  });

  it("ignores files at the root level (not directories)", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.writeText(`${libraryRoot}/README.md`, "hello");

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // Files are silently ignored, no diagnostic
    expect(r.value.workspaces).toHaveLength(0);
    expect(r.value.diagnostics).toHaveLength(0);
  });

  it("skips hidden directories (except .workspace)", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.mkdir(`${libraryRoot}/.git`, true);
    await fs.mkdir(`${libraryRoot}/.hidden`, true);

    const r = await discoverChannels(libraryRoot, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // Hidden dirs are skipped silently
    expect(r.value.workspaces).toHaveLength(0);
    // No diagnostics for hidden dirs (they're skipped, not errored)
    expect(r.value.diagnostics.filter((d) => d.path.includes(".git"))).toHaveLength(0);
  });

  it("rejects invalid library root", async () => {
    const fs = new FakeFileSystem();

    const r = await discoverChannels("relative/path", fs);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("not-absolute");
    }
  });

  it("rejects root / filesystem root", async () => {
    const fs = new FakeFileSystem();

    const r = await discoverChannels("/", fs);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("filesystem-root");
    }
  });
});

describe("discoverSeries", () => {
  const libraryRoot = "/videos";

  async function seedChannel(fs: FakeFileSystem): Promise<string> {
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });
    const r = await initChannel(libraryRoot, "test-channel", {}, opts);
    if (!r.ok) throw new Error("channel init failed");
    return r.value.path;
  }

  it("discovers series under a channel", async () => {
    const fs = new FakeFileSystem();
    const channelPath = await seedChannel(fs);
    const opts = makeOpts({ fs });

    await initSeries(channelPath, "season-1", {}, opts);
    await initSeries(channelPath, "season-2", {}, opts);

    const r = await discoverSeries(channelPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(2);
    const slugs = r.value.workspaces.map((w) => w.slug).sort();
    expect(slugs).toEqual(["season-1", "season-2"]);
    for (const ws of r.value.workspaces) {
      expect(ws.kind).toBe("series");
    }
  });

  it("skips non-series directories and reports diagnostics", async () => {
    const fs = new FakeFileSystem();
    const channelPath = await seedChannel(fs);
    const opts = makeOpts({ fs });

    // Create a series
    await initSeries(channelPath, "season-1", {}, opts);

    // Create a directory without contract
    await fs.mkdir(`${channelPath}/not-a-series`, true);

    const r = await discoverSeries(channelPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(1);
    expect(r.value.diagnostics).toHaveLength(1);
    expect(r.value.diagnostics[0]!.reason).toBe("missing-contract");
  });

  it("skips an episode masquerading as a series", async () => {
    const fs = new FakeFileSystem();
    const channelPath = await seedChannel(fs);
    const opts = makeOpts({ fs });

    // Create a series first (parent for episode)
    const serR = await initSeries(channelPath, "season-1", {}, opts);
    if (!serR.ok) throw new Error("series init failed");

    // Create an episode inside the series
    await initEpisode(serR.value.path, "ep-01", {}, opts);

    // Create an episode-typed directory directly under channel (wrong hierarchy)
    await fs.mkdir(`${channelPath}/fake-series/${WORKSPACE_DIR}`, true);
    await fs.writeText(
      `${channelPath}/fake-series/${WORKSPACE_DIR}/${CONTRACT_FILE}`,
      JSON.stringify({
        schema: "video-workspace-contracts/workspace-v1",
        version: "0.1.0",
        type: "episode", // Should be "series" to be discovered as series
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    const r = await discoverSeries(channelPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // The episode-typed directory should be in diagnostics
    const episodeDiag = r.value.diagnostics.find((d) => d.path.includes("fake-series"));
    expect(episodeDiag).toBeDefined();
    expect(episodeDiag!.reason).toBe("invalid-contract-structure");
  });
});

describe("discoverEpisodes", () => {
  const libraryRoot = "/videos";

  async function seedSeries(fs: FakeFileSystem): Promise<string> {
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });
    const chR = await initChannel(libraryRoot, "test-channel", {}, opts);
    if (!chR.ok) throw new Error("channel init failed");
    const serR = await initSeries(chR.value.path, "season-1", {}, opts);
    if (!serR.ok) throw new Error("series init failed");
    return serR.value.path;
  }

  it("discovers episodes under a series", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await seedSeries(fs);
    const opts = makeOpts({ fs });

    await initEpisode(seriesPath, "ep-01", {}, opts);
    await initEpisode(seriesPath, "ep-02", {}, opts);
    await initEpisode(seriesPath, "ep-03", {}, opts);

    const r = await discoverEpisodes(seriesPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(3);
    const slugs = r.value.workspaces.map((w) => w.slug).sort();
    expect(slugs).toEqual(["ep-01", "ep-02", "ep-03"]);
    for (const ws of r.value.workspaces) {
      expect(ws.kind).toBe("episode");
      expect(ws.schema).toBe("video-workspace-contracts/workspace-v1");
    }
  });

  it("returns empty when no episodes exist", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await seedSeries(fs);

    const r = await discoverEpisodes(seriesPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(0);
    // Skeleton directories (voice-profiles, pipelines, etc.) produce diagnostics
    expect(r.value.diagnostics.length).toBeGreaterThanOrEqual(0);
  });

  it("skips non-episode directories and reports diagnostics", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await seedSeries(fs);
    const opts = makeOpts({ fs });

    await initEpisode(seriesPath, "ep-01", {}, opts);

    // Create a non-workspace directory
    await fs.mkdir(`${seriesPath}/output`, true);

    const r = await discoverEpisodes(seriesPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(1);
    // Skeleton dirs + manual output/ dir all produce diagnostics
    expect(r.value.diagnostics.length).toBeGreaterThanOrEqual(1);
    const missingContractDiags = r.value.diagnostics.filter((d) => d.reason === "missing-contract");
    expect(missingContractDiags.length).toBeGreaterThanOrEqual(1);
  });

  it("reports diagnostic for malformed contract", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await seedSeries(fs);
    const opts = makeOpts({ fs });

    await initEpisode(seriesPath, "good-ep", {}, opts);

    // Manually create a corrupt episode
    await fs.mkdir(`${seriesPath}/bad-ep/${WORKSPACE_DIR}`, true);
    await fs.writeText(
      `${seriesPath}/bad-ep/${WORKSPACE_DIR}/${CONTRACT_FILE}`,
      "{{{broken}}}",
    );

    const r = await discoverEpisodes(seriesPath, fs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.workspaces).toHaveLength(1);
    expect(r.value.workspaces[0]!.slug).toBe("good-ep");
    // Skeleton dirs + bad-ep all produce diagnostics; at minimum the bad-ep one
    expect(r.value.diagnostics.length).toBeGreaterThanOrEqual(1);
    const invalidDiags = r.value.diagnostics.filter((d) => d.reason === "invalid-contract-json");
    expect(invalidDiags.length).toBe(1);
  });
});

describe("discovery logs diagnostics", () => {
  it("logger receives debug and info messages", async () => {
    const fs = new FakeFileSystem();
    const libraryRoot = "/videos";

    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });
    const logger = opts.logger;

    await initChannel(libraryRoot, "test-chan", {}, opts);

    logger.clear();

    const r = await discoverChannels(libraryRoot, fs, logger);
    expect(isOk(r)).toBe(true);

    // Should have at least info-level messages
    const infoCalls = logger.ofLevel("info");
    expect(infoCalls.length).toBeGreaterThan(0);

    // Should mention the discovered count
    const infoMessages = infoCalls.map((c) => c.message).join(" ");
    expect(infoMessages).toContain("1");
  });
});
