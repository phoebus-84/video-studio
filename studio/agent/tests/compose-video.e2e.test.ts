import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real episode rendered through pva_compose_video: timeline built from disk,
 * rendered by Remotion, loudness normalised (avg-tk7.6). Slow, and needs
 * headless Chrome (Remotion downloads it the first time) and a built
 * @av/remotion-composer: only with REMOTION_E2E=1.
 *
 * The checks the FFmpeg composer's tests made — scenes in reading order, each
 * for its own length, nothing cut off — are kept here against the new path.
 */

const enabled = process.env.REMOTION_E2E === "1";
const CHANNEL = "video-storici";
const SERIES = "roma-pills";
const EPISODE = "giulio-cesare";

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

describe.skipIf(!enabled)("composing a real episode", () => {
  let root: string;
  let previousRoot: string | undefined;
  const dir = () => join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-compose-e2e-"));
    previousRoot = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
    // Three dark scenes (red, green, blue) for 1 s each, s10 last: a
    // lexicographic sort would play it second.
    mkdirSync(join(dir(), "assets", "images"), { recursive: true });
    for (const [id, colour] of [["s1", "0x600000"], ["s2", "0x006000"], ["s10", "0x000060"]]) {
      ffmpeg(["-f", "lavfi", "-i", `color=c=${colour}:s=1280x720`, "-frames:v", "1", join(dir(), "assets", "images", `${id}.png`)]);
    }
    mkdirSync(join(dir(), "artifacts", "narration"), { recursive: true });
    writeFileSync(join(dir(), "artifacts", "timing.json"), JSON.stringify({
      scenes: ["s1", "s2", "s10"].map((sceneId) => ({ sceneId, durationSeconds: 1 })),
    }));
    // 3.5 s of narration: the last scene must hold to its end, not be cut.
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=3.5", "-af", "volume=0.3", "-ar", "48000", "-ac", "1",
      join(dir(), "artifacts", "narration", "final.wav")]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=3.5", "-ar", "48000", "-ac", "1",
      join(dir(), "artifacts", "narration", "s1.wav")]);
    writeFileSync(join(dir(), "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 3.5 }, pauseAfterMs: 0 }],
      finalWav: { path: "artifacts/narration/final.wav", durationSeconds: 3.5 },
      captions: [{ segmentId: "s1", index: 1, startSeconds: 2, endSeconds: 3.5, text: "Veni, vidi, vici" }],
    }));
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  async function compose(params: Record<string, unknown> = {}) {
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
    registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
    const result = await tools.get("pva_compose_video")!.execute(
      "call-1", { channel: CHANNEL, series: SERIES, episode: EPISODE, ...params }, undefined, undefined, undefined,
    );
    if (result.isError) throw new Error(result.content[0].text);
    const current = JSON.parse(readFileSync(join(dir(), "output", "current.json"), "utf-8"));
    return join(dir(), "output", current.path);
  }

  const probe = (file: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf-8" }).stdout);

  /** The dominant channel of the frame shown at `seconds`. */
  function channelAt(file: string, seconds: number): "r" | "g" | "b" {
    const out = spawnSync("ffmpeg", ["-v", "quiet", "-ss", String(seconds), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw:ih/2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" }).stdout;
    const [r, g, b] = out;
    if (r! >= g! && r! >= b!) return "r";
    return g! >= b! ? "g" : "b";
  }

  /** The brightest luma in the bottom third of the frame at `seconds` (white caption text is near 235). */
  function bottomBrightness(file: string, seconds: number): number {
    const out = spawnSync("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw:ih/3:0:2*ih/3,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf-8" }).stdout;
    return Number(/lavfi\.signalstats\.YMAX=(\d+)/.exec(out)?.[1]);
  }

  function loudness(file: string): number {
    const err = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf-8" }).stderr;
    return Number(JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1)).input_i);
  }

  it("renders 16:9 in reading order, holds the last scene to the end of the narration, captions it, at -15 LUFS", async () => {
    const out = await compose();
    const video = probe(out).streams.find((s: any) => s.codec_type === "video");
    expect([video.width, video.height]).toEqual([1920, 1080]);
    // 3.5 s of narration at 30 fps: 105 frames (the container runs a little
    // longer because AAC pads its last packet).
    expect(Number(video.nb_frames)).toBe(105);
    expect([channelAt(out, 0.4), channelAt(out, 1.5), channelAt(out, 2.6), channelAt(out, 3.3)]).toEqual(["r", "g", "b", "b"]);
    expect(bottomBrightness(out, 0.5)).toBeLessThan(100);
    expect(bottomBrightness(out, 3)).toBeGreaterThan(200);
    expect(Math.abs(loudness(out) + 15)).toBeLessThanOrEqual(1);
  });

  it("renders 9:16 at 1080x1920 and -14 LUFS", async () => {
    const out = await compose({ profile: "vertical-1080x1920" });
    const video = probe(out).streams.find((s: any) => s.codec_type === "video");
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(Math.abs(loudness(out) + 14)).toBeLessThanOrEqual(1);
  });
}, 300_000);
