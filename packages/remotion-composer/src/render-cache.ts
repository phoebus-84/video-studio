// Disposable, content-addressed render cache. Audio never enters the video
// keys, and pictures never enter the audio key: each is reused on its own.
// A segment is rendered at its ORIGINAL frame range, not a rebased timeline:
// kit animation, clip trims and crossfades keep their absolute/local clocks.
import {createHash, randomUUID} from 'node:crypto';
import {access, copyFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
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

/** Hashes already read in this process, by what identifies a file's content without reading it. */
const remembered = new Map<string, Promise<string>>();
const REMEMBER = 8192;

/**
 * sha256, read once per process for a file whose identity, size and
 * modification time have not changed, as git trusts its index. The same file
 * reached by another path or a hard link (a linked bundle) is the same
 * entry. A render and a layout sheet each read the browser (200 MB) and the
 * code again, and a correction every cached second. Not the change time:
 * linking a file changes it, never its content.
 */
export async function sha256Cached(file: string): Promise<string> {
  const s = await stat(file, {bigint: true});
  // Without a file id (some filesystems give 0) the path names the file.
  const key = `${s.ino !== 0n ? `${s.dev}:${s.ino}` : path.resolve(file)}:${s.size}:${s.mtimeNs}`;
  let pending = remembered.get(key);
  if (!pending) {
    pending = sha256(file);
    pending.catch(() => remembered.delete(key));
    if (remembered.size >= REMEMBER) remembered.delete(remembered.keys().next().value!);
    remembered.set(key, pending);
  }
  return pending;
}

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
  /** Segments another machine drew for this render (a shared render): used, never cached here. */
  segmentsProvided?: number;
  totalSegments: number;
  /** The mixed soundtrack came from the cache: no audio pass ran. */
  audioReused?: boolean;
  /** The soundtrack, normalised, came from the cache: no loudness pass ran. */
  loudnessReused?: boolean;
  /** Cache I/O is best effort, never a reason to lose a valid render. */
  warnings: string[];
}

/**
 * renderer identifies code, dependencies and encoding settings, NOT the
 * timeline. A kit item is keyed by what its kit says the segment's frames
 * read (KitVersion.segmentProps), when it says so; otherwise by its props.
 */
export function planVideo(timeline: EditTimeline, renderer: string, assetFrames: Record<string, number> = {}, kits?: readonly KitVersion[]): VideoPlan {
  const key = rangeKeys(timeline, renderer, assetFrames, kits);
  const segments: VideoSegment[] = [];
  for (let from = 0; from < timeline.durationInFrames; from += timeline.fps) {
    const to = Math.min(from + timeline.fps, timeline.durationInFrames) - 1;
    segments.push({from, to, key: key(from, to)});
  }
  return {key: cacheKey(segments), segments};
}

/**
 * The key of frames from..to (inclusive) of `timeline`, as planVideo keys a
 * segment: what draws them, and nothing else. A layout sheet keys its stills
 * with it, so a correction redraws only the stills it touches.
 */
