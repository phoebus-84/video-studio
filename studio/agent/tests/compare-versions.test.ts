import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@studio/episode/testing";

/**
 * pva_compare_versions (avg-jao.5): Pi proves a correction stayed where it
 * was asked. Two small real renders, made with ffmpeg, as renderEpisode
 * leaves them; @studio/episode tests the comparison itself.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

/** A render of flat-colour sections (1 s each, 30 fps), with its timeline snapshot and report. */
function render(id: string, colors: [string, string, string]): void {
  const out = join(dir(), "output");
  mkdirSync(out, { recursive: true });
  const video = join(out, `${id}.mp4`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    ...colors.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${c}:s=320x180:r=30:d=1`]),
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const sections = ["intro", "block-1", "block-2"].map((sid, i) => ({ id: sid, from: i * 30, duration: 30 }));
  const timeline = `${JSON.stringify({ fps: 30, durationInFrames: 90, resolution: { width: 320, height: 180 }, sections })}\n`;
  writeFileSync(join(out, `${id}.timeline.json`), timeline);
  writeFileSync(join(out, `${id}.report.json`), JSON.stringify({
    renderId: id, timeline: { hash: sha256(timeline) }, render: { hash: sha256(readFileSync(video)) },
  }));
  writeFileSync(join(out, "current.json"), JSON.stringify({ renderId: id, path: `${id}.mp4` }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-compare-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  render("render-1-aaaaaaaa", ["red", "green", "blue"]);
  render("render-2-bbbbbbbb", ["red", "yellow", "blue"]);
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_compare_versions")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_compare_versions", () => {
  it("says the correction stayed in its section, against the current render", async () => {
    const result = await tool({ old: "render-1-aaaaaaaa", expect: ["block-1"] });
    expect(result.isError).toBeFalsy();
    const text: string = result.content[0].text;
    expect(text).toMatch(/^✅ ok: every difference found is inside block-1 — render-1-aaaaaaaa → render-2-bbbbbbbb, \d+ instants compared, aligned by sections/);
    expect(text).toMatch(/· #\d\d · \d+\.\d\ds · block-1 · diff \d+(\.\d)? \(\d+%\)/);
    expect(text).toContain(`open: ${join(dir(), "reviews/compare/render-1-aaaaaaaa--render-2-bbbbbbbb/changed.jpg")}`);
  });

  it("flags every change outside the expected sections", async () => {
    const result = await tool({ old: "render-1-aaaaaaaa", expect: ["intro"] });
    const text: string = result.content[0].text;
    expect(text).toMatch(/^❌ unexpected changes outside intro: \d+ frame\(s\)/);
    expect(text).toMatch(/❌ #\d\d · \d+\.\d\ds · block-1 · /);
    expect(text).toContain("⚠️ intro was expected to change and did not");
  });

  it("names a section that changed shape, which no frame shows", async () => {
    render("render-3-cccccccc", ["red", "blue", "blue"]);
    // Rewrite render 3 as two sections: block-1 removed.
    const out = join(dir(), "output");
    const timeline = `${JSON.stringify({ fps: 30, durationInFrames: 90, resolution: { width: 320, height: 180 },
      sections: [{ id: "intro", from: 0, duration: 30 }, { id: "block-2", from: 30, duration: 60 }] })}\n`;
    writeFileSync(join(out, "render-3-cccccccc.timeline.json"), timeline);
    const report = JSON.parse(readFileSync(join(out, "render-3-cccccccc.report.json"), "utf-8"));
    report.timeline.hash = sha256(timeline);
    writeFileSync(join(out, "render-3-cccccccc.report.json"), JSON.stringify(report));
    const text: string = (await tool({ old: "render-1-aaaaaaaa", new: "render-3-cccccccc", expect: ["block-2"] })).content[0].text;
    expect(text).toMatch(/^❌ unexpected changes outside block-2/);
    expect(text).toContain("❌ block-1 removed (30 → 0 frames)");
    expect(text).toContain("❌ block-2 resized (30 → 60 frames)".replace("❌", "·"));
  });

  it("compares at the times asked", async () => {
    const result = await tool({ old: "render-1-aaaaaaaa", times: [0.5, 1.5], expect: ["block-1"] });
    expect(result.content[0].text).toMatch(/2 instants compared/);
  });

  it("replies with the error's code", async () => {
    const result = await tool({ old: "not a render" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ bad-version: "not a render" is neither a render id nor reference:<template>\/<reference>/);
    expect(result.details.code).toBe("bad-version");
  });
});
