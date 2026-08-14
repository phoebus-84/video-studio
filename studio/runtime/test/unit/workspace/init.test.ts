import { describe, it, expect, beforeEach } from "vitest";
import { FakeFileSystem, FakeClock, SpyLogger } from "../../fixtures/index.js";
import {
  initChannel,
  initSeries,
  initEpisode,
  ensureDefaultChannel,
  DEFAULT_CHANNEL_SLUG,
} from "../../../src/workspace/init.js";
import { isOk, isErr } from "../../../src/result.js";
import { validateContractStructure, parseContractJson } from "../../../src/workspace/contracts.js";
import { WORKSPACE_DIR, CONTRACT_FILE, METADATA_FILE } from "../../../src/workspace/types.js";
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

// Helper to read the contract from a created workspace
async function readContract(fs: FakeFileSystem, wsPath: string) {
  const r = await fs.readText(`${wsPath}/${WORKSPACE_DIR}/${CONTRACT_FILE}`);
  if (!r.ok) throw new Error("no contract");
  return r.value;
}

// Helper to read metadata
async function readMeta(fs: FakeFileSystem, wsPath: string) {
  const r = await fs.readText(`${wsPath}/${WORKSPACE_DIR}/${METADATA_FILE}`);
  if (!r.ok) throw new Error("no metadata");
  return r.value;
}

describe("initChannel", () => {
  const libraryRoot = "/videos";

  beforeEach(() => {
    // no shared state needed beyond per-test fs
  });

  // -- Basic creation ------------------------------------------------------

  it("creates a channel workspace with contract and metadata", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });

    const r = await initChannel(libraryRoot, "my-channel", { title: "My Channel" }, opts);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.slug).toBe("my-channel");
    expect(r.value.existed).toBe(false);
    expect(r.value.kind).toBe("channel");
    expect(r.value.path).toBe(`${libraryRoot}/my-channel`);

    // Contract exists and is valid
    const contractJson = await readContract(fs, r.value.path);
    const parsed = parseContractJson(contractJson);
    expect("value" in parsed).toBe(true);
    if (!("value" in parsed)) return;

    const validation = validateContractStructure(parsed.value);
    expect(validation.valid).toBe(true);
    expect(validation.contract?.type).toBe("channel");
    expect(validation.contract?.schema).toBe("video-workspace-contracts/workspace-v1");

    // Metadata exists
    const metaJson = await readMeta(fs, r.value.path);
    const meta = JSON.parse(metaJson);
    expect(meta.title).toBe("My Channel");
    expect(meta.createdAt).toBeTruthy();
    expect(meta.updatedAt).toBeTruthy();
  });

  it("uses the default clock timestamp", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const clock = new FakeClock(new Date("2025-06-15T10:00:00Z").getTime());
    const opts = makeOpts({ fs, clock });

    const r = await initChannel(libraryRoot, "ts-test", {}, opts);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    const metaJson = await readMeta(fs, r.value.path);
    const meta = JSON.parse(metaJson);
    expect(meta.createdAt).toBe("2025-06-15T10:00:00.000Z");
  });

  // -- Idempotency ---------------------------------------------------------

  it("is idempotent: second init preserves existing files", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });

    // First init
    const r1 = await initChannel(libraryRoot, "idem-test", { title: "Original" }, opts);
    expect(isOk(r1)).toBe(true);
    if (!isOk(r1)) return;
    expect(r1.value.existed).toBe(false);

    // User edits the metadata
    const metaPath = `${r1.value.path}/${WORKSPACE_DIR}/${METADATA_FILE}`;
    const editedMeta = JSON.stringify({ title: "Edited by User", description: "custom", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-06-01T00:00:00.000Z" }, null, 2) + "\n";
    await fs.writeText(metaPath, editedMeta);

    // User edits the contract (e.g., bumps version)
    const contractPath = `${r1.value.path}/${WORKSPACE_DIR}/${CONTRACT_FILE}`;
    const editedContract = JSON.stringify({ schema: "video-workspace-contracts/workspace-v1", version: "0.2.0", type: "channel", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-06-01T00:00:00.000Z" }, null, 2) + "\n";
    await fs.writeText(contractPath, editedContract);

    // Second init
    const r2 = await initChannel(libraryRoot, "idem-test", { title: "Should Be Ignored" }, opts);
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value.existed).toBe(true);

    // Verify edits are preserved
    const metaAfter = await readMeta(fs, r2.value.path);
    expect(JSON.parse(metaAfter).title).toBe("Edited by User");

    const contractAfter = await readContract(fs, r2.value.path);
    expect(JSON.parse(contractAfter).version).toBe("0.2.0");
  });

  // -- Collision -----------------------------------------------------------

  it("fails when a non-workspace directory exists at the slug path", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.mkdir(`${libraryRoot}/my-channel`, true);
    await fs.writeText(`${libraryRoot}/my-channel/some-file.txt`, "not a workspace");
    const opts = makeOpts({ fs });

    const r = await initChannel(libraryRoot, "my-channel", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_ALREADY_EXISTS");
      expect(r.error.details?.reason).toBe("path-collision");
    }
  });

  it("fails when a file (not directory) exists at the slug path", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    await fs.writeText(`${libraryRoot}/not-a-dir`, "file");
    const opts = makeOpts({ fs });

    const r = await initChannel(libraryRoot, "not-a-dir", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_ALREADY_EXISTS");
    }
  });

  // -- Slug validation -----------------------------------------------------

  it("rejects an invalid slug", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });

    const r = await initChannel(libraryRoot, "BAD SLUG!", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_INVALID_ARGUMENT");
    }
  });

  // -- Path traversal ------------------------------------------------------

  it("rejects slugs that would escape the library root", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });

    // ".." as a slug would resolve outside
    const r = await initChannel(libraryRoot, "..", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_INVALID_ARGUMENT"); // slug validation fails first
    }
  });

  // -- Default channel -----------------------------------------------------

  it("ensureDefaultChannel creates a channel with slug 'default'", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });

    const r = await ensureDefaultChannel(libraryRoot, opts);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.slug).toBe(DEFAULT_CHANNEL_SLUG);
    expect(r.value.kind).toBe("channel");

    const metaJson = await readMeta(fs, r.value.path);
    const meta = JSON.parse(metaJson);
    expect(meta.title).toBe("Default Channel");
  });

  it("ensureDefaultChannel is idempotent", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });

    await ensureDefaultChannel(libraryRoot, opts);
    const r2 = await ensureDefaultChannel(libraryRoot, opts);
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value.existed).toBe(true);
  });
});

