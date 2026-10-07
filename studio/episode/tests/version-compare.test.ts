import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compareVersions, COMPARE_DIR } from "../src/version-compare.js";
import { CompareError } from "../src/version-diff.js";
import { sha256 } from "../src/testing.js";

/**
 * compareVersions (avg-jao.5) on real videos: small renders made with ffmpeg
 * (already required by the studio), each a run of flat-colour sections, with
 * the report and timeline snapshot renderEpisode writes beside them.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

interface Segment {
  id: string;
  /** A colour, or "testsrc2" for a moving test pattern. */
  color: string;
  seconds: number;
  /** A white box drawn on the section: "x:y:w:h". */
  box?: string;
}
const FPS = 30;

/** A render of `segments`, as renderEpisode leaves it: video, timeline snapshot (unless `timeline: false`), report. */
function render(id: string, segments: Segment[], options: { timeline?: boolean; size?: string; episodeDir?: string; crf?: number; timelineSize?: string } = {}): void {
  const base = options.episodeDir ?? dir();
  const size = options.size ?? "320x180";
  mkdirSync(join(base, "output"), { recursive: true });
  const video = join(base, "output", `${id}.mp4`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    ...segments.flatMap((s) => ["-f", "lavfi", "-i", s.color === "testsrc2"
      ? `testsrc2=s=${size}:r=${FPS}:d=${s.seconds}`
      : `color=c=${s.color}:s=${size}:r=${FPS}:d=${s.seconds}`]),
    "-filter_complex", `${segments.map((s, i) => (s.box ? `[${i}:v]drawbox=${s.box}:color=white:t=fill[s${i}];` : "")).join("")}`
      + `${segments.map((s, i) => (s.box ? `[s${i}]` : `[${i}:v]`)).join("")}concat=n=${segments.length}:v=1[v]`,
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(options.crf ?? 18), video]);
  let from = 0;
  const sections = segments.map((s) => {
    const section = { id: s.id, from, duration: s.seconds * FPS };
    from += section.duration;
    return section;
  });
  const [width, height] = (options.timelineSize ?? size).split("x").map(Number);
  const timelineText = `${JSON.stringify({ fps: FPS, durationInFrames: from, resolution: { width, height }, sections }, null, 2)}\n`;
  if (options.timeline !== false) writeFileSync(join(base, "output", `${id}.timeline.json`), timelineText);
  writeFileSync(join(base, "output", `${id}.report.json`), JSON.stringify({
    renderId: id,
    timeline: { path: "artifacts/edit-timeline.json", hash: sha256(timelineText), snapshot: `${id}.timeline.json` },
    render: { path: `${id}.mp4`, hash: sha256(readFileSync(video)) },
  }));
}
/** The mean colour of a 10×10 patch of an image, as [r, g, b]. */
const colour = (file: string, x: number, y: number) =>
  [...execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `crop=10:10:${x}:${y},scale=1:1,format=rgb24`, "-f", "rawvideo", "-"])];
const near = (actual: number[], expected: number[]) => actual.every((v, i) => Math.abs(v - expected[i]!) <= 24);

const current = (id: string) => writeFileSync(at("output/current.json"), JSON.stringify({ renderId: id, path: `${id}.mp4` }));

