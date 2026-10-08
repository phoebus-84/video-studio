// The series-production family (avg-jao.4, avg-3th.1): which stages the
// studio performs, and what its four adapters do with a spec-driven episode.
// The render and the layout sheet are faked, as in the agent's tests:
// @av/remotion-composer has its own.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystemPipelineLoader, resolvePipeline } from "@studio/runtime";
import { editSpec, specEpisode } from "@studio/episode/testing";
import { createStudioRegistry } from "../src/index.js";
import { seriesCheck, seriesRender, seriesSheet, seriesTimeline } from "../src/adapters/series.js";
import { BUILTIN_NAMES, BUILTIN_PIPELINES, builtin } from "./helpers.js";

const renders: string[] = [];
const sheets: string[] = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    // The file is fake: its audit is @av/remotion-composer's and @studio/episode's to test.
    auditRender: async () => ({ passed: true, checks: ["decode"], findings: [] }),
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      renders.push(options.outputPath);
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: `sha256:${"0".repeat(64)}`,
        kits: [],
        profile: options.timeline.profile.id,
        loudness: null,
        cache: { wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 1, totalSegments: 1, warnings: [] },
      };
    },
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
      sheets.push(options.outDir);
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, "still");
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: `sha256:${createHash("sha256").update("still").digest("hex")}` };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, "sheet");
      return {
        frames,
        // layoutSheetStatus checks the image against this hash.
        sheet: { path, hash: `sha256:${createHash("sha256").update("sheet").digest("hex")}`, columns: 8, rows: 3, width: 2160, height: 1560 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const lines: string[] = [];
const ctx = () => ({ episodeDir: dir(), ref: REF, log: (line: string) => lines.push(line) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-adapters-"));
  specEpisode(dir(), REF);
  renders.length = 0;
  sheets.length = 0;
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the series-production pipeline", () => {
  it("resolves, every input produced by an earlier stage", async () => {
    const pipeline = await builtin("series-production");
    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "sheet", "render"]);
    expect(pipeline.version).toBe("1.1.0");
  });

  it("is performed by the studio at timeline, check, sheet and render; spec, pictures and takes are a person's or Pi's", async () => {
    const pipeline = await builtin("series-production");
    const registry = createStudioRegistry();
    expect(pipeline.stages.map((s) => [s.definition.id, registry.match(s)?.id ?? null])).toEqual([
      ["spec", null],
      ["pictures", null],
      ["takes", null],
      ["timeline", "series-timeline"],
      ["check", "series-check"],
      ["sheet", "series-sheet"],
      ["render", "series-render"],
    ]);
  });

  it("its adapters perform no stage of another built-in pipeline", async () => {
    const registry = createStudioRegistry();
    const series = new Set(["series-timeline", "series-check", "series-sheet", "series-render"]);
    for (const name of BUILTIN_NAMES.filter((n) => n !== "series-production")) {
      for (const stage of (await builtin(name)).stages) {
        expect(series.has(registry.match(stage)?.id ?? ""), `${name}/${stage.definition.id}`).toBe(false);
      }
    }
  });

  it("a series extends it and replaces a stage by id", async () => {
    // The built-in pipelines, then a folder of series-local ones.
    const local = join(dirname(createRequire(import.meta.url).resolve("@studio/pipelines/package.json")), "fixtures/valid/series-local");
    const pipeline = await resolvePipeline(new FileSystemPipelineLoader([BUILTIN_PIPELINES, local]), "poetry-short");
    expect(pipeline.inheritanceChain).toEqual(["series-production", "poetry-short"]);
    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "sheet", "render"]);
    expect(pipeline.stages.find((s) => s.definition.id === "takes")!.definition.name).toBe("Recital Take");
  });
});

