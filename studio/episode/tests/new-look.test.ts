import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { themeFilePaths } from "@studio/contracts/src/channel-themes.mjs";
import { checkEpisode, compileEpisode, loadEpisode } from "../src/series-compile.js";
import { upgradeEpisodeSpec } from "../src/spec-init.js";
import { editSpec, sha256, specEpisode } from "../src/testing.js";

/**
 * A new look reaches an episode (ADR-0040): the loader holds a sealed theme's
 * rooms to their hashes and warns about an unsealed one; upgradeEpisodeSpec
 * moves the spec to the template release pinning the new theme. The release
 * is made here as `vpr theme seal` and `vpr template release` make it
 * (their own tests are the runtime's). The episode is the starter
 * poetry-short one, drawn in the contracts' sample theme.
 */

const require = createRequire(import.meta.url);
const SAMPLE = dirname(require.resolve("@studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json"));
const episodeRef = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const channelDir = () => join(root, "sample");
const episodeDir = () => join(channelDir(), "series", "poetry", "episodes", "morning");
const themeDir = (version: string) => join(channelDir(), "themes", "sample", version);
const releaseDir = (version: string) => join(channelDir(), "series", "poetry", "templates", "poetry-short", version);

/** Release `version` of the template as a copy of 1.0.0, pinning `theme`; its manifest's hash. */
function release(version: string, theme: { version: string; text: string }, change: (schema: any) => void = () => {}): string {
  if (version !== "1.0.0") cpSync(releaseDir("1.0.0"), releaseDir(version), { recursive: true });
  const schemaFile = join(releaseDir(version), "episode-spec.schema.json");
  const schema = JSON.parse(readFileSync(schemaFile, "utf-8"));
  change(schema);
  const schemaText = `${JSON.stringify(schema, null, 2)}\n`;
  writeFileSync(schemaFile, schemaText);
  const manifest = JSON.parse(readFileSync(join(releaseDir(version), "series-template.json"), "utf-8"));
  manifest.files.schema.hash = sha256(schemaText);
  const manifestText = `${JSON.stringify({ ...manifest, version, theme: { id: "sample", version: theme.version, hash: sha256(theme.text) } }, null, 2)}\n`;
  writeFileSync(join(releaseDir(version), "series-template.json"), manifestText);
  return sha256(manifestText);
}

/** Theme <version>, sealed, and poetry-short@<version> pinning it. Returns the release's manifest hash. */
function newLook(version: string, change?: (schema: any) => void): string {
  cpSync(themeDir("1.0.0"), themeDir(version), { recursive: true });
  const theme = JSON.parse(readFileSync(join(themeDir(version), "theme.json"), "utf-8"));
  const files = Object.fromEntries(themeFilePaths(theme).map((path) => [path, sha256(readFileSync(join(themeDir(version), path)))]));
  const themeText = `${JSON.stringify({ ...theme, version, files }, null, 2)}\n`;
  writeFileSync(join(themeDir(version), "theme.json"), themeText);
  return release(version, { version, text: themeText }, change);
}

/**
 * A schema whose panels are one of two shapes: a picture cued by a word, or a
 * still held for seconds. A cue is a word, so "__FILL__" breaks the first
 * branch: the union then fails at the panel holding it, and only the
 * placeholder excuses that.
 */
