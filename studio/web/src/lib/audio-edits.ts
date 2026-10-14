// An audio edit as the Audio tab draws it (avg-8hs.5): what the gateway
// answers, laid out as lanes of clips over time, with the joins, the
// reshaped pauses and the report's concerns as marks on the ruler.

import type { EpisodeRef } from "./sheet-review";
import type { MediaPlace } from "./episode-media";

export type EditWhere = ({ kind: "episode" } & EpisodeRef & { pin?: string }) | { kind: "source"; channel: string; source: string; pin?: string };

export interface EditPlacement { track: string; clip: string; source: string; in: number; out: number; start: number; end: number; fadeIn: number; fadeOut: number; take?: string }
export interface EditJoin { track: string; before: string; after: string; at: number; click: boolean; jumpDb: number | null }
export interface EditRecord {
  output: { path: string; hash: string; durationSeconds: number };
  resolved: { tracks?: { id: string; gain?: number; duck?: { under: string; gain: number }; clips?: { id: string; gain?: number; automation?: [number, number][] }[] }[] };
  placements: EditPlacement[];
  report: { loudness: { integrated: number | null; range: number | null; truePeak: number | null }; normalization: string; clipped: number; headTrim: number; joins: EditJoin[]; concerns: string[] };
  words?: { text: string; start: number; end: number }[];
  pauses?: { take: string; word: string; before: number; after: number; at: number }[];
  createdAt: string;
}
export interface AudioEditEntry { where: EditWhere; recordPath: string; record: EditRecord; peaks: { window: number; peaks: [number, number][] } | null }
export interface AudioEditsAnswer { edits: AudioEditEntry[]; invalid: string[] }

export interface LaneClip {
  id: string;
  /** What the clip plays: the take's id, or the source file's name. */
  label: string;
  take?: string;
  /** Room tone inserted to lengthen a pause. */
  room: boolean;
  start: number;
  end: number;
  in: number;
  out: number;
  fadeIn: number;
  fadeOut: number;
  gain: number;
  automation?: [number, number][];
  source: string;
}
export interface Lane { track: string; gain: number; duck?: { under: string; gain: number }; clips: LaneClip[] }

export interface Mark {
  at: number;
  kind: "join" | "click" | "jump" | "pause" | "concern";
  label: string;
}

const fileName = (path: string) => path.split("/").pop() ?? path;

type Loose = Record<string, any>;

/**
 * A record as the gateway read it, with what it lacks given its empty
 * default: a record written before a field existed is still drawn.
 */
export function recordOf(raw: unknown): EditRecord {
  const r = (raw ?? {}) as Loose;
  const report = (r.report ?? {}) as Loose;
  const loudness = (report.loudness ?? {}) as Loose;
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    output: { path: String(r.output?.path ?? ""), hash: String(r.output?.hash ?? ""), durationSeconds: Number(r.output?.durationSeconds) || 0 },
    resolved: { tracks: list(r.resolved?.tracks) },
    placements: list(r.placements),
    report: {
      loudness: { integrated: loudness.integrated ?? null, range: loudness.range ?? null, truePeak: loudness.truePeak ?? null },
      normalization: String(report.normalization ?? "none"),
      clipped: Number(report.clipped) || 0,
      headTrim: Number(report.headTrim) || 0,
      joins: list(report.joins),
      concerns: list(report.concerns),
    },
    ...(Array.isArray(r.words) ? { words: r.words } : {}),
    ...(Array.isArray(r.pauses) ? { pauses: r.pauses } : {}),
    createdAt: String(r.createdAt ?? ""),
  };
}

/** The takes the edit reads, once per source file: what "before" plays. */
export function takesOf(record: EditRecord): { take: string; source: string; key: string }[] {
  const out: { take: string; source: string; key: string }[] = [];
  for (const p of record.placements) {
    if (!p.take) continue;
    const key = `${p.source}#${p.take}`;
    if (!out.some((t) => t.key === key)) out.push({ take: p.take, source: p.source, key });
  }
  return out;
}

