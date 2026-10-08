import {execFile} from 'node:child_process';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {ensureBrowser, openBrowser, renderMedia} from '@remotion/renderer';
import type {VideoConfig} from 'remotion';
import {sha256} from './assets.js';
import {drawsPictures} from './identity.js';
import {cachedVideo, cacheKey, planVideo, type CacheReport} from './render-cache.js';
import type {TimelineProps} from './Timeline.js';

const exec = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';
const run = (args: string[]) => exec(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {maxBuffer: 8 * 1024 * 1024});

// Explicit settings shared by every independently decodable, silent H.264 segment.
const encoding = {
  codec: 'h264', crf: 18, x264Preset: 'medium', imageFormat: 'jpeg', jpegQuality: 92,
  pixelFormat: 'yuv420p', colorSpace: 'bt709', muted: true,
} as const;

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
    // The bundle includes the actual kit/React/Remotion code. Node-side code
    // is also hashed, so a renderer fix invalidates entries without a version
    // bump — but not the modules that never draw (a loudness fix keeps them).
    bundle: await codeHashes(serveUrl),
    runtime: await codeHashes(path.dirname(fileURLToPath(import.meta.url)), drawsPictures),
    ffmpeg: (await exec(ffmpeg(), ['-version'])).stdout,
  });
}

export async function renderWithCache(options: {
  inputProps: TimelineProps;
  composition: VideoConfig;
  serveUrl: string;
  cacheDir: string;
  work: string;
  output: string;
  hasAudio: boolean;
  concurrency?: number;
  onProgress?: (progress: number) => void;
}): Promise<CacheReport> {
  const {inputProps, composition, serveUrl, work, hasAudio} = options;
  const {timeline} = inputProps;
  // Keys use asset ids, not staging filenames (which change when audio is added).
  const assetFrames = Object.fromEntries(Object.entries(inputProps.files)
    .filter(([, file]) => inputProps.assetFrames[file] !== undefined)
    .map(([id, file]) => [id, inputProps.assetFrames[file]!]));
  const plan = planVideo(timeline, await rendererKey(serveUrl), assetFrames);
  const common = {composition, serveUrl, concurrency: options.concurrency ?? null};
  const silentProps = {...inputProps, timeline: {...timeline, tracks: timeline.tracks.filter((t) => t.type === 'visual')}};
  // Reuse one browser across misses, rather than launching Chrome each second.
  // A whole-video hit with no audio never opens it.
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  const getBrowser = async () => browser ??= await openBrowser('chrome');
  try {
    const {video, report} = await cachedVideo({
      plan, cacheDir: options.cacheDir, work,
      onProgress: (p) => options.onProgress?.(p * 0.8),
      renderSegment: async (segment, output) => {
        await renderMedia({
          ...common, ...encoding, puppeteerInstance: await getBrowser(), inputProps: silentProps, outputLocation: output,
          frameRange: [segment.from, segment.to], gopSize: timeline.fps,
        });
      },
      concatenate: async (files, output) => {
        // Only generated basenames go in the concat script; no caller-controlled
        // paths or quoting, and no shell execution.
        const list = path.join(work, 'segments.txt');
        await writeFile(list, files.map((file) => `file '${path.basename(file)}'`).join('\n'));
        await run(['-f', 'concat', '-safe', '1', '-i', list, '-map', '0:v:0', '-c:v', 'copy', '-an', output]);
      },
    });
    const audio = path.join(work, 'audio.wav');
    if (hasAudio) {
      // Keep ALL audio tracks: ducking looks up other tracks in the timeline.
      // No visual kits are mounted for this pass and no video frames are encoded.
      const audioProps = {...inputProps, timeline: {...timeline, tracks: timeline.tracks.filter((t) => t.type === 'audio')}};
      await renderMedia({
        ...common, puppeteerInstance: await getBrowser(), inputProps: audioProps, codec: 'wav', enforceAudioTrack: true,
        outputLocation: audio, sampleRate: 48000,
        onProgress: ({progress}) => options.onProgress?.(0.8 + progress * 0.2),
      });
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
    return report;
  } finally {
    await browser?.close({silent: true});
  }
}
