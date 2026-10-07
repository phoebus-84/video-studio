// ---------------------------------------------------------------------------
// An episode's layout sheet (avg-3th.1)
// ---------------------------------------------------------------------------
// Small stills of the timeline a render would use, at the instants
// sheetInstants decides, and one labelled grid of them, kept in
// artifacts/layout-sheet/ with the sheet.json that says what they show. Its
// inputsHash covers everything that decides the pictures — the timeline
// (assets, timing and kit versions by hash), the kits' code, the rest of the
// composer's drawing code, the instants' rules and the scale — so layoutSheetStatus can tell a current sheet from
// a stale one without rendering anything.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { drawingCodeHash, renderLayoutSheet, timelineKits, type LockedKit } from "@av/remotion-composer";
import { canonicalJson } from "@studio/contracts/src/receipt.mjs";
import { decideEditTimeline, SeriesRulesError, type TimelineDecision } from "./episode-render.js";
import { EDIT_TIMELINE_PATH, type BuildOptions } from "./edit-timeline-builder.js";
import { isSpecDriven, loadEpisode, sharedRootsOf } from "./series-compile.js";
import { sheetInstants, type SheetRules } from "./sheet-instants.js";

export const LAYOUT_SHEET_DIR = "artifacts/layout-sheet";
export const LAYOUT_SHEET_REPORT = `${LAYOUT_SHEET_DIR}/sheet.json`;
/** Of the timeline's resolution. */
export const SHEET_SCALE = 0.25;

/** Where a sheet's instants come from: the pinned release's rules, or the defaults alone. */
export interface SheetRulesSource {
  /** "<template id>@<version>", or "default". */
  source: string;
  instants: SheetRules["instants"];
}

/** sheet.json. Paths are relative to artifacts/layout-sheet/. */
export interface LayoutSheetReport {
  createdAt: string;
  timeline: { path: string; hash: string };
  /** Why a render would rebuild the stored timeline first; absent when it renders it as it stands. */
  rebuilt?: string;
  rules: SheetRulesSource;
  scale: number;
  kits: LockedKit[];
  /** The composer's drawing code and its Remotion and React versions (drawingCodeHash). */
  renderer: string;
  inputsHash: string;
  frames: { index: number; frame: number; seconds: number; label: string; path: string; hash: string }[];
  sheet: { path: string; hash: string; columns: number; rows: number; width: number; height: number };
  warnings: string[];
}

export interface LayoutSheet {
  report: LayoutSheetReport;
  /** Absolute paths. */
  reportPath: string;
  sheetPath: string;
}

export type LayoutSheetStatus =
  | { state: "missing"; reason: string }
  | { state: "stale"; reasons: string[] }
  | { state: "current"; inputsHash: string; sheetHash: string };

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** sha256 of the canonical JSON of what decides a sheet's pictures. */
export function sheetInputsHash(parts: { timeline: string; kits: LockedKit[]; renderer: string; rules: SheetRulesSource; scale: number }): string {
  return sha256(canonicalJson(parts));
}

/** The rules a spec-driven episode's pinned release declares; the defaults for every other episode. */
function rulesFor(episodeDir: string, options: BuildOptions): SheetRulesSource {
  if (!isSpecDriven(episodeDir)) return { source: "default", instants: [] };
  const loaded = loadEpisode(episodeDir, options);
  // decideEditTimeline compiled this episode a moment ago; a failure here is a race.
  if (!loaded.ok) throw new Error(`the episode could not be loaded: ${loaded.problems.map((p) => p.message).join("; ")}`);
  const { template } = loaded.input;
  return { source: `${template.id}@${template.version}`, instants: template.sheet?.instants ?? [] };
}

/** What the sheet of this decision would be made from; throws what decideEditTimeline throws. */
function inputsOf(episodeDir: string, options: BuildOptions, decision: TimelineDecision) {
  const kits = timelineKits(decision.timeline as never);
  if (kits === null) throw new Error("a kit of this timeline is not one this studio has");
  const rules = rulesFor(episodeDir, options);
  const renderer = drawingCodeHash();
  const timeline = `sha256:${decision.hash}`;
  return { timeline, kits, renderer, rules, scale: SHEET_SCALE, inputsHash: sheetInputsHash({ timeline, kits, renderer, rules, scale: SHEET_SCALE }) };
}

let temporaries = 0;

/**
 * Render the layout sheet of the timeline a render would use, and replace
 * artifacts/layout-sheet/ with it whole. Refuses a timeline that breaks its
 * series' rules, writing nothing; a failure leaves the previous sheet as it
 * was. Writes nothing else: a rebuilt timeline is written by the render.
 */
