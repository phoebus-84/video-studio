// Disposable, content-addressed render cache. Audio never enters the video
// keys, and pictures never enter the audio key: each is reused on its own.
// A segment is rendered at its ORIGINAL frame range, not a rebased timeline:
// kit animation, clip trims and crossfades keep their absolute/local clocks.
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './assets.js';
import {resolveKit} from './kits/index.js';
import type {KitVersion} from './kits/types.js';
import {visualLayers} from './layers.js';
import type {EditTimeline} from './schema.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export const cacheKey = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function assetRefs(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) value.forEach((v) => assetRefs(v, ids));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length === 1 && typeof obj.$asset === 'string') ids.add(obj.$asset);
    else Object.values(obj).forEach((v) => assetRefs(v, ids));
  }
}

export interface VideoSegment { key: string; from: number; to: number }
export interface VideoPlan { key: string; segments: VideoSegment[] }
export interface CacheReport {
  wholeVideoReused: boolean;
  segmentsReused: number;
  segmentsRendered: number;
  totalSegments: number;
  /** The mixed soundtrack came from the cache: no audio pass ran. */
  audioReused?: boolean;
  /** Cache I/O is best effort, never a reason to lose a valid render. */
  warnings: string[];
}

/**
 * renderer identifies code, dependencies and encoding settings, NOT the
 * timeline. A kit item is keyed by what its kit says the segment's frames
 * read (KitVersion.segmentProps), when it says so; otherwise by its props.
 */
export function planVideo(timeline: EditTimeline, renderer: string, assetFrames: Record<string, number> = {}, kits?: readonly KitVersion[]): VideoPlan {
  const layers = visualLayers(timeline);
  const global = {
    version: 1, renderer, fps: timeline.fps, duration: timeline.durationInFrames,
    resolution: timeline.resolution, profile: timeline.profile, assetFrames,
  };
  const segments: VideoSegment[] = [];
  for (let from = 0; from < timeline.durationInFrames; from += timeline.fps) {
    const to = Math.min(from + timeline.fps, timeline.durationInFrames) - 1;
    const active = layers.filter(({item}) => item.from <= to && item.from + item.duration > from);
    // Drawing order is already resolved; source pointers/track names are editorial only.
    const items = active.map(({item: {source: _source, ...item}}) => {
      const read = item.kit ? resolveKit(item.kit.name, item.kit.version, kits)?.segmentProps?.(item.props as Record<string, unknown>,
        {from: Math.max(from, item.from) - item.from, to: Math.min(to, item.from + item.duration - 1) - item.from, fps: timeline.fps}) : undefined;
      return read === undefined ? item : {...item, props: {segmentProps: read}};
    });
    const ids = new Set<string>();
    items.forEach((item) => assetRefs(item.props, ids));
    const assets = Object.fromEntries([...ids].sort().map((id) => [id, timeline.assets[id]]));
    segments.push({from, to, key: cacheKey({global, from, to, items, assets})});
  }
  return {key: cacheKey(segments), segments};
}

/**
 * The key of the mixed soundtrack: the audio tracks whole (ducking reads the
 * other audio tracks) and the media they play. Nothing drawn changes it.
 */
export function planAudio(timeline: EditTimeline, renderer: string, sampleRate: number, soundItems: ReadonlySet<unknown> = new Set(), assetFrames: Record<string, number> = {}): string {
  // Items of kits that play sound belong to the soundtrack too (their props, their media).
  const tracks = timeline.tracks
    .map((track) => (track.type === 'audio' ? track : {...track, items: track.items.filter((item) => soundItems.has(item))}))
    .filter((track) => track.type === 'audio' || track.items.length > 0);
  const ids = new Set<string>();
  assetRefs(tracks, ids);
  for (const track of tracks) for (const item of track.items) if ('asset' in item) ids.add(item.asset);
  const assets = Object.fromEntries([...ids].sort().map((id) => [id, timeline.assets[id]]));
  // Sounding kits can read the whole KitContext, unlike plain audio tracks.
  // Counts are keyed by asset id, not transient staged URLs (as in planVideo).
  const context = soundItems.size > 0 ? {profile: timeline.profile, assetFrames} : null;
  return cacheKey({version: 1, kind: 'audio', renderer, fps: timeline.fps, duration: timeline.durationInFrames, sampleRate, tracks, assets, context});
}

/** Atomic publication + a digest prevent interrupted writes or corruption from being hits. */
export class VideoCache {
  constructor(private root: string, private warnings: string[], private ext = '.mp4') {}

  async get(key: string, destination: string): Promise<boolean> {
    try {
      const record = JSON.parse(await readFile(path.join(this.root, `${key}.json`), 'utf8')) as {hash: string};
      if (!/^sha256:[a-f0-9]{64}$/.test(record.hash)) return false;
      await copyFile(path.join(this.root, `${key}${this.ext}`), destination);
      if (await sha256(destination) === record.hash) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warnings.push(`Cache read missed: ${(error as Error).message}`);
    }
    await rm(destination, {force: true});
    return false;
  }

