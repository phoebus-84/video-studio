import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemWorkspaceService } from "../src/workspace/filesystem-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileSystemWorkspaceService", () => {
  // Layout 2 puts episodes in `episodes/`, so a support folder sitting beside
  // them can no longer be mistaken for content. This used to require a denylist
  // of names that are not a series.
  it("lists only directories inside episodes/, ignoring support folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const series = join(root, "wordless-comedy", "series", "give-me-time");
    await Promise.all([
      mkdir(join(series, "episodes", "the-run-up", "artifacts"), { recursive: true }),
      mkdir(join(series, "skills", "plan-physical-comedy"), { recursive: true }),
      mkdir(join(series, "pipelines"), { recursive: true }),
      mkdir(join(series, "rigs"), { recursive: true }),
      mkdir(join(series, "shared-assets"), { recursive: true }),
      mkdir(join(series, "sources"), { recursive: true }),
      mkdir(join(series, "templates"), { recursive: true }),
      mkdir(join(series, "voice-profiles"), { recursive: true }),
      mkdir(join(series, ".pipeline"), { recursive: true }),
    ]);

    const workspace = new FileSystemWorkspaceService([root]);
    const summaries = await workspace.listSeries("wordless-comedy");
    const episodes = await workspace.listEpisodes("wordless-comedy", "give-me-time");

    expect(summaries).toEqual([{ slug: "give-me-time", title: "Give Me Time", episodeCount: 1 }]);
    expect(episodes.map((episode) => episode.slug)).toEqual(["the-run-up"]);
  });

  it("resolves pipeline.yaml from the layout-2 series directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const series = join(root, "wordless-comedy", "series", "give-me-time");
    await mkdir(join(series, "episodes", "the-run-up", "artifacts"), { recursive: true });
    await writeFile(join(series, "pipeline.yaml"), "pipeline: wordless-keyframed-h3-short\n");

    const workspace = new FileSystemWorkspaceService([root]);
    const episodes = await workspace.listEpisodes("wordless-comedy", "give-me-time");
    const detail = await workspace.getEpisode("wordless-comedy", "give-me-time", "the-run-up");

    expect(episodes[0]?.pipeline).toBe("wordless-keyframed-h3-short");
    expect(detail?.pipeline).toBe("wordless-keyframed-h3-short");
  });

  it("prefers editorial QA and keeps validation renders in progress", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const episode = join(root, "wordless-comedy", "series", "give-me-time", "episodes", "the-run-up");
    await Promise.all([
      mkdir(join(episode, "artifacts"), { recursive: true }),
      mkdir(join(episode, "output"), { recursive: true }),
    ]);
    await writeFile(join(episode, "artifacts", "episode.json"), JSON.stringify({ scenes: [] }));
    await writeFile(join(episode, "output", "render-1.mp4"), "media");
    await writeFile(join(episode, "output", "current.json"), JSON.stringify({ renderId: "render-1", path: "render-1.mp4" }));
    await writeFile(join(episode, "output", "render-1.report.json"), JSON.stringify({ kind: "composition-report" }));
    await writeFile(join(episode, "artifacts", "qa-report.json"), JSON.stringify({ approved: false, validationApproved: true }));

    const workspace = new FileSystemWorkspaceService([root]);
    const detail = await workspace.getEpisode("wordless-comedy", "give-me-time", "the-run-up") as any;

    // "running" is the canonical EpisodeStatus for work in flight. This
    // asserted "in-progress", which is not a member of that union and which
    // the browser's own EpisodeStatus could never represent.
    expect(detail.status).toBe("running");
    expect(detail.qaReport).toEqual({ approved: false, validationApproved: true });
  });

  // Asset URLs were built with template literals that omitted the `series/`
  // and `episodes/` containers. The static route serves the canonical path, so
  // every image, narration clip and render 404'd — in the browser that reads
  // as "nothing was generated" rather than "the URL is wrong".
  it("addresses assets and renders at their canonical library URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const episode = join(root, "wordless-comedy", "series", "give-me-time", "episodes", "the-run-up");
    await Promise.all([
      mkdir(join(episode, "artifacts", "narration"), { recursive: true }),
      mkdir(join(episode, "assets", "images"), { recursive: true }),
      mkdir(join(episode, "output"), { recursive: true }),
    ]);
    await writeFile(
      join(episode, "artifacts", "episode.json"),
      JSON.stringify({ scenes: [{ id: "s1", durationSeconds: 4 }] }),
    );
    await writeFile(join(episode, "assets", "images", "s1.png"), "png");
    await writeFile(join(episode, "artifacts", "narration", "s1.json"), JSON.stringify({ duration_sec: 4 }));
    await writeFile(join(episode, "artifacts", "narration", "s1.wav"), "wav");
    await writeFile(join(episode, "output", "render-1.mp4"), "media");

    const workspace = new FileSystemWorkspaceService([root]);
    const detail = await workspace.getEpisode("wordless-comedy", "give-me-time", "the-run-up") as any;

    const prefix = "/library/wordless-comedy/series/give-me-time/episodes/the-run-up";
    expect(detail.scenes[0].asset.url).toBe(`${prefix}/assets/images/s1.png`);
    expect(detail.render.url).toBe(`${prefix}/output/render-1.mp4`);

    // The pre-migration shape, which is what the studio was actually requesting.
    const urls = [detail.scenes[0].asset.url, detail.render.url, detail.scenes[0].narration?.url]
      .filter((u): u is string => typeof u === "string");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith(prefix)).toBe(true);
      expect(url).not.toContain("/library/wordless-comedy/give-me-time/");
    }
  });

  // artifacts/episode.json is authored once, empty, and nothing ever wrote
  // scenes back into it. Building the scene list from that file alone meant a
  // finished episode displayed nothing: the enrichment below was right, it just
  // had no scenes to enrich.
  it("shows the scenes of an episode whose episode.json was never written", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const episode = join(root, "wordless-comedy", "series", "give-me-time", "episodes", "the-run-up");
    await Promise.all([
      mkdir(join(episode, "artifacts", "narration"), { recursive: true }),
      mkdir(join(episode, "assets", "images"), { recursive: true }),
      mkdir(join(episode, "output"), { recursive: true }),
    ]);
    // Exactly as workspace authoring leaves it.
    await writeFile(join(episode, "artifacts", "episode.json"), JSON.stringify({ scenes: [] }));
    await writeFile(join(episode, "artifacts", "timing.json"), JSON.stringify({
      version: 2,
      scenes: [
        { sceneId: "s1", startSeconds: 0, durationSeconds: 4 },
        { sceneId: "s2", startSeconds: 4, durationSeconds: 6 },
      ],
    }));
    await writeFile(join(episode, "assets", "images", "s1.png"), "png");
    await writeFile(join(episode, "assets", "images", "s2.png"), "png");
    await writeFile(join(episode, "artifacts", "narration", "s1.wav"), "wav");
    await writeFile(join(episode, "artifacts", "narration", "s1.json"), JSON.stringify({ duration_sec: 4 }));
    await writeFile(join(episode, "output", "render-1.mp4"), "media");

    const workspace = new FileSystemWorkspaceService([root]);
    const detail = await workspace.getEpisode("wordless-comedy", "give-me-time", "the-run-up") as any;

    expect(detail.scenes.map((s: any) => s.id)).toEqual(["s1", "s2"]);
    // And the enrichment lands on them, which is the whole point.
    const prefix = "/library/wordless-comedy/series/give-me-time/episodes/the-run-up";
    expect(detail.scenes[0].asset.url).toBe(`${prefix}/assets/images/s1.png`);
    expect(detail.scenes[0].narration.url).toBe(`${prefix}/artifacts/narration/s1.wav`);
    expect(detail.render.url).toBe(`${prefix}/output/render-1.mp4`);
  });

  // The render and the QA report were discovered inside the same try block as
  // the episode.json read, so an episode without that file lost them too --
  // a finished MP4 reported as no render at all.
  it("still finds the render when there is no episode.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const episode = join(root, "wordless-comedy", "series", "give-me-time", "episodes", "the-run-up");
    await Promise.all([
      mkdir(join(episode, "assets", "images"), { recursive: true }),
      mkdir(join(episode, "output"), { recursive: true }),
    ]);
    await writeFile(join(episode, "assets", "images", "s1.png"), "png");
    await writeFile(join(episode, "output", "render-1.mp4"), "media");

    const workspace = new FileSystemWorkspaceService([root]);
    const detail = await workspace.getEpisode("wordless-comedy", "give-me-time", "the-run-up") as any;

    expect(detail.scenes.map((s: any) => s.id)).toEqual(["s1"]);
    expect(detail.render.file).toBe("render-1.mp4");
  });

  // Immutable releases live in output/<render-id>/…, and output/current.json is
  // the pointer to them. The runtime's artifact discovery resolves output.mp4
  // through that pointer, so a scan that only read the top level of output/
  // contradicted the studio's own contract: a delivered episode — Carabinieri
  // "Alla fonte", "Il miracolo", "I due colleghi" — showed no render at all.
  it("follows output/current.json into an immutable release directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-workspace-"));
    roots.push(root);
    const episode = join(root, "wordless-comedy", "series", "give-me-time", "episodes", "the-run-up");
    await Promise.all([
      mkdir(join(episode, "artifacts"), { recursive: true }),
      mkdir(join(episode, "output", "the-run-up-v002"), { recursive: true }),
    ]);
    await writeFile(join(episode, "artifacts", "episode.json"), JSON.stringify({ scenes: [{ id: "s1", durationSeconds: 4, kind: "animation" }] }));
    await writeFile(join(episode, "output", "the-run-up-v002", "the-run-up.mp4"), "media");
    await writeFile(
      join(episode, "output", "current.json"),
      JSON.stringify({ renderId: "the-run-up-v002", path: "the-run-up-v002/the-run-up.mp4" }),
    );

    const workspace = new FileSystemWorkspaceService([root]);
    const detail = await workspace.getEpisode("wordless-comedy", "give-me-time", "the-run-up") as any;

    const prefix = "/library/wordless-comedy/series/give-me-time/episodes/the-run-up";
    expect(detail.render.url).toBe(`${prefix}/output/the-run-up-v002/the-run-up.mp4`);
    // An animation beat with no artwork previews the render it belongs to.
    expect(detail.scenes[0].asset.url).toBe(detail.render.url);
  });
});