export function rangeKeys(timeline: EditTimeline, renderer: string, assetFrames: Record<string, number> = {}, kits?: readonly KitVersion[]): (from: number, to: number) => string {
  const layers = visualLayers(timeline);
  const global = {
    version: 1, renderer, fps: timeline.fps, duration: timeline.durationInFrames,
    resolution: timeline.resolution, profile: timeline.profile, assetFrames,
  };
  return (from, to) => {
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
    return cacheKey({global, from, to, items, assets});
  };
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
    return (await this.read(key, destination)) !== null;
  }

  /** get, with what put recorded beside the file: null on a miss. */
  async read(key: string, destination: string): Promise<{meta?: unknown} | null> {
    try {
      const record = JSON.parse(await readFile(path.join(this.root, `${key}.json`), 'utf8')) as {hash: string; meta?: unknown};
      if (!/^sha256:[a-f0-9]{64}$/.test(record.hash)) return null;
      // The entry is checked where it lies, once per process while it stays
      // as it is (an entry is published whole, by rename, and never
      // rewritten): a correction reads every cached second again.
      const entry = path.join(this.root, `${key}${this.ext}`);
      if (await sha256Cached(entry) !== record.hash) return null;
      await copyFile(entry, destination);
      return {meta: record.meta};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warnings.push(`Cache read missed: ${(error as Error).message}`);
    }
    await rm(destination, {force: true});
    return null;
  }

  /** Whether `key` is cached, without reading it: get still checks it. */
  async has(key: string): Promise<boolean> {
    try {
      await Promise.all([access(path.join(this.root, `${key}.json`)), access(path.join(this.root, `${key}${this.ext}`))]);
      return true;
    } catch {
      return false;
    }
  }

  async put(key: string, source: string, meta?: unknown): Promise<void> {
    const temp = path.join(this.root, `.${key}.${randomUUID()}`);
    try {
      await mkdir(this.root, {recursive: true});
      await copyFile(source, `${temp}${this.ext}`);
      const hash = await sha256(`${temp}${this.ext}`);
      await writeFile(`${temp}.json`, JSON.stringify(meta === undefined ? {hash} : {hash, meta}));
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

/** Cache entries read at once. */
const CACHE_READERS = 8;

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
  /** Longest run rendered by one call, in segments (default 120: two minutes at one second each). */
  maxRunSegments?: number;
  /**
   * Runs rendered at once (default 1). The misses are cut so that every lane
   * has a share, and each lane takes the next run as it finishes one.
   */
  lanes?: number;
  /**
   * A shared render's share: only these segments, and no whole video — the
   * result's `video` is then empty and `files[i]` holds segment i.
   */
  only?: readonly number[];
  /**
   * Segments other machines drew, by index: a segment the cache lacks is
   * taken from here rather than drawn. Once `checkProvided` passes they join
   * like this machine's own, and are cached with the whole video: a later
   * render, a correction above all, draws none of them again.
   */
  provided?: ReadonlyMap<number, string>;
  /** Called before the concat with the indices taken from `provided`: it may refuse them. */
  checkProvided?: (files: string[], provided: number[]) => Promise<void>;
  /**
   * Return once the video is joined, and cache it whole meanwhile: `stored`
   * settles when it is (the caller reads the video, never writes it, and
   * awaits it before reading the report's warnings).
   */
  deferStore?: boolean;
}): Promise<{video: string; report: CacheReport; files: string[]; stored?: Promise<void>}> {
  const {plan, work} = options;
  const wanted = options.only ? [...new Set(options.only)].sort((a, b) => a - b) : plan.segments.map((_, index) => index);
  for (const index of wanted) {
    if (!Number.isInteger(index) || index < 0 || index >= plan.segments.length) throw new Error(`there is no segment ${index}: the video has ${plan.segments.length}`);
  }
  const report: CacheReport = {wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 0, totalSegments: plan.segments.length, warnings: []};
  const whole = new VideoCache(path.join(options.cacheDir, 'video'), report.warnings);
  const segments = new VideoCache(path.join(options.cacheDir, 'segments'), report.warnings);
  const video = path.join(work, 'video.mp4');
  const files = plan.segments.map((_, index) => path.join(work, `segment-${index}.mp4`));
  if (!options.only && await whole.get(plan.key, video)) {
    report.wholeVideoReused = true;
    options.onProgress?.(1);
    return {video, report, files: []};
  }
  const missing: number[] = [];
  const provided: number[] = [];
  // Read side by side: one at a time, an hour's 3600 seconds took half a minute before any drawing.
  const found = new Array<'cached' | 'provided' | 'missing'>(plan.segments.length);
  let at = 0;
  const reader = async () => {
    for (let k = at++; k < wanted.length; k = at++) {
      const index = wanted[k]!;
      const from = options.provided?.get(index);
      if (await segments.get(plan.segments[index]!.key, files[index]!)) found[index] = 'cached';
      else if (from !== undefined) {
        await copyFile(from, files[index]!);
        found[index] = 'provided';
      } else found[index] = 'missing';
    }
  };
  await Promise.all(Array.from({length: Math.min(CACHE_READERS, wanted.length)}, reader));
  for (const index of wanted) {
    if (found[index] === 'cached') report.segmentsReused++;
    else if (found[index] === 'provided') provided.push(index);
    else missing.push(index);
  }
  if (provided.length > 0) report.segmentsProvided = provided.length;
  const done = () => report.segmentsReused + provided.length;
  const total = wanted.length;
  options.onProgress?.(done() / total);
  const lanes = Math.max(1, Math.floor(options.lanes ?? 1));
  const runs = missRuns(missing, Math.min(options.maxRunSegments ?? 120, Math.max(1, Math.ceil(missing.length / lanes))));
  // Within a run, progress moves with its frames rather than jumping at its end.
  const partial = new Map<number[], number>();
  const progress = () => options.onProgress?.(
    (done() + report.segmentsRendered + [...partial.values()].reduce((a, b) => a + b, 0)) / total);
  let next = 0, failed = false;
  const lane = async (index: number) => {
    while (!failed && next < runs.length) {
      const run = runs[next++]!;
      partial.set(run, 0);
      try {
        await options.renderRun(run.map((i) => plan.segments[i]!), run.map((i) => files[i]!),
          (p) => { partial.set(run, Math.min(Math.max(p, 0), 1) * run.length); progress(); }, index);
      } catch (e) {
        // The other lanes take no further run, and finish and keep the one they are on.
        failed = true;
        throw e;
      }
      // Cached while the lane draws its next run.
      storing.push(Promise.all(run.map((i) => segments.put(plan.segments[i]!.key, files[i]!))).then(() => undefined));
      partial.delete(run);
      report.segmentsRendered += run.length;
      progress();
    }
  };
  const storing: Promise<void>[] = [];
  const settled = await Promise.allSettled(Array.from({length: Math.min(lanes, runs.length)}, (_, index) => lane(index)));
  // put never throws: a failed write is a warning.
  await Promise.all(storing);
  const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failure) throw failure.reason;
  if (options.only) return {video: '', report, files};
  if (provided.length > 0) {
    await options.checkProvided?.(files, provided);
    await Promise.all(provided.map((i) => segments.put(plan.segments[i]!.key, files[i]!)));
  }
  await options.concatenate(files, video);
  const stored = whole.put(plan.key, video);
  if (options.deferStore) return {video, report, files, stored};
  await stored;
  return {video, report, files};
}
