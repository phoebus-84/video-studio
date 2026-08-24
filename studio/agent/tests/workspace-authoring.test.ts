import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Create channel → series → episode with fixed slugs, the common setup. */
async function seedTree(libraryRoot: string) {
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
  return { channel, series, episode };
}

const SERIES_DIR = "wordless-comedy/series/give-me-time";
const EPISODE_DIR = `${SERIES_DIR}/episodes/the-run-up`;

describe("workspace authoring", () => {
  it("creates a discoverable channel, series, and canonical episode layout", async () => {
    const libraryRoot = await root();
    const { channel, series, episode } = await seedTree(libraryRoot);

    expect(channel.createdFiles).toContain("wordless-comedy/channel.json");
    expect(channel.createdFiles).toContain("wordless-comedy/.workspace/contract.json");
    expect(series.createdFiles).toContain(`${SERIES_DIR}/series.json`);
    expect(series.createdFiles).toContain(`${SERIES_DIR}/visual-bible.md`);
    expect(episode.createdFiles).toContain(`${EPISODE_DIR}/artifacts/episode-request.md`);
    expect(episode.createdFiles).toContain(`${EPISODE_DIR}/output/current.json`);

    const metadata = JSON.parse(
      await readFile(join(libraryRoot, EPISODE_DIR, "artifacts/episode.json"), "utf-8"),
    );
    const contract = JSON.parse(
      await readFile(join(libraryRoot, EPISODE_DIR, ".workspace/contract.json"), "utf-8"),
    );
    expect(metadata.scenes).toEqual([]);
    expect(contract.type).toBe("episode");
  });

  // The layout-1 paths this module used to write. Discovery scans `series/` and
  // `episodes/`, so a tree authored at these paths is invisible to the studio
  // even though every file is present — which is exactly how a finished episode
  // came to sit on disk while the workspace listed nothing.
  it("does not write series or episodes at the pre-migration paths", async () => {
    const libraryRoot = await root();
    const { series, episode } = await seedTree(libraryRoot);

    expect(series.path).toBe(join(libraryRoot, SERIES_DIR));
    expect(episode.path).toBe(join(libraryRoot, EPISODE_DIR));

    // A series loose in the channel directory, an episode loose in the series.
    expect(await isDirectory(join(libraryRoot, "wordless-comedy/give-me-time"))).toBe(false);
    expect(await isDirectory(join(libraryRoot, `${SERIES_DIR}/the-run-up`))).toBe(false);

    for (const created of [...series.createdFiles, ...episode.createdFiles]) {
      expect(created.startsWith("wordless-comedy/series/")).toBe(true);
    }
  });

  it("creates the containers and knowledge folders the layout declares", async () => {
    const libraryRoot = await root();
    await seedTree(libraryRoot);

    // Channel: its own knowledge, plus the container series live in.
    for (const dir of ["brand", "characters", "references", "skills", "voices", "series"]) {
      expect(await isDirectory(join(libraryRoot, "wordless-comedy", dir))).toBe(true);
    }
    // Series: its own knowledge, plus the container episodes live in.
    for (const dir of ["visual-bible", "skills", "templates", "sources", "pipelines", "voice-profiles", "episodes"]) {
      expect(await isDirectory(join(libraryRoot, SERIES_DIR, dir))).toBe(true);
    }
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

  it("is idempotent for series and episodes too", async () => {
    const libraryRoot = await root();
    await seedTree(libraryRoot);
    const { series, episode } = await seedTree(libraryRoot);
    expect(series.createdFiles).toEqual([]);
    expect(episode.createdFiles).toEqual([]);
    expect(series.existingFiles).toContain(`${SERIES_DIR}/series.json`);
    expect(episode.existingFiles).toContain(`${EPISODE_DIR}/episode.json`);
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

  it("refuses an episode whose series exists only at the pre-migration path", async () => {
    const libraryRoot = await root();
    await createChannelWorkspace({
      slug: "wordless-comedy",
      title: "Wordless Comedy",
      description: "Family-safe dialogue-free shorts.",
    }, libraryRoot);

    // No series was created inside `series/`, so the episode must not be
    // authored — silently creating one is what produced an orphan tree before.
    await expect(createEpisodeWorkspace({
      channel: "wordless-comedy",
      series: "give-me-time",
      slug: "the-run-up",
      title: "The Run-Up",
      description: "Pipeline validation pilot.",
    }, libraryRoot)).rejects.toThrow(/Series does not exist/);
  });
});
