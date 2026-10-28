// renderTimeline: validate → verify and stage assets → bundle → render →
// two-pass loudness → result record. The caller gives an output path; where
// renders live in an episode is the studio's business, not this package's.

import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {stageAssets, sha256, type StagedAssets} from './assets.js';
import {ComposerError} from './errors.js';
import {normalizeLoudness, type LoudnessResult, type LoudnessTarget} from './loudness.js';
import {isAudioItem, type EditTimeline, type VisualItem} from './schema.js';
import {validateTimeline} from './validate.js';
import {videoFrames} from './probe.js';
import {cachedSegments, closeBrowsers, renderWithCache, type Browser} from './cached-render.js';
import {libraryEntry, readLibraryKits, type LibraryKit} from './library-kits.js';
import {bundleInto} from './bundle-cache.js';
import {soundLayers} from './layers.js';
import {resolveKit} from './kits/index.js';
import {placeSounds} from './sound-mix.js';
import type {CacheReport} from './render-cache.js';
import type {TimelineProps} from './Timeline.js';
import {timed} from './timings.js';
import {createHash} from 'node:crypto';
import {drawingCodeHash} from './identity.js';

export interface RenderTimelineOptions {
  /** A studio.video/v1alpha2 EditTimeline that already passed validateEditTimeline. */
  timeline: unknown;
  /** The directory asset paths are relative to (the episode). */
  assetRoot: string;
  /** Folders outside assetRoot that assets may also come from (a channel's theme releases, ADR-0040). */
  sharedRoots?: string[];
  outputPath: string;
  concurrency?: number;
  /** With `cacheDir`: browsers drawing the pictures at once, the `concurrency` tabs shared among them (default 1). */
  browsers?: number;
  /** Opt in to disposable one-second video segments and whole-video reuse. */
  cacheDir?: string;
  onProgress?: (progress: number) => void;
  /** Overrides the timeline's `profile.loudness`. */
  loudness?: LoudnessTarget;
  /** Kits the channel or the series carries (avg-d1x), beside the application's. */
  kits?: readonly LibraryKit[];
  /**
   * With `cacheDir`, a shared render's assembly: segment files other machines
   * drew (drawSegments), by index. Segments the cache lacks come from here;
   * the rest are drawn.
   */
  drawn?: Record<number, string>;
}

export interface RenderResult {
  path: string;
  durationSeconds: number;
  sizeBytes: number;
  hash: string;
  kits: {name: string; version: string}[];
  /** The id of the output profile the timeline rendered to. */
  profile: string;
  loudness: LoudnessResult | null;
  /** Present only when cacheDir was supplied. */
  cache?: CacheReport;
}

interface Prepared {
  timeline: EditTimeline;
  staged: StagedAssets;
  library: Awaited<ReturnType<typeof readLibraryKits>>;
  work: string;
  inputProps: TimelineProps;
  soundItems: VisualItem[];
  hasAudio: boolean;
  serveUrl: string;
  composition: Awaited<ReturnType<typeof selectComposition>>;
}

/** Validates, stages and bundles; `close` removes the work directory and the staging. */
async function prepareComposition(options: Omit<RenderTimelineOptions, 'outputPath'>): Promise<Prepared & {close: () => Promise<void>}> {
  const library = await readLibraryKits(options.kits ?? []);
  const checked = validateTimeline(options.timeline, {kits: library.versions});
  if (!checked.ok) {
    const code = checked.problems[0]!.code;
    throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
  }
  const timeline = checked.timeline;
  const staging = await timed('stage assets', () => stageAssets(timeline, options.assetRoot, options.sharedRoots));
  if (!staging.ok) {
    throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
  }
  const {staged} = staging;
  const work = await mkdtemp(path.join(tmpdir(), 'remotion-composer-render-'));
  const close = async () => {
    await staged.cleanup();
    await rm(work, {recursive: true, force: true});
  };
  try {
    const assetFrames: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
    }
    const inputProps = {timeline, files: staged.files, assetFrames};
    const entryPoint = await libraryEntry(library);
    // Sound comes from the audio tracks and from kits that play it themselves (a ported runtime).
    const kitOf = (name: string, version: string) => resolveKit(name, version, library.versions);
    const soundItems = soundLayers(timeline, kitOf).map(({item}) => item);
    const hasAudio = timeline.tracks.some((t) => t.type === 'audio' && !t.muted && t.items.some(isAudioItem)) || soundItems.length > 0;
    let serveUrl: string, composition: Prepared['composition'];
    try {
      // The bundle — the cached code linked with the staged public directory — lives
      // in the work directory, so it is removed with it, on success and on failure.
      serveUrl = await timed('bundle', () => bundleInto({entryPoint, withKits: Boolean(options.kits?.length)}, staged.publicDir, path.join(work, 'bundle')));
      composition = await timed('select composition', () => selectOnce(serveUrl, entryPoint, inputProps));
    } catch (e) {
      throw new ComposerError('render-failed', `Remotion could not render the timeline: ${e instanceof Error ? e.message : String(e)}`);
    }
    return {timeline, staged, library, work, inputProps, soundItems, hasAudio, serveUrl, composition, close};
  } catch (e) {
    await close();
    throw e;
  }
}

