import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardEpisodePath } from "../src/trust-guards.js";

/**
 * Layout 2 puts a series inside `series/` and an episode inside `episodes/`.
 * The capability tools joined the four names by hand instead, so every image,
 * narration clip and render went beside the episode rather than into it. That
 * was invisible while workspace authoring made the same mistake — the two were
 * coherently wrong together — and became a split the moment authoring was
 * corrected: workspaces in the right place, assets in the old one.
 */
describe("capability tools write into the episode", () => {
  let root: string;
  let previousRoot: string | undefined;

  const CHANNEL = "video-storici";
  const SERIES = "roma-pills";
  const EPISODE = "giulio-cesare";
  const CANONICAL = join(CHANNEL, "series", SERIES, "episodes", EPISODE);
  const PRE_MIGRATION = join(CHANNEL, SERIES, EPISODE);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-layout-"));
    previousRoot = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  /** A 16-bit mono WAV of a given duration. */
  function wav(path: string, seconds: number): void {
    const dataBytes = Math.round(seconds * 24000) * 2;
    const buffer = Buffer.alloc(44 + dataBytes);
    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write("WAVE", 8, "ascii");
    buffer.write("fmt ", 12, "ascii");
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(24000, 24);
    buffer.writeUInt32LE(48000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(dataBytes, 40);
    writeFileSync(path, buffer);
  }

  interface RegisteredTool {
    name: string;
    execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown>; isError?: boolean }>;
  }

  async function tools(): Promise<Map<string, RegisteredTool>> {
    // Imported inside the test: LIBRARY_ROOT is read when the tools register,
    // so the environment has to be set first.
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const registered = new Map<string, RegisteredTool>();
    registerCapabilityTools({
      registerTool: (tool: RegisteredTool) => registered.set(tool.name, tool),
    } as never);
    return registered;
  }

  it("writes the narration manifest inside the episode, not beside it", async () => {
    const episode = join(root, CANONICAL);
    mkdirSync(join(episode, "artifacts", "narration"), { recursive: true });
    wav(join(episode, "artifacts", "narration", "s1.wav"), 2);
    wav(join(episode, "artifacts", "narration", "s2.wav"), 3);

    const tool = (await tools()).get("pva_write_narration_manifest")!;
    const result = await tool.execute("call-1", {
      channel: CHANNEL, series: SERIES, episode: EPISODE,
    }, undefined, undefined, undefined);

    expect(result.isError).toBeUndefined();
    expect(result.details.segmentCount).toBe(2);
    expect(existsSync(join(episode, "artifacts", "narration", "narration-manifest.json"))).toBe(true);
    // The path the tools used before the migration.
    expect(existsSync(join(root, PRE_MIGRATION, "artifacts"))).toBe(false);
  });

  it("guards the path the tools actually write to", async () => {
    // The guard joined the four names by hand too, so it validated a path no
    // tool writes to: a check that cannot see what it is protecting.
    const allowed = await guardEpisodePath(root, CHANNEL, SERIES, EPISODE, "assets/images/s1.png");
    expect(allowed.allowed).toBe(true);

    for (const escape of ["../../../etc/passwd", "assets/../../../../secrets"]) {
      const rejected = await guardEpisodePath(root, CHANNEL, SERIES, EPISODE, escape);
      expect(rejected.allowed).toBe(false);
    }

    // Containment was checked against the library, which made the depth of the
    // layout decide the answer: five directories down, this climbs out of the
    // episode and lands in a sibling channel while still inside the library,
    // and was allowed. Tools take these paths from the model.
    const sideways = await guardEpisodePath(
      root, CHANNEL, SERIES, EPISODE, "../../../../../other-channel/stolen.png",
    );
    expect(sideways.allowed).toBe(false);

    const badComponent = await guardEpisodePath(root, "../evil", SERIES, EPISODE, "a.png");
    expect(badComponent.allowed).toBe(false);
    expect(badComponent.code).toBe("INVALID_COMPONENT");
  });

  it("reports a missing narration directory rather than writing an empty manifest", async () => {
    mkdirSync(join(root, CANONICAL, "artifacts"), { recursive: true });
    const tool = (await tools()).get("pva_write_narration_manifest")!;
    const result = await tool.execute("call-2", {
      channel: CHANNEL, series: SERIES, episode: EPISODE,
    }, undefined, undefined, undefined);
    expect(result.isError).toBe(true);
  });
});
