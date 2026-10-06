import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * A spec-driven episode rendered for real (avg-jao.2): poetry-short@1.0.0
 * compiles the fixture's spec, Remotion renders it, loudness is normalised.
 * Only with REMOTION_E2E=1, as compose-video.e2e.test.ts.
 */

const enabled = process.env.REMOTION_E2E === "1";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
const COLOURS: Record<string, string> = { "morning-room": "0x600000", teacup: "0x006000", cat: "0x000060" };

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

describe.skipIf(!enabled)("composing a spec-driven episode", () => {
  let root: string;
  let previousRoot: string | undefined;
  const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-compose-spec-e2e-"));
    previousRoot = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
    specEpisode(dir(), REF, {
      image: (path, assetId) => ffmpeg(["-f", "lavfi", "-i", `color=c=${COLOURS[assetId]}:s=720x1280`, "-frames:v", "1", path]),
      audio: (path, _take, seconds) => ffmpeg(["-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`, "-af", "volume=0.3",
        "-ar", "48000", "-ac", "1", path]),
    });
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  const probe = (file: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf-8" }).stdout);

  /** The dominant channel of the top half of the frame shown at `seconds`. */
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

  it("renders 1080x1920 at -14 LUFS, pictures on their cues, captions while the voice speaks", async () => {
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
    registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
    const result = await tools.get("pva_compose_video")!.execute("call-1", { ...REF }, undefined, undefined, undefined);
    if (result.isError) throw new Error(result.content[0].text);
    const current = JSON.parse(readFileSync(join(dir(), "output", "current.json"), "utf-8"));
    const out = join(dir(), "output", current.path);

    const video = probe(out).streams.find((s: any) => s.codec_type === "video");
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(Number(video.nb_frames)).toBe(324);
    // "cup" at frame 97, "cat" at frame 205; the last panel holds to the end.
    expect([channelAt(out, 1), channelAt(out, 5), channelAt(out, 9), channelAt(out, 10.6)]).toEqual(["r", "g", "b", "b"]);
    // A caption from 0.1 s to 2.4 s; none in the 1.5 s hold at the end.
    expect(bottomBrightness(out, 1.5)).toBeGreaterThan(200);
    expect(bottomBrightness(out, 10.5)).toBeLessThan(100);
    expect(Math.abs(loudness(out) + 14)).toBeLessThanOrEqual(1);
  });
}, 300_000);