const ORIGINAL: Segment[] = [
  { id: "intro", color: "red", seconds: 2 },
  { id: "block-1", color: "green", seconds: 2 },
  { id: "block-2", color: "blue", seconds: 2 },
];
const withBlock1 = (change: Partial<Segment>) => ORIGINAL.map((s) => (s.id === "block-1" ? { ...s, ...change } : s));
const changedSections = (r: Awaited<ReturnType<typeof compareVersions>>) =>
  [...new Set(r.report.pairs.filter((p) => p.changed).map((p) => p.section))];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "version-compare-"));
  mkdirSync(dir(), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("compareVersions", () => {
  it("finds nothing changed between two renders of the same thing", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", ORIGINAL);
    current("render-2-bbbbbbbb");
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa" });
    expect(r.report.alignment).toBe("sections");
    expect(r.report.verdict).toBe("listed");
    expect(r.report.changed).toEqual([]);
    expect(r.changedPath).toBeNull();
    expect(r.dir).toBe(at(`${COMPARE_DIR}/render-1-aaaaaaaa--render-2-bbbbbbbb`));
    expect(JSON.parse(readFileSync(r.reportPath, "utf-8"))).toEqual(r.report);
    expect(existsSync(join(r.dir, "pairs"))).toBe(false);
  });

  it("shows a correction stayed in its section: ok when expected, unexpected otherwise", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", withBlock1({ color: "yellow" }));
    const ok = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["block-*"] });
    expect(changedSections(ok)).toEqual(["block-1"]);
    expect(ok.report.verdict).toBe("ok");
    expect(ok.report.warnings).toEqual([]);
    for (const p of ok.report.pairs.filter((x) => x.changed)) {
      expect(p.meanDiff!).toBeGreaterThan(10);
      expect(existsSync(join(ok.dir, "pairs", `${String(p.index).padStart(3, "0")}.jpg`))).toBe(true);
    }
    expect(ok.changedPath).toBe(join(ok.dir, "changed.jpg"));
    // old | new | difference, in colour: green, yellow, and grey heat (white where it changed).
    const pair = join(ok.dir, "pairs", `${String(ok.report.changed[0]).padStart(3, "0")}.jpg`);
    expect(near(colour(pair, 30, 20), [0, 128, 0]), String(colour(pair, 30, 20))).toBe(true);
    expect(near(colour(pair, 110, 20), [255, 255, 0]), String(colour(pair, 110, 20))).toBe(true);
    const heat = colour(pair, 190, 20);
    expect(heat[0] === heat[1] && heat[1] === heat[2] && heat[0]! > 200, String(heat)).toBe(true);

    const wrong = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["intro"] });
    expect(wrong.report.verdict).toBe("unexpected-changes");
    expect(wrong.report.unexpected).toEqual(wrong.report.changed);
    expect(wrong.report.warnings).toEqual(["intro was expected to change and did not"]);
  });

  it("keeps later sections aligned when a section got longer", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", withBlock1({ seconds: 3 }));
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["block-1"] });
    expect(changedSections(r)).toEqual(["block-1"]);
    expect(r.report.pairs.filter((p) => p.changed).every((p) => p.reason === "beyond-old-section")).toBe(true);
    expect(r.report.pairs.filter((p) => p.section === "block-2").every((p) => p.oldFrame === p.newFrame - 30 && !p.changed)).toBe(true);
    expect(r.report.verdict).toBe("ok");
  });

  it("sees a section the correction deleted, though no sampled frame can", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", ORIGINAL.filter((s) => s.id !== "block-1"));
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["block-2"] });
    expect(r.report.verdict).toBe("unexpected-changes");
    expect(r.report.structure).toEqual([{ section: "block-1", change: "removed", oldFrames: 60, newFrames: 0 }]);
    expect(r.report.unexpectedStructure).toEqual(r.report.structure);
    const asked = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["block-1"] });
    expect(asked.report.verdict).toBe("ok");
  });

  it("sees a word-sized change the mean alone would miss", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", withBlock1({ box: "140:80:32:8" }));
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["intro"] });
    const block1 = r.report.pairs.filter((p) => p.section === "block-1");
    expect(block1.every((p) => p.meanDiff! < 1 && p.changed)).toBe(true);
    expect(r.report.verdict).toBe("unexpected-changes");
  });

  it("finds nothing changed between two encodings of the same pictures", async () => {
    const pattern = ORIGINAL.map((s) => ({ ...s, color: "testsrc2" }));
    render("render-1-aaaaaaaa", pattern, { crf: 18 });
    render("render-2-bbbbbbbb", pattern, { crf: 23 });
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" });
    expect(r.report.changed).toEqual([]);
  });

  it("takes the size from the videos, noting a timeline that says otherwise", async () => {
    render("render-1-aaaaaaaa", ORIGINAL, { timelineSize: "640x360" });
    render("render-2-bbbbbbbb", ORIGINAL);
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" });
    expect(r.report.old.notes).toEqual(["its timeline says 640x360; the video is 320x180"]);
    expect(r.report.changed).toEqual([]);
  });

  it("falls back to time for a render that kept no timeline, and says so", async () => {
    render("render-1-aaaaaaaa", ORIGINAL, { timeline: false });
    render("render-2-bbbbbbbb", ORIGINAL);
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" });
    expect(r.report.alignment).toBe("time");
    expect(r.report.old.notes).toEqual(["render-1-aaaaaaaa kept no timeline: aligned by time"]);
    expect(r.report.changed).toEqual([]);
  });

  it("compares with a golden reference of the series", async () => {
    const other = join(dirname(dir()), "evening");
    render("render-9-cccccccc", ORIGINAL, { episodeDir: other });
    render("render-2-bbbbbbbb", withBlock1({ color: "yellow" }));
    const require = createRequire(import.meta.url);
    const descriptor = JSON.parse(readFileSync(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/references/morning-v1.json"), "utf-8"));
    // A descriptor whose shape validateSeriesReference accepts: frozen
    // snapshots, the render and its report, all bound by the approval.
    const snap = join(other, "reviews/references/evening-v1");
    mkdirSync(snap, { recursive: true });
    cpSync(join(other, "output/render-9-cccccccc.timeline.json"), join(snap, "edit-timeline.json"));
    writeFileSync(join(snap, "episode-spec.json"), "{}");
    const file = (path: string) => ({ path, hash: sha256(readFileSync(join(other, path))) });
    const files = {
      spec: file("reviews/references/evening-v1/episode-spec.json"),
      timeline: file("reviews/references/evening-v1/edit-timeline.json"),
      render: file("output/render-9-cccccccc.mp4"),
      report: file("output/render-9-cccccccc.report.json"),
    };
    const bound = (f: { path: string; hash: string }) => ({ path: f.path, sha256: f.hash.slice(7) });
    const reference = {
      ...descriptor,
      id: "evening-v1",
      episodeRef: { ...REF, episode: "evening" },
      ...files,
      approval: {
        ...descriptor.approval,
        episode: `${REF.channel}/${REF.series}/evening`,
        binding: { ...descriptor.approval.binding, inputs: [bound(files.spec), bound(files.timeline)], outputs: [bound(files.render), bound(files.report)] },
      },
    };
    const descriptorPath = join(dirname(dirname(dir())), "templates/poetry-short/references/evening-v1.json");
    mkdirSync(dirname(descriptorPath), { recursive: true });
    writeFileSync(descriptorPath, JSON.stringify(reference));

    const r = await compareVersions(dir(), { old: "reference:poetry-short/evening-v1", new: "render-2-bbbbbbbb", expect: ["block-1"] });
    expect(r.report.verdict).toBe("ok");
    expect(r.report.old.notes).toEqual(["signature not checked: run vpr reference verify for trust"]);
    expect(r.dir).toBe(at(`${COMPARE_DIR}/reference_poetry-short_evening-v1--render-2-bbbbbbbb`));

    // A reference names its own series: one of another series is not this one's.
    writeFileSync(descriptorPath, JSON.stringify({
      ...reference,
      episodeRef: { ...reference.episodeRef, series: "prose" },
      approval: { ...reference.approval, episode: `${REF.channel}/prose/evening` },
    }));
    await expect(compareVersions(dir(), { old: "reference:poetry-short/evening-v1", new: "render-2-bbbbbbbb" }))
      .rejects.toMatchObject({ code: "no-such-reference" });
    writeFileSync(descriptorPath, JSON.stringify(reference));

    writeFileSync(join(other, "output/render-9-cccccccc.mp4"), "not the reference any more");
    await expect(compareVersions(dir(), { old: "reference:poetry-short/evening-v1", new: "render-2-bbbbbbbb" }))
      .rejects.toMatchObject({ code: "reference-changed" });
  });

  it("refuses what it cannot compare, writing nothing", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-3-dddddddd", ORIGINAL, { size: "160x90" });
    const code = (options: Parameters<typeof compareVersions>[1]) =>
      compareVersions(dir(), options).then(() => "none", (e) => (e instanceof CompareError ? e.code : String(e)));
    expect(await code({ old: "render-1-aaaaaaaa" })).toBe("no-render");
    expect(await code({ old: "../escape", new: "render-1-aaaaaaaa" })).toBe("bad-version");
    expect(await code({ old: "render-7-eeeeeeee", new: "render-1-aaaaaaaa" })).toBe("no-such-render");
    expect(await code({ old: "reference:poetry-short/none", new: "render-1-aaaaaaaa" })).toBe("no-such-reference");
    expect(await code({ old: "render-3-dddddddd", new: "render-1-aaaaaaaa" })).toBe("resolution-differs");
    expect(await code({ old: "render-1-aaaaaaaa", new: "render-1-aaaaaaaa", threshold: 0 })).toBe("bad-options");
    writeFileSync(at("output/render-3-dddddddd.mp4"), "edited by hand");
    expect(await code({ old: "render-3-dddddddd", new: "render-1-aaaaaaaa" })).toBe("render-changed");
    expect(existsSync(at(COMPARE_DIR)) ? readdirSync(at(COMPARE_DIR)) : []).toEqual([]);
  });

  it("keeps a previous comparison of the same pair, and leaves nothing behind, when decoding fails", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", ORIGINAL);
    const first = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" });
    const before = readFileSync(first.reportPath, "utf-8");
    // A video that is not a video, but matches its report: decoding fails.
    writeFileSync(at("output/render-1-aaaaaaaa.mp4"), "not a video");
    const report = JSON.parse(readFileSync(at("output/render-1-aaaaaaaa.report.json"), "utf-8"));
    report.render.hash = sha256("not a video");
    writeFileSync(at("output/render-1-aaaaaaaa.report.json"), JSON.stringify(report));
    await expect(compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" })).rejects.toMatchObject({ code: "decode-failed" });
    expect(readFileSync(first.reportPath, "utf-8")).toBe(before);
    expect(readdirSync(at(COMPARE_DIR))).toEqual(["render-1-aaaaaaaa--render-2-bbbbbbbb"]);
  });
});
