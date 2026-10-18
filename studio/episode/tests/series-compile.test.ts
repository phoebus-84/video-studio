import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkEpisode, compileEpisode, isSpecDriven, loadEpisode } from "../src/series-compile.js";
import { editSpec, sha256, specEpisode } from "../src/testing.js";

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

  it("accepts the spec's episodeRef whatever the order of its keys", () => {
    editSpec(dir(), (spec) => { spec.episodeRef = { episode: REF.episode, series: REF.series, channel: REF.channel }; });
    expect(compileEpisode(dir(), { episodeRef: REF }).ok).toBe(true);
  });

  it("reports a spec for another episode before looking for its template", () => {
    editSpec(dir(), (spec) => { spec.episodeRef.episode = "evening"; spec.template.version = "9.9.9"; });
    expect(problemsOf()).toEqual([["episode-mismatch", "episode-spec.json#$.episodeRef"]]);
  });

  it("not-a-file: a take whose audio path names a directory", () => {
    const takes = JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));
    takes.takes[0].audio.path = "assets/takes";
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(takes));
    expect(problemsOf()).toEqual([["not-a-file", "assets/takes"]]);
  });

  it("ignores a directory in assets/images even when its name looks like a picture", () => {
    mkdirSync(at("assets/images/extra.png"));
    expect(compileEpisode(dir(), { episodeRef: REF }).ok).toBe(true);
  });

  it("a wordless release (narration: none) needs no takes.json: the compiler gets no takes", () => {
    const manifest = join(dirname(dirname(dir())), "templates/poetry-short/1.0.0/series-template.json");
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), narration: "none" }, null, 2));
    editSpec(dir(), (spec) => { spec.template.hash = sha256(readFileSync(manifest)); });
    unlinkSync(at("artifacts/narration/takes.json"));
    // poetry-short is narrated: its compiler, not the loader, reports the missing unit.
    expect(problemsOf()).toEqual([["missing-unit", "artifacts/narration/takes.json#$.units"]]);
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

describe("loadEpisode", () => {
  it("gives the compile input without compiling, every file hashed", () => {
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.releaseKey).toBe("../../templates/poetry-short/1.0.0");
    expect(loaded.input.spec.revision).toBe(2);
    expect(Object.keys(loaded.input.inputs)).toHaveLength(13);
    expect(Object.keys(loaded.input.assets).sort()).toEqual(["image-cat", "image-morning-room", "image-teacup", "narration-cup", "narration-light"]);
  });

  it("offers video scene assets to series compilers with their hashes", () => {
    mkdirSync(at("assets/video"), { recursive: true });
    writeFileSync(at("assets/video/walk.mp4"), "scene clip");
    writeFileSync(at("assets/video/.partial.mp4"), "unfinished");
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.assets["video-walk"]).toEqual({ path: "assets/video/walk.mp4", hash: sha256("scene clip"), kind: "video" });
    expect(loaded.input.assets["video-.partial"]).toBeUndefined();
    expect(loaded.input.inputs["assets/video/walk.mp4"]).toBe(sha256("scene clip"));
  });

  it("offers an SVG drawing in assets/images as image-<name>", () => {
    mkdirSync(at("assets/images"), { recursive: true });
    writeFileSync(at("assets/images/ic-eye.svg"), "<svg/>");
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.assets["image-ic-eye"]).toEqual({ path: "assets/images/ic-eye.svg", hash: sha256("<svg/>"), kind: "image" });
  });

  it("offers every sound in assets/sounds as sound-<name>, hashed", () => {
    mkdirSync(at("assets/sounds"), { recursive: true });
    writeFileSync(at("assets/sounds/applause.wav"), "clapping");
    writeFileSync(at("assets/sounds/Thunder.MP3"), "rumble");
    writeFileSync(at("assets/sounds/credits.txt"), "who recorded what");
    writeFileSync(at("assets/sounds/.DS_Store"), "finder");
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.assets["sound-applause"]).toEqual({ path: "assets/sounds/applause.wav", hash: sha256("clapping"), kind: "audio" });
    expect(loaded.input.assets["sound-Thunder"]?.path).toBe("assets/sounds/Thunder.MP3");
    expect(loaded.input.inputs["assets/sounds/applause.wav"]).toBe(sha256("clapping"));
    expect(Object.keys(loaded.input.assets).filter((id) => id.startsWith("sound-")).sort()).toEqual(["sound-Thunder", "sound-applause"]);
  });

  it("ambiguous-asset: two files for one sound", () => {
    mkdirSync(at("assets/sounds"), { recursive: true });
    writeFileSync(at("assets/sounds/applause.wav"), "clapping");
    writeFileSync(at("assets/sounds/applause.mp3"), "clapping again");
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.problems.map((p) => [p.code, p.path])).toEqual([["ambiguous-asset", "assets/sounds/applause.wav"]]);
  });
});

describe("checkEpisode", () => {
  it("finds nothing wrong with the compiled timeline of a complete episode", () => {
    const result = checkEpisode(dir(), { episodeRef: REF });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.validator).toBe("poetry-short@1.0.0");
    expect(result.findings).toEqual([]);
    expect(result.compiled.durationInFrames).toBe(324);
  });

  it("checks the timeline it is given, against what the compiler makes", () => {
    const compiled = compileEpisode(dir(), { episodeRef: REF });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const timeline = structuredClone(compiled.timeline) as any;
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    const result = checkEpisode(dir(), { episodeRef: REF, timeline });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.findings.map((f) => [f.code, f.severity, f.path])).toEqual([
      ["text-not-voice", "error", "artifacts/edit-timeline.json#$.tracks[1]"],
    ]);
  });

  it("finds a spec whose video is shorter than the series allows", () => {
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
    const result = checkEpisode(dir(), { episodeRef: REF });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.findings.map((f) => [f.code, f.path])).toEqual([["duration-range", "artifacts/edit-timeline.json#$.durationInFrames"]]);
  });

  it("locates a finding about the spec in the spec", () => {
    const compiled = compileEpisode(dir(), { episodeRef: REF });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const timeline = structuredClone(compiled.timeline) as any;
    timeline.tracks[0].items[2].props.src.$asset = "image-teacup";
    const result = checkEpisode(dir(), { episodeRef: REF, timeline });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.findings.map((f) => [f.code, f.path])).toEqual([["missing-picture", "episode-spec.json#$.data.panels[2]"]]);
  });

  it("reports the loader's problems when the episode cannot be compiled", () => {
    unlinkSync(at("artifacts/narration/takes.json"));
    const result = checkEpisode(dir(), { episodeRef: REF });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.map((p) => p.code)).toEqual(["missing-narration"]);
  });
});