/**
 * The composition of the same code and props, selected once: a shared render
 * prepares it to draw and again to assemble, and a correction renders the
 * props it rendered before. Selecting opens a page in a browser.
 */
const selected = new Map<string, Promise<Prepared['composition']>>();
function selectOnce(serveUrl: string, entryPoint: string, inputProps: Record<string, unknown>): Promise<Prepared['composition']> {
  const key = createHash('sha256').update(JSON.stringify([entryPoint, drawingCodeHash(), inputProps])).digest('hex');
  let pending = selected.get(key);
  if (!pending) {
    pending = selectComposition({serveUrl, id: 'Timeline', inputProps});
    pending.catch(() => selected.delete(key));
    if (selected.size >= 16) selected.delete(selected.keys().next().value!);
    selected.set(key, pending);
  }
  return pending;
}

/** `body` runs with the composition, and the work directory and staging go after it. */
async function withComposition<T>(options: Omit<RenderTimelineOptions, 'outputPath'>, body: (prepared: Prepared) => Promise<T>): Promise<T> {
  const prepared = await prepareComposition(options);
  try {
    return await body(prepared);
  } finally {
    await prepared.close();
  }
}

const cacheOptions = (options: Omit<RenderTimelineOptions, 'outputPath'>, cacheDir: string, prepared: Prepared) => ({
  composition: prepared.composition, serveUrl: prepared.serveUrl, inputProps: prepared.inputProps, cacheDir: path.resolve(cacheDir),
  work: prepared.work, hasAudio: prepared.hasAudio, soundItems: prepared.soundItems,
  // Listed sounds are mixed by FFmpeg; a kit that lists none keeps the browser pass.
  sounds: prepared.hasAudio ? placeSounds({timeline: prepared.timeline, soundItems: prepared.soundItems, files: prepared.staged.files,
    sources: prepared.staged.sources, assetFrames: prepared.inputProps.assetFrames, kits: prepared.library.versions}) : null,
  kits: prepared.library.versions, concurrency: options.concurrency, browsers: options.browsers, onProgress: options.onProgress,
});

