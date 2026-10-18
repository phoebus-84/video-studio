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
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkSeries, compileSpec, type CompileAsset, type CompileInput, type CompileProblem, type EditTimeline, type Finding } from "@studio/series";
import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from "@studio/contracts/src/layout.mjs";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
import { THEME_FILE, themeReleasePath, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
import { PINS_DIR, sourceDir, validateSourcePin } from "@studio/contracts/src/source-pins.mjs";
import { releaseCodeOf } from "./release-code.js";
import { kitDirOf, readKitRelease } from "./kit-code.js";
import { isApplicationKit } from "@av/remotion-composer";
import { KIT_BUNDLE, KIT_RELEASE_FILE } from "@studio/contracts/src/kit-releases.mjs";

export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
/** What the loader offers from assets/: every file in each folder, as <prefix>-<name>. */
const OFFERED = [
  { dir: "images", prefix: "image", kind: "image", extensions: [".png", ".jpg", ".jpeg", ".webp", ".svg"] },
  { dir: "sounds", prefix: "sound", kind: "audio", extensions: [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"] },
  { dir: "video", prefix: "video", kind: "video", extensions: [".mp4", ".webm", ".mov", ".mkv", ".ogv"] },
] as const;

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

/** A series rule broken by the timeline about to be rendered, located like a problem. */
export interface SeriesFinding extends SeriesCompileProblem {
  severity: "error" | "warning";
}

export type EpisodeLoadResult =
  | { ok: true; input: CompileInput; releaseKey: string; /** What loads but should not stay so (theme-unsealed). */ warnings: SeriesCompileProblem[] }
  | { ok: false; problems: SeriesCompileProblem[] };

export type EpisodeCheckResult =
  | {
    ok: true;
    /** What the release's compiler makes of the episode: the reference. */
    compiled: EditTimeline;
    /** "<id>@<version>" of the validator that ran; null when the template names none. */
    validator: string | null;
    findings: SeriesFinding[];
  }
  | { ok: false; problems: SeriesCompileProblem[] };

/**
 * The ids of the episode's pins whose inventory holds takes
 * (artifacts/narration/takes.json): its narration comes from them. Pins that
 * do not parse are left to the loader to report.
 */
export function pinsBringingTakes(episodeDir: string): string[] {
  const pinsDir = join(episodeDir, PINS_DIR);
  const out: string[] = [];
  for (const name of existsSync(pinsDir) ? readdirSync(pinsDir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort() : []) {
    try {
      const pin = JSON.parse(readFileSync(join(pinsDir, name), "utf-8"));
      if ((pin?.source?.kind === "episode" || pin?.source?.kind === "channel-source") && pin?.files?.[NARRATION_TAKES_PATH]) out.push(String(pin.id));
    } catch { /* reported when the episode loads */ }
  }
  return out;
}

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
 * Read, check and hash everything the episode's compiler needs. Reads files
 * only; writes nothing. Every file read is in `input.inputs` with its hash,
 * keyed by its path relative to the episode (release files as ../../templates/…).
 */
export function loadEpisode(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string } },
): EpisodeLoadResult {
  try {
    return load(resolve(episodeDir), options.episodeRef);
  } catch (error) {
    if (error instanceof Stop) return { ok: false, problems: error.problems };
    throw error;
  }
}

/**
 * The library kits a spec-driven episode's release pins (avg-d1x), as a
 * render or a layout sheet receives them; none for an episode without a spec
 * or one that does not load (its timeline cannot be decided either).
 */
export function libraryKitsOf(episodeDir: string, options: { episodeRef: { channel: string; series: string; episode: string } }): { name: string; version: string; file: string; hash: string }[] {
  if (!isSpecDriven(episodeDir)) return [];
  const loaded = loadEpisode(episodeDir, options);
  return loaded.ok ? (loaded.input.kits ?? []).map(({ name, version, file, hash }) => ({ name, version, file, hash })) : [];
}

/**
 * Folders outside the episode a render may take assets from: the theme
 * release its template release pins (library/<channel>/themes/<id>/<version>,
 * ADR-0040), or none. Whatever cannot be read gives none: loading the
 * episode reports why.
 */
export function sharedRootsOf(episodeDir: string): string[] {
  try {
    const dir = resolve(episodeDir);
    const seriesDir = dirname(dirname(dir));
    const pin = JSON.parse(readFileSync(join(dir, EPISODE_SPEC_PATH), "utf-8"))?.template;
    const releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), pin?.id, pin?.version);
    const theme = JSON.parse(readFileSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST), "utf-8"))?.theme;
    const roots: string[] = [];
    if (theme) {
      const themeDir = join(dirname(dirname(seriesDir)), themeReleasePath(theme.id, theme.version));
      if (existsSync(themeDir)) roots.push(themeDir);
    }
    // the episodes it pins (ADR-0035): their pictures and takes are its assets too
    const channelDir = dirname(dirname(seriesDir));
    const pinsDir = join(dir, PINS_DIR);
    for (const name of existsSync(pinsDir) ? readdirSync(pinsDir).filter((n) => n.endsWith(".json")).sort() : []) {
      try {
        const pinDoc = JSON.parse(readFileSync(join(pinsDir, name), "utf-8"));
        // only a pin that holds names a root
        if (validateSourcePin(pinDoc).length > 0 || `${pinDoc.id}.json` !== name) continue;
        const source = pinDoc.source;
        if (source?.kind !== "episode" && source?.kind !== "channel-source") continue;
        const srcDir = sourceDir(dirname(channelDir), basename(channelDir), source);
        if (existsSync(srcDir)) roots.push(srcDir);
      } catch { /* loading the episode reports it */ }
    }
    return roots;
  } catch {
    return [];
  }
}

