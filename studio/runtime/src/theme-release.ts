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
  | "missing-template" | "release-exists" | "bad-version" | "theme-unsealed" | "theme-mismatch" | "bad-template" | "bundled-code";

export class ThemeReleaseError extends Error {
  constructor(readonly code: ThemeReleaseCode, message: string) {
    super(message);
    this.name = "ThemeReleaseError";
  }
}

const EXACT = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The theme release's theme.json, parsed and checked: valid, and the release
 * its folder says it is (a copied folder that kept its old version would be
 * pinned under a name it does not carry).
 */
function readTheme(channelDir: string, id: string, version: string): { theme: any; bytes: Buffer; releaseDir: string } {
  if (!SLUG.test(id)) fail("bad-theme", `"${id}" is not a theme id`);
  if (!EXACT.test(version)) fail("bad-version", `"${version}" is not an exact x.y.z release`);
  const releaseDir = join(channelDir, themeReleasePath(id, version));
  const themeFile = join(releaseDir, THEME_FILE);
  if (!existsSync(themeFile)) fail("missing-theme", `${themeReleasePath(id, version)}/${THEME_FILE} is not in this channel`);
  const bytes = readFileSync(themeFile);
  let theme: any;
  try {
    theme = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    return fail("bad-theme", `${THEME_FILE} is not JSON: ${(error as Error).message}`);
  }
  const problems = validateChannelTheme(theme);
  if (problems.length > 0) fail("bad-theme", problems.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; "));
  if (theme.id !== id || theme.version !== version) {
    fail("bad-theme", `${themeReleasePath(id, version)}/${THEME_FILE} says ${theme.id}@${theme.version}: a release's theme.json names its own folder`);
  }
  return { theme, bytes, releaseDir };
}

/** Each named file's sha256, read inside the release. */
function hashFiles(releaseDir: string, theme: any, label: string): Record<string, string> {
  const root = realpathSync(releaseDir);
  const files: Record<string, string> = {};
  for (const path of themeFilePaths(theme)) {
    const file = join(releaseDir, path);
    if (!existsSync(file)) fail("missing-file", `${path} is missing from ${label}`);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) fail("path-escape", `${path} is not a file inside ${label}`);
    files[path] = sha256(readFileSync(real));
  }
  return files;
}

