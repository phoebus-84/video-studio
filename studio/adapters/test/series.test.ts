// The series-production family (avg-jao.4): which stages the studio
// performs, and what its three adapters do with a spec-driven episode. The
// render itself is faked, as in the agent's tests: @av/remotion-composer has
// its own.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystemPipelineLoader, resolvePipeline } from "@studio/runtime";
import { editSpec, specEpisode } from "@studio/episode/testing";
import { createStudioRegistry } from "../src/index.js";
import { seriesCheck, seriesRender, seriesTimeline } from "../src/adapters/series.js";
import { BUILTIN_NAMES, BUILTIN_PIPELINES, builtin } from "./helpers.js";

const renders: string[] = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
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
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the series-production pipeline", () => {
  it("resolves, every input produced by an earlier stage", async () => {
    const pipeline = await builtin("series-production");
    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "render"]);
  });

  it("is performed by the studio at timeline, check and render; spec, pictures and takes are a person's or Pi's", async () => {
    const pipeline = await builtin("series-production");
    const registry = createStudioRegistry();
    expect(pipeline.stages.map((s) => [s.definition.id, registry.match(s)?.id ?? null])).toEqual([
      ["spec", null],
      ["pictures", null],
      ["takes", null],
      ["timeline", "series-timeline"],
      ["check", "series-check"],
      ["render", "series-render"],
    ]);
  });

  it("its adapters perform no stage of another built-in pipeline", async () => {
    const registry = createStudioRegistry();
    const series = new Set(["series-timeline", "series-check", "series-render"]);
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
    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "render"]);
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

describe("series-render", () => {
  it("renders the checked timeline", async () => {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    const written = await seriesRender.perform(ctx());
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/output\/render-\d+-[0-9a-f]{8}\.mp4$/);
    expect(renders).toHaveLength(1);
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).path).toBe(written[0]!.split("/").pop());
  });

  it("refuses a timeline that breaks the series' rules, writing no output", async () => {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    await expect(seriesRender.perform(ctx())).rejects.toThrow(/series rules/);
    expect(renders).toHaveLength(0);
    expect(existsSync(at("output"))).toBe(false);
  });
});

describe("an episode without a spec", () => {
  it("is refused by every series adapter", async () => {
    unlinkSync(at("episode-spec.json"));
    for (const adapter of [seriesTimeline, seriesCheck, seriesRender]) {
      await expect(adapter.perform(ctx()), adapter.id).rejects.toThrow(/this pipeline needs an episode-spec\.json; run the spec stage/);
    }
  });
});