  async put(key: string, source: string): Promise<void> {
    const temp = path.join(this.root, `.${key}.${randomUUID()}`);
    try {
      await mkdir(this.root, {recursive: true});
      await copyFile(source, `${temp}${this.ext}`);
      const hash = await sha256(`${temp}${this.ext}`);
      await writeFile(`${temp}.json`, JSON.stringify({hash}));
      await rename(`${temp}${this.ext}`, path.join(this.root, `${key}${this.ext}`));
      await rename(`${temp}.json`, path.join(this.root, `${key}.json`));
    } catch (error) {
      this.warnings.push(`Cache write skipped: ${(error as Error).message}`);
    } finally {
      await Promise.all([`${temp}${this.ext}`, `${temp}.json`].map((p) => rm(p, {force: true}).catch(() => {})));
    }
  }
}

/**
 * Consecutive cache misses, at most `max` segments each. A run is rendered by
 * one renderer call: per-second calls paid the browser's and the encoder's
 * start-up for every 30 frames, and left the tabs idle (avg: render 8 s per
 * second of video). Bounded so an interrupted render still leaves most of its
 * work in the cache: a run is published only when it ends.
 */
export function missRuns(missing: number[], max: number): number[][] {
  const runs: number[][] = [];
  for (const index of missing) {
    const run = runs.at(-1);
    if (run && run.at(-1) === index - 1 && run.length < max) run.push(index);
    else runs.push([index]);
  }
  return runs;
}

/** Callbacks keep cache policy testable without Chrome or FFmpeg. */
export async function cachedVideo(options: {
  plan: VideoPlan;
  cacheDir: string;
  work: string;
  /**
   * Render consecutive segments in one go, writing outputs[i] for segments[i];
   * it may report how far it is through the run (0–1) as it goes. `lane` says
   * which of the `lanes` renders it, so each lane can draw in its own browser.
   */
  renderRun: (segments: VideoSegment[], outputs: string[], onProgress: (progress: number) => void, lane: number) => Promise<void>;
  concatenate: (files: string[], output: string) => Promise<void>;
  onProgress?: (progress: number) => void;
  /**
   * Longest run rendered by one call, in segments (default 30: half a minute at
   * one second each). With 120, the four lanes of a 3:28 biography each drew one
   * run of 52 s and all four ended together: when FFmpeg could not start at that
   * moment (Windows 0xC0000142, the machine short of memory) the whole render was
   * lost at 100% with nothing in the cache (2026-10-20). Shorter runs publish as
   * they go, for a start-up of a few seconds each.
   */
  maxRunSegments?: number;
  /**
   * Times a lane draws a failed run again before the render fails (default 1).
   * A browser or an FFmpeg that could not start is often a passing shortage.
   */
  retries?: number;
  /**
   * Runs rendered at once (default 1). The misses are cut so that every lane
   * has a share, and each lane takes the next run as it finishes one.
   */
  lanes?: number;
}): Promise<{video: string; report: CacheReport}> {
  const {plan, work} = options;
  const report: CacheReport = {wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 0, totalSegments: plan.segments.length, warnings: []};
  const whole = new VideoCache(path.join(options.cacheDir, 'video'), report.warnings);
  const segments = new VideoCache(path.join(options.cacheDir, 'segments'), report.warnings);
  const video = path.join(work, 'video.mp4');
  if (await whole.get(plan.key, video)) {
    report.wholeVideoReused = true;
    options.onProgress?.(1);
    return {video, report};
  }
  const files = plan.segments.map((_, index) => path.join(work, `segment-${index}.mp4`));
  const missing: number[] = [];
  for (const [index, segment] of plan.segments.entries()) {
    if (await segments.get(segment.key, files[index]!)) report.segmentsReused++;
    else missing.push(index);
  }
  const total = plan.segments.length;
  options.onProgress?.(report.segmentsReused / total);
  const lanes = Math.max(1, Math.floor(options.lanes ?? 1));
  const runs = missRuns(missing, Math.min(options.maxRunSegments ?? 30, Math.max(1, Math.ceil(missing.length / lanes))));
  const retries = Math.max(0, Math.floor(options.retries ?? 1));
  // Within a run, progress moves with its frames rather than jumping at its end.
  const partial = new Map<number[], number>();
  const progress = () => options.onProgress?.(
    (report.segmentsReused + report.segmentsRendered + [...partial.values()].reduce((a, b) => a + b, 0)) / total);
  let next = 0, failed = false;
  const lane = async (index: number) => {
    while (!failed && next < runs.length) {
      const run = runs[next++]!;
      for (let attempt = 0; ; attempt++) {
        partial.set(run, 0);
        try {
          await options.renderRun(run.map((i) => plan.segments[i]!), run.map((i) => files[i]!),
            (p) => { partial.set(run, Math.min(Math.max(p, 0), 1) * run.length); progress(); }, index);
          break;
        } catch (e) {
          if (attempt < retries && !failed) {
            report.warnings.push(`Frames ${plan.segments[run[0]!]!.from}-${plan.segments[run.at(-1)!]!.to} drawn again after: ${(e as Error).message}`);
            continue;
          }
          // The other lanes take no further run, and finish and keep the one they are on.
          failed = true;
          throw e;
        }
      }
      for (const i of run) await segments.put(plan.segments[i]!.key, files[i]!);
      partial.delete(run);
      report.segmentsRendered += run.length;
      progress();
    }
  };
  const settled = await Promise.allSettled(Array.from({length: Math.min(lanes, runs.length)}, (_, index) => lane(index)));
  const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failure) throw failure.reason;
  await options.concatenate(files, video);
  await whole.put(plan.key, video);
  return {video, report};
}
