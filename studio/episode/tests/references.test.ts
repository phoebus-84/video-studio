import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeEditTimeline } from "../src/episode-render.js";
import { proposeReference } from "../src/references.js";
import { editSpec, specEpisode } from "../src/testing.js";

/**
 * proposeReference (avg-jao.6): what a person would approve, frozen; nothing
 * signed. A render is faked: the file, its report naming the timeline it was
 * made from, and output/current.json.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Compile the timeline and fake its render, as renderEpisode would leave it. */
function rendered(): void {
  writeEditTimeline(dir(), { episodeRef: REF });
  mkdirSync(at("output"), { recursive: true });
  writeFileSync(at("output/render-1-abcd1234.mp4"), "fake mp4");
  const timelineHash = sha256(readFileSync(at("artifacts/edit-timeline.json")));
  writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify({ renderId: "render-1-abcd1234", timeline: { path: "artifacts/edit-timeline.json", hash: timelineHash } }));
  writeFileSync(at("output/current.json"), JSON.stringify({ renderId: "render-1-abcd1234", path: "render-1-abcd1234.mp4" }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "propose-reference-"));
  specEpisode(dir(), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const codes = (result: ReturnType<typeof proposeReference>) => (result.ok ? [] : result.problems.map((p) => p.code));

describe("proposeReference", () => {
  it("freezes the spec and the timeline and writes the proposal with every hash", () => {
    rendered();
    const result = proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.paths).toEqual([
      "reviews/references/morning-v1/episode-spec.json",
      "reviews/references/morning-v1/edit-timeline.json",
      "reviews/references/morning-v1/proposal.json",
    ]);
    const { proposal } = result;
    expect(readFileSync(at(proposal.spec.path))).toEqual(readFileSync(at("episode-spec.json")));
    expect(readFileSync(at(proposal.timeline.path))).toEqual(readFileSync(at("artifacts/edit-timeline.json")));
    for (const field of ["spec", "timeline", "render", "report"] as const) {
      expect(proposal[field].hash).toBe(sha256(readFileSync(at(proposal[field].path))));
    }
    expect(proposal.render.path).toBe("output/render-1-abcd1234.mp4");
    expect(proposal.report.path).toBe("output/render-1-abcd1234.report.json");
    expect(proposal.template.id).toBe("poetry-short");
    expect(JSON.parse(readFileSync(at("reviews/references/morning-v1/proposal.json"), "utf-8"))).toEqual(proposal);
    expect("approval" in proposal).toBe(false);
  });

  it("writes nothing outside reviews/references/<id>/", () => {
    rendered();
    const before = readdirSync(dir(), { recursive: true }).map(String).sort();
    proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
    const added = readdirSync(dir(), { recursive: true }).map(String).filter((f) => !before.includes(f));
    expect(added.every((f) => f.startsWith("reviews"))).toBe(true);
  });

  it("refuses an id already proposed, or already promoted in the series", () => {
    rendered();
    proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" });
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["reference-exists"]);
    const promoted = join(dirname(dirname(dir())), "templates/poetry-short/references/evening-v1.json");
    mkdirSync(dirname(promoted), { recursive: true });
    writeFileSync(promoted, "{}");
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "evening-v1" }))).toEqual(["reference-exists"]);
    expect(existsSync(at("reviews/references/evening-v1"))).toBe(false);
  });

  it("bad-spec: a spec that is not JSON is a problem, not an exception", () => {
    rendered();
    writeFileSync(at("episode-spec.json"), "{ half an edit");
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["bad-spec"]);
  });

  it("bad-id, no-spec, no-render", () => {
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "Morning V1" }))).toEqual(["bad-id"]);
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["no-render"]);
    unlinkSync(at("episode-spec.json"));
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["no-spec"]);
  });

  it("timeline-changed: the timeline is no longer the one the render was made from", () => {
    rendered();
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[0].items[0].duration = 113;
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["timeline-changed"]);
    expect(existsSync(at("reviews/references/morning-v1"))).toBe(false);
  });

  it("series-rules: a rendered timeline that breaks the series' rules is no standard", () => {
    rendered();
    // A caption rewritten by hand, then "rendered" as it stands.
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    const report = JSON.parse(readFileSync(at("output/render-1-abcd1234.report.json"), "utf-8"));
    report.timeline.hash = sha256(readFileSync(at("artifacts/edit-timeline.json")));
    writeFileSync(at("output/render-1-abcd1234.report.json"), JSON.stringify(report));
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["series-rules"]);
  });

  it("spec-changed: the spec was edited after the timeline was compiled", () => {
    rendered();
    editSpec(dir(), (spec) => { spec.data.title = "Morning, again"; spec.revision = 3; });
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["spec-changed"]);
    expect(existsSync(at("reviews/references/morning-v1"))).toBe(false);
  });

  it("an episode whose release was edited in place cannot be proposed", () => {
    rendered();
    writeFileSync(join(dirname(dirname(dir())), "templates/poetry-short/1.0.0/FORMAT.md"), "A quiet change of style.\n");
    expect(codes(proposeReference(dir(), { episodeRef: REF, referenceId: "morning-v1" }))).toEqual(["hash-mismatch"]);
  });
});
