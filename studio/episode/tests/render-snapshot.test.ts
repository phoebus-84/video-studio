import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderEpisode } from "../src/episode-render.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * Every render keeps the exact timeline it rendered beside its video
 * (avg-jao.5): a later version can then be compared with it section by
 * section. The render itself is faked; @av/remotion-composer renders for real.
 */

let failRender = false;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      if (failRender) throw new actual.ComposerError("render-failed", "Remotion could not render the timeline: out of memory");
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: sha256("fake mp4"),
        kits: [],
        profile: options.timeline.profile.id,
        loudness: null,
      };
    },
    auditRender: async () => ({ passed: true, checks: ["decode", "streams", "duration"], findings: [] }),
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-snapshot-"));
  specEpisode(dir(), REF);
  failRender = false;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("renderEpisode keeps the timeline it rendered", () => {
  it("writes output/<render-id>.timeline.json, the exact text the report's hash names", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF });
    const snapshot = at(`output/${render.renderId}.timeline.json`);
    const report = JSON.parse(readFileSync(render.reportPath, "utf-8"));
    expect(report.timeline.snapshot).toBe(`${render.renderId}.timeline.json`);
    expect(sha256(readFileSync(snapshot))).toBe(report.timeline.hash);
    expect(readFileSync(snapshot, "utf-8")).toBe(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
  });

  it("keeps it unchanged when the episode's timeline is edited afterwards", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF });
    const before = readFileSync(at(`output/${render.renderId}.timeline.json`), "utf-8");
    writeFileSync(at("artifacts/edit-timeline.json"), "{}");
    expect(readFileSync(at(`output/${render.renderId}.timeline.json`), "utf-8")).toBe(before);
  });

  it("writes no snapshot when the render fails", async () => {
    failRender = true;
    await expect(renderEpisode(dir(), { episodeRef: REF })).rejects.toThrow(/out of memory/);
    expect(existsSync(at("output")) ? readdirSync(at("output")).filter((n) => n.endsWith(".timeline.json")) : []).toEqual([]);
  });
});
