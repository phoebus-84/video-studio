// ---------------------------------------------------------------------------
// A series episode's stages, as its files show them (avg-qwc)
// ---------------------------------------------------------------------------
// A spec-driven episode is made with the studio's tools (pva_init_spec,
// pva_generate_image, pva_register_take, pva_build_timeline, pva_layout_sheet,
// pva_compose_video), which write files and never touch the journal. So its
// series-production stages are read from those files: what is there, whether
// it still matches what it was made from, and whether the operator approved
// the sheet. One source of truth; a changed file makes its stage stale by
// itself. Reads only.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NARRATION_TAKES_PATH, checkEpisode, isSpecDriven, loadEpisode } from "./series-compile.js";
import type { SeriesCompileProblem } from "./series-compile.js";
import { EDIT_TIMELINE_PATH } from "./edit-timeline-builder.js";
import { decideEditTimeline } from "./episode-render.js";
import type { TimelineDecision } from "./episode-render.js";
import { layoutSheetStatusOf } from "./layout-sheet.js";
import { sheetReviewOf } from "./sheet-review.js";

export type StageEvidenceState = "pending" | "completed" | "awaiting_review" | "stale" | "failed";

export interface StageVerdict {
  state: StageEvidenceState;
  /** The sentence a person can act on: what is there, or what is missing and which tool makes it. */
  reason: string;
}

/** The series-production stages, in order (studio/pipelines' series-production.yaml). */
export const SERIES_STAGES = ["spec", "pictures", "takes", "timeline", "check", "sheet", "render"] as const;
export type SeriesStage = (typeof SERIES_STAGES)[number];

const PLACEHOLDER = "__FILL__";

const brief = (problems: { message: string }[], most = 2) =>
  problems.slice(0, most).map((p) => p.message).join("; ") + (problems.length > most ? `; and ${problems.length - most} more` : "");

/** A problem with the takes, their audio or their timing, rather than with the spec. */
const isTakeProblem = (p: SeriesCompileProblem) =>
  ["missing-narration", "bad-narration", "missing-timing", "bad-timing"].includes(p.code) ||
  ["$.takes", "artifacts/narration/", "artifacts/timing/", "assets/takes/"].some((prefix) => p.path.startsWith(prefix));

/**
 * Which stage a problem loading the episode belongs to, and what it makes of
 * it. Loading stops at the first problem: a changed pin or theme is not the
 * spec's fault, and must not hide every stage behind it.
 */
function ownerOf(p: SeriesCompileProblem): { stage: "spec" | "pictures" | "takes"; state: StageEvidenceState } {
  if (["missing-pin", "bad-pin", "pin-mismatch"].includes(p.code)) {
    const stage = /(^|\/)(artifacts|assets\/takes)\//.test(p.path) ? "takes" : "pictures";
    return { stage, state: p.code === "pin-mismatch" ? "stale" : "failed" };
  }
  if (["missing-theme", "bad-theme", "theme-mismatch"].includes(p.code)) return { stage: "pictures", state: "failed" };
  if (isTakeProblem(p)) return { stage: "takes", state: p.code === "missing-timing" || p.code === "missing-asset" ? "pending" : "failed" };
  if (["missing-asset", "ambiguous-asset", "not-a-file"].includes(p.code) && !p.path.startsWith("episode-spec.json")) {
    return { stage: "pictures", state: p.code === "missing-asset" ? "pending" : "failed" };
  }
  return { stage: "spec", state: "failed" };
}

/**
 * Each series-production stage's state, read from the episode's files, or
 * null for an episode without a spec (its stages follow the journal).
 * `key` verifies the sheet review's signature when this process holds the
 * operator key; without it the review is held to its binding alone.
 */
