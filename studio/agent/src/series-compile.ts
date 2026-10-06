// ---------------------------------------------------------------------------
// A spec-driven episode, compiled into its edit timeline (avg-jao.2)
// ---------------------------------------------------------------------------
// An episode with an episode-spec.json is pinned to a series template release
// (ADR-0037). Its timeline is not assembled from whatever is on disk, as
// buildEditTimeline does for the others: the release's compiler, a reviewed
// and versioned piece of @studio/series, turns the spec and the measured
// narration into it. This module is the only part that touches files: it
// reads, checks and hashes everything, then hands it to the pure compiler.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compileSpec, type CompileAsset, type CompileProblem, type EditTimeline } from "@studio/series";
import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from "@studio/contracts/src/layout.mjs";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";

export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

/** Located as `<file relative to the episode>#<JSON path>`, or a bare file. */
export interface SeriesCompileProblem {
  code: string;
  message: string;
  path: string;
}

export type EpisodeCompileResult =
  | {
    ok: true;
    timeline: EditTimeline;
    warnings: string[];
    /** "<id>@<version>" of the compiler that ran. */
    compiler: string;
    template: { id: string; version: string; hash: string };
    revision: number;
  }
  | { ok: false; problems: SeriesCompileProblem[] };

/** Does this episode have a spec, and so a compiler instead of the legacy builder? */
export function isSpecDriven(episodeDir: string): boolean {
  return existsSync(join(episodeDir, EPISODE_SPEC_PATH));
}

class Stop extends Error {
  constructor(readonly problems: SeriesCompileProblem[]) {
    super(problems.map((p) => p.message).join("; "));
  }
}
const stop = (code: string, path: string, message: string): never => {
  throw new Stop([{ code, path, message }]);
};
const at = (file: string, problems: { code: string; message: string; path?: string }[]) =>
  problems.map((p) => ({ code: p.code, message: p.message, path: `${file}#${p.path ?? "$"}` }));
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * Compile the episode's spec. Reads files only; writes nothing. Every file
 * read is in the timeline's `metadata.inputs` with its hash, keyed by its
 * path relative to the episode (release files as ../../templates/…).
 */
export function compileEpisode(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string } },
): EpisodeCompileResult {
  try {
    return compile(resolve(episodeDir), options.episodeRef);
  } catch (error) {
    if (error instanceof Stop) return { ok: false, problems: error.problems };
    throw error;
  }
}