/** Compile the episode's spec with its release's compiler. Writes nothing. */
export function compileEpisode(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string } },
): EpisodeCompileResult {
  const loaded = loadEpisode(episodeDir, options);
  if (!loaded.ok) return loaded;
  const { input, releaseKey } = loaded;
  const result = compileSpec(input);
  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
  return {
    ok: true,
    timeline: result.timeline,
    warnings: [...loaded.warnings.map((w) => `${w.code} at ${w.path}: ${w.message}`), ...result.warnings],
    compiler: `${input.template.compiler.id}@${input.template.compiler.version}`,
    template: { ...input.spec.template },
    revision: input.spec.revision,
  };
}

/**
 * The series rules on the timeline about to be rendered (by default, the
 * one the compiler makes). Writes nothing.
 */
export function checkEpisode(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string }; timeline?: EditTimeline },
): EpisodeCheckResult {
  const loaded = loadEpisode(episodeDir, options);
  if (!loaded.ok) return loaded;
  const { input, releaseKey } = loaded;
  const result = compileSpec(input);
  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
  const checked = checkSeries({ ...input, compiled: result.timeline, timeline: options.timeline ?? result.timeline });
  return {
    ok: true,
    compiled: result.timeline,
    validator: checked.validator,
    findings: [
      ...loaded.warnings.map((w) => ({ ...w, severity: "warning" as const })),
      ...checked.findings.map((f: Finding) => ({ ...locate(f, releaseKey), severity: f.severity })),
    ],
  };
}