export function seriesStageEvidence(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string }; key: string | null },
): Record<SeriesStage, StageVerdict> | null {
  if (!isSpecDriven(episodeDir)) return null;
  const out = {} as Record<SeriesStage, StageVerdict>;
  const waiting = (stage: SeriesStage, on: SeriesStage[]) => {
    const open = on.filter((d) => out[d].state !== "completed");
    out[stage] = { state: "pending", reason: `waiting on ${open.join(" and ")}` };
    // A video already delivered is not hidden behind the stage that now holds the next one.
    const rendered = stage === "render" ? currentRender(episodeDir) : null;
    if (rendered) out[stage] = { state: "stale", reason: `output/${rendered}.mp4 is the current video, but ${open.join(" and ")} must be done again before the next render` };
  };
  const done = (...stages: SeriesStage[]) => stages.every((s) => out[s].state === "completed");

  // spec
  const specText = readFileSync(join(episodeDir, "episode-spec.json"), "utf-8");
  const placeholders = specText.split(PLACEHOLDER).length - 1;
  const loaded = loadEpisode(episodeDir, options);
  // Loading reads the takes, the pins and the theme too: their problems are their stages', not the spec's.
  const loadProblems = loaded.ok ? [] : loaded.problems;
  const specProblems = loadProblems.filter((p) => ownerOf(p).stage === "spec");
  const otherProblems = loadProblems.filter((p) => ownerOf(p).stage !== "spec");
  if (placeholders > 0) {
    out.spec = { state: "pending", reason: `${placeholders} ${PLACEHOLDER} placeholder${placeholders === 1 ? "" : "s"} left in episode-spec.json` };
  } else if (specProblems.length > 0) {
    out.spec = { state: "failed", reason: `episode-spec.json does not load: ${brief(specProblems)}` };
  } else {
    const spec = JSON.parse(specText) as { revision?: number; template?: { id?: string; version?: string } };
    out.spec = { state: "completed", reason: `revision ${spec.revision ?? "?"} on ${spec.template?.id}@${spec.template?.version}` };
  }
  if (!done("spec")) {
    for (const stage of SERIES_STAGES.slice(1)) waiting(stage, ["spec"]);
    return out;
  }

  if (otherProblems.length > 0) {
    const first = otherProblems[0]!;
    const { stage, state } = ownerOf(first);
    const other = stage === "takes" ? "pictures" : "takes";
    out[stage] = stage === "takes" && state === "pending"
      ? takesVerdict(episodeDir, otherProblems)
      : { state, reason: brief(otherProblems) };
    out[other] = { state: "pending", reason: `checked once ${stage} ${stage === "takes" ? "load" : "loads"}` };
    for (const s of ["timeline", "check", "sheet", "render"] as const) waiting(s, s === "timeline" ? ["pictures", "takes"] : ["timeline"]);
    return out;
  }

  // pictures and takes: what the compiler cannot find, and the takes' own record
  const checked = checkEpisode(episodeDir, options);
  const problems = checked.ok ? [] : checked.problems;
  const missingMedia = problems.filter((p) => p.code === "missing-asset" && !isTakeProblem(p));
  out.pictures = missingMedia.length > 0
    ? { state: "pending", reason: `missing: ${brief(missingMedia)} (pva_generate_image, assets/)` }
    : { state: "completed", reason: "every picture and sound the spec names is in assets/" };
  out.takes = takesVerdict(episodeDir, problems.filter(isTakeProblem));
  if (!done("pictures", "takes")) {
    for (const stage of ["timeline", "check", "sheet", "render"] as const) waiting(stage, stage === "timeline" ? ["pictures", "takes"] : ["timeline"]);
    return out;
  }

  // timeline: compiled, and still what the compiler makes of the files
  const refused = problems.filter((p) => !(p.code === "missing-asset"));
  let decision: TimelineDecision | null = null;
  if (refused.length > 0) {
    out.timeline = { state: "failed", reason: `the compiler refuses the spec: ${brief(refused)}` };
  } else {
    try {
      decision = decideEditTimeline(episodeDir, options);
    } catch (error) {
      out.timeline = { state: "failed", reason: (error as Error).message };
    }
    if (decision) {
      out.timeline = !existsSync(join(episodeDir, EDIT_TIMELINE_PATH))
        ? { state: "pending", reason: "not compiled yet (pva_build_timeline)" }
        : decision.rebuilt !== null
          ? { state: "stale", reason: `${EDIT_TIMELINE_PATH} would be recompiled: ${decision.rebuilt} (pva_build_timeline)` }
          : { state: "completed", reason: `${EDIT_TIMELINE_PATH} matches the spec, pictures and takes` };
    }
  }
  if (!decision || !done("timeline")) {
    for (const stage of ["check", "sheet", "render"] as const) waiting(stage, ["timeline"]);
    return out;
  }

  // check: the series rules on the stored timeline
  const findings = decision.validation?.findings ?? [];
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.length - errors.length;
  out.check = errors.length > 0
    ? { state: "failed", reason: `${errors.length} series rule${errors.length === 1 ? "" : "s"} broken: ${brief(errors)}` }
    : decision.validation?.validator == null
      ? { state: "completed", reason: "the template names no series rules to check" }
      : { state: "completed", reason: `the series rules pass${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}` };
  if (!done("check")) {
    waiting("sheet", ["check"]);
    waiting("render", ["sheet"]);
    return out;
  }

  // sheet: made for this timeline, and the operator's signed review of it
  const sheet = layoutSheetStatusOf(episodeDir, options, () => decision!);
  if (sheet.state === "missing") {
    out.sheet = { state: "pending", reason: `no layout sheet (${sheet.reason}): pva_layout_sheet` };
  } else if (sheet.state === "stale") {
    out.sheet = { state: "stale", reason: `the layout sheet no longer pictures the timeline: ${sheet.reasons.join("; ")} (pva_layout_sheet)` };
  } else {
    const review = sheetReviewOf(episodeDir, options, sheet, options.key);
    out.sheet = review.state === "approved"
      ? { state: "completed", reason: `approved by the operator${review.at ? ` at ${review.at}` : ""}` }
      : review.state === "rejected"
        ? { state: "failed", reason: `the operator rejected the sheet: "${review.note}"` }
        : { state: "awaiting_review", reason: `${review.message}: the operator reads it in the web studio's Storyboard, or \`vpr sheet approve\`` };
  }
  if (!done("sheet")) {
    waiting("render", ["sheet"]);
    return out;
  }

  out.render = renderVerdict(episodeDir, decision);
  return out;
}

