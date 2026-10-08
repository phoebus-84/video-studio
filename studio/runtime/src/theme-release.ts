// ---------------------------------------------------------------------------
// A new look: sealing a theme release, releasing a template on it (avg-dcf.6.10)
// ---------------------------------------------------------------------------
// ADR-0040: changing a channel's look is a new theme release and a new series
// template release. sealTheme writes the release's files and their hashes
// into its theme.json, so the loader holds every room to them; releaseTemplate
// copies a template release to a new version pinned to a sealed theme. Both
// refuse rather than change anything a release already pins.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { THEME_FILE, themeFilePaths, themeReleasePath, validateChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
import { SERIES_TEMPLATE_FILES, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";

export type ThemeReleaseCode =
  | "missing-theme" | "bad-theme" | "sealed" | "pinned" | "missing-file" | "path-escape"
  | "missing-template" | "release-exists" | "bad-version" | "theme-unsealed" | "bad-template";

export class ThemeReleaseError extends Error {
  constructor(readonly code: ThemeReleaseCode, message: string) {
    super(message);
    this.name = "ThemeReleaseError";
  }
}

const EXACT = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code: ThemeReleaseCode, message: string): never => {
  throw new ThemeReleaseError(code, message);
};

/** -1, 0 or 1 as exact version a is before, equal to or after b. */
export function compareReleases(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

function writeAtomically(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

/** Every template release of the channel that pins this theme release, as "<series>/<template>@<version>". */
function pinsOf(channelDir: string, id: string, version: string): string[] {
  const pins: string[] = [];
  const seriesRoot = join(channelDir, "series");
  if (!existsSync(seriesRoot)) return pins;
  for (const series of readdirSync(seriesRoot).sort()) {
    const templates = join(seriesRoot, series, "templates");
    if (!existsSync(templates) || !statSync(templates).isDirectory()) continue;
    for (const template of readdirSync(templates).sort()) {
      const releases = join(templates, template);
      if (!statSync(releases).isDirectory()) continue;
      for (const release of readdirSync(releases).sort()) {
        const manifest = join(releases, release, SERIES_TEMPLATE_MANIFEST);
        if (!existsSync(manifest)) continue;
        try {
          const theme = JSON.parse(readFileSync(manifest, "utf-8"))?.theme;
          if (theme?.id === id && theme?.version === version) pins.push(`${series}/${template}@${release}`);
        } catch {
          // A broken manifest pins nothing; its own loader reports it.
        }
      }
    }
  }
  return pins;
}

/**
 * Seal the theme release library/<channel>/themes/<id>/<version>: list each
 * file it names with its sha256 in theme.json. Returns the new theme.json's
 * hash, the one a template release pins.
 */
export function sealTheme(channelDir: string, id: string, version: string): { hash: string; files: Record<string, string> } {
  if (!EXACT.test(version)) fail("bad-version", `"${version}" is not an exact x.y.z release`);
  const releaseDir = join(channelDir, themeReleasePath(id, version));
  const themeFile = join(releaseDir, THEME_FILE);
  if (!existsSync(themeFile)) fail("missing-theme", `${themeReleasePath(id, version)}/${THEME_FILE} is not in this channel`);
  let theme: any;
  try {
    theme = JSON.parse(readFileSync(themeFile, "utf-8"));
  } catch (error) {
    return fail("bad-theme", `${THEME_FILE} is not JSON: ${(error as Error).message}`);
  }
  if (theme.files) fail("sealed", `${id}@${version} is sealed already: a release never changes, make a new one`);
  const pins = pinsOf(channelDir, id, version);
  if (pins.length > 0) fail("pinned", `${id}@${version} is pinned by ${pins.join(", ")}: sealing would change the theme they pinned; make a new release`);
  const before = validateChannelTheme(theme);
  if (before.length > 0) fail("bad-theme", before.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; "));

  const root = realpathSync(releaseDir);
  const files: Record<string, string> = {};
  for (const path of themeFilePaths(theme)) {
    const file = join(releaseDir, path);
    if (!existsSync(file)) fail("missing-file", `${path} is missing from ${id}@${version}`);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) fail("path-escape", `${path} is not a file inside ${id}@${version}`);
    files[path] = sha256(readFileSync(real));
  }
  const sealed = { ...theme, files };
  const problems = validateChannelTheme(sealed);
  if (problems.length > 0) fail("bad-theme", problems.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; "));
  const text = `${JSON.stringify(sealed, null, 2)}\n`;
  writeAtomically(themeFile, text);
  return { hash: sha256(text), files };
}

export interface ReleaseTemplateOptions {
  id: string;
  /** The release copied. */
  from: string;
  /** The new release: greater than `from`, not there yet. */
  version: string;
  /** The sealed theme release the new release pins; without it, the copied pin stays. */
  theme?: { id: string; version: string };
}

/**
 * Release library/<channel>/series/<series>/templates/<id>/<version> as a copy
 * of `from`, pinned to `theme` when given. Writes nothing unless the new
 * release is valid. Returns its manifest's hash, the one an episode pins.
 */
export function releaseTemplate(seriesDir: string, options: ReleaseTemplateOptions): { path: string; hash: string; theme?: { id: string; version: string; hash: string } } {
  const { id, from, version } = options;
  for (const v of [from, version]) if (!EXACT.test(v)) fail("bad-version", `"${v}" is not an exact x.y.z release`);
  if (compareReleases(version, from) <= 0) fail("bad-version", `${version} does not come after ${from}`);
  const templates = join(seriesDir, "templates", id);
  const source = join(templates, from);
  const target = join(templates, version);
  if (!existsSync(join(source, SERIES_TEMPLATE_MANIFEST))) fail("missing-template", `${id}@${from} is not in this series`);
  if (existsSync(target)) fail("release-exists", `${id}@${version} exists already: a release never changes`);

  const manifest = JSON.parse(readFileSync(join(source, SERIES_TEMPLATE_MANIFEST), "utf-8"));
  manifest.version = version;
  let themePin: { id: string; version: string; hash: string } | undefined;
  if (options.theme) {
    const channelDir = dirname(dirname(seriesDir));
    const themeFile = join(channelDir, themeReleasePath(options.theme.id, options.theme.version), THEME_FILE);
    if (!existsSync(themeFile)) fail("missing-theme", `${options.theme.id}@${options.theme.version} is not in this channel`);
    const bytes = readFileSync(themeFile);
    let theme: any;
    try {
      theme = JSON.parse(bytes.toString("utf-8"));
    } catch (error) {
      return fail("bad-theme", `${THEME_FILE} is not JSON: ${(error as Error).message}`);
    }
    if (!theme.files) fail("theme-unsealed", `${options.theme.id}@${options.theme.version} is not sealed: vpr theme seal it first`);
    themePin = { id: options.theme.id, version: options.theme.version, hash: sha256(bytes) };
    manifest.theme = themePin;
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const files: Record<string, string> = {};
  for (const name of Object.values(SERIES_TEMPLATE_FILES)) files[name] = readFileSync(join(source, name), "utf-8");
  const problems = validateTemplateBundle({ manifest: manifestText, files });
  if (problems.length > 0) fail("bad-template", problems.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; "));

  // Built beside its name, then moved into place whole.
  const temp = `${target}.${process.pid}.tmp`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  try {
    cpSync(source, temp, { recursive: true });
    writeFileSync(join(temp, SERIES_TEMPLATE_MANIFEST), manifestText, "utf-8");
    renameSync(temp, target);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return { path: relative(seriesDir, target).split(sep).join("/"), hash: sha256(manifestText), ...(themePin ? { theme: themePin } : {}) };
}
