// ---------------------------------------------------------------------------
// Comparing two versions of an episode: the pure half (avg-jao.5, UP-54)
// ---------------------------------------------------------------------------
// Which frames of the two versions are compared — the layout sheet's instants
// of the new version, carried into the old one by section and offset, so a
// block that got longer does not make everything after it look changed — how
// different two frames are, and what the differences mean against the
// sections a correction was expected to touch.
// ---------------------------------------------------------------------------

import { matchesSection, sheetInstants } from "./sheet-instants.js";

export type CompareErrorCode =
  | "bad-version"
  | "no-such-render"
  | "no-render"
  | "render-changed"
  | "no-such-reference"
  | "reference-changed"
  | "resolution-differs"
  | "decode-failed"
  | "bad-options";

/** Why a comparison could not be made; nothing was written. */
export class CompareError extends Error {
  constructor(readonly code: CompareErrorCode, message: string) {
    super(message);
    this.name = "CompareError";
  }
}

export interface AlignSection {
  id: string;
  from: number;
  duration: number;
}

/** What alignment needs of a version: its timing and, when its timeline is known, its sections. */
export interface AlignSide {
  fps: number;
  durationInFrames: number;
  sections: AlignSection[] | null;
}

export type UnmappedReason = "beyond-old-section" | "new-section" | "missing-in-old";

export interface ComparePick {
  index: number;
  /** From sheetInstants, or "<t>s" for an explicit time. */
  label: string;
  /** The new version's section containing the frame, when its timeline is known. */
  section: string | null;
  newFrame: number;
  /** null when the instant has no counterpart in the old version. */
  oldFrame: number | null;
  reason?: UnmappedReason;
}

export interface Shift {
  /** Seconds of the new version from which the old one is `by` seconds later (negative: earlier). */
  from: number;
  by: number;
}

/**
 * A difference in the shape of the two versions that no sampled frame can
 * show: a section added, removed or resized, or — without sections — videos
 * of different lengths.
 */
export interface StructureChange {
  /** null for a difference in length between versions without sections. */
  section: string | null;
  change: "added" | "removed" | "resized" | "length";
  oldFrames: number;
  newFrames: number;
}

export interface Alignment {
  picks: ComparePick[];
  /** Sections added, removed or resized; or the length, aligning by time. */
  structure: StructureChange[];
  /** "sections" when both versions have sections; otherwise "time". */
  alignment: "sections" | "time";
  warnings: string[];
}

const usable = (sections: AlignSection[] | null) => (sections ?? []).filter((s) => s.duration > 0);
const containing = (sections: AlignSection[], frame: number) =>
  sections.find((s) => s.from <= frame && frame < s.from + s.duration) ?? null;

/** The new version's instants, and where each one is in the old version. */
export function alignInstants(newer: AlignSide, older: AlignSide, options: { times?: number[]; shifts?: Shift[] } = {}): Alignment {
  const shifts = options.shifts ?? [];
  for (const s of shifts) {
    if (!Number.isFinite(s.from) || !Number.isFinite(s.by) || s.from < 0) {
      throw new CompareError("bad-options", `shift ${JSON.stringify(s)} is not {from ≥ 0, by} in seconds`);
    }
  }

  let instants: { frame: number; label: string }[];
  const warnings: string[] = [];
  if (options.times !== undefined) {
    if (options.times.length === 0) throw new CompareError("bad-options", "give at least one time, or none for the sheet's instants");
    const seen = new Map<number, string>();
    for (const t of options.times) {
      const frame = Math.round(t * newer.fps);
      if (!Number.isFinite(t) || frame < 0 || frame >= newer.durationInFrames) {
        throw new CompareError("bad-options", `time ${t}s is not inside the new version (0–${((newer.durationInFrames - 1) / newer.fps).toFixed(2)}s)`);
      }
      if (!seen.has(frame)) seen.set(frame, `${t}s`);
    }
    instants = [...seen.entries()].sort(([a], [b]) => a - b).map(([frame, label]) => ({ frame, label }));
  } else {
    const sections = usable(newer.sections);
    const sheet = sheetInstants({ fps: newer.fps, durationInFrames: newer.durationInFrames, ...(sections.length > 0 ? { sections } : {}) });
    instants = sheet.picks;
    warnings.push(...sheet.warnings);
  }

  const newSections = usable(newer.sections);
  const oldSections = usable(older.sections);
  const bySections = newSections.length > 0 && oldSections.length > 0;
  if (bySections && shifts.length > 0) warnings.push("shifts ignored: both versions have sections, aligned by section");

  const picks = instants.map(({ frame, label }, index): ComparePick => {
    const section = containing(newSections, frame);
    const pick = { index, label, section: section?.id ?? null, newFrame: frame };
    let oldFrame: number;
    if (bySections && section) {
      const counterpart = oldSections.find((s) => s.id === section.id);
      if (!counterpart) return { ...pick, oldFrame: null, reason: "new-section" };
      const offset = Math.round(((frame - section.from) * older.fps) / newer.fps);
      if (offset >= counterpart.duration) return { ...pick, oldFrame: null, reason: "beyond-old-section" };
      oldFrame = counterpart.from + offset;
    } else {
      const t = frame / newer.fps + shifts.filter((s) => s.from <= frame / newer.fps).reduce((sum, s) => sum + s.by, 0);
      oldFrame = Math.round(t * older.fps);
    }
    if (oldFrame < 0 || oldFrame >= older.durationInFrames) return { ...pick, oldFrame: null, reason: "missing-in-old" };
    return { ...pick, oldFrame };
  });
  return { picks, structure: structureOf(newer, older, bySections), alignment: bySections ? "sections" : "time", warnings };
}

