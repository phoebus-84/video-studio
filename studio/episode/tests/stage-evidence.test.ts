import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditTimeline } from "../src/episode-render.js";
import { makeLayoutSheet } from "../src/layout-sheet.js";
import { seriesStageEvidence } from "../src/stage-evidence.js";
import { approveSheet, divLongEpisode, editSpec, sha256, specEpisode } from "../src/testing.js";

/**
 * A series episode's stages read from its files (avg-qwc): each stage is
 * done when its files are there and still match what they were made from,
 * the sheet when the operator approved it. The sheet's rendering is faked,
 * as in layout-sheet.test.ts.
 */

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    drawingCodeHash: () => `sha256:${"a".repeat(64)}`,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, `sheet of ${frames.length}`);
      return {
        frames,
        sheet: { path, hash: sha256(`sheet of ${frames.length}`), columns: 8, rows: 1, width: 2160, height: 1600 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const KEY = "test-operator-key";
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const evidence = (key: string | null = KEY) => seriesStageEvidence(dir(), { episodeRef: REF, key })!;
const states = (key?: string | null) => Object.fromEntries(Object.entries(evidence(key)).map(([id, v]) => [id, v.state]));

/** A render whose report names `hash` as its timeline and passed its audit, made current. */
function renderedFrom(hash: string, passed = true) {
  mkdirSync(join(dir(), "output"), { recursive: true });
  writeFileSync(join(dir(), "output", "render-1-a.report.json"), JSON.stringify({ renderId: "render-1-a", timeline: { hash }, audit: { passed } }));
  writeFileSync(join(dir(), "output", "current.json"), JSON.stringify({ renderId: "render-1-a", path: "render-1-a.mp4" }));
  writeFileSync(join(dir(), "output", "render-1-a.mp4"), "video");
}
const timelineHash = () => sha256(readFileSync(join(dir(), "artifacts", "edit-timeline.json")));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stage-evidence-"));
  specEpisode(dir(), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("seriesStageEvidence", () => {
  it("answers null for an episode without a spec: its stages follow the journal", () => {
    rmSync(join(dir(), "episode-spec.json"));
    expect(seriesStageEvidence(dir(), { episodeRef: REF, key: KEY })).toBeNull();
  });

  it("follows a complete episode from its files to its render", async () => {
    expect(states()).toEqual({ spec: "completed", pictures: "completed", takes: "completed", timeline: "pending", check: "pending", sheet: "pending", render: "pending" });
    expect(evidence().timeline.reason).toContain("pva_build_timeline");
    expect(evidence().check.reason).toBe("waiting on timeline");

    writeEditTimeline(dir(), { episodeRef: REF });
    expect(states()).toMatchObject({ timeline: "completed", check: "completed", sheet: "pending", render: "pending" });

    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(states()).toMatchObject({ sheet: "awaiting_review", render: "pending" });
    expect(evidence().sheet.reason).toContain("Storyboard");

    approveSheet(dir(), REF, KEY);
    expect(states()).toMatchObject({ sheet: "completed", render: "pending" });

    renderedFrom(timelineHash());
    expect(evidence().render).toEqual({ state: "completed", reason: "output/render-1-a.mp4, audit passed" });
  });

  it("says how many placeholders are left, and holds everything after the spec", () => {
    editSpec(dir(), (spec) => { spec.data.title = "__FILL__"; });
    expect(evidence().spec).toEqual({ state: "pending", reason: "1 __FILL__ placeholder left in episode-spec.json" });
    expect(evidence().pictures).toEqual({ state: "pending", reason: "waiting on spec" });
  });

  it("names a missing picture", () => {
    const spec = JSON.parse(readFileSync(join(dir(), "episode-spec.json"), "utf-8"));
    const assetId = spec.data.panels[0].assetId;
    rmSync(join(dir(), "assets", "images"), { recursive: true, force: true });
    const pictures = evidence().pictures;
    expect(pictures.state).toBe("pending");
    expect(pictures.reason).toContain(assetId);
    expect(evidence().timeline.reason).toBe("waiting on pictures");
  });

  it("holds the takes until each is aligned", () => {
    const path = join(dir(), "artifacts", "narration", "takes.json");
    const takes = JSON.parse(readFileSync(path, "utf-8"));
    delete takes.takes[0].timing;
    writeFileSync(path, JSON.stringify(takes));
    expect(evidence().takes).toEqual({ state: "pending", reason: `not aligned: ${takes.takes[0].id} (pva_align_take)` });
  });

  it("makes the timeline stale when the spec changes after it was compiled, and the rest wait", () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    editSpec(dir(), (spec) => { spec.data.title = `${spec.data.title} again`; });
    expect(evidence().timeline.state).toBe("stale");
    expect(evidence().timeline.reason).toContain("would be recompiled");
    expect(evidence().sheet.reason).toBe("waiting on timeline");
  });

  it("reports a rejected sheet with the operator's note, and a sheet the timeline outran as stale", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY, "rejected", "the title covers the face");
    expect(evidence().sheet).toEqual({ state: "failed", reason: 'the operator rejected the sheet: "the title covers the face"' });

    approveSheet(dir(), REF, KEY);
    editSpec(dir(), (spec) => { spec.data.title = `${spec.data.title} again`; });
    writeEditTimeline(dir(), { episodeRef: REF });
    expect(evidence().sheet.state).toBe("stale");
  });

  it("does not take a review signed with another key", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, "someone-else");
    expect(evidence(KEY).sheet.state).toBe("awaiting_review");
  });

  it("makes a render of an earlier timeline stale, and a failed audit failed", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    renderedFrom("sha256:" + "0".repeat(64));
    expect(evidence().render.state).toBe("stale");
    renderedFrom(timelineHash(), false);
    expect(evidence().render.state).toBe("failed");
  });

  it("fails a render whose video is gone", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    renderedFrom(timelineHash());
    rmSync(join(dir(), "output", "render-1-a.mp4"));
    expect(evidence().render).toEqual({ state: "failed", reason: "output/render-1-a.mp4 is missing" });
  });

  it("makes a changed pinned picture the pictures' staleness, not the spec's failure", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    const shortImages = join(episodeDir, "..", "..", "..", "short", "episodes", "il-lampo", "assets", "images");
    writeFileSync(join(shortImages, readdirSync(shortImages)[0]!), "a repainted picture");
    const long = seriesStageEvidence(episodeDir, { episodeRef, key: KEY })!;
    expect(long.spec.state).toBe("completed");
    expect(long.pictures.state).toBe("stale");
    expect(long.pictures.reason).toContain("renew the pin");
    expect(long.takes.reason).toBe("checked once pictures loads");
    expect(long.timeline.reason).toBe("waiting on pictures and takes");
  });

  it("keeps a delivered video in sight when the sheet must be approved again", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    renderedFrom(timelineHash());
    rmSync(join(dir(), "artifacts", "layout-sheet", "review.json"));
    expect(evidence().render).toEqual({ state: "stale", reason: "output/render-1-a.mp4 is the current video, but sheet must be done again before the next render" });
  });
});
