import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderEpisode } from "../src/episode-render.js";
import { makeLayoutSheet } from "../src/layout-sheet.js";
import { recordSheetReading, requireSheetReview, sheetApprovalPolicy, SheetReviewError } from "../src/sheet-review.js";
import { approveSheet, editSpec, sha256, specEpisode } from "../src/testing.js";

/**
 * A spec-driven episode renders only with an approval of its current layout
 * sheet (avg-3th.2). Rendering, the sheet's and the video's, is faked.
 */

let rendered = 0;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, `sheet of ${frames.length} at ${options.timeline.durationInFrames}`);
      return {
        frames,
        sheet: { path, hash: sha256(`sheet of ${frames.length} at ${options.timeline.durationInFrames}`), columns: 8, rows: 1, width: 2160, height: 1600 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      rendered++;
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return { path: options.outputPath, durationSeconds: 1, sizeBytes: 8, hash: sha256("fake mp4"), kits: [], profile: options.timeline.profile.id, loudness: null };
    },
    auditRender: async () => ({ passed: true, checks: ["decode"], findings: [] }),
  };
});

const KEY = "test-operator-key";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sheet-review-"));
  specEpisode(dir(), REF);
  rendered = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The refusal's single problem code; and nothing rendered or written to output/. */
async function refused(options: { operatorKey?: string | null } = {}): Promise<string> {
  const error = await renderEpisode(dir(), { episodeRef: REF, ...options }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SheetReviewError);
  expect((error as SheetReviewError).code).toBe("sheet-review");
  expect(rendered).toBe(0);
  expect(existsSync(at("output"))).toBe(false);
  return (error as SheetReviewError).problems[0]!.code;
}