function takesVerdict(episodeDir: string, problems: SeriesCompileProblem[]): StageVerdict {
  const path = join(episodeDir, NARRATION_TAKES_PATH);
  if (!existsSync(path)) return { state: "pending", reason: "no takes registered (pva_register_take)" };
  let doc: { units?: unknown[]; takes?: { id?: string; timing?: unknown }[] };
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    return { state: "failed", reason: `${NARRATION_TAKES_PATH} is not JSON: ${(error as Error).message}` };
  }
  const takes = Array.isArray(doc.takes) ? doc.takes : [];
  if (takes.length === 0) return { state: "pending", reason: "no takes registered (pva_register_take)" };
  const unaligned = takes.filter((t) => !t.timing).map((t) => t.id ?? "?");
  if (unaligned.length > 0) return { state: "pending", reason: `not aligned: ${unaligned.join(", ")} (pva_align_take)` };
  if (problems.length > 0) return { state: "failed", reason: brief(problems) };
  const units = Array.isArray(doc.units) ? doc.units.length : 0;
  return { state: "completed", reason: `${takes.length} take${takes.length === 1 ? "" : "s"} in ${units} unit${units === 1 ? "" : "s"}, aligned` };
}

/** The render output/current.json points at, by id, or null. */
function currentRender(episodeDir: string): string | null {
  const current = readJson(join(episodeDir, "output", "current.json")) as { renderId?: unknown } | null;
  return current && typeof current.renderId === "string" && /^[A-Za-z0-9._-]+$/.test(current.renderId) ? current.renderId : null;
}

function renderVerdict(episodeDir: string, decision: TimelineDecision): StageVerdict {
  const renderId = currentRender(episodeDir);
  if (!renderId) return { state: "pending", reason: "not rendered yet (pva_compose_video)" };
  const report = readJson(join(episodeDir, "output", `${renderId}.report.json`)) as
    { timeline?: { hash?: string }; audit?: { passed?: boolean } } | null;
  if (!report) return { state: "failed", reason: `output/${renderId}.report.json is missing or not JSON` };
  if (report.audit?.passed !== true) return { state: "failed", reason: `the render audit of ${renderId} did not pass` };
  if (!existsSync(join(episodeDir, "output", `${renderId}.mp4`))) return { state: "failed", reason: `output/${renderId}.mp4 is missing` };
  if (report.timeline?.hash !== `sha256:${decision.hash}`) {
    return { state: "stale", reason: `output/${renderId}.mp4 was rendered from an earlier timeline (pva_compose_video)` };
  }
  return { state: "completed", reason: `output/${renderId}.mp4, audit passed` };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
