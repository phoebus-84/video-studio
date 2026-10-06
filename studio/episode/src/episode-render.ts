// ---------------------------------------------------------------------------
// Rendering an episode through its edit timeline (avg-tk7.6, ADR-0036)
// ---------------------------------------------------------------------------
// `artifacts/edit-timeline.json` is the reviewable account of a render. It is
// rebuilt from the episode's material when that material changed, and is
// otherwise rendered exactly as it stands — a hand edit, on the web or on
// disk, is never overwritten. Renders are immutable: output/<render-id>.mp4
// with a sibling report, and output/current.json moved last.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderTimeline, type RenderResult } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import {
  buildEditTimeline,
  DEFAULT_PROFILE,
  EDIT_TIMELINE_PATH,
  type BuildOptions,
  type BuildProblem,
  type EditTimelineDoc,
} from "./edit-timeline-builder.js";
import { checkEpisode, compileEpisode, isSpecDriven, type SeriesFinding } from "./series-compile.js";

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const describe = (problems: BuildProblem[]) => problems.map((p) => `${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`).join("; ");

/** The timeline cannot be built or used; `problems` say why. */
export class TimelineBuildError extends Error {
  constructor(readonly problems: BuildProblem[], lead = "the edit timeline cannot be built") {
    super(`${lead}: ${describe(problems)}`);
    this.name = "TimelineBuildError";
  }
}

/** The series rules a spec-driven timeline was checked against, and what they found. */
export interface Validation {
  /** "<id>@<version>", or null when the template names no validator. */
  validator: string | null;
  findings: SeriesFinding[];
}

/**
 * The timeline breaks its series' rules (avg-jao.3). `problems` are the
 * error findings; nothing was written or rendered.
 */
export class SeriesRulesError extends TimelineBuildError {
  readonly code = "series-rules";
  constructor(readonly validator: string | null, errors: SeriesFinding[], hint = "") {
    super(errors, `the series rules (${validator}) refuse this timeline${hint}`);
    this.name = "SeriesRulesError";
  }
}

const errorsOf = (validation: Validation | null) => validation?.findings.filter((f) => f.severity === "error") ?? [];

