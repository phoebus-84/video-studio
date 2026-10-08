import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
import { divLongEpisode } from "../src/testing.js";

/**
 * The dentro-i-versi-long golden episode (avg-dcf.6.3) drawn for real
 * through Remotion with every lesson kit: its layout sheet — every block's
 * start and middle, every chapter card. Slow, and it needs headless Chrome
 * and ffmpeg. Only with REMOTION_E2E=1, against @av/remotion-composer's and
 * @studio/series's dist/ (build them first). The full 6½-minute render is
 * avg-dcf.6.5's.
 */

const enabled = process.env.REMOTION_E2E === "1";
let root: string;
let episode: Awaited<ReturnType<typeof divLongEpisode>>;
const LIBRARY_PAINTINGS = join(import.meta.dirname, "..", "..", "..", "library", "dentro-i-versi", "series", "short", "episodes", "il-lampo", "assets", "images");
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

beforeAll(async () => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), "div-long-e2e-"));
  let i = 0;
  episode = await divLongEpisode(root, {
    // Il lampo's paintings from the channel library when there (the source Pi made), else plain colours.
    image: (path, name) => existsSync(join(LIBRARY_PAINTINGS, `${name}.png`)) ? copyFileSync(join(LIBRARY_PAINTINGS, `${name}.png`), path) : ff("-f", "lavfi", "-i", `color=c=0x${(0x304870 + 0x0c0a08 * i++).toString(16)}:s=${name.startsWith("lampo-") ? "1536x2048" : name.startsWith("ic-") ? "256x256" : "1600x1200"}`, "-frames:v", "1", path),
    audio: (path, _take, seconds) => ff("-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ar", "48000", path),
  });
});
// KEEP=1 leaves the episode (and its sheet) to look at.
afterAll(() => { if (root && process.env.KEEP !== "1") rmSync(root, { recursive: true, force: true }); else if (root) console.log(`kept ${root}`); });

describe.skipIf(!enabled)("the dentro-i-versi-long golden episode, drawn", () => {
  it("makes its layout sheet at every block and chapter; the sheet is then current", async () => {
    const { episodeDir, episodeRef } = episode;
    const { report, sheetPath } = await makeLayoutSheet(episodeDir, { episodeRef });
    const labels = report.frames.map((f) => f.label ?? "").join(" ");
    for (const block of ["portale", "epoca", "scheda", "reperto1", "reperto5", "metrica", "invito", "ripasso", "uscita"]) expect(labels).toContain(`block-${block}`);
    expect(labels).toContain("chapter-1");
    expect(readdirSync(join(episodeDir, "artifacts/layout-sheet/frames"))).toHaveLength(report.frames.length);
    expect(existsSync(sheetPath)).toBe(true);
    expect(layoutSheetStatus(episodeDir, { episodeRef }).state).toBe("current");
  }, 900_000);
});
