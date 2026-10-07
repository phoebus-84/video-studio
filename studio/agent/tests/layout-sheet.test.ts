import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_layout_sheet (avg-3th.1): Pi makes the episode's layout sheet and is
 * told where to open it. The rendering is a fake, as in compose-spec.test.ts:
 * @av/remotion-composer and @studio/episode render for real in their tests.
 */

const sheets: string[] = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
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
        sheet: { path, hash: `sha256:${createHash("sha256").update("sheet").digest("hex")}`, columns: 8, rows: 3, width: 2160, height: 1560 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-layout-sheet-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  sheets.length = 0;
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

describe("pva_layout_sheet", () => {
  it("makes the sheet and says where to open it", async () => {
    const result = await tool("pva_layout_sheet");
    expect(result.isError).toBeFalsy();
    const text: string = result.content[0].text;
    expect(text).toMatch(/^✅ layout sheet: 24 frames, 8×3, rules poetry-short@1\.0\.0/);
    expect(text).toContain(`open it: ${at("artifacts/layout-sheet/sheet.jpg")}`);
    expect(text).toMatch(/inputs sha256:[0-9a-f]{64}/);
    expect(text).toMatch(/it shows the timeline a render would recompile first: there was no timeline yet/);
    expect(existsSync(at("artifacts/layout-sheet/sheet.json"))).toBe(true);
  });

  it("refuses a timeline that breaks the series' rules, with the findings", async () => {
    await tool("pva_build_timeline");
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    const result = await tool("pva_layout_sheet");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ series-rules: the series rules \(poetry-short@1\.0\.0\) refuse this timeline: the layout sheet shows only/);
    expect(result.content[0].text).toMatch(/text-not-voice at artifacts\/edit-timeline\.json#\$\.tracks\[1\]/);
    expect(result.details.code).toBe("series-rules");
    expect(sheets).toHaveLength(0);
  });
});
