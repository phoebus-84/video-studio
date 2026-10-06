import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileEpisode } from "../src/series-compile.js";
import { initEpisodeSpec } from "../src/spec-init.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * initEpisodeSpec (avg-jao.4): a draft pinned to an exact release, every
 * __FILL__ kept, an existing spec never replaced.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const TEMPLATE = { id: "poetry-short", version: "1.0.0" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const release = () => join(dirname(dirname(dir())), "templates/poetry-short/1.0.0");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spec-init-"));
  // A complete episode, then its spec removed: the release, takes and pictures stay.
  specEpisode(dir(), REF);
  unlinkSync(at("episode-spec.json"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const codes = (result: ReturnType<typeof initEpisodeSpec>) => (result.ok ? [] : result.problems.map((p) => [p.code, p.path]));

describe("initEpisodeSpec", () => {
  it("writes a draft pinned to the exact release, listing every placeholder", () => {
    const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.path).toBe("episode-spec.json");
    const written = JSON.parse(readFileSync(at("episode-spec.json"), "utf-8"));
    expect(written).toEqual(result.spec);
    expect(written.episodeRef).toEqual(REF);
    expect(written.revision).toBe(1);
    expect(written.template).toEqual({ ...TEMPLATE, hash: sha256(readFileSync(join(release(), "series-template.json"))) });
    expect(result.placeholders).toEqual([
      '$.data["title"]',
      '$.data["narration"]',
      '$.data["holdSeconds"]',
      '$.data["panels"][0]["assetId"]',
      '$.data["panels"][0]["cue"]',
    ]);
    expect(written.data.style.outputProfile).toBe("vertical-1080x1920");
  });

  it("never replaces an existing spec", () => {
    writeFileSync(at("episode-spec.json"), "{ a person's work }");
    expect(codes(initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE }))).toEqual([["spec-exists", "episode-spec.json"]]);
    expect(readFileSync(at("episode-spec.json"), "utf-8")).toBe("{ a person's work }");
  });

  it("missing-template: a release the series does not have", () => {
    expect(codes(initEpisodeSpec(dir(), { episodeRef: REF, template: { id: "poetry-short", version: "2.0.0" } })))
      .toEqual([["missing-template", "../../templates/poetry-short/2.0.0"]]);
  });

  it("bad-version: a range or a partial version is not a release", () => {
    for (const version of ["^1.0.0", "1.0", "latest"]) {
      expect(codes(initEpisodeSpec(dir(), { episodeRef: REF, template: { id: "poetry-short", version } }))[0]?.[0]).toBe("bad-version");
    }
  });

  it("bad-template: a release edited in place", () => {
    appendFileSync(join(release(), "FORMAT.md"), "\nA quiet change of style.\n");
    const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
    expect(codes(result)[0]?.[0]).toBe("bad-template");
    expect(() => readFileSync(at("episode-spec.json"))).toThrow();
  });

  it("a draft filled with the golden fixture's data compiles", () => {
    const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    const require = createRequire(import.meta.url);
    const input = JSON.parse(readFileSync(require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json"), "utf-8"));
    writeFileSync(at("episode-spec.json"), JSON.stringify({ ...result.spec, data: input.spec.data }, null, 2));
    const compiled = compileEpisode(dir(), { episodeRef: REF });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.revision).toBe(1);
  });
});
