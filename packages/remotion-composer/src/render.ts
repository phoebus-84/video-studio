// renderTimeline: validate → verify and stage assets → bundle → render →
// two-pass loudness → result record. The caller gives an output path; where
// renders live in an episode is the studio's business, not this package's.

import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {stageAssets, sha256} from './assets.js';
import {ComposerError} from './errors.js';
import {DEFAULT_LOUDNESS, normalizeLoudness, type LoudnessResult, type LoudnessTarget} from './loudness.js';
import {isAudioItem} from './schema.js';
import {validateTimeline} from './validate.js';
import {videoFrames} from './probe.js';

export interface RenderTimelineOptions {
  /** A studio.video/v1alpha2 EditTimeline that already passed validateEditTimeline. */
  timeline: unknown;
  /** The directory asset paths are relative to (the episode). */
  assetRoot: string;
  outputPath: string;
  concurrency?: number;
  onProgress?: (progress: number) => void;
  loudness?: LoudnessTarget;
}

export interface RenderResult {
  path: string;
  durationSeconds: number;
  sizeBytes: number;
  hash: string;
  kits: {name: string; version: string}[];
  loudness: LoudnessResult | null;
}

export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderResult> {
  const checked = validateTimeline(options.timeline);
  if (!checked.ok) {
    const code = checked.problems[0]!.code;
    throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
  }
  const timeline = checked.timeline;
  const staging = await stageAssets(timeline, options.assetRoot);
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
    const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remotion-entry.js');
    const hasAudio = timeline.tracks.some((t) => t.type === 'audio' && !t.muted && t.items.some(isAudioItem));
    const output = path.resolve(options.outputPath);
    await mkdir(path.dirname(output), {recursive: true});
    // Without audio there is nothing to normalise: render straight to the output
    // (no cross-filesystem rename). With audio, loudness writes the output.
    const rendered = hasAudio ? path.join(work, 'render.mp4') : output;
    try {
      // The bundle — which copies the staged public directory — lives in the work
      // directory, so it is removed with it, on success and on failure.
      const serveUrl = await bundle({entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle')});
      const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
      await renderMedia({
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
        loudness = await normalizeLoudness(rendered, output, options.loudness ?? DEFAULT_LOUDNESS);
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
      loudness,
    };
  } finally {
    await staged.cleanup();
    await rm(work, {recursive: true, force: true});
  }
}