describe("renderEpisode needs an approval of the current layout sheet", () => {
  it("refuses with no sheet", async () => {
    expect(await refused()).toBe("sheet-missing");
  });

  it("refuses with a sheet nobody approved", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(await refused()).toBe("review-missing");
  });

  it("renders with an approval of the current sheet, verified when it holds the key", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    await renderEpisode(dir(), { episodeRef: REF, operatorKey: KEY });
    expect(rendered).toBe(1);
  });

  it("renders without the key on an approval bound to the current sheet (Pi's case)", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    await renderEpisode(dir(), { episodeRef: REF });
    expect(rendered).toBe(1);
  });

  it("refuses a rejected sheet, quoting the reviewer", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY, "rejected", "the verse bar covers the hand");
    const error = (await renderEpisode(dir(), { episodeRef: REF }).catch((e: unknown) => e)) as SheetReviewError;
    expect(error.problems[0]).toMatchObject({ code: "review-rejected", message: expect.stringContaining("the verse bar covers the hand") });
  });

  it("refuses a sheet made stale by an edit, and a review of an earlier sheet", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, KEY);
    editSpec(dir(), (spec) => { spec.data.title = `${spec.data.title} (revised)`; spec.revision += 1; });
    expect(await refused()).toBe("sheet-stale");
    const old = readFileSync(at("artifacts/layout-sheet/review.json"), "utf-8");
    await makeLayoutSheet(dir(), { episodeRef: REF });
    // a new sheet starts unreviewed: regenerating it cleared the review
    expect(existsSync(at("artifacts/layout-sheet/review.json"))).toBe(false);
    writeFileSync(at("artifacts/layout-sheet/review.json"), old);
    expect(await refused()).toBe("review-stale");
  });

  it("accepts the pipeline's sheet gate in place of a review file, but never a stale sheet", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    await renderEpisode(dir(), { episodeRef: REF, sheetApproval: "pipeline-gate" });
    expect(rendered).toBe(1);
    editSpec(dir(), (spec) => { spec.data.title = `${spec.data.title} (revised)`; spec.revision += 1; });
    const error = (await renderEpisode(dir(), { episodeRef: REF, sheetApproval: "pipeline-gate" }).catch((e: unknown) => e)) as SheetReviewError;
    expect(error.problems[0]!.code).toBe("sheet-stale");
  });

  it("takes the agent's reading for the review where the series sets sheet.approval: auto, and nowhere else", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(() => recordSheetReading(dir(), { episodeRef: REF }, { problems: [] })).toThrow(/vpr sheet approve/);
    const settings = join(dirname(dirname(dir())), "settings.yaml");
    writeFileSync(settings, "# operator\nsheet:\n  approval: auto\n");
    expect(sheetApprovalPolicy(dir())).toEqual({ approval: "auto", from: settings });
    expect(await refused()).toBe("review-missing");
    const read = recordSheetReading(dir(), { episodeRef: REF }, { problems: [] });
    expect(read.decision).toBe("approved");
    expect(JSON.parse(readFileSync(at("artifacts/layout-sheet/review.json"), "utf-8"))).toMatchObject({ origin: "policy", actor: "pi", decision: "approved" });
    // never signed: the key does not make it fail
    await renderEpisode(dir(), { episodeRef: REF, operatorKey: KEY });
    expect(rendered).toBe(1);
    // the setting withdrawn, the reading counts for nothing
    writeFileSync(settings, "sheet:\n  approval: review\n");
    const error = (await renderEpisode(dir(), { episodeRef: REF }).catch((e: unknown) => e)) as SheetReviewError;
    expect(error.problems[0]!.code).toBe("review-invalid");
    expect(rendered).toBe(1);
  });

  it("stops on what the agent found, and on a sheet it did not read as it is now", async () => {
    writeFileSync(join(dirname(dirname(dir())), "settings.yaml"), "sheet:\n  approval: auto\n");
    expect(() => recordSheetReading(dir(), { episodeRef: REF }, { problems: [] })).toThrow(SheetReviewError);
    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(recordSheetReading(dir(), { episodeRef: REF }, { problems: ["  ", "the title covers a face"] }).decision).toBe("rejected");
    const error = (await renderEpisode(dir(), { episodeRef: REF }).catch((e: unknown) => e)) as SheetReviewError;
    expect(error.problems[0]).toMatchObject({ code: "review-rejected", message: expect.stringContaining("the title covers a face") });
    recordSheetReading(dir(), { episodeRef: REF }, { problems: [] });
    editSpec(dir(), (spec) => { spec.data.title = `${spec.data.title} (revised)`; spec.revision += 1; });
    expect(() => recordSheetReading(dir(), { episodeRef: REF }, { problems: [] })).toThrow(/no longer pictures/);
    expect(await refused()).toBe("sheet-stale");
  });

  it("reads the channel's setting under the series', and never the episode's own", () => {
    const series = dirname(dirname(dir())), channel = dirname(dirname(series));
    writeFileSync(join(dir(), "settings.yaml"), "sheet:\n  approval: auto\n");
    expect(sheetApprovalPolicy(dir()).approval).toBe("review");
    writeFileSync(join(channel, "settings.yaml"), "sheet:\n  approval: auto\n");
    expect(sheetApprovalPolicy(dir())).toEqual({ approval: "auto", from: join(channel, "settings.yaml") });
    writeFileSync(join(series, "settings.yaml"), "sheet:\n  approval: review\n");
    expect(sheetApprovalPolicy(dir()).approval).toBe("review");
    // An absent declaration inherits; a broken or invalid one must not
    // accidentally waive the operator's review through the channel.
    writeFileSync(join(series, "settings.yaml"), "{}\n");
    expect(sheetApprovalPolicy(dir()).approval).toBe("auto");
    for (const settings of ["sheet: [unclosed\n", "sheet:\n  approval: typo\n", "sheet: null\n", "sheet:\n  approval: null\n"]) {
      writeFileSync(join(series, "settings.yaml"), settings);
      expect(sheetApprovalPolicy(dir())).toEqual({ approval: "review", from: join(series, "settings.yaml") });
    }
  });

  it("stops accepting an agent review when series settings become invalid, even under channel auto", async () => {
    const series = dirname(dirname(dir())), channel = dirname(dirname(series));
    writeFileSync(join(channel, "settings.yaml"), "sheet:\n  approval: auto\n");
    await makeLayoutSheet(dir(), { episodeRef: REF });
    recordSheetReading(dir(), { episodeRef: REF }, { problems: [] });
    writeFileSync(join(series, "settings.yaml"), "sheet: [unclosed\n");
    expect(await refused()).toBe("review-invalid");
    expect(() => recordSheetReading(dir(), { episodeRef: REF }, { problems: [] })).toThrow(/operator's review/);
  });

  it("refuses a review that is not JSON, and, with the key, one with no signature or a changed note", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/review.json"), "{ not json");
    expect(await refused()).toBe("review-invalid");
    const review = approveSheet(dir(), REF, KEY) as Record<string, unknown>;
    const { signature: _drop, ...unsigned } = review;
    writeFileSync(at("artifacts/layout-sheet/review.json"), JSON.stringify(unsigned));
    expect(await refused({ operatorKey: KEY })).toBe("review-invalid");
    writeFileSync(at("artifacts/layout-sheet/review.json"), JSON.stringify({ ...review, note: "added later" }));
    expect(await refused({ operatorKey: KEY })).toBe("review-invalid");
  });

  it("refuses another episode's review", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), { ...REF, episode: "evening" }, KEY);
    expect(await refused()).toBe("review-invalid");
  });

  it("does not gate an episode without a spec", () => {
    const legacy = join(root, "legacy");
    mkdirSync(legacy, { recursive: true });
    expect(() => requireSheetReview(legacy, { episodeRef: REF }, null as never, null)).not.toThrow();
  });

  it("with the key, refuses a review whose signature does not verify", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    approveSheet(dir(), REF, "someone-else's-key");
    expect(await refused({ operatorKey: KEY })).toBe("review-invalid");
  });
});
