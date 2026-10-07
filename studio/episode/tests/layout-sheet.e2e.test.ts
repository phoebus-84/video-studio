import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
import { specEpisode } from "../src/testing.js";

/**
 * One real layout sheet of a poetry-short episode (avg-3th.1), through
 * Remotion: slow, and it needs headless Chrome and ffmpeg. Only with
 * REMOTION_E2E=1, against @av/remotion-composer's dist/ (build it first).
 */

const enabled = process.env.REMOTION_E2E === "1";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

const COLORS = ["0x2e7d32", "0x6a1b9a", "0xef6c00", "0x1565c0"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "layout-sheet-e2e-"));
  let i = 0;
  specEpisode(dir(), REF, {
    image: (path) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${COLORS[i++ % COLORS.length]}:s=1080x1920`, "-frames:v", "1", path]),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!enabled)("makeLayoutSheet, rendered", () => {
  it("renders every pick of the poetry-short episode and a grid of them; the sheet is then current", async () => {
    const made = await makeLayoutSheet(dir(), { episodeRef: REF });
    const { report } = made;
    expect(report.frames.length).toBeGreaterThanOrEqual(20);
    expect(readdirSync(join(dir(), "artifacts/layout-sheet/frames"))).toHaveLength(report.frames.length);
    // 1080x1920 at 0.25, eight columns.
    expect(report.sheet).toMatchObject({ columns: 8, width: 8 * 270, rows: Math.ceil(report.frames.length / 8) });
    expect(existsSync(made.sheetPath)).toBe(true);
    expect(layoutSheetStatus(dir(), { episodeRef: REF }).state).toBe("current");
  }, 300_000);
});