function compile(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }): EpisodeCompileResult {
  const seriesDir = dirname(dirname(episodeDir));
  const inputs: Record<string, string> = {};

  /** Read a file that must stay inside `within` once symlinks are followed. */
  const read = (file: string, within: string, missing: () => never): Buffer => {
    const key = relative(episodeDir, file).split(sep).join("/");
    if (!existsSync(file)) return missing();
    const real = realpathSync(file);
    const root = realpathSync(within);
    if (real !== root && !real.startsWith(root + sep)) {
      stop("path-escape", key, `${key} leads outside ${within === episodeDir ? "the episode" : "the series"} (${real})`);
    }
    const bytes = readFileSync(real);
    inputs[key] = sha256(bytes);
    return bytes;
  };
  const inEpisode = (path: string, where: string) => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) stop("path-escape", where, `${path} is not a path inside the episode`);
    return join(episodeDir, path);
  };

  // ── The spec and its pinned release ───────────────────────────────────────
  const specBytes = read(join(episodeDir, EPISODE_SPEC_PATH), episodeDir, () => stop("missing-spec", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} is missing`));
  let spec: any;
  try {
    spec = JSON.parse(specBytes.toString("utf-8"));
  } catch (error) {
    return stop("bad-spec", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} is not JSON: ${(error as Error).message}`);
  }
  const pin = spec?.template;
  let releaseDir: string;
  try {
    releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), pin?.id, pin?.version);
  } catch (error) {
    return stop("bad-spec", `${EPISODE_SPEC_PATH}#$.template`, `the spec does not pin an exact template release: ${(error as Error).message}`);
  }
  const releaseKey = relative(episodeDir, releaseDir).split(sep).join("/");
  if (!existsSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST))) {
    stop("missing-template", `${EPISODE_SPEC_PATH}#$.template`, `the pinned release ${pin.id}@${pin.version} is not in this series (${releaseKey})`);
  }
  const text = (name: string) => read(join(releaseDir, name), seriesDir, () => stop("missing-template", `${releaseKey}/${name}`, `${releaseKey}/${name} is missing`)).toString("utf-8");
  const bundle = {
    manifest: text(SERIES_TEMPLATE_MANIFEST),
    files: Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((name) => [name, text(name)])),
  };
  const bundleProblems = validateTemplateBundle(bundle);
  if (bundleProblems.length > 0) throw new Stop(at(`${releaseKey}/${SERIES_TEMPLATE_MANIFEST}`, bundleProblems));
  const specProblems = validateEpisodeSpec(spec, bundle);
  if (specProblems.length > 0) throw new Stop(at(EPISODE_SPEC_PATH, specProblems));
  if (JSON.stringify(spec.episodeRef) !== JSON.stringify({ channel: episodeRef.channel, series: episodeRef.series, episode: episodeRef.episode })) {
    stop("episode-mismatch", `${EPISODE_SPEC_PATH}#$.episodeRef`,
      `the spec belongs to ${spec.episodeRef.channel}/${spec.episodeRef.series}/${spec.episodeRef.episode}, not this episode`);
  }
  const template = JSON.parse(bundle.manifest);

  // ── Narration takes and their timing ──────────────────────────────────────
  const takesBytes = read(join(episodeDir, NARRATION_TAKES_PATH), episodeDir,
    () => stop("missing-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is missing: record and verify the narration takes first`));
  let narration: any;
  try {
    narration = JSON.parse(takesBytes.toString("utf-8"));
  } catch (error) {
    return stop("bad-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is not JSON: ${(error as Error).message}`);
  }
  const takesProblems = validateNarrationTakes(narration);
  if (takesProblems.length > 0) throw new Stop(at(NARRATION_TAKES_PATH, takesProblems));

  const assets: Record<string, CompileAsset> = {};
  const timings: Record<string, any> = {};
  (narration.takes as any[]).forEach((take, i) => {
    const where = `${NARRATION_TAKES_PATH}#$.takes[${i}]`;
    const audio = read(inEpisode(take.audio.path, `${where}.audio.path`), episodeDir,
      () => stop("missing-asset", `${where}.audio.path`, `take "${take.id}": ${take.audio.path} is missing`));
    if (sha256(audio) !== take.audio.hash) {
      stop("hash-mismatch", `${where}.audio.hash`, `take "${take.id}": ${take.audio.path} is not the audio the take recorded`);
    }
    assets[`narration-${take.id}`] = { path: take.audio.path, hash: take.audio.hash, kind: "audio" };
    if (!take.timing) stop("missing-timing", `${where}.timing`, `take "${take.id}" has no word timing: align it first`);
    const timingBytes = read(inEpisode(take.timing.path, `${where}.timing.path`), episodeDir,
      () => stop("missing-timing", `${where}.timing.path`, `take "${take.id}": ${take.timing.path} is missing`));
    if (sha256(timingBytes) !== take.timing.hash) {
      stop("hash-mismatch", `${where}.timing.hash`, `take "${take.id}": ${take.timing.path} changed since the take recorded it`);
    }
    let timing: unknown;
    try {
      timing = JSON.parse(timingBytes.toString("utf-8"));
    } catch (error) {
      return stop("bad-timing", take.timing.path, `${take.timing.path} is not JSON: ${(error as Error).message}`);
    }
    const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
    if (timingProblems.length > 0) throw new Stop(at(take.timing.path, timingProblems));
    timings[take.id] = timing;
  });

  // ── Images ────────────────────────────────────────────────────────────────
  // Every picture in assets/images is offered as image-<name>; the compiler
  // says which it needs. Two files with one name is a choice nobody made.
  const imagesDir = join(episodeDir, "assets", "images");
  const images = existsSync(imagesDir)
    ? readdirSync(imagesDir).filter((f) => !f.startsWith(".") && IMAGE_EXTENSIONS.includes(extname(f).toLowerCase())).sort()
    : [];
  for (const file of images) {
    const id = `image-${file.slice(0, -extname(file).length)}`;
    const path = `assets/images/${file}`;
    if (assets[id]) stop("ambiguous-asset", path, `${assets[id].path} and ${path} are both ${id.slice(6)}: keep one`);
    read(join(episodeDir, path), episodeDir, () => stop("missing-asset", path, `${path} is missing`));
    assets[id] = { path, hash: inputs[path]!, kind: "image" };
  }

  // ── Compile ───────────────────────────────────────────────────────────────
  const result = compileSpec({ spec, template, narration, timings, assets, inputs });
  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
  return {
    ok: true,
    timeline: result.timeline,
    warnings: result.warnings,
    compiler: `${template.compiler.id}@${template.compiler.version}`,
    template: { ...spec.template },
    revision: spec.revision,
  };
}

/** A compiler's paths point into its input; name the file each one is in. */
function locate(problem: CompileProblem, releaseKey: string): SeriesCompileProblem {
  const { path } = problem;
  const file = path.startsWith("$.data") || path.startsWith("$.episodeRef") ? EPISODE_SPEC_PATH
    : path.startsWith("$.units") || path.startsWith("$.takes") ? NARRATION_TAKES_PATH
    : path.startsWith("$.template") ? `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}`
    : problem.code.startsWith("timeline:") ? "artifacts/edit-timeline.json"
    : null;
  const inFile = path.startsWith("$.template") ? path.replace(/^\$\.template/, "$") : path;
  return { code: problem.code, message: problem.message, path: file ? `${file}#${inFile}` : path };
}
