import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { themeFilePaths } from "@studio/contracts/src/channel-themes.mjs";
import { checkEpisode, compileEpisode, loadEpisode } from "../src/series-compile.js";
import { upgradeEpisodeSpec } from "../src/spec-init.js";
import { divLongEpisode, editSpec, sha256 } from "../src/testing.js";

/**
 * A new look reaches an episode (ADR-0040): the loader holds a sealed theme's
 * rooms to their hashes and warns about an unsealed one; upgradeEpisodeSpec
 * moves the spec to the template release pinning the new theme. The release
 * is made here as `vpr theme seal` and `vpr template release` make it
 * (their own tests are the runtime's).
 */

let root: string;
let episodeDir: string;
let episodeRef: { channel: string; series: string; episode: string };
const channelDir = () => join(root, "dentro-i-versi");
const themeDir = (version: string) => join(channelDir(), "themes", "dentro-i-versi", version);
const releaseDir = (version: string) => join(channelDir(), "series", "long", "templates", "dentro-i-versi-long", version);

/** Theme <version>, sealed, and dentro-i-versi-long@<version> pinning it. Returns the release's manifest hash. */
function newLook(version: string): string {
  cpSync(themeDir("1.0.0"), themeDir(version), { recursive: true });
  const theme = JSON.parse(readFileSync(join(themeDir(version), "theme.json"), "utf-8"));
  const files = Object.fromEntries(themeFilePaths(theme).map((path) => [path, sha256(readFileSync(join(themeDir(version), path)))]));
  const themeText = `${JSON.stringify({ ...theme, version, files }, null, 2)}\n`;
  writeFileSync(join(themeDir(version), "theme.json"), themeText);
  cpSync(releaseDir("1.0.0"), releaseDir(version), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(releaseDir(version), "series-template.json"), "utf-8"));
  const manifestText = `${JSON.stringify({ ...manifest, version, theme: { id: "dentro-i-versi", version, hash: sha256(themeText) } }, null, 2)}\n`;
  writeFileSync(join(releaseDir(version), "series-template.json"), manifestText);
  return sha256(manifestText);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "new-look-"));
  ({ episodeDir, episodeRef } = await divLongEpisode(root));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("an unsealed theme", () => {
  it("loads as before, with a theme-unsealed warning in the compile and the check", () => {
    const compiled = compileEpisode(episodeDir, { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.warnings.filter((w) => w.startsWith("theme-unsealed at ../../../../themes/dentro-i-versi/1.0.0/theme.json: "))).toHaveLength(1);
    const checked = checkEpisode(episodeDir, { episodeRef });
    if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
    expect(checked.findings.filter((f) => f.code === "theme-unsealed").map((f) => [f.path, f.severity]))
      .toEqual([["../../../../themes/dentro-i-versi/1.0.0/theme.json", "warning"]]);
  });
});

describe("upgradeEpisodeSpec onto a sealed theme", () => {
  it("re-pins the spec, keeps its data, and the episode compiles with no warning about the theme", () => {
    const hash = newLook("1.1.0");
    const before = JSON.parse(readFileSync(join(episodeDir, "episode-spec.json"), "utf-8"));
    const upgraded = upgradeEpisodeSpec(episodeDir, { episodeRef, version: "1.1.0" });
    if (!upgraded.ok) throw new Error(JSON.stringify(upgraded.problems));
    expect(upgraded.from).toEqual(before.template);
    expect(upgraded.spec.template).toEqual({ id: "dentro-i-versi-long", version: "1.1.0", hash });
    expect(upgraded.spec.revision).toBe(before.revision + 1);
    expect(upgraded.spec.data).toEqual(before.data);
    expect(JSON.parse(readFileSync(join(episodeDir, "episode-spec.json"), "utf-8"))).toEqual(upgraded.spec);

    const compiled = compileEpisode(episodeDir, { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.template.version).toBe("1.1.0");
    expect(compiled.warnings.some((w) => w.startsWith("theme-unsealed"))).toBe(false);
  });

  it("stops the load when a sealed room changed, at that file", () => {
    newLook("1.1.0");
    upgradeEpisodeSpec(episodeDir, { episodeRef, version: "1.1.0" });
    writeFileSync(join(themeDir("1.1.0"), "rooms", "atrio.png"), "another atrio");
    const loaded = loadEpisode(episodeDir, { episodeRef });
    expect(loaded.ok ? [] : loaded.problems.map((p) => [p.code, p.path]))
      .toEqual([["theme-mismatch", "../../../../themes/dentro-i-versi/1.1.0/rooms/atrio.png"]]);
  });

  it("moves a draft too: its unfilled values, and what the schema says of them, do not stop it", () => {
    newLook("1.1.0");
    // an asset id's pattern refuses "__FILL__": still a draft, not bad data
    editSpec(episodeDir, (spec) => { spec.data.title = "__FILL__"; spec.data.pictures[0].asset = "__FILL__"; });
    const upgraded = upgradeEpisodeSpec(episodeDir, { episodeRef, version: "1.1.0" });
    if (!upgraded.ok) throw new Error(JSON.stringify(upgraded.problems));
    expect((upgraded.spec.data as { pictures: { asset: string }[] }).pictures[0]!.asset).toBe("__FILL__");
  });

  it("refuses a version not after the pin, a missing release, another episode's spec, data the release refuses, no spec", () => {
    newLook("1.1.0");
    const codes = (version: string, ref = episodeRef) => {
      const result = upgradeEpisodeSpec(episodeDir, { episodeRef: ref, version });
      return result.ok ? ["ok"] : result.problems.map((p) => p.code);
    };
    expect(codes("1.0.0")).toEqual(["bad-version"]);
    expect(codes("latest")).toEqual(["bad-version"]);
    expect(codes("1.9.0")).toEqual(["missing-template"]);
    expect(codes("1.1.0", { ...episodeRef, episode: "san-martino" })).toEqual(["episode-mismatch"]);
    editSpec(episodeDir, (spec) => { delete spec.data.title; });
    expect(codes("1.1.0")[0]).toBe("bad-spec");
    expect(JSON.parse(readFileSync(join(episodeDir, "episode-spec.json"), "utf-8")).template.version).toBe("1.0.0");
    rmSync(join(episodeDir, "episode-spec.json"));
    expect(codes("1.1.0")).toEqual(["missing-spec"]);
  });
});
