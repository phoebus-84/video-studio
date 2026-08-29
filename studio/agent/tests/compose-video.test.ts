import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The composer selected scene images with `/^s\d+\.jpg$/` and held every one of
 * them for a flat ten seconds. An episode drawn as PNG rendered nothing at all;
 * an episode of eleven scenes rendered them in the order s1, s10, s11, s2 …;
 * and every scene sat on screen for ten seconds regardless of the line it
 * carries, with `-shortest` cutting off whatever did not fit.
 *
 * These run real FFmpeg, because the defect is in what FFmpeg is asked to do.
 */
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!hasFfmpeg)("composing an episode video", () => {
  let root: string;
  let previousRoot: string | undefined;

  const CHANNEL = "video-storici";
  const SERIES = "roma-pills";
  const EPISODE = "giulio-cesare";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-compose-"));
    previousRoot = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  const episodeDir = () => join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);

  /** A solid-colour PNG, drawn by FFmpeg so the test needs no fixtures. */
  function png(path: string, colour: string): void {
    const result = spawnSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=640x360`, "-frames:v", "1", path,
    ], { encoding: "utf-8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }

  async function compose(outputName = "final.mp4") {
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
    registerCapabilityTools({
      registerTool: (t: { name: string }) => tools.set(t.name, t as never),
    } as never);
    return tools.get("pva_compose_video")!.execute(
      "call-1", { channel: CHANNEL, series: SERIES, episode: EPISODE, outputName },
      undefined, undefined, undefined,
    );
  }

  function durationOf(path: string): number {
    const probe = spawnSync("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path,
    ], { encoding: "utf-8" });
    return Number(probe.stdout.trim());
  }

  it("renders an episode whose images are PNG", async () => {
    const dir = episodeDir();
    mkdirSync(join(dir, "assets", "images"), { recursive: true });
    png(join(dir, "assets", "images", "s1.png"), "red");
    png(join(dir, "assets", "images", "s2.png"), "blue");

    const result = await compose();

    expect(result.isError).toBeUndefined();
    expect(existsSync(join(dir, "artifacts", "final.mp4"))).toBe(true);
  });

  it("gives each scene the time its timing document allots, not a flat ten seconds", async () => {
    const dir = episodeDir();
    mkdirSync(join(dir, "assets", "images"), { recursive: true });
    for (const [id, colour] of [["s1", "red"], ["s2", "blue"], ["s3", "green"]]) {
      png(join(dir, "assets", "images", `${id}.png`), colour!);
    }
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
      scenes: [
        { sceneId: "s1", durationSeconds: 2 },
        { sceneId: "s2", durationSeconds: 3 },
        { sceneId: "s3", durationSeconds: 1 },
      ],
    }));

    await compose();

    // Six seconds of narrated scenes, not thirty seconds of slideshow.
    const duration = durationOf(join(dir, "artifacts", "final.mp4"));
    expect(duration).toBeGreaterThan(5.5);
    expect(duration).toBeLessThan(6.6);
  });

  it("says what is wrong when the images are not named like scenes", async () => {
    const dir = episodeDir();
    mkdirSync(join(dir, "assets", "images"), { recursive: true });
    png(join(dir, "assets", "images", "opening-shot.png"), "red");

    const result = await compose();

    expect(result.isError).toBe(true);
    // "No scene images found" over a directory holding an image is a puzzle;
    // saying the files are there but misnamed is an instruction.
    expect(result.content[0].text).toContain("1 file(s) are there");
  });

  it("plays the scenes in order once the episode passes nine", async () => {
    // A lexicographic sort renders s1, s10, s2 — so the tenth scene plays
    // second. Reading the frames back is the only way to see it.
    const dir = episodeDir();
    mkdirSync(join(dir, "assets", "images"), { recursive: true });
    png(join(dir, "assets", "images", "s1.png"), "red");
    png(join(dir, "assets", "images", "s2.png"), "lime");
    png(join(dir, "assets", "images", "s10.png"), "blue");
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
      scenes: ["s1", "s2", "s10"].map((sceneId) => ({ sceneId, durationSeconds: 1 })),
    }));

    await compose();

    /** The dominant channel of the frame shown at `seconds`. */
    function channelAt(seconds: number): "r" | "g" | "b" {
      const probe = spawnSync("ffmpeg", [
        "-v", "quiet", "-ss", String(seconds), "-i", join(dir, "artifacts", "final.mp4"),
        "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
      ], { encoding: "buffer" });
      const [r, g, b] = probe.stdout;
      if (r! >= g! && r! >= b!) return "r";
      return g! >= b! ? "g" : "b";
    }

    expect([channelAt(0.5), channelAt(1.5), channelAt(2.5)]).toEqual(["r", "g", "b"]);
  });

  it("includes a scene numbered s4a rather than dropping it", async () => {
    const dir = episodeDir();
    mkdirSync(join(dir, "assets", "images"), { recursive: true });
    for (const id of ["s4", "s4a"]) png(join(dir, "assets", "images", `${id}.png`), "red");
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    writeFileSync(join(dir, "artifacts", "timing.json"), JSON.stringify({
      scenes: [{ sceneId: "s4", durationSeconds: 2 }, { sceneId: "s4a", durationSeconds: 2 }],
    }));

    await compose();

    const duration = durationOf(join(dir, "artifacts", "final.mp4"));
    // Both scenes present: two seconds each, not one scene's worth.
    expect(duration).toBeGreaterThan(3.5);
  });
}, 60_000);
