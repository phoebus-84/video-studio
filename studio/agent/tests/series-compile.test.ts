import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileEpisode, isSpecDriven } from "../src/series-compile.js";
import { editSpec, sha256, specEpisode } from "./spec-episode.js";

/**
 * compileEpisode (avg-jao.2): everything a series compiler needs, read from
 * the episode and its series, checked, hashed, then compiled. What the
 * compiler does with it is @studio/series's tests; these pin what the loader
 * refuses before it ever runs.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-compile-"));
  specEpisode(dir(), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const problemsOf = () => {
  const result = compileEpisode(dir(), { episodeRef: REF });
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.problems.map((p) => [p.code, p.path]);
};

describe("compileEpisode", () => {
  it("compiles a complete episode and records every file it read", () => {
    const result = compileEpisode(dir(), { episodeRef: REF });
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    expect(result.compiler).toBe("poetry-short@1.0.0");
    expect(result.revision).toBe(2);
    expect(result.timeline.durationInFrames).toBe(324);
    expect(result.timeline.profile.id).toBe("vertical-1080x1920");
    const inputs = (result.timeline.metadata as any).inputs as Record<string, string>;
    expect(Object.keys(inputs).sort()).toEqual([
      "../../templates/poetry-short/1.0.0/FORMAT.md",
      "../../templates/poetry-short/1.0.0/episode-spec.schema.json",
      "../../templates/poetry-short/1.0.0/episode-spec.template.json",
      "../../templates/poetry-short/1.0.0/series-template.json",
      "artifacts/narration/takes.json",
      "artifacts/timing/cup.json",
      "artifacts/timing/light.json",
      "assets/images/cat.png",
      "assets/images/morning-room.png",
      "assets/images/teacup.png",
      "assets/takes/cup.wav",
      "assets/takes/light.wav",
      "episode-spec.json",
    ]);
    expect(inputs["episode-spec.json"]).toBe(sha256(readFileSync(at("episode-spec.json"))));
    expect(result.timeline.derivedFrom?.spec.hash).toBe(inputs["episode-spec.json"]);
    expect(result.timeline.assets["image-teacup"]).toEqual({ path: "assets/images/teacup.png", hash: inputs["assets/images/teacup.png"], kind: "image" });
  });

  it("knows a spec-driven episode by its episode-spec.json", () => {
    expect(isSpecDriven(dir())).toBe(true);
    unlinkSync(at("episode-spec.json"));
    expect(isSpecDriven(dir())).toBe(false);
  });

  it("missing-template: the pinned release is not in the series", () => {
    editSpec(dir(), (spec) => { spec.template.version = "1.1.0"; });
    expect(problemsOf()).toEqual([["missing-template", "episode-spec.json#$.template"]]);
  });

  it("refuses a release edited in place", () => {
    appendFileSync(join(dirname(dirname(dir())), "templates/poetry-short/1.0.0/FORMAT.md"), "\nA quiet change of style.\n");
    expect(problemsOf()).toEqual([["hash-mismatch", "../../templates/poetry-short/1.0.0/series-template.json#$.files[\"FORMAT.md\"]"]]);
  });

  it("refuses a spec still holding __FILL__", () => {
    editSpec(dir(), (spec) => { spec.data.title = "__FILL__"; });
    expect(problemsOf()).toEqual([["unfilled", "episode-spec.json#$.data[\"title\"]"]]);
  });

  it("refuses a spec that is not JSON", () => {
    writeFileSync(at("episode-spec.json"), "{ half an edit");
    expect(problemsOf()).toEqual([["bad-spec", "episode-spec.json"]]);
  });

  it("refuses a spec that belongs to another episode", () => {
    editSpec(dir(), (spec) => { spec.episodeRef.episode = "evening"; });
    expect(problemsOf()).toEqual([["episode-mismatch", "episode-spec.json#$.episodeRef"]]);
  });

  it("missing-narration: no takes.json yet", () => {
    unlinkSync(at("artifacts/narration/takes.json"));
    expect(problemsOf()).toEqual([["missing-narration", "artifacts/narration/takes.json"]]);
  });

  it("missing-timing: a take whose word timing is gone", () => {
    unlinkSync(at("artifacts/timing/cup.json"));
    expect(problemsOf()).toEqual([["missing-timing", "artifacts/narration/takes.json#$.takes[1].timing.path"]]);
  });

  it("refuses a take whose audio was replaced after its timing was made", () => {
    writeFileSync(at("assets/takes/cup.wav"), "another recording");
    expect(problemsOf()).toEqual([["hash-mismatch", "artifacts/narration/takes.json#$.takes[1].audio.hash"]]);
  });

  it("refuses a timing made for another recording, even when takes.json was updated to it", () => {
    // Someone re-recorded "cup" and updated takes.json, but not the timing.
    writeFileSync(at("assets/takes/cup.wav"), "another recording");
    const takes = JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));
    takes.takes[1].audio.hash = sha256("another recording");
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(takes));
    expect(problemsOf()).toEqual([["audio-mismatch", "artifacts/timing/cup.json#$.audio.hash"]]);
  });

  it("ambiguous-asset: two files for one picture", () => {
    writeFileSync(at("assets/images/teacup.jpg"), "another teacup");
    expect(problemsOf()).toEqual([["ambiguous-asset", "assets/images/teacup.png"]]);
  });

  it("path-escape: a picture that is a link out of the episode", () => {
    const outside = join(root, "elsewhere.png");
    writeFileSync(outside, "not this episode's");
    unlinkSync(at("assets/images/cat.png"));
    symlinkSync(outside, at("assets/images/cat.png"));
    expect(problemsOf()).toEqual([["path-escape", "assets/images/cat.png"]]);
  });

  it("path-escape: a take whose audio path climbs out of the episode", () => {
    const takes = JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));
    takes.takes[0].audio.path = "../other/light.wav";
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(takes));
    expect(problemsOf()).toEqual([["path-escape", "artifacts/narration/takes.json#$.takes[0].audio.path"]]);
  });

  it("ignores hidden files and files that are not pictures in assets/images", () => {
    writeFileSync(at("assets/images/.DS_Store"), "finder");
    writeFileSync(at("assets/images/notes.txt"), "which picture goes where");
    const result = compileEpisode(dir(), { episodeRef: REF });
    expect(result.ok).toBe(true);
  });

  it("offers a picture whatever the case of its extension", () => {
    renameSync(at("assets/images/cat.png"), at("assets/images/cat.PNG"));
    const result = compileEpisode(dir(), { episodeRef: REF });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.timeline.assets["image-cat"]?.path).toBe("assets/images/cat.PNG");
  });

  it("path-escape: a release file that is a link out of the series", () => {
    const release = join(dirname(dirname(dir())), "templates/poetry-short/1.0.0");
    const outside = join(root, "FORMAT.md");
    writeFileSync(outside, readFileSync(join(release, "FORMAT.md")));
    unlinkSync(join(release, "FORMAT.md"));
    symlinkSync(outside, join(release, "FORMAT.md"));
    expect(problemsOf()).toEqual([["path-escape", "../../templates/poetry-short/1.0.0/FORMAT.md"]]);
  });

  it("names the file a compiler problem is in", () => {
    editSpec(dir(), (spec) => { spec.data.panels[1].cue = "teapot"; });
    expect(problemsOf()).toEqual([["unknown-word", "episode-spec.json#$.data.panels[1].cue"]]);
  });
});
