// Disposable, content-addressed video cache. Audio never enters these keys.
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

/** Atomic publication + a digest prevent interrupted writes or corruption from being hits. */
export class VideoCache {
  constructor(private root: string, private warnings: string[]) {}

  async get(key: string, destination: string): Promise<boolean> {
    try {
      const record = JSON.parse(await readFile(path.join(this.root, `${key}.json`), 'utf8')) as {hash: string};
      if (!/^sha256:[a-f0-9]{64}$/.test(record.hash)) return false;
      await copyFile(path.join(this.root, `${key}.mp4`), destination);
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
      await copyFile(source, `${temp}.mp4`);
      const hash = await sha256(`${temp}.mp4`);
      await writeFile(`${temp}.json`, JSON.stringify({hash}));
      await rename(`${temp}.mp4`, path.join(this.root, `${key}.mp4`));
      await rename(`${temp}.json`, path.join(this.root, `${key}.json`));
    } catch (error) {
      this.warnings.push(`Cache write skipped: ${(error as Error).message}`);
    } finally {
      await Promise.all([`${temp}.mp4`, `${temp}.json`].map((p) => rm(p, {force: true}).catch(() => {})));
    }
  }
}

/** Callbacks keep cache policy testable without Chrome or FFmpeg. */
export async function cachedVideo(options: {
  plan: VideoPlan;
  cacheDir: string;
  work: string;
  renderSegment: (segment: VideoSegment, output: string) => Promise<void>;
  concatenate: (files: string[], output: string) => Promise<void>;
  onProgress?: (progress: number) => void;
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
  const files: string[] = [];
  for (const [index, segment] of plan.segments.entries()) {
    const output = path.join(work, `segment-${index}.mp4`);
    if (await segments.get(segment.key, output)) report.segmentsReused++;
    else {
      await options.renderSegment(segment, output);
      await segments.put(segment.key, output);
      report.segmentsRendered++;
    }
    files.push(output);
    options.onProgress?.((index + 1) / plan.segments.length);
  }
  await options.concatenate(files, video);
  await whole.put(plan.key, video);
  return {video, report};
}
