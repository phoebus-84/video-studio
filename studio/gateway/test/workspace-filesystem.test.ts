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
});
