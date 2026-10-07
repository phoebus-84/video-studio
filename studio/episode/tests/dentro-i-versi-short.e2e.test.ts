import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderEpisode } from "../src/episode-render.js";
import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
import { divShortEpisode } from "../src/testing.js";

/**
 * The dentro-i-versi-short golden episode (avg-dcf.3), rendered for real
 * through Remotion with every museum kit: its layout sheet, then the video.
 * Slow (the video takes about half an hour), and it needs headless Chrome and ffmpeg. Only with
 * REMOTION_E2E=1, against @av/remotion-composer's and @studio/series's dist/
 * (build them first).
 */

const enabled = process.env.REMOTION_E2E === "1";
const REF = { channel: "dentro-i-versi", series: "short", episode: "san-martino" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

beforeAll(() => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), "div-short-e2e-"));
  let i = 0;
  divShortEpisode(dir(), REF, {
    image: (path, id) => id === "nebbia-texture"
      ? ff("-f", "lavfi", "-i", "nullsrc=s=256x256,geq=lum='128+60*sin(X/9)*cos(Y/13)':cb=128:cr=128,format=rgba,colorchannelmixer=aa=0.6", "-frames:v", "1", path)
      : ff("-f", "lavfi", "-i", `color=c=0x${(0x305080 + 0x101010 * i++).toString(16)}:s=${id.includes("sagoma") ? "360x480" : "1024x1536"}`, "-frames:v", "1", path),
    sound: (path) => ff("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "8", path),
    audio: (path, _take, seconds) => ff("-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ar", "48000", path),
  });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe.skipIf(!enabled)("the dentro-i-versi-short golden episode, rendered", () => {
  it("makes its layout sheet at the teleports and every verse; the sheet is then current", async () => {
    const { report, sheetPath } = await makeLayoutSheet(dir(), { episodeRef: REF });
    const labels = report.frames.map((f) => f.label ?? "").join(" ");
    expect(labels).toContain("start+0.85s");
    expect(labels).toContain("end-0.7s");
    for (let n = 1; n <= 8; n++) expect(labels).toContain(`verse-${n}`);
    expect(readdirSync(join(dir(), "artifacts/layout-sheet/frames"))).toHaveLength(report.frames.length);
    expect(existsSync(sheetPath)).toBe(true);
    expect(layoutSheetStatus(dir(), { episodeRef: REF }).state).toBe("current");
  }, 300_000);

  it("renders the whole video: 1129 frames, 1080x1920", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF, label: "e2e" });
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets", "-of", "json", render.outputPath]).toString());
    expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920, nb_read_packets: "1129" });
    expect(JSON.parse(readFileSync(join(dir(), "output", `${render.renderId}.timeline.json`), "utf-8")).durationInFrames).toBe(1129);
  }, 3_600_000);
});
