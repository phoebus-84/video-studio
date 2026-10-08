import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeLayoutSheet } from "@studio/episode";
import { approveSheet, editSpec, sha256, specEpisode } from "@studio/episode/testing";

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
    // The file is fake: its audit is @av/remotion-composer's and @studio/episode's to test.
    auditRender: async () => ({ passed: true, checks: ["decode"], findings: [] }),
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, `sheet of ${frames.length}`);
      return { frames, sheet: { path, hash: sha256(`sheet of ${frames.length}`), columns: 8, rows: 1, width: 2160, height: 1600 }, kits: actual.timelineKits(options.timeline)! };
    },
  };
});

/** A person read the sheet of the timeline about to be rendered, and approved it (avg-3th.2). */
async function sheetApproved(): Promise<void> {
  await makeLayoutSheet(dir(), { episodeRef: REF });
  approveSheet(dir(), REF);
}

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
    await sheetApproved();
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
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 2; spec.revision = 3; });
    await sheetApproved();
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/timeline rebuilt: episode-spec\.json changed/);
    // 9.3 s of narration and 2 s of hold.
    expect(renders.at(-1)!.timeline.durationInFrames).toBe(339);
    expect(readJson("artifacts/edit-timeline.json").derivedFrom.spec.revision).toBe(3);
  });

  it("renders a hand-edited timeline as it stands when its inputs did not change", async () => {
    await tool("pva_build_timeline");
    // The teacup arrives 10 frames later: a change the series allows.
    const timeline = readJson("artifacts/edit-timeline.json");
    const panels = timeline.tracks.find((t: any) => t.id === "panels").items;
    panels[0].duration = 113;
    panels[1].from = 101;
    panels[1].duration = 110;
    const edited = `${JSON.stringify(timeline, null, 2)}\n`;
    writeFileSync(at("artifacts/edit-timeline.json"), edited);
    await sheetApproved();
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/rendered artifacts\/edit-timeline\.json as it stands/);
    expect(result.content[0].text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2, then edited by hand/);
    const current = readJson("output/current.json");
    expect(readJson(`output/${current.renderId}.report.json`).compiledBy.editedByHand).toBe(true);
    expect(renders.at(-1)!.timeline.tracks.find((t: any) => t.id === "panels").items[1].from).toBe(101);
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

describe("series rules (poetry-short@1.0.0) on a spec-driven episode", () => {
  /** Every file under the series, with its bytes: to prove a tool wrote nothing. */
  function snapshot(): Map<string, string> {
    const files = new Map<string, string>();
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else files.set(p, readFileSync(p).toString("base64"));
      }
    };
    walk(join(root, REF.channel));
    return files;
  }
  function editTimeline(change: (timeline: any) => void): string {
    const timeline = readJson("artifacts/edit-timeline.json");
    change(timeline);
    const text = `${JSON.stringify(timeline, null, 2)}\n`;
    writeFileSync(at("artifacts/edit-timeline.json"), text);
    return text;
  }

  it("pva_build_timeline refuses a spec whose video falls outside 10–60 s, and writes nothing", async () => {
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/series rules \(poetry-short@1\.0\.0\) refuse this timeline: change the spec or the takes/);
    expect(result.content[0].text).toMatch(/duration-range at artifacts\/edit-timeline\.json#\$\.durationInFrames/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });

  it("pva_build_timeline says the rules passed", async () => {
    const result = await tool("pva_build_timeline");
    expect(result.content[0].text).toMatch(/series rules poetry-short@1\.0\.0: no errors/);
  });

  it("pva_compose_video refuses a hand edit that rewrites a caption, renders nothing and leaves the edit alone", async () => {
    await tool("pva_build_timeline");
    const edited = editTimeline((t) => { t.tracks[1].items[0].props.text = "Light falls across the room."; });
    const result = await tool("pva_compose_video");
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toMatch(/^❌ series-rules: the series rules \(poetry-short@1\.0\.0\) refuse this timeline: fix the edit in artifacts\/edit-timeline\.json, or delete it to recompile/);
    expect(text).toMatch(/text-not-voice at artifacts\/edit-timeline\.json#\$\.tracks\[1\]/);
    expect(result.details.code).toBe("series-rules");
    expect(renders).toHaveLength(0);
    expect(existsSync(at("output"))).toBe(false);
    expect(readFileSync(at("artifacts/edit-timeline.json"), "utf-8")).toBe(edited);
  });

  it("pva_compose_video renders a timeline with only warnings, and records them in the report", async () => {
    // A 5 s hold keeps the cat on screen for 7.7 s.
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 5; });
    await sheetApproved();
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/⚠️ panel-long at artifacts\/edit-timeline\.json#\$\.tracks\[0\]\.items\[2\]/);
    const current = readJson("output/current.json");
    const report = readJson(`output/${current.renderId}.report.json`);
    expect(report.validation.validator).toBe("poetry-short@1.0.0");
    expect(report.validation.findings.map((f: any) => [f.code, f.severity])).toEqual([["panel-long", "warning"]]);
  });

  it("pva_check_episode reports the findings on the timeline as it stands, and writes nothing", async () => {
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 5; });
    await tool("pva_build_timeline");
    editTimeline((t) => { t.tracks[1].items[0].props.text = "Light falls across the room."; });
    const before = snapshot();
    const result = await tool("pva_check_episode");
    expect(result.isError).toBeFalsy();
    const lines = result.content[0].text.split("\n");
    expect(lines[0]).toBe("artifacts/edit-timeline.json would be rendered as it stands");
    expect(lines[1]).toBe("❌ 1 error(s) against poetry-short@1.0.0: pva_compose_video would refuse it");
    // Errors first.
    expect(lines[2]).toMatch(/^ {2}❌ text-not-voice at artifacts\/edit-timeline\.json#\$\.tracks\[1\]/);
    expect(lines[3]).toMatch(/^ {2}⚠️ panel-long at artifacts\/edit-timeline\.json#\$\.tracks\[0\]\.items\[2\]/);
    expect(snapshot()).toEqual(before);
  });

  it("pva_check_episode says when the timeline would be recompiled, and checks the recompiled one", async () => {
    await tool("pva_build_timeline");
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
    const before = snapshot();
    const result = await tool("pva_check_episode");
    const text = result.content[0].text;
    expect(text).toMatch(/^the timeline would be recompiled: episode-spec\.json changed/);
    expect(text).toMatch(/duration-range at artifacts\/edit-timeline\.json#\$\.durationInFrames/);
    expect(snapshot()).toEqual(before);
  });

  it("pva_check_episode shows the warnings pva_compose_video would show", async () => {
    rmSync(at("episode-spec.json"));
    writeFileSync(at("assets/images/s1.png"), "a legacy scene");
    await tool("pva_build_timeline");
    rmSync(at("assets/images/s1.png"));
    const result = await tool("pva_check_episode");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/⚠️ the episode could not be rebuilt \(no-scenes/);
  });

  it("a template naming a validator the studio does not have is refused, and says so", async () => {
    const release = join(root, REF.channel, "series", REF.series, "templates/poetry-short/1.0.0/series-template.json");
    const manifest = JSON.parse(readFileSync(release, "utf-8"));
    manifest.validator.version = "9.9.9";
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(release, text);
    editSpec(dir(), (spec) => { spec.template.hash = sha256(text); });
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/the template names a validator this studio does not have/);
    expect(result.content[0].text).toMatch(/unknown-validator at \.\.\/\.\.\/templates\/poetry-short\/1\.0\.0\/series-template\.json#\$\.validator/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });

  it("pva_check_episode on an episode without a spec: no series rules", async () => {
    rmSync(at("episode-spec.json"));
    writeFileSync(at("assets/images/s1.png"), "a legacy scene");
    const result = await tool("pva_check_episode");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/^the timeline would be recompiled: there was no timeline yet\nno series rules for this episode$/);
  });
});
