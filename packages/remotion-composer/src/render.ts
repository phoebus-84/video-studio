// renderTimeline: validate → verify and stage assets → bundle → render →
// two-pass loudness → result record. The caller gives an output path; where
// renders live in an episode is the studio's business, not this package's.

import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {stageAssets, sha256} from './assets.js';
import {ComposerError} from './errors.js';
import {normalizeLoudness, type LoudnessResult, type LoudnessTarget} from './loudness.js';
import {isAudioItem} from './schema.js';
import {validateTimeline} from './validate.js';
import {videoFrames} from './probe.js';
import {renderWithCache} from './cached-render.js';
import {libraryEntry, readLibraryKits, resolveFromApplication, type LibraryKit} from './library-kits.js';
import {soundLayers} from './layers.js';
import {resolveKit} from './kits/index.js';
import type {CacheReport} from './render-cache.js';

export interface RenderTimelineOptions {
  /** A studio.video/v1alpha2 EditTimeline that already passed validateEditTimeline. */
  timeline: unknown;
  /** The directory asset paths are relative to (the episode). */
  assetRoot: string;
  /** Folders outside assetRoot that assets may also come from (a channel's theme releases, ADR-0040). */
  sharedRoots?: string[];
  outputPath: string;
  concurrency?: number;
  /** Opt in to disposable one-second video segments and whole-video reuse. */
  cacheDir?: string;
  onProgress?: (progress: number) => void;
  /** Overrides the timeline's `profile.loudness`. */
  loudness?: LoudnessTarget;
  /** Kits the channel or the series carries (avg-d1x), beside the application's. */
  kits?: readonly LibraryKit[];
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

export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderResult> {
  const library = await readLibraryKits(options.kits ?? []);
  const checked = validateTimeline(options.timeline, {kits: library.versions});
  if (!checked.ok) {
    const code = checked.problems[0]!.code;
    throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
  }
  const timeline = checked.timeline;
  const staging = await stageAssets(timeline, options.assetRoot, options.sharedRoots);
  if (!staging.ok) {
    throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
  }
  const {staged} = staging;
  const work = await mkdtemp(path.join(tmpdir(), 'remotion-composer-render-'));
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
    const output = path.resolve(options.outputPath);
    await mkdir(path.dirname(output), {recursive: true});
    // Without audio there is nothing to normalise: render straight to the output
    // (no cross-filesystem rename). With audio, loudness writes the output.
    const rendered = hasAudio ? path.join(work, options.cacheDir ? 'render.mkv' : 'render.mp4') : output;
    let cache: CacheReport | undefined;
    try {
      // The bundle — which copies the staged public directory — lives in the work
      // directory, so it is removed with it, on success and on failure.
      const serveUrl = await bundle({
        entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle'),
        ...(options.kits?.length ? {webpackOverride: resolveFromApplication} : {}),
      });
      const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
      if (options.cacheDir) {
        cache = await renderWithCache({
          composition, serveUrl, inputProps, cacheDir: path.resolve(options.cacheDir),
          work, output: rendered, hasAudio, soundItems, concurrency: options.concurrency, onProgress: options.onProgress,
        });
      } else await renderMedia({
        composition, serveUrl, inputProps,
        codec: 'h264', audioCodec: 'aac', enforceAudioTrack: true,
        outputLocation: rendered,
        concurrency: options.concurrency ?? null,
        imageFormat: 'jpeg', jpegQuality: 92, pixelFormat: 'yuv420p', colorSpace: 'bt709',
        onProgress: ({progress}) => options.onProgress?.(progress),
      });
    } catch (e) {
      throw new ComposerError('render-failed', `Remotion could not render the timeline: ${e instanceof Error ? e.message : String(e)}`);
    }

    let loudness: LoudnessResult | null = null;
    if (hasAudio) {
      try {
        loudness = await normalizeLoudness(rendered, output, options.loudness ?? timeline.profile.loudness);
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
  } finally {
    await staged.cleanup();
    await rm(work, {recursive: true, force: true});
  }
}