function load(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }): EpisodeLoadResult {
  const seriesDir = dirname(dirname(episodeDir));
  const inputs: Record<string, string> = {};
  const warnings: SeriesCompileProblem[] = [];

  /** Read a file that must stay inside `within` once symlinks are followed. */
  const read = (file: string, within: string, missing: () => never): Buffer => {
    const key = relative(episodeDir, file).split(sep).join("/");
    if (!existsSync(file)) return missing();
    const real = realpathSync(file);
    const root = realpathSync(within);
    if (real !== root && !real.startsWith(root + sep)) {
      const where = within === episodeDir ? "the episode" : within === seriesDir ? "the series" : "its release";
      stop("path-escape", key, `${key} leads outside ${where} (${real})`);
    }
    if (!statSync(real).isFile()) stop("not-a-file", key, `${key} is not a file`);
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
  // Checked before anything else is read: a spec copied from another episode
  // is the problem to report, whatever else is wrong with it.
  const owner = spec?.episodeRef;
  if (owner && typeof owner === "object"
    && (owner.channel !== episodeRef.channel || owner.series !== episodeRef.series || owner.episode !== episodeRef.episode)) {
    stop("episode-mismatch", `${EPISODE_SPEC_PATH}#$.episodeRef`,
      `the spec belongs to ${owner.channel}/${owner.series}/${owner.episode}, not ${episodeRef.channel}/${episodeRef.series}/${episodeRef.episode}`);
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
  const template = JSON.parse(bundle.manifest);

  // ── The release's own code (avg-d1x): its sealed compiler and validator ──
  const code: NonNullable<CompileInput["code"]> = {};
  for (const role of ["compiler", "validator"] as const) {
    const ref = template[role] as { id: string; version: string; bundle?: { path: string; hash: string } } | undefined;
    if (!ref?.bundle) continue;
    const key = `${releaseKey}/${ref.bundle.path}`;
    const file = join(releaseDir, ref.bundle.path);
    const bytes = read(file, releaseDir, () => stop("missing-code", key, `${key} is missing: the release names it, so it was sealed with it (vpr template seal)`));
    if (sha256(bytes) !== ref.bundle.hash) stop("code-mismatch", key, `${key} is not the code the release sealed (${ref.bundle.hash}): a release never changes, make a new one`);
    const loaded = releaseCodeOf(role, file, bytes, ref.bundle.hash, ref);
    if (!loaded.ok) return stop("bad-code", key, `${key}: ${loaded.message}`);
    (code as Record<string, unknown>)[role] = loaded.code;
  }

  // ── The library kits it pins (avg-d1x): the channel's or the series' own ──
  const kits: NonNullable<CompileInput["kits"]> = [];
  const channelDir = dirname(dirname(seriesDir));
  const pinnedKits = new Set<string>();
  for (const pin of (template.kits ?? []) as { name: string; version: string; level: "channel" | "series"; hash: string }[]) {
    if (pinnedKits.has(`${pin.name}@${pin.version}`)) stop("kit-duplicate", `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}#$.kits`, `${pin.name}@${pin.version} is pinned twice: one kit per name@version`);
    pinnedKits.add(`${pin.name}@${pin.version}`);
    const place = { channelDir, name: pin.name, version: pin.version, ...(pin.level === "series" ? { series: basename(seriesDir) } : {}) };
    const dir = kitDirOf(place);
    const within = pin.level === "series" ? seriesDir : channelDir;
    const manifestKey = relative(episodeDir, join(dir, KIT_RELEASE_FILE)).split(sep).join("/");
    const label = `${pin.level} kit ${pin.name}@${pin.version}`;
    const manifestBytes = read(join(dir, KIT_RELEASE_FILE), within, () => stop("missing-kit", manifestKey, `${manifestKey} is missing: the release pins ${label}`));
    if (sha256(manifestBytes) !== pin.hash) stop("kit-mismatch", manifestKey, `${manifestKey} is not the kit the release pinned (${pin.hash}): a kit never changes, make a new version`);
    read(join(dir, KIT_BUNDLE), within, () => stop("missing-kit", `${manifestKey.replace(/kit\.json$/, KIT_BUNDLE)}`, `${label}'s ${KIT_BUNDLE} is missing`));
    if (isApplicationKit(pin.name, pin.version)) stop("kit-shadows", manifestKey, `${label} takes an application kit's name and version`);
    const release = readKitRelease(dir, pin);
    if (!release.ok) return stop(release.code, manifestKey, release.message);
    kits.push({ name: pin.name, version: pin.version, file: release.file, hash: release.release.bundle.hash, kit: release.kit });
  }

  // ── Narration takes and their timing ──────────────────────────────────────
  // An episode whose pinned source brings the takes (avg-dcf.8) may have none of its own,
  // and a wordless series (narration: "none") has none at all.
  let narration: any;
  if ((template as { narration?: string }).narration === "none"
    || (!existsSync(join(episodeDir, NARRATION_TAKES_PATH)) && pinsBringingTakes(episodeDir).length > 0)) {
    narration = { apiVersion: "studio.video/v1alpha1", kind: "NarrationTakes", takes: [], units: [] };
  } else {
    const takesBytes = read(join(episodeDir, NARRATION_TAKES_PATH), episodeDir,
      () => stop("missing-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is missing: record and verify the narration takes first, or pin a source that has them`));
    try {
      narration = JSON.parse(takesBytes.toString("utf-8"));
    } catch (error) {
      return stop("bad-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is not JSON: ${(error as Error).message}`);
    }
    const takesProblems = validateNarrationTakes(narration);
    if (takesProblems.length > 0) throw new Stop(at(NARRATION_TAKES_PATH, takesProblems));
  }

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

  // ── Images, sounds and video clips ────────────────────────────────────────
  // Each asset is offered as image-<name>, sound-<name> or video-<name>;
  // pinned sources use the same prefixes. The compiler chooses what it needs. Two files
  // with one name is a choice nobody made.
  for (const { dir, prefix, kind, extensions } of OFFERED) {
    const folder = join(episodeDir, "assets", dir);
    const files = existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true })
        .filter((e) => !e.isDirectory() && !e.name.startsWith(".") && (extensions as readonly string[]).includes(extname(e.name).toLowerCase()))
        .map((e) => e.name)
        .sort()
      : [];
    for (const file of files) {
      const id = `${prefix}-${file.slice(0, -extname(file).length)}`;
      const path = `assets/${dir}/${file}`;
      if (assets[id]) stop("ambiguous-asset", path, `${assets[id].path} and ${path} are both ${id.slice(prefix.length + 1)}: keep one`);
      read(join(episodeDir, path), episodeDir, () => stop("missing-asset", path, `${path} is missing`));
      assets[id] = { path, hash: inputs[path]!, kind };
    }
  }

  // ── The channel theme the release pins (ADR-0040) ─────────────────────────
  // Read from library/<channel>/themes/<id>/<version>/, held to the pin's hash
  // and to the contract; its room images (and monitor clips) are offered as
  // theme-<room> (theme-<room>-monitor), its media as theme-<name>, with paths
  // relative to the episode.
  let theme: ChannelTheme | undefined;
  if (template.theme) {
    const themesDir = join(dirname(dirname(seriesDir)), "themes");
    const themeDir = join(dirname(themesDir), themeReleasePath(template.theme.id, template.theme.version));
    const themeKey = relative(episodeDir, themeDir).split(sep).join("/");
    if (!existsSync(join(themeDir, THEME_FILE))) {
      stop("missing-theme", `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}#$.theme`, `the pinned theme ${template.theme.id}@${template.theme.version} is not in this channel (${themeKey})`);
    }
    const themeBytes = read(join(themeDir, THEME_FILE), themeDir, () => stop("missing-theme", `${themeKey}/${THEME_FILE}`, `${themeKey}/${THEME_FILE} is missing`));
    if (sha256(themeBytes) !== template.theme.hash) {
      stop("theme-mismatch", `${themeKey}/${THEME_FILE}`, `${themeKey}/${THEME_FILE} is not the theme the release pinned (${template.theme.hash}): pin the theme again in a new release`);
    }
    try {
      theme = JSON.parse(themeBytes.toString("utf-8"));
    } catch (error) {
      return stop("bad-theme", `${themeKey}/${THEME_FILE}`, `${themeKey}/${THEME_FILE} is not JSON: ${(error as Error).message}`);
    }
    const themeProblems = validateChannelTheme(theme);
    if (themeProblems.length > 0) throw new Stop(at(`${themeKey}/${THEME_FILE}`, themeProblems));
    // the release it sits in is the one the pin names
    for (const field of ["id", "version"] as const) {
      if (theme![field] !== template.theme[field]) {
        stop("theme-mismatch", `${themeKey}/${THEME_FILE}#$.${field}`, `${themeKey}/${THEME_FILE} says ${field} ${theme![field]}, not the pinned ${template.theme[field]}`);
      }
    }
    // A sealed release is held to its files; an unsealed one (made before
    // releases were sealed) loads as before, with a warning.
    const sealed = theme!.files;
    if (!sealed) {
      warnings.push({
        code: "theme-unsealed",
        path: `${themeKey}/${THEME_FILE}`,
        message: `${template.theme.id}@${template.theme.version} lists no files, so its rooms can change under the release: seal a new release (vpr theme seal) and pin it`,
      });
    }
    const offer = (id: string, file: string, kind: CompileAsset["kind"]) => {
      const path = `${themeKey}/${file}`;
      read(join(themeDir, file), themeDir, () => stop("missing-asset", path, `${path} is missing`));
      if (sealed && sealed[file] !== inputs[path]) {
        stop("theme-mismatch", path, `${path} is not the file ${template.theme.id}@${template.theme.version} sealed (${sealed[file]}): a release never changes, make a new one`);
      }
      assets[id] = { path, hash: inputs[path]!, kind };
    };
    for (const [name, room] of Object.entries(theme!.rooms).sort(([a], [b]) => (a < b ? -1 : 1))) {
      offer(`theme-${name}`, room.image, "image");
      if (room.monitor) offer(`theme-${name}-monitor`, room.monitor.video, "video");
    }
    for (const [name, media] of Object.entries(theme!.media ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      offer(`theme-${name}`, media.path, media.kind);
    }
  }

  // ── Material pinned from other episodes or the channel's sources (ADR-0035) ─
  // Each pin names an episode or a channel source; what this episode reads of it must be what the
  // pin inventoried, or the pin needs renewing. Its pictures are offered as
  // source-<pin>-image-<name>, its takes as source-<pin>-narration-<take>, with
  // paths relative to this episode.
  const sources: NonNullable<CompileInput["sources"]> = {};
  const pinsDir = join(episodeDir, PINS_DIR);
  const pinFiles = existsSync(pinsDir) ? readdirSync(pinsDir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort() : [];
  for (const name of pinFiles) {
    const pinKey = `${PINS_DIR}/${name}`;
    let pinDoc: any;
    try {
      pinDoc = JSON.parse(read(join(pinsDir, name), episodeDir, () => stop("missing-pin", pinKey, `${pinKey} is missing`)).toString("utf-8"));
    } catch (error) {
      if (error instanceof Stop) throw error;
      return stop("bad-pin", pinKey, `${pinKey} is not JSON: ${(error as Error).message}`);
    }
    const pinProblems = validateSourcePin(pinDoc);
    if (pinProblems.length > 0) throw new Stop(at(pinKey, pinProblems));
    // A pin's file is named by its id: two pins never claim one id.
    if (`${pinDoc.id}.json` !== name) stop("bad-pin", `${pinKey}#$.id`, `${pinKey} says its id is "${pinDoc.id}": name it ${pinDoc.id}.json`);
    // An episode or a channel source (avg-dcf.2): the parts that follow the studio's contracts are compile material.
    if (pinDoc.source.kind !== "episode" && pinDoc.source.kind !== "channel-source") continue;
    const id = pinDoc.id as string;
    const srcDir = sourceDir(dirname(channelDir), basename(channelDir), pinDoc.source);
    const files = pinDoc.files as Record<string, { hash: string }>;
    /** A file of the source, held to the pin's inventory. */
    const fromSource = (path: string, where: string): Buffer => {
      if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) stop("path-escape", where, `${path} is not a path inside the pinned source`);
      const file = join(srcDir, path);
      const key = relative(episodeDir, file).split(sep).join("/");
      const entry = files[path];
      if (!entry) stop("pin-mismatch", where, `${path} of the pinned source is not in pin "${id}": renew the pin (vpr pin)`);
      const bytes = read(file, srcDir, () => stop("pin-mismatch", key, `${key} is missing: renew the pin (vpr pin) or restore it`));
      if (inputs[key] !== entry!.hash) stop("pin-mismatch", key, `${key} changed since pin "${id}" inventoried it: renew the pin (vpr pin)`);
      return bytes;
    };
    const keyOf = (path: string) => relative(episodeDir, join(srcDir, path)).split(sep).join("/");
    const sourceNarration = files[NARRATION_TAKES_PATH] ? JSON.parse(fromSource(NARRATION_TAKES_PATH, pinKey).toString("utf-8")) : null;
    const sourceTimings: Record<string, any> = {};
    if (sourceNarration) {
      const problems = validateNarrationTakes(sourceNarration);
      if (problems.length > 0) throw new Stop(at(keyOf(NARRATION_TAKES_PATH), problems));
      (sourceNarration.takes as any[]).forEach((take, i) => {
        const where = `${keyOf(NARRATION_TAKES_PATH)}#$.takes[${i}]`;
        const audio = fromSource(take.audio.path, `${where}.audio.path`);
        if (sha256(audio) !== take.audio.hash) stop("hash-mismatch", `${where}.audio.hash`, `pinned take "${take.id}": ${take.audio.path} is not the audio the take recorded`);
        assets[`source-${id}-narration-${take.id}`] = { path: keyOf(take.audio.path), hash: take.audio.hash, kind: "audio" };
        if (!take.timing) return;
        const timingBytes = fromSource(take.timing.path, `${where}.timing.path`);
        if (sha256(timingBytes) !== take.timing.hash) stop("hash-mismatch", `${where}.timing.hash`, `pinned take "${take.id}": ${take.timing.path} is not the timing the take recorded`);
        const timing = JSON.parse(timingBytes.toString("utf-8"));
        const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
        if (timingProblems.length > 0) throw new Stop(at(keyOf(take.timing.path), timingProblems));
        sourceTimings[take.id] = timing;
      });
      sources[id] = { narration: sourceNarration, timings: sourceTimings };
    }
    for (const { dir, prefix, kind, extensions } of OFFERED) {
      for (const path of Object.keys(files).filter((p) => p.startsWith(`assets/${dir}/`) && !p.slice(`assets/${dir}/`.length).includes("/")).sort()) {
        const file = path.slice(`assets/${dir}/`.length);
        if (file.startsWith(".") || !(extensions as readonly string[]).includes(extname(file).toLowerCase())) continue;
        fromSource(path, pinKey);
        assets[`source-${id}-${prefix}-${file.slice(0, -extname(file).length)}`] = { path: keyOf(path), hash: files[path]!.hash, kind };
      }
    }
  }

  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}), ...(Object.keys(sources).length > 0 ? { sources } : {}), ...(Object.keys(code).length > 0 ? { code } : {}), ...(kits.length > 0 ? { kits } : {}) }, releaseKey, warnings };
}

const IN_TIMELINE = /^\$\.(tracks|profile|durationInFrames|resolution|assets|sections)\b/;

/** A compiler's or validator's paths point into its input; name the file each one is in. */
function locate(problem: CompileProblem, releaseKey: string): SeriesCompileProblem {
  const { path } = problem;
  const file = path.startsWith("$.data") || path.startsWith("$.episodeRef") ? EPISODE_SPEC_PATH
    : path.startsWith("$.units") || path.startsWith("$.takes") ? NARRATION_TAKES_PATH
    : path.startsWith("$.template") ? `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}`
    : problem.code.startsWith("timeline:") || IN_TIMELINE.test(path) ? "artifacts/edit-timeline.json"
    : null;
  const inFile = path.startsWith("$.template") ? path.replace(/^\$\.template/, "$") : path;
  return { code: problem.code, message: problem.message, path: file ? `${file}#${inFile}` : path };
}
