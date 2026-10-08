import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";
import { createStudioStageEvidence } from "../src/index.js";

/** The studio's stage evidence applies to a spec-driven episode on the series-production stages only (avg-qwc). */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const SERIES = ["spec", "pictures", "takes", "timeline", "check", "sheet", "render"];
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function episode(withSpec = true) {
  const root = mkdtempSync(join(tmpdir(), "adapters-evidence-"));
  roots.push(root);
  const episodeDir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  specEpisode(episodeDir, REF);
  if (!withSpec) rmSync(join(episodeDir, "episode-spec.json"));
  return episodeDir;
}

describe("createStudioStageEvidence", () => {
  it("applies to a spec-driven episode on the series-production stages", async () => {
    const evidence = createStudioStageEvidence();
    const episodeDir = episode();
    expect(evidence.appliesTo({ ref: REF, episodeDir, stageIds: SERIES })).toBe(true);
    const stages = await evidence.stages({ ref: REF, episodeDir, operatorKey: null });
    expect(stages.spec!.state).toBe("completed");
  });

  it("leaves another pipeline, a series' extra stage, and an episode without a spec to the journal", () => {
    const evidence = createStudioStageEvidence();
    expect(evidence.appliesTo({ ref: REF, episodeDir: episode(), stageIds: ["script", "narration", "compose"] })).toBe(false);
    expect(evidence.appliesTo({ ref: REF, episodeDir: episode(), stageIds: [...SERIES, "subtitles"] })).toBe(false);
    expect(evidence.appliesTo({ ref: REF, episodeDir: episode(false), stageIds: SERIES })).toBe(false);
  });
});
