// ---------------------------------------------------------------------------
// A new episode's spec, drafted from its series' template release (avg-jao.4)
// ---------------------------------------------------------------------------
// The first stage of the series-production pipeline. The draft is pinned to
// the exact release the caller names (ADR-0037: no "latest", no ranges) and
// keeps every __FILL__ marker for the editor; nothing is invented. An
// existing spec is never replaced.
// ---------------------------------------------------------------------------

import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep, basename } from "node:path";
import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from "@studio/contracts/src/layout.mjs";
import {
  instantiateEpisodeSpec,
  placeholderPaths,
  SERIES_TEMPLATE_FILES,
  validateEpisodeSpec,
  validateTemplateBundle,
  type EpisodeSpec,
} from "@studio/contracts/src/series-templates.mjs";

export interface SpecInitProblem {
  code: string;
  message: string;
  path: string;
}

export type SpecInitResult =
  | {
    ok: true;
    /** episode-spec.json, relative to the episode. */
    path: string;
    spec: EpisodeSpec;
    /** JSON paths of every __FILL__ the editor must replace. */
    placeholders: string[];
  }
  | { ok: false; problems: SpecInitProblem[] };

/** What a filesystem without hard links answers to link(2). */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);
const EXACT = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const fail = (code: string, path: string, message: string): SpecInitResult => ({ ok: false, problems: [{ code, path, message }] });

