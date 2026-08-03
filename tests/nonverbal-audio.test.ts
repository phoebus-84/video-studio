import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesizeNonverbalBuzz } from "../src/nonverbal-audio.js";

const outputs: string[] = [];
afterEach(async () => {
  await Promise.all(outputs.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("nonverbal audio", () => {
  it("writes deterministic canonical PCM WAV cues", async () => {
    const root = await mkdtemp(join(tmpdir(), "pva-buzz-"));
    outputs.push(root);
    const first = join(root, "first.wav");
    const second = join(root, "second.wav");
    const a = await synthesizeNonverbalBuzz({
      emotion: "idea",
      durationSeconds: 0.25,
      outputPath: first,
      seed: "same",
    });
    await synthesizeNonverbalBuzz({
      emotion: "idea",
      durationSeconds: 0.25,
      outputPath: second,
      seed: "same",
    });
    const firstBytes = await readFile(first);
    const secondBytes = await readFile(second);
    expect(firstBytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(firstBytes.subarray(8, 12).toString()).toBe("WAVE");
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(a.sampleRate).toBe(48_000);
  });

  it("rejects cues outside the bounded duration", async () => {
    await expect(synthesizeNonverbalBuzz({
      emotion: "defeat",
      durationSeconds: 9,
      outputPath: "/tmp/should-not-write.wav",
    })).rejects.toThrow(/0.1 to 8/);
  });
});