describe("initSeries", () => {
  const libraryRoot = "/videos";

  async function createChannel(fs: FakeFileSystem): Promise<string> {
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });
    const r = await initChannel(libraryRoot, "test-channel", {}, opts);
    if (!r.ok) throw new Error("channel init failed");
    return r.value.path;
  }

  it("creates a series under an existing channel", async () => {
    const fs = new FakeFileSystem();
    const channelPath = await createChannel(fs);
    const opts = makeOpts({ fs });

    const r = await initSeries(channelPath, "season-1", { title: "Season 1" }, opts);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.slug).toBe("season-1");
    expect(r.value.kind).toBe("series");
    expect(r.value.path).toBe(`${channelPath}/series/season-1`);

    const contractJson = await readContract(fs, r.value.path);
    const parsed = parseContractJson(contractJson);
    if (!("value" in parsed)) return;
    const validation = validateContractStructure(parsed.value);
    expect(validation.valid).toBe(true);
    expect(validation.contract?.type).toBe("series");
  });

  it("rejects creating a series under a non-channel directory", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir("/random-dir", true);
    const opts = makeOpts({ fs });

    const r = await initSeries("/random-dir", "test-series", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_NOT_FOUND");
      expect(r.error.details?.reason).toBe("missing-contract");
    }
  });

  it("is idempotent: preserves user edits on re-init", async () => {
    const fs = new FakeFileSystem();
    const channelPath = await createChannel(fs);
    const opts = makeOpts({ fs });

    const r1 = await initSeries(channelPath, "season-1", { title: "Original" }, opts);
    expect(isOk(r1)).toBe(true);
    if (!isOk(r1)) return;

    // Edit metadata
    const metaPath = `${r1.value.path}/${WORKSPACE_DIR}/${METADATA_FILE}`;
    await fs.writeText(metaPath, JSON.stringify({ title: "User Edit" }) + "\n");

    // Re-init
    const r2 = await initSeries(channelPath, "season-1", { title: "Ignored" }, opts);
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value.existed).toBe(true);

    const metaJson = await readMeta(fs, r2.value.path);
    expect(JSON.parse(metaJson).title).toBe("User Edit");
  });

  it("fails when a non-series workspace already exists at the slug", async () => {
    const fs = new FakeFileSystem();
    const channelPath = await createChannel(fs);
    const opts = makeOpts({ fs });

    // Create an episode directly (not a series)
    await fs.mkdir(`${channelPath}/series/my-episode/${WORKSPACE_DIR}`, true);
    await fs.writeText(
      `${channelPath}/series/my-episode/${WORKSPACE_DIR}/${CONTRACT_FILE}`,
      JSON.stringify({
        schema: "video-workspace-contracts/workspace-v1",
        version: "0.1.0",
        type: "episode",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );

    const r = await initSeries(channelPath, "my-episode", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_ALREADY_EXISTS");
      expect(r.error.details?.reason).toBe("kind-mismatch");
    }
  });
});

