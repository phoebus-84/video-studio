import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderEpisode, RenderAuditError } from "../src/episode-render.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * Only an audited render becomes current (avg-3th.3). The render and the
 * audit are faked; @av/remotion-composer audits real files in its own tests.
 */

let findings: { code: string; message: string }[] = [];
let expectation: unknown = null;
let auditCrash: Error | null = null;
let rendered = 0;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      rendered++;
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
    auditRender: async (_file: string, expect: unknown) => {
      expectation = expect;
      if (auditCrash) throw auditCrash;
      return { passed: findings.length === 0, checks: ["decode", "streams", "duration"], findings };
    },
  };
});

// The sheet-review gate has its own tests (sheet-review.test.ts).
vi.mock("../src/sheet-review.js", () => ({ requireSheetReview: () => undefined }));

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-audit-"));
  specEpisode(dir(), REF);
  findings = [];
  expectation = null;
  auditCrash = null;
  rendered = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("renderEpisode audits the file before it becomes current", () => {
  it("records a passed audit in the report and moves current.json", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF });
    expect(render.audit.passed).toBe(true);
    const report = JSON.parse(readFileSync(render.reportPath, "utf-8"));
    expect(report.audit).toEqual({ passed: true, checks: ["decode", "streams", "duration"] });
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).renderId).toBe(render.renderId);
  });

  it("audits against what the timeline promised", async () => {
    await renderEpisode(dir(), { episodeRef: REF });
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    expect(expectation).toMatchObject({
      width: timeline.resolution.width,
      height: timeline.resolution.height,
      fps: timeline.fps,
      durationInFrames: timeline.durationInFrames,
      loop: false,
    });
  });

  it("keeps a failed render to be looked at, leaves current.json where it was, and says why", async () => {
    const first = await renderEpisode(dir(), { episodeRef: REF });
    findings = [{ code: "loudness-off", message: "the loudness is -30 LUFS, not -14" }];
    const error = await renderEpisode(dir(), { episodeRef: REF, label: "second" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderAuditError);
    const audit = error as RenderAuditError;
    expect(audit.code).toBe("render-audit");
    expect(audit.problems).toEqual([{ code: "loudness-off", message: "the loudness is -30 LUFS, not -14", path: `output/${audit.renderId}.mp4` }]);
    expect(existsSync(at(`output/${audit.renderId}.mp4`))).toBe(true);
    expect(existsSync(at(`output/${audit.renderId}.timeline.json`))).toBe(true);
    const report = JSON.parse(readFileSync(at(`output/${audit.renderId}.report.json`), "utf-8"));
    expect(report.audit).toEqual({ passed: false, checks: ["decode", "streams", "duration"], findings });
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).renderId).toBe(first.renderId);
    expect(audit.message).toBe(`the render ${audit.renderId} failed its audit (1 finding), so it did not become current`);
  });

  it("keeps the render and says so when the audit cannot run, and never makes it current", async () => {
    const first = await renderEpisode(dir(), { episodeRef: REF });
    auditCrash = new Error("spawn ffmpeg ENOENT");
    const error = (await renderEpisode(dir(), { episodeRef: REF, label: "second" }).catch((e: unknown) => e)) as RenderAuditError;
    expect(error).toBeInstanceOf(RenderAuditError);
    expect(error.problems).toEqual([{ code: "audit-unavailable", message: "the audit could not run: spawn ffmpeg ENOENT", path: `output/${error.renderId}.mp4` }]);
    const report = JSON.parse(readFileSync(at(`output/${error.renderId}.report.json`), "utf-8"));
    expect(report.audit).toEqual({ passed: false, error: "spawn ffmpeg ENOENT" });
    expect(existsSync(at(`output/${error.renderId}.timeline.json`))).toBe(true);
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).renderId).toBe(first.renderId);
  });
});
