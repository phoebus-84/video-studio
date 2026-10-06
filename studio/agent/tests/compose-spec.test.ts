import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { editSpec, specEpisode } from "./spec-episode.js";

/**
 * pva_build_timeline and pva_compose_video on an episode with an
 * episode-spec.json (avg-jao.2): the timeline comes from the template's
 * compiler, never from the legacy builder. The render is a fake, as in
 * compose-video.test.ts.
 */

const renders: Array<{ timeline: any; outputPath: string }> = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      renders.push({ timeline: options.timeline, outputPath: options.outputPath });
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: `sha256:${"0".repeat(64)}`,
        kits: [{ name: "still", version: "1.0.0" }],
        profile: options.timeline.profile.id,
        loudness: null,
        cache: { wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 1, totalSegments: 1, warnings: [] },
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const readJson = (relative: string) => JSON.parse(readFileSync(at(relative), "utf-8"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-compose-spec-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  renders.length = 0;
  specEpisode(dir(), REF);
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function tool(name: string, params: Record<string, unknown> = {}) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get(name)!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_build_timeline on a spec-driven episode", () => {
  it("compiles the spec with its template's compiler and says so", async () => {
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/artifacts\/edit-timeline\.json: 3 panels, 3 captions, 10\.8s, vertical-1080x1920/);
    expect(text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2 \(template poetry-short@1\.0\.0\)/);
    const timeline = readJson("artifacts/edit-timeline.json");
    expect(timeline.derivedFrom.compiler).toEqual({ id: "poetry-short", version: "1.0.0" });
    expect(timeline.metadata.builtBy).toBe("@studio/series poetry-short@1.0.0");
  });

  it("lists what is wrong with the spec and writes nothing, never falling back to the legacy builder", async () => {
    // Scene-named images would satisfy the legacy builder: it must not be asked.
    writeFileSync(at("assets/images/s1.png"), "a legacy scene");
    editSpec(dir(), (spec) => { spec.data.panels[1].cue = "teapot"; });
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown-word at episode-spec\.json#\$\.data\.panels\[1\]\.cue/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });

  it("refuses another profile than the template's, and accepts the same one", async () => {
    const other = await tool("pva_build_timeline", { profile: "youtube-1920x1080" });
    expect(other.isError).toBe(true);
    expect(other.content[0].text).toMatch(/profile-fixed-by-template/);
    expect(other.content[0].text).toMatch(/renders vertical-1080x1920, not youtube-1920x1080/);
    const same = await tool("pva_build_timeline", { profile: "vertical-1080x1920" });
    expect(same.isError).toBeFalsy();
  });
});

describe("pva_compose_video on a spec-driven episode", () => {
  it("compiles a missing timeline, renders its template's profile and records the compiler in the report", async () => {
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2/);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.timeline.profile.id).toBe("vertical-1080x1920");
    const current = readJson("output/current.json");
    const report = readJson(`output/${current.renderId}.report.json`);
    expect(report.compiledBy).toEqual({
      editedByHand: false,
      compiler: "poetry-short@1.0.0",
      template: readJson("episode-spec.json").template,
      revision: 2,
    });
  });

  it("refuses to render another profile than the template's, and renders nothing", async () => {
    const result = await tool("pva_compose_video", { profile: "youtube-1920x1080" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/profile-fixed-by-template/);
    expect(renders).toHaveLength(0);
  });

  it("recompiles after the spec is edited, and names the spec as the reason", async () => {
    await tool("pva_build_timeline");
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; spec.revision = 3; });
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/timeline rebuilt: episode-spec\.json changed/);
    expect(renders.at(-1)!.timeline.durationInFrames).toBe(279);
    expect(readJson("artifacts/edit-timeline.json").derivedFrom.spec.revision).toBe(3);
  });

  it("renders a hand-edited timeline as it stands when its inputs did not change", async () => {
    await tool("pva_build_timeline");
    const timeline = readJson("artifacts/edit-timeline.json");
    timeline.tracks.find((t: any) => t.id === "captions").items[0].props.text = "Light falls across the room.";
    const edited = `${JSON.stringify(timeline, null, 2)}\n`;
    writeFileSync(at("artifacts/edit-timeline.json"), edited);
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/rendered artifacts\/edit-timeline\.json as it stands/);
    expect(result.content[0].text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2, then edited by hand/);
    const current = readJson("output/current.json");
    expect(readJson(`output/${current.renderId}.report.json`).compiledBy.editedByHand).toBe(true);
    expect(renders.at(-1)!.timeline.tracks.find((t: any) => t.id === "captions").items[0].props.text).toBe("Light falls across the room.");
    expect(readFileSync(at("artifacts/edit-timeline.json"), "utf-8")).toBe(edited);
  });

  it("refuses to render while the spec does not compile, even with a valid timeline from before", async () => {
    await tool("pva_build_timeline");
    editSpec(dir(), (spec) => { spec.data.title = "__FILL__"; });
    const result = await tool("pva_compose_video");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unfilled/);
    expect(renders).toHaveLength(0);
    expect(existsSync(at("output/current.json"))).toBe(false);
  });
});