/** What sampling cannot see: sections added, removed or resized; without sections, a change of length. */
function structureOf(newer: AlignSide, older: AlignSide, bySections: boolean): StructureChange[] {
  // Lengths compared in time, so a change of frame rate alone is no change.
  const frames = (side: AlignSide, n: number) => Math.round((n * newer.fps) / side.fps);
  if (!bySections) {
    return frames(older, older.durationInFrames) === newer.durationInFrames
      ? []
      : [{ section: null, change: "length", oldFrames: older.durationInFrames, newFrames: newer.durationInFrames }];
  }
  const newSections = usable(newer.sections);
  const oldSections = usable(older.sections);
  const changes: StructureChange[] = [];
  for (const old of oldSections) {
    const now = newSections.find((s) => s.id === old.id);
    if (!now) changes.push({ section: old.id, change: "removed", oldFrames: old.duration, newFrames: 0 });
    else if (frames(older, old.duration) !== now.duration) {
      changes.push({ section: old.id, change: "resized", oldFrames: old.duration, newFrames: now.duration });
    }
  }
  for (const now of newSections) {
    if (!oldSections.some((s) => s.id === now.id)) changes.push({ section: now.id, change: "added", oldFrames: 0, newFrames: now.duration });
  }
  return changes;
}

/**
 * The share of pixels that, once changed, makes a frame changed whatever its
 * mean: a word in a caption moves the mean of a whole frame by less than 1.
 */
export const MIN_CHANGED_SHARE = 0.002;

/** Has a frame changed: its mean past the threshold, or enough of its pixels changed. */
export const changedFrame = (m: { meanDiff: number; changedShare: number }, threshold: number) =>
  m.meanDiff > threshold || m.changedShare >= MIN_CHANGED_SHARE;

/** How different two grey frames of the same size are. */
export function measure(a: Uint8Array, b: Uint8Array): { meanDiff: number; changedShare: number } {
  if (a.length !== b.length) throw new Error(`frames of different sizes (${a.length} and ${b.length} pixels)`);
  let total = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    total += d;
    if (d > 16) changed++;
  }
  const n = a.length || 1;
  return { meanDiff: Math.round((total / n) * 10) / 10, changedShare: Math.round((changed / n) * 1000) / 1000 };
}

export type Verdict = "ok" | "unexpected-changes" | "listed";

/** What the changed pairs and the changes of shape mean against the sections expected to change. */
export function judge(
  pairs: { index: number; section: string | null; changed: boolean }[],
  expect: string[] | undefined,
  structure: StructureChange[] = [],
): { verdict: Verdict; changed: number[]; unexpected: number[]; unexpectedStructure: StructureChange[]; warnings: string[] } {
  const changed = pairs.filter((p) => p.changed);
  const indexes = changed.map((p) => p.index);
  if (expect === undefined) return { verdict: "listed", changed: indexes, unexpected: [], unexpectedStructure: [], warnings: [] };
  const expected = (section: string | null) => section !== null && expect.some((pattern) => matchesSection(pattern, section));
  const unexpected = changed.filter((p) => !expected(p.section)).map((p) => p.index);
  const unexpectedStructure = structure.filter((c) => !expected(c.section));
  const touched = [...changed.map((p) => p.section), ...structure.map((c) => c.section)];
  const warnings = expect
    .filter((pattern) => !touched.some((section) => section !== null && matchesSection(pattern, section)))
    .map((pattern) => `${pattern} was expected to change and did not`);
  const verdict = unexpected.length > 0 || unexpectedStructure.length > 0 ? "unexpected-changes" : "ok";
  return { verdict, changed: indexes, unexpected, unexpectedStructure, warnings };
}