describe("series-timeline", () => {
  it("compiles the timeline", async () => {
    const written = await seriesTimeline.perform(ctx());
    expect(written).toEqual([at("artifacts/edit-timeline.json")]);
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    expect(timeline.derivedFrom.compiler).toEqual({ id: "poetry-short", version: "1.0.0" });
    expect(lines[0]).toMatch(/timeline: poetry-short@1\.0\.0 from spec revision 2, 324 frames/);
  });

  it("fails on a spec whose video breaks the series' rules, writing nothing", async () => {
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
    await expect(seriesTimeline.perform(ctx())).rejects.toThrow(/series rules \(poetry-short@1\.0\.0\) refuse this timeline/);
    expect(lines.join("\n")).toMatch(/duration-range at artifacts\/edit-timeline\.json#\$\.durationInFrames/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });
});

describe("series-check", () => {
  it("writes the report the reviewer reads", async () => {
    await seriesTimeline.perform(ctx());
    const written = await seriesCheck.perform(ctx());
    expect(written).toEqual([at("artifacts/series-check.json")]);
    const report = JSON.parse(readFileSync(at("artifacts/series-check.json"), "utf-8"));
    expect(report.validator).toBe("poetry-short@1.0.0");
    expect(report.decision).toEqual({ rebuilt: null });
    expect(report.timeline.path).toBe("artifacts/edit-timeline.json");
    expect(report.timeline.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.findings).toEqual([]);
  });

  it("writes the report and fails on a hand edit that breaks a rule", async () => {
    await seriesTimeline.perform(ctx());
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    await expect(seriesCheck.perform(ctx())).rejects.toThrow(/refuse this timeline: see artifacts\/series-check\.json/);
    const report = JSON.parse(readFileSync(at("artifacts/series-check.json"), "utf-8"));
    expect(report.findings.map((f: any) => [f.code, f.severity, f.path])).toEqual([
      ["text-not-voice", "error", "artifacts/edit-timeline.json#$.tracks[1]"],
    ]);
  });
});

/** A change the rules allow (the teacup arrives 10 frames later), made after the review. */
function editAllowed(): void {
  const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
  timeline.tracks[0].items[0].duration = 113;
  timeline.tracks[0].items[1].from = 101;
  timeline.tracks[0].items[1].duration = 110;
  writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
}

describe("series-sheet", () => {
  it("renders the layout sheet of the checked timeline and returns its report and image", async () => {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    const written = await seriesSheet.perform(ctx());
    expect(written).toEqual([at("artifacts/layout-sheet/sheet.json"), at("artifacts/layout-sheet/sheet.jpg")]);
    expect(sheets).toHaveLength(1);
    const report = JSON.parse(readFileSync(at("artifacts/layout-sheet/sheet.json"), "utf-8"));
    expect(report.timeline.hash).toBe(JSON.parse(readFileSync(at("artifacts/series-check.json"), "utf-8")).timeline.hash);
    expect(lines.join("\n")).toMatch(/sheet: \d+ frames \(8×3\), rules poetry-short@1\.0\.0 → .*artifacts\/layout-sheet\/sheet\.jpg/);
  });

  it("refuses an episode never checked, or a timeline changed since its check", async () => {
    await seriesTimeline.perform(ctx());
    await expect(seriesSheet.perform(ctx())).rejects.toThrow(/series-check\.json is missing: run the check stage/);
    await seriesCheck.perform(ctx());
    editAllowed();
    await expect(seriesSheet.perform(ctx())).rejects.toThrow(/changed since it was checked: run the check stage again/);
    expect(sheets).toHaveLength(0);
  });
});

describe("series-render", () => {
  /** timeline → check → sheet, as the pipeline runs them. */
  async function upToTheSheet(): Promise<void> {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    await seriesSheet.perform(ctx());
  }

  it("renders the checked timeline whose sheet is current", async () => {
    await upToTheSheet();
    const written = await seriesRender.perform(ctx());
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/output\/render-\d+-[0-9a-f]{8}\.mp4$/);
    expect(renders).toHaveLength(1);
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).path).toBe(written[0]!.split("/").pop());
  });

  it("refuses a timeline changed since it was checked, until the check runs again", async () => {
    await upToTheSheet();
    editAllowed();
    await expect(seriesRender.perform(ctx())).rejects.toThrow(/changed since it was checked: run the check stage again/);
    expect(renders).toHaveLength(0);
  });

  it("refuses without a layout sheet", async () => {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    await expect(seriesRender.perform(ctx())).rejects.toThrow(
      /the layout sheet is missing \(artifacts\/layout-sheet\/sheet\.json does not exist\): run the sheet stage again/,
    );
    expect(renders).toHaveLength(0);
  });

  it("refuses a sheet of an earlier timeline, even one checked again since, until the sheet is made again", async () => {
    await upToTheSheet();
    editAllowed();
    await seriesCheck.perform(ctx());
    await expect(seriesRender.perform(ctx())).rejects.toThrow(/the layout sheet is stale \(the timeline changed\): run the sheet stage again/);
    expect(renders).toHaveLength(0);
    await seriesSheet.perform(ctx());
    await seriesRender.perform(ctx());
    expect(renders).toHaveLength(1);
  });

  it("refuses a sheet whose image was replaced", async () => {
    await upToTheSheet();
    writeFileSync(at("artifacts/layout-sheet/sheet.jpg"), "another picture");
    await expect(seriesRender.perform(ctx())).rejects.toThrow(/the layout sheet is missing \(the sheet image is not the one rendered\)/);
    expect(renders).toHaveLength(0);
  });

  it("refuses a timeline that breaks the series' rules, writing no output", async () => {
    await upToTheSheet();
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    // Checked again (and refused), no sheet can be made of it, and the old
    // sheet no longer shows what would be rendered.
    await expect(seriesCheck.perform(ctx())).rejects.toThrow(/refuse this timeline/);
    await expect(seriesSheet.perform(ctx())).rejects.toThrow(/series rules \(poetry-short@1\.0\.0\) refuse this timeline: the layout sheet shows only/);
    await expect(seriesRender.perform(ctx())).rejects.toThrow(/the layout sheet is stale \(the timeline changed\)/);
    expect(renders).toHaveLength(0);
    expect(existsSync(at("output"))).toBe(false);
  });
});

describe("an episode without a spec", () => {
  it("is refused by every series adapter", async () => {
    unlinkSync(at("episode-spec.json"));
    for (const adapter of [seriesTimeline, seriesCheck, seriesSheet, seriesRender]) {
      await expect(adapter.perform(ctx()), adapter.id).rejects.toThrow(/this pipeline needs an episode-spec\.json; run the spec stage/);
    }
  });
});
