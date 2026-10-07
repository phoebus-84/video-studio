// ---------------------------------------------------------------------------
// Comparing two versions of an episode (avg-jao.5, UP-54)
// ---------------------------------------------------------------------------
// A correction changes only the part that was asked for, and that is shown:
// two renders — of this episode, or a golden reference — decoded by ffmpeg at
// the same instants (version-diff.ts aligns them), every pair measured, the
// changed ones drawn side by side with their difference, and a verdict
// against the sections expected to change. Written whole to
// reviews/compare/<old>--<new>/ in the new version's episode.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { validateSeriesReference } from "@studio/contracts/src/series-templates.mjs";
import { alignInstants, CompareError, judge, measure, type AlignSide, type ComparePick, type Shift, type Verdict } from "./version-diff.js";

const exec = promisify(execFile);

export const COMPARE_DIR = "reviews/compare";
const RENDER_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REFERENCE = /^reference:([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** "<render-id>" of this episode, or "reference:<template-id>/<reference-id>" of its series. */
export type VersionRef = string;

export interface Version {
  ref: VersionRef;
  /** The episode directory the version's files belong to. */
  episodeDir: string;
  /** Paths relative to episodeDir; hashes "sha256:…". */
  video: { path: string; hash: string };
  timeline: { path: string; hash: string } | null;
  side: AlignSide;
  width: number;
  height: number;
  notes: string[];
}

const sha256Text = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
};

/** A path a document names, confined to `base`; null when it points outside. */
function inside(base: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  const full = resolve(base, path);
  const rel = relative(base, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : full;
}

/** Timing, size and sections from a timeline document; null when it has none of them. */
function fromTimeline(doc: any): { side: AlignSide; width: number; height: number } | null {
  const fps = doc?.fps;
  const durationInFrames = doc?.durationInFrames;
  const width = doc?.resolution?.width;
  const height = doc?.resolution?.height;
  if (![fps, durationInFrames, width, height].every((n) => typeof n === "number" && n > 0)) return null;
  const sections = Array.isArray(doc.sections)
    ? doc.sections
      .filter((s: any) => typeof s?.id === "string" && Number.isInteger(s?.from) && Number.isInteger(s?.duration))
      .map((s: any) => ({ id: s.id, from: s.from, duration: s.duration }))
    : null;
  return { side: { fps, durationInFrames, sections }, width, height };
}

/** What ffprobe says of a video: its rate, its frames and its size. */
async function probe(video: string): Promise<{ side: AlignSide; width: number; height: number }> {
  let out: string;
  try {
    ({ stdout: out } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
      "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", video]));
  } catch (error) {
    throw new CompareError("decode-failed", `ffprobe could not read ${video}: ${(error as Error).message}`);
  }
  const stream = JSON.parse(out).streams?.[0];
  const [num, den] = String(stream?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = num! / (den || 1);
  const durationInFrames = Number(stream?.nb_read_frames);
  if (!stream || !(fps > 0) || !(durationInFrames > 0)) throw new CompareError("decode-failed", `${video} has no video stream ffprobe can measure`);
  return { side: { fps, durationInFrames, sections: null }, width: stream.width, height: stream.height };
}

async function renderVersion(episodeDir: string, renderId: string): Promise<Version> {
  const video = join(episodeDir, "output", `${renderId}.mp4`);
  const report = readJson(join(episodeDir, "output", `${renderId}.report.json`));
  if (!existsSync(video) || report === undefined) {
    throw new CompareError("no-such-render", `output/${renderId}.mp4 and its report are not both in this episode`);
  }
  const hash = await sha256File(video);
  if (hash !== report?.render?.hash) {
    throw new CompareError("render-changed", `output/${renderId}.mp4 is not the video its report describes (${hash}, the report says ${report?.render?.hash})`);
  }
  const notes: string[] = [];
  const snapshotPath = `output/${renderId}.timeline.json`;
  let timeline: Version["timeline"] = null;
  let measured: ReturnType<typeof fromTimeline> = null;
  if (existsSync(join(episodeDir, snapshotPath))) {
    const text = readFileSync(join(episodeDir, snapshotPath));
    if (sha256Text(text) === report?.timeline?.hash) {
      timeline = { path: snapshotPath, hash: sha256Text(text) };
      measured = fromTimeline(readJson(join(episodeDir, snapshotPath)));
    } else {
      notes.push(`${snapshotPath} is not the timeline the report names: aligned by time`);
    }
  } else {
    notes.push(`${renderId} kept no timeline: aligned by time`);
  }
  return { ref: renderId, episodeDir, video: { path: `output/${renderId}.mp4`, hash }, timeline, ...(measured ?? await probe(video)), notes };
}

async function referenceVersion(episodeDir: string, ref: string, templateId: string, referenceId: string): Promise<Version> {
  const seriesDir = dirname(dirname(episodeDir));
  const descriptor = readJson(join(seriesDir, "templates", templateId, "references", `${referenceId}.json`));
  if (descriptor === undefined || validateSeriesReference(descriptor).length > 0) {
    throw new CompareError("no-such-reference", `templates/${templateId}/references/${referenceId}.json is not a reference of this series`);
  }
  const refEpisode = join(seriesDir, "episodes", descriptor.episodeRef.episode);
  const video = inside(refEpisode, descriptor.render.path);
  const timelinePath = inside(refEpisode, descriptor.timeline.path);
  if (!video || !timelinePath || !existsSync(video) || !existsSync(timelinePath)) {
    throw new CompareError("reference-changed", `the files of reference ${referenceId} are not in its episode`);
  }
  const hash = await sha256File(video);
  const timelineText = readFileSync(timelinePath);
  if (hash !== descriptor.render.hash || sha256Text(timelineText) !== descriptor.timeline.hash) {
    throw new CompareError("reference-changed", `the render or timeline of reference ${referenceId} is not what its descriptor says`);
  }
  const measured = fromTimeline(readJson(timelinePath)) ?? await probe(video);
  return {
    ref,
    episodeDir: refEpisode,
    video: { path: descriptor.render.path, hash },
    timeline: { path: descriptor.timeline.path, hash: descriptor.timeline.hash },
    ...measured,
    notes: [`signature not checked: run vpr reference verify for trust`],
  };
}

/** Find a version and check its files are the ones recorded. */
export async function resolveVersion(episodeDir: string, ref: VersionRef): Promise<Version> {
  const reference = REFERENCE.exec(ref);
  if (reference) return referenceVersion(episodeDir, ref, reference[1]!, reference[2]!);
  if (!RENDER_ID.test(ref)) throw new CompareError("bad-version", `"${ref}" is neither a render id nor reference:<template>/<reference>`);
  return renderVersion(episodeDir, ref);
}

/** The render output/current.json points at. */
function currentRender(episodeDir: string): string {
  const current = readJson(join(episodeDir, "output", "current.json"));
  if (typeof current?.renderId !== "string") throw new CompareError("no-render", "this episode has no current render (output/current.json) to compare");
  return current.renderId;
}

const dirName = (ref: VersionRef) => ref.replace(/^reference:/, "reference-").replace("/", "-");

/**
 * Decode `frames` of `video` in one ffmpeg pass, at `width`×`height`: each as
 * grey bytes (for measuring) and as `<dir>/<prefix>-<frame>.jpg` (for people).
 */
async function decode(video: string, frames: number[], width: number, height: number, dir: string, prefix: string): Promise<Map<number, Uint8Array>> {
  const unique = [...new Set(frames)].sort((a, b) => a - b);
  const result = new Map<number, Uint8Array>();
  if (unique.length === 0) return result;
  const select = unique.map((f) => `eq(n\\,${f})`).join("+");
  const raw = join(dir, `${prefix}.gray`);
  const jpgs = join(dir, `${prefix}-%04d.jpg`);
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video,
      // Split before scaling: split's outputs share one pixel format, so a
      // split after it would make the JPEGs grey too. Each scaler converts.
      "-filter_complex", `[0:v]split=2[a][b];[a]select='${select}',scale=${width}:${height},format=gray[g];`
        + `[b]select='${select}',scale=${width}:${height},format=yuvj420p[j]`,
      "-map", "[g]", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", raw,
      "-map", "[j]", "-fps_mode", "passthrough", "-q:v", "3", jpgs], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new CompareError("decode-failed", `ffmpeg could not decode ${video}: ${(error as Error).message}`);
  }
  const bytes = readFileSync(raw);
  const size = width * height;
  if (bytes.length < size * unique.length) {
    throw new CompareError("decode-failed", `${video} gave ${Math.floor(bytes.length / size)} of the ${unique.length} frames asked for`);
  }
  unique.forEach((frame, i) => {
    result.set(frame, new Uint8Array(bytes.subarray(i * size, (i + 1) * size)));
    renameSync(join(dir, `${prefix}-${String(i + 1).padStart(4, "0")}.jpg`), join(dir, `${prefix}-${frame}.jpg`));
  });
  rmSync(raw, { force: true });
  return result;
}

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new CompareError("decode-failed", `ffmpeg could not draw the comparison: ${(error as Error).message}`);
  }
}