/** Write a draft episode-spec.json pinned to `template` (exact id and version). */
export function initEpisodeSpec(
  episodeDir: string,
  options: {
    episodeRef: { channel: string; series: string; episode: string };
    template: { id: string; version: string };
  },
): SpecInitResult {
  const dir = resolve(episodeDir);
  const target = join(dir, EPISODE_SPEC_PATH);
  if (existsSync(target)) {
    return fail("spec-exists", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} already exists: edit it, never replace it`);
  }
  const { id, version } = options.template;
  if (!EXACT.test(version)) {
    return fail("bad-version", "template.version", `"${version}" is not an exact x.y.z release: no ranges, no latest`);
  }

  const seriesDir = dirname(dirname(dir));
  let releaseDir: string;
  try {
    releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), id, version);
  } catch (error) {
    return fail("bad-version", "template", (error as Error).message);
  }
  const releaseKey = relative(dir, releaseDir).split(sep).join("/");
  if (!existsSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST))) {
    return fail("missing-template", releaseKey, `the release ${id}@${version} is not in this series (${releaseKey})`);
  }

  // Exact UTF-8 bytes, from files that stay inside the series.
  const root = realpathSync(seriesDir);
  const read = (name: string): string | SpecInitResult => {
    const file = join(releaseDir, name);
    if (!existsSync(file)) return fail("missing-template", `${releaseKey}/${name}`, `${releaseKey}/${name} is missing`);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) {
      return fail("path-escape", `${releaseKey}/${name}`, `${releaseKey}/${name} is not a file inside the series`);
    }
    return readFileSync(real, "utf-8");
  };
  const texts: Record<string, string> = {};
  for (const name of [SERIES_TEMPLATE_MANIFEST, ...Object.values(SERIES_TEMPLATE_FILES)]) {
    const text = read(name);
    if (typeof text !== "string") return text;
    texts[name] = text;
  }
  const { [SERIES_TEMPLATE_MANIFEST]: manifest, ...files } = texts;
  const bundle = { manifest: manifest!, files };
  const problems = validateTemplateBundle(bundle);
  if (problems.length > 0) {
    return { ok: false, problems: problems.map((p) => ({ code: "bad-template", message: `${p.code}: ${p.message}`, path: `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}#${p.path}` })) };
  }

  const spec = instantiateEpisodeSpec(bundle, options.episodeRef);
  // Written whole beside its name, then linked into place: a link never
  // replaces an existing file, so a spec that appeared meanwhile survives.
  const text = `${JSON.stringify(spec, null, 2)}\n`;
  const temp = `${target}.${process.pid}.tmp`;
  const exists = () => fail("spec-exists", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} already exists: edit it, never replace it`);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(temp, text, "utf-8");
    try {
      linkSync(temp, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return exists();
      if (!NO_HARD_LINKS.has(code ?? "")) throw error;
      // A filesystem without hard links (exFAT, some network mounts): create
      // the file exclusively instead — it still never replaces one.
      try {
        writeFileSync(target, text, { encoding: "utf-8", flag: "wx" });
      } catch (second) {
        if ((second as NodeJS.ErrnoException).code === "EEXIST") return exists();
        throw second;
      }
    }
  } finally {
    rmSync(temp, { force: true });
  }
  return { ok: true, path: EPISODE_SPEC_PATH, spec, placeholders: placeholderPaths(spec.data, "$.data") };
}

export type SpecUpgradeResult =
  | {
    ok: true;
    path: string;
    spec: EpisodeSpec;
    /** The release it was pinned to before. */
    from: { id: string; version: string; hash: string };
  }
  | { ok: false; problems: SpecInitProblem[] };

const later = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! > pb[i]!;
  return false;
};

/**
 * Pin the episode's spec to a newer release of the same template (a new look,
 * a corrected standard): its data is kept and must hold under the new
 * release's schema, its revision goes up by one. Never an implicit latest.
 */
export function upgradeEpisodeSpec(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string }; version: string },
): SpecUpgradeResult {
  const dir = resolve(episodeDir);
  const target = join(dir, EPISODE_SPEC_PATH);
  if (!existsSync(target)) return fail("missing-spec", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} is missing: draft one with pva_init_spec`) as SpecUpgradeResult;
  let spec: EpisodeSpec;
  try {
    spec = JSON.parse(readFileSync(target, "utf-8"));
  } catch (error) {
    return fail("bad-spec", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} is not JSON: ${(error as Error).message}`) as SpecUpgradeResult;
  }
  const owner = spec.episodeRef;
  const ref = options.episodeRef;
  if (!owner || owner.channel !== ref.channel || owner.series !== ref.series || owner.episode !== ref.episode) {
    return fail("episode-mismatch", `${EPISODE_SPEC_PATH}#$.episodeRef`, `the spec belongs to ${owner?.channel}/${owner?.series}/${owner?.episode}, not ${ref.channel}/${ref.series}/${ref.episode}`) as SpecUpgradeResult;
  }
  const from = spec.template;
  const { version } = options;
  if (!EXACT.test(version)) return fail("bad-version", "template.version", `"${version}" is not an exact x.y.z release: no ranges, no latest`) as SpecUpgradeResult;
  if (!from || !EXACT.test(from.version) || !later(version, from.version)) {
    return fail("bad-version", `${EPISODE_SPEC_PATH}#$.template.version`, `${version} does not come after the pinned ${from?.id}@${from?.version}`) as SpecUpgradeResult;
  }

  const seriesDir = dirname(dirname(dir));
  const releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), from.id, version);
  const releaseKey = relative(dir, releaseDir).split(sep).join("/");
  if (!existsSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST))) {
    return fail("missing-template", releaseKey, `the release ${from.id}@${version} is not in this series (${releaseKey})`) as SpecUpgradeResult;
  }
  const root = realpathSync(seriesDir);
  const texts: Record<string, string> = {};
  for (const name of [SERIES_TEMPLATE_MANIFEST, ...Object.values(SERIES_TEMPLATE_FILES)]) {
    const file = join(releaseDir, name);
    if (!existsSync(file)) return fail("missing-template", `${releaseKey}/${name}`, `${releaseKey}/${name} is missing`) as SpecUpgradeResult;
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) {
      return fail("path-escape", `${releaseKey}/${name}`, `${releaseKey}/${name} is not a file inside the series`) as SpecUpgradeResult;
    }
    texts[name] = readFileSync(real, "utf-8");
  }
  const { [SERIES_TEMPLATE_MANIFEST]: manifest, ...files } = texts;
  const bundle = { manifest: manifest!, files };
  const broken = validateTemplateBundle(bundle);
  if (broken.length > 0) {
    return { ok: false, problems: broken.map((p) => ({ code: "bad-template", message: `${p.code}: ${p.message}`, path: `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}#${p.path}` })) };
  }
  const draft = instantiateEpisodeSpec(bundle, spec.episodeRef);
  const upgraded = { ...spec, revision: spec.revision + 1, template: draft.template };
  // A draft stays a draft: only what the new release refuses stops the move.
  const problems = validateEpisodeSpec(upgraded, bundle).filter((p: SpecInitProblem) => p.code !== "unfilled");
  if (problems.length > 0) {
    return { ok: false, problems: problems.map((p: SpecInitProblem) => ({ code: "bad-spec", message: `${p.code}: ${p.message}`, path: `${EPISODE_SPEC_PATH}#${p.path}` })) };
  }
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(upgraded, null, 2)}\n`, "utf-8");
  renameSync(temp, target);
  return { ok: true, path: EPISODE_SPEC_PATH, spec: upgraded, from };
}