/** Every template release of the channel that pins this theme release, as "<series>/<template>@<version>". */
function pinsOf(channelDir: string, id: string, version: string): string[] {
  const pins: string[] = [];
  const seriesRoot = join(channelDir, "series");
  if (!existsSync(seriesRoot)) return pins;
  for (const series of readdirSync(seriesRoot).sort()) {
    const templates = join(seriesRoot, series, "templates");
    if (!isDirectory(templates)) continue;
    for (const template of readdirSync(templates).sort()) {
      const releases = join(templates, template);
      if (!isDirectory(releases)) continue;
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
export function sealTheme(channelDir: string, id: string, version: string, options: { dryRun?: boolean } = {}): { hash: string; files: Record<string, string> } {
  const { theme, releaseDir } = readTheme(channelDir, id, version);
  if (theme.files) fail("sealed", `${id}@${version} is sealed already: a release never changes, make a new one`);
  const pins = pinsOf(channelDir, id, version);
  if (pins.length > 0) fail("pinned", `${id}@${version} is pinned by ${pins.join(", ")}: sealing would change the theme they pinned; make a new release`);
  const files = hashFiles(releaseDir, theme, `${id}@${version}`);
  const sealed = { ...theme, files };
  const problems = validateChannelTheme(sealed);
  if (problems.length > 0) fail("bad-theme", problems.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; "));
  const text = `${JSON.stringify(sealed, null, 2)}\n`;
  if (!options.dryRun) writeAtomically(join(releaseDir, THEME_FILE), text);
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
  /** The compiler and validator versions the new release names, when they change (registered or not is the loader's check). */
  compiler?: string;
  validator?: string;
  /** Check everything, write nothing. */
  dryRun?: boolean;
}

/**
 * Release library/<channel>/series/<series>/templates/<id>/<version> as a copy
 * of `from`, pinned to `theme` when given. Writes nothing unless the new
 * release is valid. Returns its manifest's hash, the one an episode pins.
 */
export function releaseTemplate(seriesDir: string, options: ReleaseTemplateOptions): { path: string; hash: string; theme?: { id: string; version: string; hash: string } } {
  const { id, from, version } = options;
  if (!SLUG.test(id)) fail("missing-template", `"${id}" is not a template id`);
  for (const v of [from, version, options.compiler, options.validator]) if (v !== undefined && !EXACT.test(v)) fail("bad-version", `"${v}" is not an exact x.y.z release`);
  if (compareReleases(version, from) <= 0) fail("bad-version", `${version} does not come after ${from}`);
  const templates = join(seriesDir, "templates", id);
  const source = join(templates, from);
  const target = join(templates, version);
  if (!existsSync(join(source, SERIES_TEMPLATE_MANIFEST))) fail("missing-template", `${id}@${from} is not in this series`);
  if (existsSync(target)) fail("release-exists", `${id}@${version} exists already: a release never changes`);

  let manifest: any;
  try {
    manifest = JSON.parse(readFileSync(join(source, SERIES_TEMPLATE_MANIFEST), "utf-8"));
  } catch (error) {
    return fail("bad-template", `${id}@${from}'s ${SERIES_TEMPLATE_MANIFEST} is not JSON: ${(error as Error).message}`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) fail("bad-template", `${id}@${from}'s ${SERIES_TEMPLATE_MANIFEST} is not a release manifest`);
  manifest.version = version;
  for (const role of ["compiler", "validator"] as const) {
    const v = options[role];
    if (v === undefined) continue;
    if (!manifest[role] || typeof manifest[role] !== "object") fail("bad-template", `${id}@${from} names no ${role} to move to ${v}`);
    // Its own code says which version it is (avg-d1x): renaming it here would make a release that never compiles.
    if (manifest[role].bundle) fail("bundled-code", `${id}@${from} carries its own ${role} (${manifest[role].bundle.path}): release a copy, change its ${role}/index.ts and its version there, then vpr template seal it`);
    manifest[role] = { ...manifest[role], version: v };
  }
  let themePin: { id: string; version: string; hash: string } | undefined;
  if (options.theme) {
    const channelDir = dirname(dirname(seriesDir));
    const label = `${options.theme.id}@${options.theme.version}`;
    const { theme, bytes, releaseDir } = readTheme(channelDir, options.theme.id, options.theme.version);
    if (!theme.files) fail("theme-unsealed", `${label} is not sealed: vpr theme seal it first`);
    // Pinned as it is now: every room still the one it sealed.
    const now = hashFiles(releaseDir, theme, label);
    for (const [path, hash] of Object.entries(now)) {
      if (theme.files[path] !== hash) fail("theme-mismatch", `${path} is not the file ${label} sealed: a release never changes, make a new one`);
    }
    themePin = { id: options.theme.id, version: options.theme.version, hash: sha256(bytes) };
    manifest.theme = themePin;
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const files: Record<string, string> = {};
  for (const name of Object.values(SERIES_TEMPLATE_FILES)) {
    const file = join(source, name);
    if (!existsSync(file)) fail("missing-template", `${id}@${from} has no ${name}`);
    files[name] = readFileSync(file, "utf-8");
  }
  const problems = validateTemplateBundle({ manifest: manifestText, files });
  if (problems.length > 0) fail("bad-template", problems.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; "));

  const path = relative(seriesDir, target).split(sep).join("/");
  const result = { path, hash: sha256(manifestText), ...(themePin ? { theme: themePin } : {}) };
  if (options.dryRun) return result;
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
  return result;
}
