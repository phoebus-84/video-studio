import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * pva_build_timeline and pva_compose_video (avg-tk7.6, ADR-0036). The render
 * itself is @av/remotion-composer's and has its own tests; here it is a fake
 * that writes a small file, or fails when asked, so these tests pin what the
 * studio decides: which timeline is rendered, and where the render goes.
 * Real renders are in compose-video.e2e.test.ts.
 */

const renders: Array<{ timeline: any; outputPath: string }> = [];
let failNext: Error | null = null;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      renders.push({ timeline: options.timeline, outputPath: options.outputPath });
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: `sha256:${"0".repeat(64)}`,
        kits: [{ name: "still", version: "1.0.0" }],
        profile: options.timeline.profile.id,
        loudness: null,
      };
    },
  };
});

const CHANNEL = "video-storici";
const SERIES = "roma-pills";
const EPISODE = "giulio-cesare";

let root: string;
let previousRoot: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-compose-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  renders.length = 0;
  failNext = null;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

const episodeDir = () => join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);
const at = (relative: string) => join(episodeDir(), relative);

function file(relative: string, content: string): void {
  mkdirSync(dirname(at(relative)), { recursive: true });
  writeFileSync(at(relative), content);
}

function episode(): void {
  file("assets/images/s1.png", "red");
  file("assets/images/s2.png", "blue");
  file("artifacts/timing.json", JSON.stringify({ scenes: [{ sceneId: "s1", durationSeconds: 2 }, { sceneId: "s2", durationSeconds: 3 }] }));
}

async function tool(name: string, params: Record<string, unknown> = {}) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get(name)!.execute("call-1", { channel: CHANNEL, series: SERIES, episode: EPISODE, ...params }, undefined, undefined, undefined);
}

const readJson = (relative: string) => JSON.parse(readFileSync(at(relative), "utf-8"));
const sha256 = (relative: string) => `sha256:${createHash("sha256").update(readFileSync(at(relative))).digest("hex")}`;

describe("pva_build_timeline", () => {
  it("writes the episode's edit timeline and says what is in it", async () => {
    episode();
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/artifacts\/edit-timeline\.json: 2 scenes, 0 captions, 5\.0s, youtube-1920x1080/);
    expect(readJson("artifacts/edit-timeline.json")).toMatchObject({ apiVersion: "studio.video/v1alpha2", durationInFrames: 150 });
    expect(readdirSync(at("artifacts")).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("says what is wrong instead of writing a timeline", async () => {
    file("assets/images/opening-shot.png", "red");
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no-scenes/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });
});

describe("pva_compose_video", () => {
  it("builds a missing timeline, renders it to output/<render-id>.mp4 with a report, and moves current.json last", async () => {
    episode();
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/timeline rebuilt: there was no timeline yet/);

    const current = readJson("output/current.json");
    expect(current.renderId).toMatch(/^render-\d+-[a-f0-9]{8}$/);
    expect(current.path).toBe(`${current.renderId}.mp4`);
    expect(existsSync(at(`output/${current.path}`))).toBe(true);
    const report = readJson(`output/${current.renderId}.report.json`);
    expect(report.timeline).toEqual({ path: "artifacts/edit-timeline.json", hash: sha256("artifacts/edit-timeline.json") });
    expect(report.render).toMatchObject({ path: current.path, profile: "youtube-1920x1080" });
    expect(current.renderId.endsWith(report.timeline.hash.slice(7, 15))).toBe(true);
    expect(readdirSync(at("output")).filter((f) => f.includes("partial"))).toEqual([]);
  });

  it("renders the timeline as it stands when nothing changed", async () => {
    episode();
    await tool("pva_build_timeline");
    const before = sha256("artifacts/edit-timeline.json");
    const result = await tool("pva_compose_video");
    expect(result.content[0].text).toMatch(/rendered artifacts\/edit-timeline\.json as it stands/);
    expect(sha256("artifacts/edit-timeline.json")).toBe(before);
  });

  it("renders a hand-edited timeline without overwriting it", async () => {
    episode();
    await tool("pva_build_timeline");
    const edited = readJson("artifacts/edit-timeline.json");
    edited.tracks[0].items[0].props.fit = "cover";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(edited));
    await tool("pva_compose_video");
    expect(renders[0]!.timeline.tracks[0].items[0].props.fit).toBe("cover");
    expect(readJson("artifacts/edit-timeline.json").tracks[0].items[0].props.fit).toBe("cover");
  });

  it("rebuilds when the episode's material changed, and names what changed", async () => {
    episode();
    await tool("pva_build_timeline");
    file("assets/images/s2.png", "green");
    file("assets/images/s3.png", "white");
    const result = await tool("pva_compose_video");
    expect(result.content[0].text).toMatch(/timeline rebuilt: assets\/images\/s2\.png changed, assets\/images\/s3\.png added/);
    expect(renders[0]!.timeline.tracks[0].items).toHaveLength(3);
  });

  it("rebuilds for another profile, and keeps the timeline's profile when none is asked for", async () => {
    episode();
    await tool("pva_build_timeline");
    const vertical = await tool("pva_compose_video", { profile: "vertical-1080x1920" });
    expect(vertical.content[0].text).toMatch(/the profile changed from youtube-1920x1080 to vertical-1080x1920/);
    expect(renders[0]!.timeline.resolution).toEqual({ width: 1080, height: 1920 });
    file("assets/images/s2.png", "green");
    await tool("pva_compose_video");
    expect(renders[1]!.timeline.profile.id).toBe("vertical-1080x1920");
  });

  it("leaves output/ and current.json as they were when the render fails, and passes the composer's code on", async () => {
    episode();
    await tool("pva_compose_video", { label: "first" });
    const current = readFileSync(at("output/current.json"), "utf-8");
    const filesBefore = readdirSync(at("output")).sort();

    const { ComposerError } = await import("@av/remotion-composer");
    failNext = new ComposerError("render-failed", "Remotion could not render the timeline: boom");
    const result = await tool("pva_compose_video", { label: "second" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ render-failed: Remotion could not render the timeline: boom/);
    expect(readFileSync(at("output/current.json"), "utf-8")).toBe(current);
    expect(readdirSync(at("output")).sort()).toEqual(filesBefore);
  });

  it("refuses a label that is not kebab-case, before rendering", async () => {
    episode();
    const result = await tool("pva_compose_video", { label: "Final Cut" });
    expect(result.isError).toBe(true);
    expect(renders).toHaveLength(0);
  });

  it("refuses an episode without scene images and lists why", async () => {
    file("assets/images/opening-shot.png", "red");
    const result = await tool("pva_compose_video");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no-scenes/);
    expect(existsSync(at("output"))).toBe(false);
  });
});