/** The tracks in the recipe's order, each with its clips where they landed. */
export function lanesOf(record: EditRecord): Lane[] {
  const tracks = record.resolved.tracks ?? [];
  const order = [...tracks.map((t) => t.id), ...record.placements.map((p) => p.track)].filter((id, i, all) => all.indexOf(id) === i);
  return order.map((id) => {
    const t = tracks.find((x) => x.id === id);
    const clips = record.placements.filter((p) => p.track === id).map((p): LaneClip => {
      const spec = t?.clips?.find((c) => c.id === p.clip);
      return {
        id: p.clip, label: p.take ?? fileName(p.source), ...(p.take ? { take: p.take } : {}),
        room: /\.room\d+$/.test(p.clip), start: p.start, end: p.end, in: p.in, out: p.out, fadeIn: p.fadeIn, fadeOut: p.fadeOut,
        gain: spec?.gain ?? 0, ...(spec?.automation ? { automation: spec.automation } : {}), source: p.source,
      };
    }).sort((a, b) => a.start - b.start);
    return { track: id, gain: t?.gain ?? 0, ...(t?.duck ? { duck: t.duck } : {}), clips };
  });
}

const s2 = (n: number) => `${n.toFixed(2)} s`;

/** The marks on the ruler: joins (and their clicks or jumps), reshaped pauses, and concerns that name a time. */
export function marksOf(record: EditRecord): Mark[] {
  const marks: Mark[] = [];
  for (const j of record.report.joins) {
    if (j.click) marks.push({ at: j.at, kind: "click", label: `click: ${j.before} → ${j.after}` });
    else if (j.jumpDb !== null && Math.abs(j.jumpDb) > 6) marks.push({ at: j.at, kind: "jump", label: `${j.jumpDb > 0 ? "+" : ""}${j.jumpDb.toFixed(1)} dB: ${j.before} → ${j.after}` });
    else marks.push({ at: j.at, kind: "join", label: `${j.before} → ${j.after}` });
  }
  for (const p of record.pauses ?? []) marks.push({ at: p.at, kind: "pause", label: `after «${p.word}»: ${s2(p.before)} → ${s2(p.after)}` });
  for (const c of record.report.concerns) {
    const at = /at (\d+(?:\.\d+)?) s/.exec(c);
    if (at && !marks.some((m) => Math.abs(m.at - Number(at[1])) < 0.002 && m.kind !== "join")) marks.push({ at: Number(at[1]), kind: "concern", label: c });
  }
  return marks.sort((a, b) => a.at - b.at);
}

/** Where an edit's files are read from. */
export const placeOf = (where: EditWhere): MediaPlace =>
  where.kind === "source" ? { channel: where.channel, source: where.source } : { channel: where.channel, series: where.series, episode: where.episode };

/** "episode" or "sources/<name>", and the pin it came through. */
export const whereLabel = (where: EditWhere) =>
  `${where.kind === "source" ? `sources/${where.source}` : `${where.series}/${where.episode}`}${where.pin ? ` (pin ${where.pin})` : ""}`;

/** The peak envelope between two times, at `columns` points: [min, max] each. */
export function envelope(peaks: { window: number; peaks: [number, number][] } | null, from: number, to: number, columns: number): [number, number][] {
  if (!peaks || peaks.peaks.length === 0 || columns <= 0 || to <= from) return [];
  const out: [number, number][] = [];
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((from + ((to - from) * c) / columns) / peaks.window);
    const b = Math.max(a + 1, Math.floor((from + ((to - from) * (c + 1)) / columns) / peaks.window));
    let lo = 0;
    let hi = 0;
    for (let i = Math.max(0, a); i < Math.min(peaks.peaks.length, b); i++) {
      lo = Math.min(lo, peaks.peaks[i]![0]);
      hi = Math.max(hi, peaks.peaks[i]![1]);
    }
    out.push([lo, hi]);
  }
  return out;
}

/** The word sounding at `t`, or -1. */
export function wordIndexAt(words: EditRecord["words"], t: number): number {
  return (words ?? []).findIndex((w) => t >= w.start && t < w.end);
}
