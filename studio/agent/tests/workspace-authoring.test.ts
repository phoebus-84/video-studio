import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChannelWorkspace,
  createEpisodeWorkspace,
  createSeriesWorkspace,
} from "../src/workspace-authoring.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pva-authoring-"));
  roots.push(value);
  return value;
}

describe("workspace authoring", () => {
  it("creates a discoverable channel, series, and canonical episode layout", async () => {
    const libraryRoot = await root();
    const channel = await createChannelWorkspace({
      slug: "wordless-comedy",
      title: "Wordless Comedy",
      description: "Family-safe dialogue-free shorts.",
      pipelineYaml: "pipeline: wordless-rigged-short",
    }, libraryRoot);
    const series = await createSeriesWorkspace({
      channel: "wordless-comedy",
      slug: "give-me-time",
      title: "Give Me Time",
      description: "A woodworm challenges an unflappable walnut.",
      pipelineYaml: "pipeline: wordless-rigged-short",
    }, libraryRoot);
    const episode = await createEpisodeWorkspace({
      channel: "wordless-comedy",
      series: "give-me-time",
      slug: "the-run-up",
      title: "The Run-Up",
      description: "Pipeline validation pilot.",
      episodeRequest: "# Episode Request\n\nValidate the series pipeline.",
    }, libraryRoot);

    expect(channel.createdFiles).toContain("wordless-comedy/channel.json");
    expect(series.createdFiles).toContain("wordless-comedy/give-me-time/series.json");
    expect(episode.createdFiles).toContain("wordless-comedy/give-me-time/the-run-up/artifacts/episode-request.md");
    expect(channel.createdFiles).toContain("wordless-comedy/.workspace/contract.json");
    expect(series.createdFiles).toContain("wordless-comedy/give-me-time/visual-bible.md");
    expect(episode.createdFiles).toContain("wordless-comedy/give-me-time/the-run-up/output/current.json");
    const metadata = JSON.parse(await readFile(join(libraryRoot, "wordless-comedy/give-me-time/the-run-up/artifacts/episode.json"), "utf-8"));
    const contract = JSON.parse(await readFile(join(libraryRoot, "wordless-comedy/give-me-time/the-run-up/.workspace/contract.json"), "utf-8"));
    expect(metadata.scenes).toEqual([]);
    expect(contract.type).toBe("episode");
  });

  it("is idempotent and never overwrites metadata", async () => {
    const libraryRoot = await root();
    const input = {
      slug: "wordless-comedy",
      title: "Wordless Comedy",
      description: "Original description.",
    };
    await createChannelWorkspace(input, libraryRoot);
    const second = await createChannelWorkspace({ ...input, description: "Replacement description." }, libraryRoot);
    expect(second.createdFiles).toEqual([]);
    expect(second.existingFiles).toContain("wordless-comedy/channel.json");
    const metadata = JSON.parse(await readFile(join(libraryRoot, "wordless-comedy/channel.json"), "utf-8"));
    expect(metadata.description).toBe("Original description.");
  });

  it("rejects traversal and requires parents", async () => {
    const libraryRoot = await root();
    await expect(createChannelWorkspace({
      slug: "../escape",
      title: "Escape",
      description: "Invalid.",
    }, libraryRoot)).rejects.toThrow(/kebab-case/);
    await expect(createSeriesWorkspace({
      channel: "missing",
      slug: "series",
      title: "Series",
      description: "Missing parent.",
    }, libraryRoot)).rejects.toThrow(/Channel does not exist/);
  });
});
