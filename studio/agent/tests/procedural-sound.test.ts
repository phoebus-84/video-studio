import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SECONDS, SAMPLE_RATE, SOUND_KINDS, synthesizeSound } from "../src/procedural-sound.js";

/**
 * Sounds at $0 (avg-jur): ambiences, effects, applause and a music bed made
 * here from seeded noise and oscillators, written to assets/sounds with a
 * receipt by pva_synthesize_sound.
 */

/** The samples of a 16-bit mono WAV, -1..1. */
function samples(wav: Buffer): Float64Array {
  const out = new Float64Array((wav.length - 44) / 2);
  for (let i = 0; i < out.length; i++) out[i] = wav.readInt16LE(44 + i * 2) / 32767;
  return out;
}
const peak = (s: Float64Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (s: Float64Array) => Math.sqrt(s.reduce((m, v) => m + v * v, 0) / s.length);

describe("synthesizeSound", () => {
  it("makes every kind: a 48 kHz mono WAV of the asked length, peaking at the asked gain", () => {
    for (const kind of SOUND_KINDS) {
      const wav = synthesizeSound({ kind, durationSeconds: 3, seed: "test", gain: 0.5 });
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
      expect(wav.readUInt16LE(22)).toBe(1);
      const s = samples(wav);
      expect(s.length).toBe(3 * SAMPLE_RATE);
      expect(peak(s), kind).toBeCloseTo(0.5, 2);
      expect(rms(s), kind).toBeGreaterThan(0.005);
      // 5 ms fades: nothing clicks at either end.
      expect(Math.abs(s[0]!)).toBeLessThan(0.01);
      expect(Math.abs(s[s.length - 1]!)).toBeLessThan(0.01);
    }
  });

  it("gives the same bytes for the same request, and different ones for another seed or kind", () => {
    const a = synthesizeSound({ kind: "rain", durationSeconds: 1, seed: "x" });
    expect(synthesizeSound({ kind: "rain", durationSeconds: 1, seed: "x" }).equals(a)).toBe(true);
    expect(synthesizeSound({ kind: "rain", durationSeconds: 1, seed: "y" }).equals(a)).toBe(false);
    expect(synthesizeSound({ kind: "wind", durationSeconds: 1, seed: "x" }).equals(a)).toBe(false);
  });

  it("plays the music bed in the asked key", () => {
    const d = synthesizeSound({ kind: "music-bed", durationSeconds: 4, seed: "k", key: "D", mode: "minor" });
    const a = synthesizeSound({ kind: "music-bed", durationSeconds: 4, seed: "k", key: "A", mode: "minor" });
    expect(d.equals(a)).toBe(false);
  });

  it("refuses an unknown kind, a duration out of range, a bad gain or key", () => {
    expect(() => synthesizeSound({ kind: "laser" as never, durationSeconds: 1, seed: "s" })).toThrow(/unknown sound kind/);
    expect(() => synthesizeSound({ kind: "wind", durationSeconds: 0.1, seed: "s" })).toThrow(/durationSeconds/);
    expect(() => synthesizeSound({ kind: "wind", durationSeconds: MAX_SECONDS + 1, seed: "s" })).toThrow(/durationSeconds/);
    expect(() => synthesizeSound({ kind: "wind", durationSeconds: 1, seed: "s", gain: 1.5 })).toThrow(/gain/);
    expect(() => synthesizeSound({ kind: "music-bed", durationSeconds: 1, seed: "s", key: "H" as never })).toThrow(/key/);
  });

  it("makes a one-minute shimmer, its slowest kind, in reasonable time", () => {
    const started = Date.now();
    synthesizeSound({ kind: "shimmer", durationSeconds: 60, seed: "long" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("pva_synthesize_sound", () => {
  const REF = { channel: "sample", series: "poetry", episode: "morning" };
  let root: string;
  let saved: string | undefined;
  const sounds = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode, "assets", "sounds");
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-sound-"));
    saved = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
  });
  async function tool(params: Record<string, unknown>) {
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const tools = new Map<string, { description: string; execute: (...a: unknown[]) => Promise<any> }>();
    registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
    return tools.get("pva_synthesize_sound")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
  }

  it("writes the sound to assets/sounds with a receipt beside it", async () => {
    const result = await tool({ soundId: "sm-sea", kind: "sea", durationSeconds: 2, gain: 0.4 });
    expect(result.isError).toBeFalsy();
    const wav = readFileSync(join(sounds(), "sm-sea.wav"));
    const receipt = JSON.parse(readFileSync(join(sounds(), "sm-sea.sound.json"), "utf-8"));
    expect(receipt).toMatchObject({
      generator: "studio-procedural-sound@1", kind: "sea", durationSeconds: 2, gain: 0.4,
      seed: "sample/poetry/morning/sm-sea", wav: "assets/sounds/sm-sea.wav",
      wavSha256: createHash("sha256").update(wav).digest("hex"),
    });
    expect(result.content[0].text).toContain("assets/sounds/sm-sea.wav");
  });

  it("refuses a sound id that is not a plain name, and writes nothing", async () => {
    const result = await tool({ soundId: "../x", kind: "sea", durationSeconds: 1 });
    expect(result.isError).toBe(true);
    expect(existsSync(sounds())).toBe(false);
  });
});