export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderResult> {
  if (options.drawn && !options.cacheDir) throw new ComposerError('render-failed', 'segments drawn elsewhere join a render only with a cacheDir');
  return withComposition(options, async (prepared) => {
    const {timeline, work, hasAudio} = prepared;
    const output = path.resolve(options.outputPath);
    await mkdir(path.dirname(output), {recursive: true});
    // Without audio there is nothing to normalise: render straight to the output
    // (no cross-filesystem rename). With a cache, the soundtrack is normalised
    // alone and muxed into the output; otherwise loudness writes the output.
    const target = options.loudness ?? timeline.profile.loudness;
    const rendered = hasAudio && !options.cacheDir ? path.join(work, 'render.mp4') : output;
    let cache: CacheReport | undefined;
    let loudness: LoudnessResult | null = null;
    try {
      if (options.cacheDir) {
        const {loudness: levelled, ...report} = await renderWithCache({
          ...cacheOptions(options, options.cacheDir, prepared), output: rendered, ...(hasAudio ? {loudness: target} : {}),
          ...(options.drawn ? {provided: new Map(Object.entries(options.drawn).map(([index, file]) => [Number(index), file]))} : {}),
        });
        cache = report;
        loudness = levelled ?? null;
      } else await renderMedia({
        composition: prepared.composition, serveUrl: prepared.serveUrl, inputProps: prepared.inputProps,
        codec: 'h264', audioCodec: 'aac', enforceAudioTrack: true,
        outputLocation: rendered,
        concurrency: options.concurrency ?? null,
        imageFormat: 'jpeg', jpegQuality: 92, pixelFormat: 'yuv420p', colorSpace: 'bt709',
        onProgress: ({progress}) => options.onProgress?.(progress),
      });
    } catch (e) {
      throw new ComposerError('render-failed', `Remotion could not render the timeline: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (hasAudio && !loudness) {
      try {
        loudness = await timed('loudness', () => normalizeLoudness(rendered, output, target));
      } catch (e) {
        throw new ComposerError('loudness-failed', `loudness could not be normalised: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const kits = [...new Map(timeline.tracks.flatMap((t) => t.items).filter((i) => !isAudioItem(i))
      .map((i) => [`${(i as {kit: {name: string}}).kit.name}@${(i as {kit: {version: string}}).kit.version}`, (i as {kit: {name: string; version: string}}).kit])).values()]
      .map((k) => ({name: k.name, version: k.version}));
    return {
      path: output,
      durationSeconds: timeline.durationInFrames / timeline.fps,
      sizeBytes: (await stat(output)).size,
      hash: await sha256(output),
      kits,
      profile: timeline.profile.id,
      loudness,
      ...(cache ? {cache} : {}),
    };
  });
}

export interface DrawSegmentsOptions extends Omit<RenderTimelineOptions, 'outputPath' | 'drawn' | 'cacheDir'> {
  cacheDir: string;
  /** The one-second segments to draw, by index (segment i starts at frame i × fps). */
  segments: number[];
  /** Where segment-<index>.mp4 are written. */
  dir: string;
  /** Also ready the cached soundtrack: this machine will assemble the video. */
  audio?: boolean;
}

export interface DrawnSegment { index: number; file: string; hash: string; bytes: number }
export interface DrawSegmentsResult { segments: DrawnSegment[]; totalSegments: number; cache: CacheReport }

/** One chunk of a share: its segments, and whether this machine also readies the soundtrack. */
export interface SegmentChunk { segments: number[]; audio?: boolean; onProgress?: (progress: number) => void }

/** A timeline opened once, bundle and browsers, to draw chunk after chunk of its segments. */
export interface SegmentDrawer {
  draw(chunk: SegmentChunk): Promise<DrawSegmentsResult>;
  /** The segments this machine's cache already holds, by index: assembled from there, never drawn. */
  cached(): Promise<number[]>;
  close(): Promise<void>;
}

/**
 * Opens a shared render's share once: validation, staging, the bundle and
 * the browsers are paid for the first chunk, not for every one (each
 * drawSegments call pays them again, about a minute on a laptop).
 */
export async function openSegmentDrawer(options: Omit<DrawSegmentsOptions, 'segments' | 'audio' | 'onProgress'>): Promise<SegmentDrawer> {
  const dir = path.resolve(options.dir);
  await mkdir(dir, {recursive: true});
  const prepared = await prepareComposition(options);
  const browserPool: Promise<Browser>[] = [];
  return {
    async draw(chunk) {
      let cache: CacheReport;
      try {
        cache = await renderWithCache({
          ...cacheOptions({...options, onProgress: chunk.onProgress}, options.cacheDir, prepared), output: path.join(prepared.work, 'unused.mkv'),
          segments: {indices: chunk.segments, dir, audio: chunk.audio ?? false}, browserPool,
          // The assembler readies the soundtrack normalised, so assembly is a stream copy.
          ...(chunk.audio ? {loudness: options.loudness ?? prepared.timeline.profile.loudness} : {}),
        });
      } catch (e) {
        throw new ComposerError('render-failed', `Remotion could not draw the segments: ${e instanceof Error ? e.message : String(e)}`);
      }
      const segments = await Promise.all([...new Set(chunk.segments)].sort((a, b) => a - b).map(async (index) => {
        const file = path.join(dir, `segment-${index}.mp4`);
        return {index, file, hash: await sha256(file), bytes: (await stat(file)).size};
      }));
      return {segments, totalSegments: cache.totalSegments, cache};
    },
    cached() {
      return cachedSegments(cacheOptions(options, options.cacheDir, prepared));
    },
    async close() {
      await closeBrowsers(browserPool);
      await prepared.close();
    },
  };
}

/**
 * A shared render's share: some of a timeline's segments, drawn (or taken
 * from the cache) and left as files, for renderTimeline's `drawn` on the
 * machine that assembles the video.
 */
export async function drawSegments(options: DrawSegmentsOptions): Promise<DrawSegmentsResult> {
  const drawer = await openSegmentDrawer(options);
  try {
    return await drawer.draw({segments: options.segments, audio: options.audio, onProgress: options.onProgress});
  } finally {
    await drawer.close();
  }
}
