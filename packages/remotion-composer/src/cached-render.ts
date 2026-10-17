import {execFile} from 'node:child_process';
import {readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {ensureBrowser, openBrowser, renderMedia} from '@remotion/renderer';
import type {VideoConfig} from 'remotion';
import {sha256} from './assets.js';
import {shapesSegments} from './identity.js';
import {cachedVideo, cacheKey, planAudio, planVideo, VideoCache, type CacheReport} from './render-cache.js';
import type {TimelineProps} from './Timeline.js';
import type {KitVersion} from './kits/types.js';
import type {VisualItem} from './schema.js';
import {mixSounds, type PlacedSound} from './sound-mix.js';

const exec = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';
const run = (args: string[]) => exec(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {maxBuffer: 8 * 1024 * 1024});

// Explicit settings shared by every independently decodable, silent H.264 segment.
const encoding = {
  codec: 'h264', crf: 18, x264Preset: 'medium', imageFormat: 'jpeg', jpegQuality: 92,
  pixelFormat: 'yuv420p', colorSpace: 'bt709', muted: true,
} as const;

/** The render cache's hash of the Node-side code: every module that draws, encodes or cuts a segment. */
export const runtimeCodeHashes = (dir: string) => codeHashes(dir, shapesSegments);

async function codeHashes(dir: string, keep: (file: string) => boolean = () => true, base = dir): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    // Never hash staged media as renderer code: it belongs in per-segment keys.
    if (entry.isDirectory() && entry.name !== 'public') rows.push([entry.name, await codeHashes(path.join(dir, entry.name), keep, base)]);
    else if (entry.isFile() && /\.(js|tsx?|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && keep(path.relative(base, path.join(dir, entry.name)))) {
      rows.push([entry.name, await sha256(path.join(dir, entry.name))]);
    }
  }
  return rows;
}