const withUnion = (schema: any) => {
  schema.$defs.Panel.properties.cue.pattern = "^[\\p{L}]+$";
  schema.$defs.Held = { type: "object", additionalProperties: false, required: ["assetId", "seconds"], properties: { assetId: { type: "string", minLength: 1 }, seconds: { type: "number", minimum: 0 } } };
  schema.properties.panels.items = { oneOf: [{ $ref: "#/$defs/Panel" }, { $ref: "#/$defs/Held" }] };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "new-look-"));
  specEpisode(episodeDir(), episodeRef);
  // The episode starts on the unsealed sample theme: 1.0.0 pins it.
  cpSync(SAMPLE, themeDir("1.0.0"), { recursive: true });
  mkdirSync(join(themeDir("1.0.0"), "rooms"), { recursive: true });
  writeFileSync(join(themeDir("1.0.0"), "rooms", "hall.png"), "a hall");
  const hash = release("1.0.0", { version: "1.0.0", text: readFileSync(join(themeDir("1.0.0"), "theme.json"), "utf-8") });
  editSpec(episodeDir(), (spec) => { spec.template.hash = hash; });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("an unsealed theme", () => {
  it("loads as before, with a theme-unsealed warning in the compile and the check", () => {
    const compiled = compileEpisode(episodeDir(), { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.warnings.filter((w) => w.startsWith("theme-unsealed at ../../../../themes/sample/1.0.0/theme.json: "))).toHaveLength(1);
    const checked = checkEpisode(episodeDir(), { episodeRef });
    if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
    expect(checked.findings.filter((f) => f.code === "theme-unsealed").map((f) => [f.path, f.severity]))
      .toEqual([["../../../../themes/sample/1.0.0/theme.json", "warning"]]);
  });
});

describe("upgradeEpisodeSpec onto a sealed theme", () => {
  it("re-pins the spec, keeps its data, and the episode compiles with no warning about the theme", () => {
    const hash = newLook("1.1.0");
    const before = JSON.parse(readFileSync(join(episodeDir(), "episode-spec.json"), "utf-8"));
    const upgraded = upgradeEpisodeSpec(episodeDir(), { episodeRef, version: "1.1.0" });
    if (!upgraded.ok) throw new Error(JSON.stringify(upgraded.problems));
    expect(upgraded.from).toEqual(before.template);
    expect(upgraded.spec.template).toEqual({ id: "poetry-short", version: "1.1.0", hash });
    expect(upgraded.spec.revision).toBe(before.revision + 1);
    expect(upgraded.spec.data).toEqual(before.data);
    expect(JSON.parse(readFileSync(join(episodeDir(), "episode-spec.json"), "utf-8"))).toEqual(upgraded.spec);

    const compiled = compileEpisode(episodeDir(), { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.template.version).toBe("1.1.0");
    expect(compiled.warnings.some((w) => w.startsWith("theme-unsealed"))).toBe(false);
  });

  it("stops the load when a sealed room changed, at that file", () => {
    newLook("1.1.0");
    upgradeEpisodeSpec(episodeDir(), { episodeRef, version: "1.1.0" });
    writeFileSync(join(themeDir("1.1.0"), "rooms", "hall.png"), "another hall");
    const loaded = loadEpisode(episodeDir(), { episodeRef });
    expect(loaded.ok ? [] : loaded.problems.map((p) => [p.code, p.path]))
      .toEqual([["theme-mismatch", "../../../../themes/sample/1.1.0/rooms/hall.png"]]);
  });

  it("moves a draft too: its unfilled values, and what the schema says of them, do not stop it", () => {
    newLook("1.1.0", (schema) => { schema.$defs.Panel.properties.assetId.pattern = "^[a-z0-9-]+$"; });
    // the asset id's pattern refuses "__FILL__": still a draft, not bad data
    editSpec(episodeDir(), (spec) => { spec.data.title = "__FILL__"; spec.data.panels[0].assetId = "__FILL__"; });
    const upgraded = upgradeEpisodeSpec(episodeDir(), { episodeRef, version: "1.1.0" });
    if (!upgraded.ok) throw new Error(JSON.stringify(upgraded.problems));
    expect((upgraded.spec.data as { panels: { assetId: string }[] }).panels[0]!.assetId).toBe("__FILL__");
  });

  it("moves a draft whose union member is unfilled, but not one missing a required field", () => {
    newLook("1.1.0", withUnion);
    editSpec(episodeDir(), (spec) => { spec.data.panels[1].cue = "__FILL__"; spec.data.panels[0] = { assetId: spec.data.panels[0].assetId, cue: "__FILL__" }; });
    const upgraded = upgradeEpisodeSpec(episodeDir(), { episodeRef, version: "1.1.0" });
    if (!upgraded.ok) throw new Error(JSON.stringify(upgraded.problems.slice(0, 3)));
    // A panel with no placeholder in it keeps its errors: one missing its asset is refused.
    editSpec(episodeDir(), (spec) => { delete spec.data.panels[2].assetId; });
    newLook("1.2.0", withUnion);
    const refused = upgradeEpisodeSpec(episodeDir(), { episodeRef, version: "1.2.0" });
    expect(refused.ok).toBe(false);
  });

  it("refuses a version not after the pin, a missing release, another episode's spec, data the release refuses, no spec", () => {
    newLook("1.1.0");
    const codes = (version: string, ref = episodeRef) => {
      const result = upgradeEpisodeSpec(episodeDir(), { episodeRef: ref, version });
      return result.ok ? ["ok"] : result.problems.map((p) => p.code);
    };
    expect(codes("1.0.0")).toEqual(["bad-version"]);
    expect(codes("latest")).toEqual(["bad-version"]);
    expect(codes("1.9.0")).toEqual(["missing-template"]);
    expect(codes("1.1.0", { ...episodeRef, episode: "evening" })).toEqual(["episode-mismatch"]);
    editSpec(episodeDir(), (spec) => { delete spec.data.title; });
    expect(codes("1.1.0")[0]).toBe("bad-spec");
    expect(JSON.parse(readFileSync(join(episodeDir(), "episode-spec.json"), "utf-8")).template.version).toBe("1.0.0");
    rmSync(join(episodeDir(), "episode-spec.json"));
    expect(codes("1.1.0")).toEqual(["missing-spec"]);
  });
});
