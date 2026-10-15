import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAudioTools } from "../src/audio-tools.js";

/** Pi's audio tools (avg-8hs.5), in a channel source: a bed under a tone, mastered, then analysed. */

let root: string;
const previous = process.env.AVG_LIBRARY_ROOT;
const src = () => join(root, "poesia", "sources", "lampo");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "audio-tools-"));
  mkdirSync(join(src(), "assets", "sounds"), { recursive: true });
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t):s=48000:d=2", join(src(), "assets/sounds/tone.wav")]);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=48000:duration=4:seed=3", "-af", "volume=-20dB", join(src(), "assets/sounds/bed.wav")]);
  process.env.AVG_LIBRARY_ROOT = root;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AVG_LIBRARY_ROOT; else process.env.AVG_LIBRARY_ROOT = previous;
});

function tools() {
  const registered = new Map<string, any>();
  registerAudioTools({ registerTool: (t: { name: string }) => registered.set(t.name, t) } as never);
  return (name: string, params: Record<string, unknown>) => registered.get(name)!.execute("call", params);
}

describe("audio tools", () => {
  it("renders a recipe in a source, with its record and peaks, and analyses the result", async () => {
    const run = tools();
    const made = await run("pva_edit_audio", { channel: "poesia", source: "lampo", recipe: {
      output: { path: "assets/sounds/mix.wav" },
      tracks: [
        { id: "voice", clips: [{ id: "t", source: { path: "assets/sounds/tone.wav" }, at: 1 }] },
        { id: "bed", gain: -6, duck: { under: "voice", gain: -10 }, clips: [{ id: "b", source: { path: "assets/sounds/bed.wav" }, at: 0, fadeIn: 0.5, fadeOut: 0.5 }] },
      ],
      master: { loudness: -18, truePeak: -1 },
    } });
    expect(made.isError, made.content[0].text).toBeUndefined();
    expect(made.content[0].text).toMatch(/assets\/sounds\/mix\.wav: 4\.00 s, -18\.\d LUFS/);
    expect(existsSync(join(src(), "assets/sounds/mix.wav.edit.json"))).toBe(true);
    expect(existsSync(join(src(), "assets/sounds/mix.wav.peaks.json"))).toBe(true);
    const analysed = await run("pva_analyze_audio", { channel: "poesia", source: "lampo", path: "assets/sounds/mix.wav" });
    expect(analysed.content[0].text).toMatch(/4\.00 s; -18\.\d LUFS/);
  });

  it("refuses a recipe that writes outside the workspace's audio folders", async () => {
    const run = tools();
    const refused = await run("pva_edit_audio", { channel: "poesia", source: "lampo", recipe: { output: { path: "../escape.wav" }, tracks: [{ id: "t", clips: [{ id: "a", source: { path: "assets/sounds/tone.wav" }, at: 0 }] }] } });
    expect([refused.isError, refused.content[0].text]).toEqual([true, expect.stringContaining("bad-recipe")]);
  });
});