async function rendererKey(serveUrl: string): Promise<string> {
  const require = createRequire(import.meta.url);
  const browser = await ensureBrowser();
  if (!('path' in browser)) throw new Error('No headless browser is available');
  const dependencies = await Promise.all(['@remotion/renderer', '@remotion/bundler', 'remotion', 'react', 'react-dom'].map(async (name) =>
    [name, JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8')).version]));
  return cacheKey({
    cacheVersion: 1, encoding, platform: process.platform, arch: process.arch,
    node: process.version, browser: await sha256(browser.path), dependencies,
    // The bundle includes the actual kit/React/Remotion code, hashed whole (a
    // volume change, which it holds, still misses). Node-side code is also
    // hashed, so a renderer fix invalidates entries without a version bump —
    // but not the modules that never draw (a loudness or audit fix keeps them).
    bundle: await codeHashes(serveUrl),
    runtime: await runtimeCodeHashes(path.dirname(fileURLToPath(import.meta.url))),
    ffmpeg: (await exec(ffmpeg(), ['-version'])).stdout,
  });
}

/** The Node code a soundtrack mixed without a browser depends on: where each sound goes, and how loud. */
async function mixerKey(): Promise<unknown[]> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = (await readdir(dir)).filter((f) => /^(sound-mix|volume)\.(js|ts)$/.test(f)).sort();
  return Promise.all(files.map(async (f) => [f, await sha256(path.join(dir, f))]));
}

/** The tabs of a browser sound pass: it draws nothing, so a few do (half the render's, at most 4). */
export const soundTabs = (concurrency: number | undefined) => Math.max(1, Math.min(4, Math.floor((concurrency ?? 2) / 2)));

/** Keyframes only where gopSize puts them: the encoding step gets -sc_threshold 0 after its -g. */
function keyframesEverySecond({args}: {args: string[]}): string[] {
  const at = args.indexOf('-g');
  return at < 0 ? args : [...args.slice(0, at + 2), '-sc_threshold', '0', ...args.slice(at + 2)];
}

export async function renderWithCache(options: {
  inputProps: TimelineProps;
  composition: VideoConfig;
  serveUrl: string;
  cacheDir: string;
  work: string;
  output: string;
  hasAudio: boolean;
  /** Visual items of kits that play sound: mounted in the sound pass, beside the audio tracks. */
  soundItems?: readonly VisualItem[];
  /**
   * Everything the sound pass would mount, when every kit that plays sound
   * lists it: the soundtrack is then mixed by FFmpeg, without a browser.
   */
  sounds?: readonly PlacedSound[] | null;
  /** The library kits drawn, for the segment keys of those that say what a segment reads. */
  kits?: readonly KitVersion[];
  concurrency?: number;
  /**
   * Browsers that draw the pictures at once (default 1), with the tabs shared
   * among them. Chrome rasterizes all of a browser's tabs in its one GPU
   * process: past a few tabs that process is the limit, and another browser
   * brings its own (a long, 2026-10-16: 4.0 frames a second with one browser
   * of 6–10 tabs, 5.3 with two of four).
   */
  browsers?: number;
  onProgress?: (progress: number) => void;
}): Promise<CacheReport> {
  const {inputProps, composition, serveUrl, work, hasAudio} = options;
  const {timeline} = inputProps;
  // Keys use asset ids, not staging filenames (which change when audio is added).
  const assetFrames = Object.fromEntries(Object.entries(inputProps.files)
    .filter(([, file]) => inputProps.assetFrames[file] !== undefined)
    .map(([id, file]) => [id, inputProps.assetFrames[file]!]));
  const renderer = await rendererKey(serveUrl);
  const plan = planVideo(timeline, renderer, assetFrames, options.kits);
  const common = {composition, serveUrl, concurrency: options.concurrency ?? null};
  const silentProps = {...inputProps, pass: 'picture' as const, timeline: {...timeline, tracks: timeline.tracks.filter((t) => t.type === 'visual')}};
  // The component is handed the props of the composition (inputProps only reach getInputProps()): each pass
  // carries its own, or the picture pass would mount every sound and the sound pass draw every picture.
  const withProps = (props: TimelineProps & {pass: 'picture' | 'sound'}) => ({composition: {...composition, props}, inputProps: props});
  const sounding = new Set(options.soundItems ?? []);
  // Reuse each browser across misses, rather than launching Chrome each second.
  // A whole-video hit with no audio never opens one.
  const browsers = Math.max(1, Math.floor(options.browsers ?? 1));
  const opened: Promise<Awaited<ReturnType<typeof openBrowser>>>[] = [];
  const getBrowser = (lane = 0) => opened[lane] ??= openBrowser('chrome');
  const tabsEach = options.concurrency ? Math.max(1, Math.floor(options.concurrency / browsers)) : null;
  // Each half is reported by how far it is. A soundtrack FFmpeg mixes goes
  // beside the pictures; a browser sound pass waits for them (see below).
  let videoDone = 0, audioDone = hasAudio ? 0 : 1;
  const report = () => options.onProgress?.(videoDone * 0.8 + audioDone * 0.2);
  const audio = path.join(work, 'audio.wav');
  const sampleRate = 48000;
  const audioWarnings: string[] = [];
  const soundtrack = async (): Promise<boolean> => {
    if (!hasAudio) return false;
    // The mix is cached on its own key: a change to the pictures alone, or a
    // render of the same audio again, skips the pass.
    const cache = new VideoCache(path.join(options.cacheDir, 'audio'), audioWarnings, '.wav');
    // Mixed without a browser, the soundtrack also depends on the Node code that places the sounds.
    const mixer = options.sounds ? await mixerKey() : null;
    const key = planAudio(timeline, mixer ? cacheKey({renderer, mixer}) : renderer, sampleRate, sounding, assetFrames);
    if (await cache.get(key, audio)) {
      audioDone = 1;
      report();
      return true;
    }
    if (options.sounds) {
      await mixSounds({sounds: options.sounds, timeline, output: audio, sampleRate, onProgress: (p) => { audioDone = p; report(); }});
      await cache.put(key, audio);
      return false;
    }
    // Keep ALL audio tracks: ducking looks up other tracks in the timeline.
    // Only kits that play sound are mounted (told it is the sound pass), and
    // no video frames are encoded.
    const tracks = timeline.tracks
      .map((t) => (t.type === 'audio' ? t : {...t, items: t.items.filter((i) => sounding.has(i as VisualItem))}))
      .filter((t) => t.type === 'audio' || t.items.length > 0);
    const audioProps = {...inputProps, pass: 'sound' as const, timeline: {...timeline, tracks}};
    await renderMedia({
      ...common, concurrency: soundTabs(options.concurrency), puppeteerInstance: await getBrowser(), ...withProps(audioProps), codec: 'wav', enforceAudioTrack: true,
      outputLocation: audio, sampleRate,
      onProgress: ({progress}) => { audioDone = progress; report(); },
    });
    await cache.put(key, audio);
    return false;
  };
  try {
    const pictures = () => cachedVideo({
      plan, cacheDir: options.cacheDir, work, lanes: browsers,
      onProgress: (p) => { videoDone = p; report(); },
      renderRun: async (segments, outputs, onRunProgress, lane) => {
        // One renderer call for the whole run, every tab busy across it. A
        // keyframe every second (gopSize) puts one at each segment's first
        // frame: segments start on multiples of fps and so does the run, so
        // ffmpeg cuts it into the cached segments without re-encoding. x264
        // would also start a GOP at each scene cut, which resets the count and
        // moves every later keyframe off the second: scene-cut detection off.
        const first = segments[0]!, last = segments.at(-1)!;
        const whole = segments.length === 1 ? outputs[0]! : path.join(work, `run-${first.from}.mp4`);
        await renderMedia({
          ...common, concurrency: browsers > 1 ? tabsEach : common.concurrency, ...encoding, puppeteerInstance: await getBrowser(lane),
          ...withProps(silentProps), outputLocation: whole,
          frameRange: [first.from, last.to], gopSize: timeline.fps, ffmpegOverride: keyframesEverySecond,
          onProgress: ({progress}) => onRunProgress(progress),
        });
        if (segments.length === 1) return;
        const cuts = segments.slice(1).map((segment) => segment.from - first.from);
        const pattern = path.join(work, `run-${first.from}-%05d.mp4`);
        await run(['-i', whole, '-map', '0:v:0', '-an', '-c:v', 'copy', '-f', 'segment',
          '-segment_frames', cuts.join(','), '-reset_timestamps', '1', pattern]);
        for (const [i, output] of outputs.entries()) {
          const piece = pattern.replace('%05d', String(i).padStart(5, '0'));
          try {
            await rename(piece, output);
          } catch {
            throw new Error(`splitting frames ${first.from}-${last.to} gave fewer than ${segments.length} segments`);
          }
        }
        await rm(whole, {force: true});
      },
      concatenate: async (files, output) => {
        // Only generated basenames go in the concat script; no caller-controlled
        // paths or quoting, and no shell execution.
        const list = path.join(work, 'segments.txt');
        await writeFile(list, files.map((file) => `file '${path.basename(file)}'`).join('\n'));
        await run(['-f', 'concat', '-safe', '1', '-i', list, '-map', '0:v:0', '-c:v', 'copy', '-an', output]);
      },
    });
    // The browser's sound pass mounts every sounding kit on every frame: beside
    // the pictures, on the same browser, it slowed them about 4× (a long,
    // 2026-10-16). It runs after them, with few tabs; FFmpeg's mix runs beside.
    const [{video, report: cacheReport}, audioReused] = options.sounds || !hasAudio
      ? await Promise.all([pictures(), soundtrack()])
      : [await pictures(), await soundtrack()];
    cacheReport.warnings.push(...audioWarnings);
    if (hasAudio) {
      cacheReport.audioReused = audioReused;
      // Lossless audio intermediate: loudnorm does the sole final AAC encode.
      await run(['-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', options.output]);
    } else {
      // Preserve the public API's silent audio track for timelines without audio.
      await run([
        '-i', video, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
        '-t', String(timeline.durationInFrames / timeline.fps), options.output,
      ]);
    }
    options.onProgress?.(1);
    return cacheReport;
  } finally {
    await Promise.all(opened.map(async (browser) => (await browser.catch(() => null))?.close({silent: true})));
  }
}
