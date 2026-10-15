import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { decideEditTimeline, SeriesRulesError, writeEditTimeline } from "../src/episode-render.js";
import { LAYOUT_SHEET_REPORT, layoutSheetStatus, makeLayoutSheet, sheetInputsHash } from "../src/layout-sheet.js";
import { SHEET_MAX_PICKS, sheetInstants } from "../src/sheet-instants.js";
import { MAX_SHEET_PICKS } from "@av/remotion-composer";
import { editSpec, sha256, specEpisode } from "../src/testing.js";

/**
 * An episode's layout sheet (avg-3th.1): what makeLayoutSheet writes and
 * refuses, and when layoutSheetStatus calls a sheet current, stale or
 * missing. The rendering is faked — @av/remotion-composer's own tests render
 * for real — and layout-sheet.e2e.test.ts makes one real sheet.
 */

const calls: { picks: { frame: number; label: string }[]; outDir: string; scale?: number }[] = [];
let failAfterWriting = false;
let drawingCode = `sha256:${"a".repeat(64)}`;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    drawingCodeHash: () => drawingCode,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string; scale?: number }) => {
      calls.push(options);
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      if (failAfterWriting) throw new actual.ComposerError("sheet-failed", "Remotion could not render the layout sheet: the browser went away");
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, `sheet of ${frames.length}`);
      return {
        frames,
        sheet: { path, hash: sha256(`sheet of ${frames.length}`), columns: 8, rows: Math.ceil(frames.length / 8), width: 2160, height: 1600 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const report = () => JSON.parse(readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8"));
/** Anything a sheet left in artifacts/ besides itself. */
const leftovers = () => readdirSync(at("artifacts")).filter((n) => n.startsWith(".layout-sheet"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "layout-sheet-"));
  specEpisode(dir(), REF);
  calls.length = 0;
  failAfterWriting = false;
  drawingCode = `sha256:${"a".repeat(64)}`;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Publish poetry-short@1.1.0 — 1.0.0 plus `sheet` — and pin the episode to it. */
function pinReleaseWithSheet(sheet: unknown): void {
  const templates = join(dirname(dirname(dir())), "templates", "poetry-short");
  cpSync(join(templates, "1.0.0"), join(templates, "1.1.0"), { recursive: true });
  const manifestPath = join(templates, "1.1.0", "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const text = `${JSON.stringify({ ...manifest, version: "1.1.0", sheet }, null, 2)}\n`;
  writeFileSync(manifestPath, text);
  editSpec(dir(), (spec) => { spec.template = { id: "poetry-short", version: "1.1.0", hash: sha256(text) }; });
}

describe("makeLayoutSheet", () => {
  it("never asks the composer for more frames than it renders", () => {
    expect(SHEET_MAX_PICKS).toBe(MAX_SHEET_PICKS);
  });

  it("renders the timeline a render would use, at sheetInstants' frames, and says so in sheet.json", async () => {
    const decision = decideEditTimeline(dir(), { episodeRef: REF });
    const made = await makeLayoutSheet(dir(), { episodeRef: REF });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.picks).toEqual(sheetInstants(decision.timeline as never).picks);
    expect(calls[0]!.scale).toBe(0.25);
    const r = report();
    expect(made.report).toEqual(r);
    expect(made.sheetPath).toBe(at("artifacts/layout-sheet/sheet.jpg"));
    expect(r.timeline).toEqual({ path: "artifacts/edit-timeline.json", hash: `sha256:${decision.hash}` });
    expect(r.rebuilt).toBe("there was no timeline yet");
    expect(r.rules).toEqual({ source: "poetry-short@1.0.0", instants: [] });
    expect(r.kits.map((k: { name: string }) => k.name)).toEqual(["captions", "still"]);
    expect(r.renderer).toBe(drawingCode);
    expect(r.inputsHash).toBe(sheetInputsHash({ timeline: r.timeline.hash, kits: r.kits, renderer: r.renderer, rules: r.rules, scale: 0.25 }));
    expect(r.frames[0]).toEqual({ index: 0, frame: 0, seconds: 0, label: "first", path: "frames/000.jpg", hash: sha256("still 0") });
    expect(r.sheet.path).toBe("sheet.jpg");
    expect(r.warnings).toEqual([]);
    // Only the sheet: the rebuilt timeline is the render's to write.
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("adds the instants the pinned release declares, and reports the ones that fall outside", async () => {
    pinReleaseWithSheet({ instants: [{ at: "start", offsetSeconds: 1 }, { at: "end", offsetSeconds: 5 }] });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    const r = report();
    expect(r.rules.source).toBe("poetry-short@1.1.0");
    expect(r.frames.map((f: { label: string }) => f.label)).toContain("poem · start+1s");
    expect(r.warnings).toEqual(["rule 2 (end+5s) falls outside section poem"]);
  });

  it("keeps a sheet that already pictures the timeline, and the review beside it", async () => {
    const first = await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/review.json"), "a person's review");
    const before = readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8");
    const again = await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(again.reused).toBe(true);
    expect(first.reused).toBeUndefined();
    expect(readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8")).toBe(before);
    expect(readFileSync(at("artifacts/layout-sheet/review.json"), "utf-8")).toBe("a person's review");
  });

  it("replaces the previous sheet whole", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/frames/999.jpg"), "a still from before");
    // A damaged still: the sheet no longer is the one rendered, so it is drawn again.
    writeFileSync(at("artifacts/layout-sheet/frames/000.jpg"), "damaged");
    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(existsSync(at("artifacts/layout-sheet/frames/999.jpg"))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("keeps the previous sheet, and leaves nothing behind, when rendering fails", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    const before = readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8");
    writeFileSync(at("artifacts/layout-sheet/frames/000.jpg"), "damaged");
    failAfterWriting = true;
    await expect(makeLayoutSheet(dir(), { episodeRef: REF })).rejects.toThrow(/the browser went away/);
    expect(readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8")).toBe(before);
    expect(leftovers()).toEqual([]);
  });

  it("refuses a timeline that breaks the series' rules, rendering and writing nothing", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    const refusal = makeLayoutSheet(dir(), { episodeRef: REF });
    await expect(refusal).rejects.toBeInstanceOf(SeriesRulesError);
    await expect(refusal).rejects.toThrow(/the layout sheet shows only a timeline a render would accept/);
    expect(calls).toEqual([]);
    expect(existsSync(at("artifacts/layout-sheet"))).toBe(false);
  });
});

describe("layoutSheetStatus", () => {
  it("is missing before the first sheet", () => {
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: `${LAYOUT_SHEET_REPORT} does not exist` });
  });

  it("is current right after a sheet, naming its hashes", async () => {
    const made = await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "current", inputsHash: made.report.inputsHash, sheetHash: made.report.sheet.hash });
  });

  it("stays current when the render writes the very timeline the sheet shows", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeEditTimeline(dir(), { episodeRef: REF });
    expect(layoutSheetStatus(dir(), { episodeRef: REF }).state).toBe("current");
  });

  it("is stale when the timeline changed", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    editSpec(dir(), (spec) => { spec.data.title = "Another morning"; });
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "stale", reasons: ["the timeline changed"] });
  });

  it("is stale when the composer's drawing code changed", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    drawingCode = `sha256:${"b".repeat(64)}`;
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "stale", reasons: ["the composer changed"] });
  });

  it("is missing when a still is gone or not the one rendered", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/frames/003.jpg"), "another still");
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: "still frames/003.jpg is not the one rendered" });
    rmSync(at("artifacts/layout-sheet/frames/003.jpg"));
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: "still frames/003.jpg is missing" });
  });

  it("is missing when sheet.json points outside its directory, even at a file with the right hash", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    const outside = at("artifacts/elsewhere.jpg");
    writeFileSync(outside, readFileSync(at("artifacts/layout-sheet/sheet.jpg")));
    const doc = report();
    doc.sheet.path = "../elsewhere.jpg";
    writeFileSync(at(LAYOUT_SHEET_REPORT), JSON.stringify(doc));
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: `${LAYOUT_SHEET_REPORT} names files outside the sheet` });
    const again = report();
    again.sheet.path = "sheet.jpg";
    again.frames[0].path = "../../edit-timeline.json";
    writeFileSync(at(LAYOUT_SHEET_REPORT), JSON.stringify(again));
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: `${LAYOUT_SHEET_REPORT} names files outside the sheet` });
  });

  it("is missing, never a crash, for a sheet.json of the wrong shape", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    for (const doc of ["null", "[]", JSON.stringify({ sheet: "sheet.jpg" }), JSON.stringify({ ...report(), frames: "all of them" })]) {
      writeFileSync(at(LAYOUT_SHEET_REPORT), doc);
      expect(layoutSheetStatus(dir(), { episodeRef: REF }).state, doc).toBe("missing");
    }
  });

  it("is stale when the sheet's rules changed", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    pinReleaseWithSheet({ instants: [{ at: "middle" }] });
    const status = layoutSheetStatus(dir(), { episodeRef: REF });
    expect(status.state).toBe("stale");
    expect(status.state === "stale" && status.reasons).toContain("the sheet's rules changed");
  });

  it("is stale, saying why, when the timeline cannot be decided", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/edit-timeline.json"), "{ half an edit");
    const status = layoutSheetStatus(dir(), { episodeRef: REF });
    expect(status.state).toBe("stale");
    expect(status.state === "stale" && status.reasons[0]).toMatch(/cannot be decided: .*not JSON/);
  });

  it("is missing when the sheet image is not the one rendered, or sheet.json is not JSON", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/sheet.jpg"), "touched up");
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: "the sheet image is not the one rendered" });
    writeFileSync(at(LAYOUT_SHEET_REPORT), "{");
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: `${LAYOUT_SHEET_REPORT} is not JSON` });
  });
});