describe("initEpisode", () => {
  const libraryRoot = "/videos";

  async function createSeries(fs: FakeFileSystem): Promise<string> {
    await fs.mkdir(libraryRoot, true);
    const opts = makeOpts({ fs });
    const chR = await initChannel(libraryRoot, "test-channel", {}, opts);
    if (!chR.ok) throw new Error("channel init failed");
    const serR = await initSeries(chR.value.path, "season-1", {}, opts);
    if (!serR.ok) throw new Error("series init failed");
    return serR.value.path;
  }

  it("creates an episode under an existing series", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await createSeries(fs);
    const opts = makeOpts({ fs });

    const r = await initEpisode(seriesPath, "ep-01", { title: "Episode 1" }, opts);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.slug).toBe("ep-01");
    expect(r.value.kind).toBe("episode");
    expect(r.value.path).toBe(`${seriesPath}/episodes/ep-01`);

    const contractJson = await readContract(fs, r.value.path);
    const parsed = parseContractJson(contractJson);
    if (!("value" in parsed)) return;
    const validation = validateContractStructure(parsed.value);
    expect(validation.valid).toBe(true);
    expect(validation.contract?.type).toBe("episode");
  });

  it("rejects creating an episode under a non-series directory", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir("/random-dir", true);
    const opts = makeOpts({ fs });

    const r = await initEpisode("/random-dir", "ep-01", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_NOT_FOUND");
    }
  });

  it("is idempotent: preserves user edits on re-init", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await createSeries(fs);
    const opts = makeOpts({ fs });

    const r1 = await initEpisode(seriesPath, "ep-01", { title: "Original" }, opts);
    expect(isOk(r1)).toBe(true);
    if (!isOk(r1)) return;

    // Edit metadata
    const metaPath = `${r1.value.path}/${WORKSPACE_DIR}/${METADATA_FILE}`;
    await fs.writeText(metaPath, JSON.stringify({ title: "User Edit" }) + "\n");

    // Re-init
    const r2 = await initEpisode(seriesPath, "ep-01", { title: "Ignored" }, opts);
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value.existed).toBe(true);

    const metaJson = await readMeta(fs, r2.value.path);
    expect(JSON.parse(metaJson).title).toBe("User Edit");
  });

  it("validates contract has correct schema fields", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await createSeries(fs);
    const opts = makeOpts({ fs });

    const r = await initEpisode(seriesPath, "ep-01", {}, opts);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    const contractJson = await readContract(fs, r.value.path);
    const parsed = parseContractJson(contractJson);
    expect("value" in parsed).toBe(true);
    if (!("value" in parsed)) return;

    const validation = validateContractStructure(parsed.value);
    expect(validation.valid).toBe(true);
    expect(validation.contract).toBeDefined();
    expect(validation.contract!.schema).toBe("video-workspace-contracts/workspace-v1");
    expect(validation.contract!.version).toBe("0.1.0");
    expect(validation.contract!.type).toBe("episode");
    expect(validation.contract!.createdAt).toBeTruthy();
    expect(validation.contract!.updatedAt).toBeTruthy();
  });

  it("fails on invalid slug for episode", async () => {
    const fs = new FakeFileSystem();
    const seriesPath = await createSeries(fs);
    const opts = makeOpts({ fs });

    const r = await initEpisode(seriesPath, "", {}, opts);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_INVALID_ARGUMENT");
    }
  });
});
