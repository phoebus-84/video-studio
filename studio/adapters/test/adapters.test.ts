// Each adapter's work, asserted on the artifact it writes rather than on the
// call. These moved with the code from the gateway's dispatcher tests.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STUDIO_ADAPTERS } from "../src/index.js";
import type { StageAdapter } from "../src/index.js";
import { REF, cleanEpisodes, episodeDir, wav } from "./helpers.js";

afterEach(cleanEpisodes);

function byId(id: string): StageAdapter {
  const adapter = STUDIO_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`no adapter "${id}"`);
  return adapter;
}

const ctx = (episodeDir: string) => ({ episodeDir, ref: REF, log: () => {} });

describe("illustrations-from-assets", () => {
  it("places the images already in assets/images where the illustrations contract says", async () => {
    const dir = await episodeDir();
    await writeFile(join(dir, "assets", "images", "s1.png"), "image bytes");

    const outputs = await byId("illustrations-from-assets").perform(ctx(dir));

    expect(outputs).toEqual([join(dir, "artifacts", "frames", "s1.png")]);
    expect(await readFile(outputs[0]!, "utf-8")).toBe("image bytes");
  });
});

describe("narration-captions and narration-timing", () => {
  async function narrated() {
    const dir = await episodeDir();
    await writeFile(join(dir, "artifacts", "narration", "s1.wav"), wav(1));
    await writeFile(join(dir, "artifacts", "narration", "s2.wav"), wav(0.5));
    await writeFile(join(dir, "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
      entries: [
        { segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 9 }, pauseAfterMs: 250 },
        { segmentId: "s2", wav: { path: "artifacts/narration/s2.wav", durationSeconds: 9 } },
      ],
      captions: [{ segmentId: "s1", text: "Once upon a time" }, { segmentId: "s2", text: "The end" }],
    }));
    return dir;
  }

  it("times captions from the measured WAVs, in manifest order", async () => {
    const dir = await narrated();

    const [file] = await byId("narration-captions").perform(ctx(dir));

    // Measured, not the manifest's recorded 9s: the WAV header is the truth.
    expect(await readFile(file!, "utf-8")).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nOnce upon a time\n\n" +
      "2\n00:00:01,250 --> 00:00:01,750\nThe end\n\n",
    );
  });

  it("derives timing.json from the same segments", async () => {
    const dir = await narrated();

    const [file] = await byId("narration-timing").perform(ctx(dir));
    const timing = JSON.parse(await readFile(file!, "utf-8"));

    expect(timing.source).toBe("narration-manifest");
    expect(timing.totalDurationSec).toBeCloseTo(1.75);
    expect(timing.segments.map((segment: { id: string; startSec: number }) => [segment.id, segment.startSec]))
      .toEqual([["s1", 0], ["s2", 1.25]]);
  });
});

describe("render-qa", () => {
  it("fails, naming what is missing, when there is no render to check", async () => {
    // A report that cannot name what it examined is not a QA report.
    const dir = await episodeDir();

    const [file] = await byId("render-qa").perform(ctx(dir));
    const report = JSON.parse(await readFile(file!, "utf-8"));

    expect(report.verdict).toBe("fail");
    expect(report.summary).toMatch(/No render found/);
    expect(report.checks).toEqual([]);
  });

  it("does not take a render still being written for one", async () => {
    // pva_compose_video writes output/.<render-id>.partial.mp4 and renames it
    // only when complete (ADR-0036); a QA run meanwhile must not examine it.
    const dir = await episodeDir();
    await mkdir(join(dir, "output"), { recursive: true });
    await writeFile(join(dir, "output", ".render-1-abcdef12.partial.mp4"), "half a video");

    const [file] = await byId("render-qa").perform(ctx(dir));
    const report = JSON.parse(await readFile(file!, "utf-8"));

    expect(report.verdict).toBe("fail");
    expect(report.summary).toMatch(/No render found/);
  });
});