export async function makeLayoutSheet(episodeDir: string, options: BuildOptions): Promise<LayoutSheet> {
  const decision = decideEditTimeline(episodeDir, options);
  const errors = decision.validation?.findings.filter((f) => f.severity === "error") ?? [];
  if (errors.length > 0) {
    throw new SeriesRulesError(decision.validation!.validator, errors, `: the layout sheet shows only a timeline a render would accept`);
  }
  const inputs = inputsOf(episodeDir, options, decision);
  const { picks, warnings } = sheetInstants(decision.timeline as never, { instants: inputs.rules.instants });

  const artifacts = join(episodeDir, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const suffix = `${process.pid}.${temporaries++}`;
  const temp = join(artifacts, `.layout-sheet.${suffix}.tmp`);
  const old = join(artifacts, `.layout-sheet.${suffix}.old`);
  const final = join(episodeDir, LAYOUT_SHEET_DIR);
  let report: LayoutSheetReport;
  try {
    const result = await renderLayoutSheet({ timeline: decision.timeline, assetRoot: episodeDir, sharedRoots: sharedRootsOf(episodeDir), picks, outDir: temp, scale: SHEET_SCALE });
    report = {
      createdAt: new Date().toISOString(),
      timeline: { path: EDIT_TIMELINE_PATH, hash: inputs.timeline },
      ...(decision.rebuilt ? { rebuilt: decision.rebuilt } : {}),
      rules: inputs.rules,
      scale: inputs.scale,
      kits: inputs.kits,
      renderer: inputs.renderer,
      inputsHash: inputs.inputsHash,
      frames: result.frames.map((f) => ({ ...f, path: relative(temp, f.path) })),
      sheet: { ...result.sheet, path: relative(temp, result.sheet.path) },
      warnings,
    };
    writeFileSync(join(temp, "sheet.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    if (existsSync(final)) renameSync(final, old);
    renameSync(temp, final);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    // Between the two renames: put the previous sheet back.
    if (!existsSync(final) && existsSync(old)) renameSync(old, final);
    throw error;
  }
  // The new sheet is in place: failing to remove the old one is no failure.
  try {
    rmSync(old, { recursive: true, force: true });
  } catch {
    /* a leftover .layout-sheet.*.old, harmless */
  }
  return { report, reportPath: join(final, "sheet.json"), sheetPath: join(final, report.sheet.path) };
}

const isObject = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
/** The names makeLayoutSheet writes: sheet.json can name nothing else. */
const SHEET_IMAGE = /^sheet\.jpg$/;
const STILL = /^frames\/\d{3}\.jpg$/;

/**
 * Read sheet.json and check the files it names are the ones rendered — the
 * grid and every still — or say why there is no sheet to speak of.
 */
function readReport(episodeDir: string): { ok: true; report: LayoutSheetReport } | { ok: false; reason: string } {
  const path = join(episodeDir, LAYOUT_SHEET_REPORT);
  if (!existsSync(path)) return { ok: false, reason: `${LAYOUT_SHEET_REPORT} does not exist` };
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { ok: false, reason: `${LAYOUT_SHEET_REPORT} is not JSON` };
  }
  if (!isObject(report) || !isObject(report.sheet) || !Array.isArray(report.frames) || !report.frames.every(isObject)) {
    return { ok: false, reason: `${LAYOUT_SHEET_REPORT} is not a layout sheet report` };
  }
  if (typeof report.sheet.path !== "string" || !SHEET_IMAGE.test(report.sheet.path)
    || !report.frames.every((f) => typeof f.path === "string" && STILL.test(f.path))) {
    return { ok: false, reason: `${LAYOUT_SHEET_REPORT} names files outside the sheet` };
  }
  const dir = join(episodeDir, LAYOUT_SHEET_DIR);
  const image = join(dir, report.sheet.path);
  if (!existsSync(image)) return { ok: false, reason: "the sheet image is missing" };
  if (sha256(readFileSync(image)) !== report.sheet.hash) return { ok: false, reason: "the sheet image is not the one rendered" };
  for (const frame of report.frames) {
    const still = join(dir, frame.path);
    if (!existsSync(still)) return { ok: false, reason: `still ${frame.path} is missing` };
    if (sha256(readFileSync(still)) !== frame.hash) return { ok: false, reason: `still ${frame.path} is not the one rendered` };
  }
  return { ok: true, report: report as unknown as LayoutSheetReport };
}

/**
 * Is the episode's layout sheet a picture of the timeline a render would use
 * now? Reads only.
 */
export function layoutSheetStatus(episodeDir: string, options: BuildOptions): LayoutSheetStatus {
  const read = readReport(episodeDir);
  if (!read.ok) return { state: "missing", reason: read.reason };
  const { report } = read;
  let now;
  try {
    now = inputsOf(episodeDir, options, decideEditTimeline(episodeDir, options));
  } catch (error) {
    return { state: "stale", reasons: [`the timeline a render would use cannot be decided: ${(error as Error).message}`] };
  }
  if (report.inputsHash === now.inputsHash) return { state: "current", inputsHash: now.inputsHash, sheetHash: report.sheet.hash };
  const reasons: string[] = [];
  if (report.timeline?.hash !== now.timeline) reasons.push("the timeline changed");
  if (canonicalJson(report.kits ?? null) !== canonicalJson(now.kits)) reasons.push("the kits changed");
  if (report.renderer !== now.renderer) reasons.push("the composer changed");
  if (canonicalJson(report.rules ?? null) !== canonicalJson(now.rules)) reasons.push("the sheet's rules changed");
  if (report.scale !== now.scale) reasons.push("the scale changed");
  if (reasons.length === 0) reasons.push("its inputs hash does not match");
  return { state: "stale", reasons };
}
