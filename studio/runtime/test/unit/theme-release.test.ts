import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
import { SERIES_TEMPLATE_FILES, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { releaseTemplate, sealTheme, ThemeReleaseError } from "../../src/theme-release.js";

/**
 * A new look (ADR-0040): a theme release sealed with its files' hashes, then
 * a template release pinned to it. Laid out from the Dentro i versi fixtures:
 * the theme dentro-i-versi@1.0.0 and the release dentro-i-versi-long@1.0.0
 * that pins it.
 */

const FIXTURES = fileURLToPath(new URL("../../../series/fixtures/", import.meta.url));
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let root: string;
const channelDir = () => join(root, "dentro-i-versi");
const seriesDir = () => join(channelDir(), "series", "long");
const themeDir = (version: string) => join(channelDir(), "themes", "dentro-i-versi", version);
const releaseDir = (version: string) => join(seriesDir(), "templates", "dentro-i-versi-long", version);

/** A copy of the 1.0.0 theme as a new, unsealed release. */
function copyTheme(version: string): void {
  cpSync(themeDir("1.0.0"), themeDir(version), { recursive: true });
  const file = join(themeDir(version), "theme.json");
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf-8")), version }, null, 2)}\n`);
}

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ThemeReleaseError) return error.code;
    throw error;
  }
  return "ok";
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "theme-release-"));
  cpSync(join(FIXTURES, "themes", "dentro-i-versi", "1.0.0"), themeDir("1.0.0"), { recursive: true });
  cpSync(join(FIXTURES, "dentro-i-versi-long", "1.0.0", "release"), releaseDir("1.0.0"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("sealTheme", () => {
  it("writes each named file's hash and returns the new theme.json's hash", () => {
    copyTheme("1.1.0");
    const sealed = sealTheme(channelDir(), "dentro-i-versi", "1.1.0");
    const text = readFileSync(join(themeDir("1.1.0"), "theme.json"));
    expect(sealed.hash).toBe(sha(text));
    const theme = JSON.parse(text.toString("utf-8"));
    expect(validateChannelTheme(theme)).toEqual([]);
    expect(theme.files).toEqual(sealed.files);
    expect(Object.keys(theme.files).sort()).toEqual(["rooms/atrio.png", "rooms/monitor.mp4", "rooms/sala.png"]);
    expect(theme.files["rooms/atrio.png"]).toBe(sha(readFileSync(join(themeDir("1.1.0"), "rooms/atrio.png"))));
  });

  it("never seals a release a template release pins", () => {
    expect(codeOf(() => sealTheme(channelDir(), "dentro-i-versi", "1.0.0"))).toBe("pinned");
    expect(JSON.parse(readFileSync(join(themeDir("1.0.0"), "theme.json"), "utf-8")).files).toBeUndefined();
  });

  it("refuses a theme.json whose id or version is not its folder's", () => {
    cpSync(themeDir("1.0.0"), themeDir("1.1.0"), { recursive: true });
    expect(codeOf(() => sealTheme(channelDir(), "dentro-i-versi", "1.1.0"))).toBe("bad-theme");
    expect(JSON.parse(readFileSync(join(themeDir("1.1.0"), "theme.json"), "utf-8")).files).toBeUndefined();
  });

  it("validates without writing on a dry run", () => {
    copyTheme("1.1.0");
    const before = readFileSync(join(themeDir("1.1.0"), "theme.json"), "utf-8");
    const dry = sealTheme(channelDir(), "dentro-i-versi", "1.1.0", { dryRun: true });
    expect(Object.keys(dry.files)).toHaveLength(3);
    expect(readFileSync(join(themeDir("1.1.0"), "theme.json"), "utf-8")).toBe(before);
    expect(codeOf(() => sealTheme(channelDir(), "dentro-i-versi", "1.0.0", { dryRun: true }))).toBe("pinned");
  });

  it("refuses a sealed release, a missing file, a missing release", () => {
    copyTheme("1.1.0");
    sealTheme(channelDir(), "dentro-i-versi", "1.1.0");
    expect(codeOf(() => sealTheme(channelDir(), "dentro-i-versi", "1.1.0"))).toBe("sealed");
    copyTheme("1.2.0");
    rmSync(join(themeDir("1.2.0"), "rooms/monitor.mp4"));
    expect(codeOf(() => sealTheme(channelDir(), "dentro-i-versi", "1.2.0"))).toBe("missing-file");
    expect(JSON.parse(readFileSync(join(themeDir("1.2.0"), "theme.json"), "utf-8")).files).toBeUndefined();
    expect(codeOf(() => sealTheme(channelDir(), "dentro-i-versi", "9.9.9"))).toBe("missing-theme");
  });
});

describe("releaseTemplate", () => {
  it("copies a release to a new version pinned to a sealed theme, valid as a bundle", () => {
    copyTheme("1.1.0");
    const sealed = sealTheme(channelDir(), "dentro-i-versi", "1.1.0");
    const released = releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.1.0", theme: { id: "dentro-i-versi", version: "1.1.0" } });
    expect(released.path).toBe("templates/dentro-i-versi-long/1.1.0");
    expect(released.theme).toEqual({ id: "dentro-i-versi", version: "1.1.0", hash: sealed.hash });
    const manifest = readFileSync(join(releaseDir("1.1.0"), "series-template.json"), "utf-8");
    expect(released.hash).toBe(sha(manifest));
    expect(JSON.parse(manifest)).toMatchObject({ version: "1.1.0", theme: released.theme });
    const files = Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((name) => [name, readFileSync(join(releaseDir("1.1.0"), name), "utf-8")]));
    expect(validateTemplateBundle({ manifest, files })).toEqual([]);
    // The release it came from is untouched.
    expect(JSON.parse(readFileSync(join(releaseDir("1.0.0"), "series-template.json"), "utf-8")).version).toBe("1.0.0");
  });

  it("names a new compiler or validator version, and refuses one that is not exact", () => {
    const released = releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.2.0", compiler: "1.1.0", validator: "1.0.1" });
    const manifest = JSON.parse(readFileSync(join(releaseDir("1.2.0"), "series-template.json"), "utf-8"));
    expect(manifest.compiler).toEqual({ id: "dentro-i-versi-long", version: "1.1.0" });
    expect(manifest.validator).toEqual({ id: "dentro-i-versi-long", version: "1.0.1" });
    expect(released.hash).toBe(sha(readFileSync(join(releaseDir("1.2.0"), "series-template.json"))));
    expect(codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.3.0", compiler: "latest" }))).toBe("bad-version");
  });

  it("refuses to rename a compiler or validator the release carries as its own code (avg-d1x)", () => {
    const manifestFile = join(releaseDir("1.0.0"), "series-template.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
    manifest.compiler.bundle = { path: "compiler/compiler.cjs", hash: `sha256:${"a".repeat(64)}` };
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const refused = codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.2.0", compiler: "1.1.0" }));
    expect(refused).toBe("bundled-code");
    expect(existsSync(releaseDir("1.2.0"))).toBe(false);
  });

  it("keeps the source's theme pin when given no theme", () => {
    const released = releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.0.1" });
    expect(released.theme).toBeUndefined();
    const pin = (version: string) => JSON.parse(readFileSync(join(releaseDir(version), "series-template.json"), "utf-8")).theme;
    expect(pin("1.0.1")).toEqual(pin("1.0.0"));
  });

  it("refuses a source release that is broken, as a release error", () => {
    cpSync(releaseDir("1.0.0"), releaseDir("1.0.1"), { recursive: true });
    writeFileSync(join(releaseDir("1.0.1"), "series-template.json"), "{ not json");
    expect(codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.1", version: "1.1.0" }))).toBe("bad-template");
    cpSync(releaseDir("1.0.0"), releaseDir("1.0.2"), { recursive: true });
    rmSync(join(releaseDir("1.0.2"), "FORMAT.md"));
    expect(codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.2", version: "1.1.0" }))).toBe("missing-template");
    expect(existsSync(releaseDir("1.1.0"))).toBe(false);
  });

  it("refuses a sealed theme whose room changed since, or whose theme.json is not its folder's", () => {
    copyTheme("1.1.0");
    sealTheme(channelDir(), "dentro-i-versi", "1.1.0");
    writeFileSync(join(themeDir("1.1.0"), "rooms/sala.png"), "another sala");
    const release = (theme: string) => codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.1.0", theme: { id: "dentro-i-versi", version: theme } }));
    expect(release("1.1.0")).toBe("theme-mismatch");
    cpSync(themeDir("1.1.0"), themeDir("1.2.0"), { recursive: true });
    expect(release("1.2.0")).toBe("bad-theme");
    expect(existsSync(releaseDir("1.1.0"))).toBe(false);
  });

  it("validates without writing on a dry run", () => {
    copyTheme("1.1.0");
    sealTheme(channelDir(), "dentro-i-versi", "1.1.0");
    const dry = releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.1.0", theme: { id: "dentro-i-versi", version: "1.1.0" }, dryRun: true });
    expect(dry.path).toBe("templates/dentro-i-versi-long/1.1.0");
    expect(existsSync(releaseDir("1.1.0"))).toBe(false);
    expect(codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from: "1.0.0", version: "1.0.0", dryRun: true }))).toBe("bad-version");
  });

  it("refuses an unsealed or missing theme, a version not after its source, a missing source, an existing release", () => {
    copyTheme("1.1.0");
    const release = (version: string, from = "1.0.0", theme = "1.1.0") =>
      codeOf(() => releaseTemplate(seriesDir(), { id: "dentro-i-versi-long", from, version, theme: { id: "dentro-i-versi", version: theme } }));
    expect(release("1.1.0")).toBe("theme-unsealed");
    expect(existsSync(releaseDir("1.1.0"))).toBe(false);
    sealTheme(channelDir(), "dentro-i-versi", "1.1.0");
    expect(release("1.0.0")).toBe("bad-version");
    expect(release("1.6.0", "1.5.0")).toBe("missing-template");
    expect(release("1.2.0", "1.0.0", "1.9.0")).toBe("missing-theme");
    expect(release("1.1.0")).toBe("ok");
    expect(release("1.1.0")).toBe("release-exists");
  });
});
