// ---------------------------------------------------------------------------
// The layout sheet's instants (avg-3th.1)
// ---------------------------------------------------------------------------
// Which frames a layout sheet shows, decided the same way every time from the
// timeline alone: the first and last frame, a spread over the sections by
// length (at least one per section, never on its cut), and the instants the
// series' template release declares. Pure: avg-jao.5 renders two versions of
// an episode at exactly these frames.
// ---------------------------------------------------------------------------

import type { SheetInstantRule, SheetRules } from "@studio/contracts/src/series-templates.mjs";

export type { SheetInstantRule, SheetRules };

/** What sheetInstants needs of an edit timeline. */
export interface SheetTimeline {
  fps: number;
  durationInFrames: number;
  sections?: { id: string; from: number; duration: number }[];
}

export interface SheetPick {
  frame: number;
  /** "first", "last", a section id, or "<section> · <at><±offset>s"; joined with " / " when picks share a frame. */
  label: string;
}

export interface SheetInstants {
  /** Sorted by frame, one per frame. */
  picks: SheetPick[];
  /** Rules that matched no section, or whose instant fell outside its section. */
  warnings: string[];
}

/** How many frames a sheet shows before the series' own instants, first and last included. */
export const SHEET_TARGET = 24;

/** The most frames one sheet holds: @av/remotion-composer's MAX_SHEET_PICKS. */
export const SHEET_MAX_PICKS = 120;

/** A section pattern: an exact id, or a prefix ending in `*` (`block-*`). */
export const matchesSection = (pattern: string, id: string) =>
  pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;

const seconds = (value: number) => `${value > 0 ? "+" : "-"}${Math.abs(value)}s`;
const describeRule = (rule: SheetInstantRule) => `${rule.at}${rule.offsetSeconds ? seconds(rule.offsetSeconds) : ""}`;

export function sheetInstants(timeline: SheetTimeline, rules?: SheetRules, target = SHEET_TARGET): SheetInstants {
  const last = timeline.durationInFrames - 1;
  const labels = new Map<number, string[]>();
  // Past the limit a new frame is dropped (a label on a frame already picked
  // still joins it): the defaults come first, then the rules in their order.
  let dropped = 0;
  const add = (frame: number, label: string) => {
    const at = labels.get(frame);
    if (at === undefined && labels.size >= SHEET_MAX_PICKS) {
      dropped++;
      return;
    }
    if (at === undefined) labels.set(frame, [label]);
    else if (!at.includes(label)) at.push(label);
  };
  add(0, "first");
  add(last, "last");

  const declared = (timeline.sections ?? []).filter((s) => s.duration > 0);
  const sections = declared.length > 0
    ? [...declared].sort((a, b) => a.from - b.from)
    : [{ id: "timeline", from: 0, duration: timeline.durationInFrames }];

  // CreativeStudio's spread: k frames per section in proportion to its length,
  // at least one, placed at (i + 0.6) / k of the way through.
  const total = sections.reduce((sum, s) => sum + s.duration, 0) || 1;
  const spread = Math.max(0, target - 2);
  for (const s of sections) {
    const k = Math.max(1, Math.round((spread * s.duration) / total));
    for (let i = 0; i < k; i++) add(Math.min(last, s.from + Math.floor((s.duration * (i + 0.6)) / k)), s.id);
  }

  const warnings: string[] = [];
  (rules?.instants ?? []).forEach((rule, index) => {
    const name = `rule ${index + 1} (${describeRule(rule)})`;
    const matching = sections.filter((s) => rule.sections === undefined || rule.sections.some((p) => matchesSection(p, s.id)));
    if (matching.length === 0) {
      warnings.push(`${name} matches no section`);
      return;
    }
    const offset = Math.round((rule.offsetSeconds ?? 0) * timeline.fps);
    for (const s of matching) {
      const end = s.from + s.duration - 1;
      const anchor = rule.at === "start" ? s.from : rule.at === "middle" ? s.from + Math.floor(s.duration / 2) : end;
      const frame = anchor + offset;
      if (frame < s.from || frame > end || frame < 0 || frame > last) {
        warnings.push(`${name} falls outside section ${s.id}`);
        continue;
      }
      add(frame, `${s.id} · ${describeRule(rule)}`);
    }
  });

  if (dropped > 0) warnings.push(`${dropped} instants dropped: a sheet holds at most ${SHEET_MAX_PICKS} frames`);

  const picks = [...labels.entries()]
    .sort(([a], [b]) => a - b)
    .map(([frame, names]) => ({ frame, label: names.join(" / ") }));
  return { picks, warnings };
}