/**
 * old | new | where they differ, side by side: the difference as grey heat,
 * amplified four times so a small change shows. A missing side is black.
 */
async function drawPair(oldJpg: string | null, newJpg: string, width: number, height: number, out: string): Promise<void> {
  const oldInput = oldJpg ? ["-i", oldJpg] : ["-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=1`];
  await ffmpeg([...oldInput, "-i", newJpg, "-filter_complex",
    "[0:v]format=rgb24,split=2[o1][o2];[1:v]format=rgb24,split=2[n1][n2];"
    + "[o2][n2]blend=all_mode=difference,format=gray,lut=y='min(val*4\\,255)',format=rgb24[d];"
    + "[o1][n1][d]hstack=inputs=3",
    "-frames:v", "1", "-q:v", "3", out]);
}

export interface ComparedPair extends ComparePick {
  seconds: number;
  meanDiff: number | null;
  changedShare: number | null;
  changed: boolean;
}

export interface CompareReport {
  createdAt: string;
  old: Omit<Version, "episodeDir" | "side" | "width" | "height">;
  new: Omit<Version, "episodeDir" | "side" | "width" | "height">;
  alignment: "sections" | "time";
  threshold: number;
  shifts: Shift[];
  expect: string[] | null;
  verdict: Verdict;
  pairs: ComparedPair[];
  changed: number[];
  unexpected: number[];
  warnings: string[];
}

export interface VersionComparison {
  report: CompareReport;
  /** Absolute paths. */
  dir: string;
  reportPath: string;
  /** null when nothing changed. */
  changedPath: string | null;
}

export interface CompareOptions {
  old: VersionRef;
  /** Default: the current render. */
  new?: VersionRef;
  expect?: string[];
  /** Mean grey difference (0–255) above which a pair has changed; default 1.0. */
  threshold?: number;
  times?: number[];
  shifts?: Shift[];
}

let temporaries = 0;

/**
 * Compare two versions at the same instants and write the comparison to
 * reviews/compare/<old>--<new>/ of this episode, replacing a previous one of
 * the same pair whole. Nothing is written unless every pair was measured.
 */
export async function compareVersions(episodeDir: string, options: CompareOptions): Promise<VersionComparison> {
  const threshold = options.threshold ?? 1;
  if (!(Number.isFinite(threshold) && threshold > 0)) throw new CompareError("bad-options", `threshold ${threshold} is not a positive number`);
  if (options.expect !== undefined && (!Array.isArray(options.expect) || options.expect.some((p) => typeof p !== "string" || p === ""))) {
    throw new CompareError("bad-options", "expect is a list of section ids or prefixes ending in *");
  }
  const older = await resolveVersion(episodeDir, options.old);
  const newer = await resolveVersion(episodeDir, options.new ?? currentRender(episodeDir));
  if (older.width !== newer.width || older.height !== newer.height) {
    throw new CompareError("resolution-differs", `${older.ref} is ${older.width}x${older.height}, ${newer.ref} is ${newer.width}x${newer.height}: nothing would be comparable`);
  }
  const { picks, alignment, warnings } = alignInstants(newer.side, older.side, {
    ...(options.times ? { times: options.times } : {}),
    ...(options.shifts ? { shifts: options.shifts } : {}),
  });

  const compareDir = join(episodeDir, COMPARE_DIR);
  mkdirSync(compareDir, { recursive: true });
  const name = `${dirName(older.ref)}--${dirName(newer.ref)}`;
  const suffix = `${process.pid}.${temporaries++}`;
  const temp = join(compareDir, `.${name}.${suffix}.tmp`);
  const old = join(compareDir, `.${name}.${suffix}.old`);
  const final = join(compareDir, name);
  const width = Math.max(2, Math.round(newer.width / 4));
  const height = Math.max(2, Math.round(newer.height / 4));
  let report: CompareReport;
  let changedPath: string | null = null;
  try {
    const frames = join(temp, "frames");
    mkdirSync(frames, { recursive: true });
    const newFrames = await decode(join(newer.episodeDir, newer.video.path), picks.map((p) => p.newFrame), width, height, frames, "new");
    const oldFrames = await decode(join(older.episodeDir, older.video.path), picks.flatMap((p) => p.oldFrame === null ? [] : [p.oldFrame]), width, height, frames, "old");

    const pairs: ComparedPair[] = picks.map((p) => {
      const seconds = Math.round((p.newFrame / newer.side.fps) * 1000) / 1000;
      if (p.oldFrame === null) return { ...p, seconds, meanDiff: null, changedShare: null, changed: true };
      const m = measure(oldFrames.get(p.oldFrame)!, newFrames.get(p.newFrame)!);
      return { ...p, seconds, ...m, changed: m.meanDiff > threshold };
    });
    const judged = judge(pairs, options.expect);

    const changed = pairs.filter((p) => p.changed);
    if (changed.length > 0) {
      mkdirSync(join(temp, "pairs"), { recursive: true });
      const drawn: string[] = [];
      for (const p of changed) {
        const out = join(temp, "pairs", `${String(p.index).padStart(3, "0")}.jpg`);
        await drawPair(p.oldFrame === null ? null : join(frames, `old-${p.oldFrame}.jpg`), join(frames, `new-${p.newFrame}.jpg`), width, height, out);
        drawn.push(out);
      }
      const stacked = join(temp, "changed.jpg");
      if (drawn.length === 1) writeFileSync(stacked, readFileSync(drawn[0]!));
      else await ffmpeg([...drawn.flatMap((d) => ["-i", d]), "-filter_complex", `vstack=inputs=${drawn.length}`, "-frames:v", "1", "-q:v", "3", stacked]);
    }
    rmSync(frames, { recursive: true, force: true });

    const describe = (v: Version) => ({ ref: v.ref, video: v.video, timeline: v.timeline, notes: v.notes });
    report = {
      createdAt: new Date().toISOString(),
      old: describe(older),
      new: describe(newer),
      alignment,
      threshold,
      shifts: options.shifts ?? [],
      expect: options.expect ?? null,
      verdict: judged.verdict,
      pairs,
      changed: judged.changed,
      unexpected: judged.unexpected,
      warnings: [...warnings, ...judged.warnings],
    };
    writeFileSync(join(temp, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    if (existsSync(final)) renameSync(final, old);
    renameSync(temp, final);
    if (changed.length > 0) changedPath = join(final, "changed.jpg");
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (!existsSync(final) && existsSync(old)) renameSync(old, final);
    throw error;
  }
  try {
    rmSync(old, { recursive: true, force: true });
  } catch {
    /* a leftover .old, harmless */
  }
  return { report, dir: final, reportPath: join(final, "report.json"), changedPath };
}
