// Disposable, content-addressed render cache. Audio never enters the video
// keys, and pictures never enter the audio key: each is reused on its own.
// A segment is rendered at its ORIGINAL frame range, not a rebased timeline:
// kit animation, clip trims and crossfades keep their absolute/local clocks.
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './assets.js';
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

/** renderer identifies code, dependencies and encoding settings, NOT the timeline. */
export function planVideo(timeline: EditTimeline, renderer: string, assetFrames: Record<string, number> = {}): VideoPlan {
  const layers = visualLayers(timeline);
  const global = {
    version: 1, renderer, fps: timeline.fps, duration: timeline.durationInFrames,
    resolution: timeline.resolution, profile: timeline.profile, assetFrames,
  };
  const segments: VideoSegment[] = [];
  for (let from = 0; from < timeline.durationInFrames; from += timeline.fps) {
    const to = Math.min(from + timeline.fps, timeline.durationInFrames) - 1;
    const active = layers.filter(({item}) => item.from <= to && item.from + item.duration > from);
    const ids = new Set<string>();
    active.forEach(({item}) => assetRefs(item.props, ids));
    const assets = Object.fromEntries([...ids].sort().map((id) => [id, timeline.assets[id]]));
    // Drawing order is already resolved; source pointers/track names are editorial only.
    const items = active.map(({item: {source: _source, ...item}}) => item);
    segments.push({from, to, key: cacheKey({global, from, to, items, assets})});
  }
  return {key: cacheKey(segments), segments};
}

/**
 * The key of the mixed soundtrack: the audio tracks whole (ducking reads the
 * other audio tracks) and the media they play. Nothing drawn changes it.
 */
export function planAudio(timeline: EditTimeline, renderer: string, sampleRate: number): string {
  const tracks = timeline.tracks.filter((track) => track.type === 'audio');
  const ids = new Set<string>();
  assetRefs(tracks, ids);
  for (const track of tracks) for (const item of track.items) if ('asset' in item) ids.add(item.asset);
  const assets = Object.fromEntries([...ids].sort().map((id) => [id, timeline.assets[id]]));
  return cacheKey({version: 1, kind: 'audio', renderer, fps: timeline.fps, duration: timeline.durationInFrames, sampleRate, tracks, assets});
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
 * work in the cache.
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
   * it may report how far it is through the run (0–1) as it goes.
   */
  renderRun: (segments: VideoSegment[], outputs: string[], onProgress: (progress: number) => void) => Promise<void>;
  concatenate: (files: string[], output: string) => Promise<void>;
  onProgress?: (progress: number) => void;
  /** Longest run rendered by one call, in segments (default 120: two minutes at one second each). */
  maxRunSegments?: number;
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
  for (const run of missRuns(missing, options.maxRunSegments ?? 120)) {
    // Within a run, progress moves with its frames rather than jumping at its end.
    const done = report.segmentsReused + report.segmentsRendered;
    await options.renderRun(run.map((i) => plan.segments[i]!), run.map((i) => files[i]!),
      (p) => options.onProgress?.((done + Math.min(Math.max(p, 0), 1) * run.length) / total));
    for (const index of run) await segments.put(plan.segments[index]!.key, files[index]!);
    report.segmentsRendered += run.length;
    options.onProgress?.((report.segmentsReused + report.segmentsRendered) / total);
  }
  await options.concatenate(files, video);
  await whole.put(plan.key, video);
  return {video, report};
}