/** What to do about a refusal: the edit, the spec and takes, or the studio itself. */
function hintFor(errors: SeriesFinding[], storedAsItStands: boolean): string {
  if (errors.some((f) => f.code === "unknown-validator")) {
    return ": the template names a validator this studio does not have — update the studio, or pin a release it knows";
  }
  return storedAsItStands
    ? `: fix the edit in ${EDIT_TIMELINE_PATH}, or delete it to recompile from the spec`
    : ": change the spec or the takes";
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const serialize = (timeline: unknown) => `${JSON.stringify(timeline, null, 2)}\n`;

let temporaries = 0;

/** Write through a temporary file, so no reader ever sees half a document. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${temporaries++}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

/**
 * Write a new timeline. A different one already there — possibly a person's
 * edit — is kept first as artifacts/edit-timeline.<hash8>.bak.json, whose path
 * is returned so the caller can say where it went.
 */
function replaceTimeline(episodeDir: string, text: string): string | null {
  const path = join(episodeDir, EDIT_TIMELINE_PATH);
  let backup: string | null = null;
  if (existsSync(path)) {
    const previous = readFileSync(path);
    if (!previous.equals(Buffer.from(text, "utf-8"))) {
      backup = EDIT_TIMELINE_PATH.replace(/\.json$/, `.${sha256(previous).slice(0, 8)}.bak.json`);
      copyFileSync(path, join(episodeDir, backup));
    }
  }
  writeAtomically(path, text);
  return backup;
}

/** How a spec-driven timeline was made; absent for the legacy builder's. */
export interface CompiledBy {
  /** "<id>@<version>" of the series compiler. */
  compiler: string;
  template: { id: string; version: string; hash: string };
  revision: number;
  /** The timeline rendered differs from what the compiler makes of the same inputs: a person edited it. */
  editedByHand: boolean;
}

type Produced =
  | { ok: true; timeline: EditTimelineDoc; warnings: string[]; compiledBy: CompiledBy | null }
  | { ok: false; problems: BuildProblem[] };

/**
 * The episode's timeline as its material says it should be: compiled from
 * episode-spec.json by the release's compiler when there is a spec, built by
 * buildEditTimeline otherwise. A spec that does not compile is never
 * replaced by the legacy builder's guess.
 */
function produceTimeline(episodeDir: string, options: BuildOptions): Produced {
  if (!isSpecDriven(episodeDir)) {
    const built = buildEditTimeline(episodeDir, options);
    return built.ok ? { ...built, compiledBy: null } : built;
  }
  const compiled = compileEpisode(episodeDir, { episodeRef: options.episodeRef });
  if (!compiled.ok) return compiled;
  const fixed = compiled.timeline.profile.id;
  if (options.profile !== undefined && options.profile !== fixed) {
    return {
      ok: false,
      problems: [{
        code: "profile-fixed-by-template",
        path: "episode-spec.json#$.template",
        message: `this episode's template ${compiled.template.id}@${compiled.template.version} renders ${fixed}, not ${options.profile}`,
      }],
    };
  }
  const { compiler, template, revision } = compiled;
  return {
    ok: true,
    timeline: compiled.timeline as unknown as EditTimelineDoc,
    warnings: compiled.warnings,
    compiledBy: { compiler, template, revision, editedByHand: false },
  };
}

export interface WrittenTimeline {
  timeline: EditTimelineDoc;
  /** Set when a series compiler made it from episode-spec.json. */
  compiledBy: CompiledBy | null;
  /** The series rules it was checked against; null for an episode without a spec. */
  validation: Validation | null;
  /** sha256 hex of the file as written. */
  hash: string;
  warnings: string[];
  /** Where a different previous timeline was kept, if one was replaced. */
  backup: string | null;
}

/** Check a spec-driven episode's timeline against its series rules; null for the others. */
function validate(episodeDir: string, options: BuildOptions, timeline: EditTimelineDoc): Validation | null {
  if (!isSpecDriven(episodeDir)) return null;
  const checked = checkEpisode(episodeDir, { episodeRef: options.episodeRef, timeline: timeline as never });
  if (!checked.ok) throw new TimelineBuildError(checked.problems);
  return { validator: checked.validator, findings: checked.findings };
}

/**
 * Build the timeline and write it to artifacts/edit-timeline.json — unless
 * it breaks its series' rules, in which case nothing is written.
 */
export function writeEditTimeline(episodeDir: string, options: BuildOptions): WrittenTimeline {
  const built = produceTimeline(episodeDir, options);
  if (!built.ok) throw new TimelineBuildError(built.problems);
  const validation = validate(episodeDir, options, built.timeline);
  const errors = errorsOf(validation);
  if (errors.length > 0) throw new SeriesRulesError(validation!.validator, errors, hintFor(errors, false));
  const text = serialize(built.timeline);
  const backup = replaceTimeline(episodeDir, text);
  return { timeline: built.timeline, compiledBy: built.compiledBy, validation, hash: sha256(text), warnings: built.warnings, backup };
}

/** Which timeline a render would use, and why — decided without writing anything. */
export interface TimelineDecision {
  timeline: EditTimelineDoc;
  /** The timeline as it would be on disk. */
  text: string;
  /** sha256 hex of `text`. */
  hash: string;
  /** Why a fresh timeline replaces the stored one, or null when the stored one is used as it stands. */
  rebuilt: string | null;
  compiledBy: CompiledBy | null;
  validation: Validation | null;
  warnings: string[];
}

/**
 * The timeline to render: the one on disk when it still describes the
 * episode's material and the profile asked for, otherwise a fresh one.
 * Reads only. For a spec-driven episode the decision carries the series
 * rules' findings on that timeline.
 */
export function decideEditTimeline(episodeDir: string, options: BuildOptions): TimelineDecision {
  const path = join(episodeDir, EDIT_TIMELINE_PATH);
  let stored: { text: string; doc: any } | null = null;
  if (existsSync(path)) {
    const text = readFileSync(path, "utf-8");
    try {
      stored = { text, doc: JSON.parse(text) };
    } catch (error) {
      // Possibly a person's edit, half done: never rebuild over it.
      throw new TimelineBuildError(
        [{ code: "bad-timeline", path: EDIT_TIMELINE_PATH, message: `not JSON (${(error as Error).message}); fix it, or delete it to rebuild` }],
        `${EDIT_TIMELINE_PATH} is not JSON`,
      );
    }
  }

  const storedProfile: string | undefined = stored?.doc?.profile?.id;
  const profileChange = options.profile !== undefined && options.profile !== storedProfile;
  // A spec-driven episode's profile is its template's. Otherwise a stored
  // profile outside the catalog (a hand edit) cannot be rebuilt; comparing
  // inputs does not need it.
  const specDriven = isSpecDriven(episodeDir);
  const profile = specDriven
    ? options.profile
    : options.profile ?? (storedProfile && outputProfile(storedProfile) ? storedProfile : DEFAULT_PROFILE);
  const fresh = produceTimeline(episodeDir, { ...options, profile });
  const storedProblems = stored ? validateEditTimeline(stored.doc) : [];

  if (!fresh.ok) {
    // A spec that no longer compiles is an edit to finish, not a reason to
    // render the timeline it replaced.
    if (stored && !specDriven && !profileChange && storedProblems.length === 0) {
      return {
        timeline: stored.doc,
        text: stored.text,
        hash: sha256(stored.text),
        warnings: [`the episode could not be rebuilt (${describe(fresh.problems)}); rendering it as it stands`],
        compiledBy: null,
        validation: null,
        rebuilt: null,
      };
    }
    throw new TimelineBuildError(fresh.problems);
  }

  let reason: string | null = null;
  if (!stored) reason = "there was no timeline yet";
  else if (profileChange) reason = `the profile changed from ${storedProfile ?? "none"} to ${options.profile}`;
  else {
    const before: Record<string, string> = stored.doc?.metadata?.inputs ?? {};
    const after = fresh.timeline.metadata.inputs;
    const changes = [
      ...Object.keys(after).filter((p) => p in before && before[p] !== after[p]).map((p) => `${p} changed`),
      ...Object.keys(after).filter((p) => !(p in before)).map((p) => `${p} added`),
      ...Object.keys(before).filter((p) => !(p in after)).map((p) => `${p} removed`),
    ];
    if (changes.length > 0) reason = changes.join(", ");
  }

  if (reason === null && stored) {
    if (storedProblems.length > 0) {
      throw new TimelineBuildError(storedProblems, `${EDIT_TIMELINE_PATH} as it stands is not valid; fix the edit, or delete the file to rebuild`);
    }
    const compiledBy = fresh.compiledBy && { ...fresh.compiledBy, editedByHand: stored.text !== serialize(fresh.timeline) };
    return {
      timeline: stored.doc,
      text: stored.text,
      hash: sha256(stored.text),
      rebuilt: null,
      compiledBy,
      validation: validate(episodeDir, options, stored.doc),
      warnings: fresh.warnings,
    };
  }
  const text = serialize(fresh.timeline);
  return {
    timeline: fresh.timeline,
    text,
    hash: sha256(text),
    rebuilt: reason,
    compiledBy: fresh.compiledBy,
    validation: validate(episodeDir, options, fresh.timeline),
    warnings: fresh.warnings,
  };
}

export interface CurrentTimeline extends WrittenTimeline {
  /** Why it was rebuilt, or null when the timeline on disk was used as it is. */
  rebuilt: string | null;
}

/** Write what a decision rebuilt (keeping a different previous timeline as a backup). */
function applyDecision(episodeDir: string, decision: TimelineDecision): CurrentTimeline {
  const backup = decision.rebuilt !== null ? replaceTimeline(episodeDir, decision.text) : null;
  const { timeline, hash, rebuilt, compiledBy, validation, warnings } = decision;
  return { timeline, hash, rebuilt, compiledBy, validation, warnings, backup };
}

/** The timeline to render, rebuilt and written when its material changed (see decideEditTimeline). */
export function currentEditTimeline(episodeDir: string, options: BuildOptions): CurrentTimeline {
  return applyDecision(episodeDir, decideEditTimeline(episodeDir, options));
}

export interface EpisodeRenderOptions extends BuildOptions {
  /** Lowercase kebab-case; the render id starts with it. */
  label?: string;
  onProgress?: (progress: number) => void;
}

export interface EpisodeRender {
  renderId: string;
  outputPath: string;
  reportPath: string;
  rebuilt: string | null;
  backup: string | null;
  warnings: string[];
  compiledBy: CompiledBy | null;
  validation: Validation | null;
  result: RenderResult;
}

/**
 * Render the episode's current timeline to output/<render-id>.mp4.
 *
 * The video is written beside its final name and renamed when complete; the
 * report follows; output/current.json moves last. A failure leaves output/
 * as it was. The caller serialises renders of one episode (current.json).
 */
export async function renderEpisode(episodeDir: string, options: EpisodeRenderOptions): Promise<EpisodeRender> {
  const label = options.label ?? "render";
  if (!LABEL.test(label)) throw new Error(`label "${label}" must be lowercase kebab-case`);
  const decision = decideEditTimeline(episodeDir, options);
  // Refused before anything is written: not even a rebuilt timeline.
  const errors = errorsOf(decision.validation);
  if (errors.length > 0) {
    throw new SeriesRulesError(decision.validation!.validator, errors, hintFor(errors, decision.rebuilt === null));
  }
  const current = applyDecision(episodeDir, decision);

  const outputDir = join(episodeDir, "output");
  mkdirSync(outputDir, { recursive: true });
  const renderId = `${label}-${Date.now()}-${current.hash.slice(0, 8)}`;
  const outputPath = join(outputDir, `${renderId}.mp4`);
  const partialPath = join(outputDir, `.${renderId}.partial.mp4`);
  const reportPath = join(outputDir, `${renderId}.report.json`);

  let result: RenderResult;
  try {
    result = await renderTimeline({
      timeline: current.timeline,
      assetRoot: episodeDir,
      cacheDir: join(episodeDir, ".cache", "remotion"),
      outputPath: partialPath,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    renameSync(partialPath, outputPath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
  result = { ...result, path: outputPath };

  writeAtomically(reportPath, serialize({
    renderId,
    createdAt: new Date().toISOString(),
    timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${current.hash}` },
    ...(current.compiledBy ? { compiledBy: current.compiledBy } : {}),
    ...(current.validation ? { validation: current.validation } : {}),
    ...(current.rebuilt ? { rebuilt: current.rebuilt } : {}),
    ...(current.warnings.length > 0 ? { warnings: current.warnings } : {}),
    render: { ...result, path: `${renderId}.mp4` },
  }));
  writeAtomically(join(outputDir, "current.json"), serialize({ renderId, path: `${renderId}.mp4` }));

  return {
    renderId,
    outputPath,
    reportPath,
    rebuilt: current.rebuilt,
    backup: current.backup,
    warnings: current.warnings,
    compiledBy: current.compiledBy,
    validation: current.validation,
    result,
  };
}
