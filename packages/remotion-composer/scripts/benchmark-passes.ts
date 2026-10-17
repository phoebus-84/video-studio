// Local, opt-in comparison of cold picture passes and browser/Node sound.
// Build first; run from this package:
//   node --import tsx scripts/benchmark-passes.ts /path/to/benchmark.json
// The JSON holds timeline (file path), assetRoot, optional sharedRoots/kits
// (RenderTimelineOptions), seconds (default 20), concurrency (4), browsers
// ([1, 2]), repetitions (2). Paths are relative to that JSON. Outputs and
// caches live only in a disposable temporary directory, never the episode.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir, cpus} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderMedia, selectComposition} from '@remotion/renderer';
import {stageAssets, sha256} from '../dist/assets.js';
import {renderWithCache} from '../dist/cached-render.js';
import {readLibraryKits, libraryEntry, resolveFromApplication, type LibraryKit} from '../dist/library-kits.js';
import {soundLayers} from '../dist/layers.js';
import {resolveKit} from '../dist/kits/index.js';
import {videoFrames} from '../dist/probe.js';
import {placeSounds, mixSounds} from '../dist/sound-mix.js';
import type {EditTimeline} from '../dist/schema.js';

interface Config {
  timeline: string;
  assetRoot: string;
  sharedRoots?: string[];
  kits?: LibraryKit[];
  seconds?: number;
  concurrency?: number;
  browsers?: number[];
  repetitions?: number;
}
if (!process.argv[2]) throw new Error('usage: benchmark-passes.ts benchmark.json');
const configFile = path.resolve(process.argv[2]);
const config = JSON.parse(await readFile(configFile, 'utf8')) as Config;
const resolve = (file: string) => path.resolve(path.dirname(configFile), file);
const timeline = JSON.parse(await readFile(resolve(config.timeline), 'utf8')) as EditTimeline;
timeline.durationInFrames = Math.min(timeline.durationInFrames, Math.round((config.seconds ?? 20) * timeline.fps));
for (const track of timeline.tracks) track.items = track.items.filter((item) => item.from < timeline.durationInFrames)
  .map((item) => ({...item, duration: Math.min(item.duration, timeline.durationInFrames - item.from)}));
const concurrency = config.concurrency ?? 4, repetitions = config.repetitions ?? 2;
const browsers = config.browsers ?? [1, 2];
assert.ok(Number.isInteger(repetitions) && repetitions > 0 && Number.isInteger(concurrency) && concurrency > 0
  && timeline.durationInFrames > 0 && browsers.length > 0 && browsers.every((n) => Number.isInteger(n) && n >= 1 && n <= concurrency));
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
console.log(JSON.stringify({machine: cpus()[0]?.model, platform: process.platform, arch: process.arch, node: process.version,
  ffmpeg: execFileSync(ffmpeg, ['-version'], {encoding: 'utf8'}).split('\n')[0],
  frames: timeline.durationInFrames, fps: timeline.fps, resolution: timeline.resolution, concurrency, browsers, repetitions}));
const root = await mkdtemp(path.join(tmpdir(), 'composer-benchmark-'));
try {
  const library = await readLibraryKits((config.kits ?? []).map((kit) => ({...kit, file: resolve(kit.file)})));
  const staging = await stageAssets(timeline, resolve(config.assetRoot), config.sharedRoots?.map(resolve));
  if (staging.ok === false) throw new Error(JSON.stringify(staging.problems));
  const {staged} = staging;
  try {
    const assetFrames: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
    }
    const inputProps = {timeline, files: staged.files, assetFrames};
    const serveUrl = await bundle({entryPoint: await libraryEntry(library), publicDir: staged.publicDir,
      outDir: path.join(root, 'bundle'), ...(library.versions.length ? {webpackOverride: resolveFromApplication} : {})});
    const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
    const silentProps = {...inputProps, timeline: {...timeline, tracks: timeline.tracks.filter((t) => t.type === 'visual')}};
    let reference: string | undefined;
    for (let repeat = 0; repeat < repetitions; repeat++) {
      // Alternate order to expose warm-up/order effects rather than credit
      // every later run's OS file-cache benefit to the multi-browser case.
      for (const count of repeat % 2 ? [...browsers].reverse() : browsers) {
        const work = path.join(root, `pictures-${repeat}-${count}`);
        await mkdir(work);
        const output = path.join(work, 'out.mp4'), start = performance.now();
        await renderWithCache({inputProps: silentProps, composition, serveUrl, work, output,
          cacheDir: path.join(work, 'cache'), hasAudio: false, concurrency, browsers: count, kits: library.versions});
        const seconds = (performance.now() - start) / 1000;
        let psnr: string | undefined;
        if (reference) {
          const result = spawnSync(ffmpeg, ['-hide_banner', '-i', reference, '-i', output,
            '-lavfi', 'psnr', '-f', 'null', '-'], {encoding: 'utf8'});
          assert.equal(result.status, 0, result.stderr);
          psnr = /average:([\d.]+|inf)/.exec(result.stderr)?.[1];
          assert.ok(psnr === 'inf' || Number(psnr) >= 40, `picture PSNR ${psnr} dB`);
        } else reference = output;
        console.log(JSON.stringify({pass: 'pictures', repeat, browsers: count, seconds, fps: timeline.durationInFrames / seconds, psnrVsFirst: psnr}));
      }
    }
    const soundItems = soundLayers(timeline, (name, version) => resolveKit(name, version, library.versions)).map(({item}) => item);
    const sounds = placeSounds({timeline, soundItems, files: staged.files, sources: staged.sources, assetFrames, kits: library.versions});
    if (!sounds) {
      console.log(JSON.stringify({pass: 'sound', fallback: 'a sounding kit does not list its sounds'}));
    } else {
      const sounding = new Set(soundItems);
      const audioProps = {...inputProps, pass: 'sound' as const, timeline: {...timeline, tracks: timeline.tracks
        .map((t) => t.type === 'audio' ? t : {...t, items: t.items.filter((i) => sounding.has(i as typeof soundItems[number]))})
        .filter((t) => t.type === 'audio' || t.items.length > 0)}};
      const browser = await openBrowser('chrome');
      try {
        for (let repeat = 0; repeat < repetitions; repeat++) {
          const hashes: string[] = [];
          for (const mode of repeat % 2 ? ['node', 'browser'] : ['browser', 'node']) {
            const output = path.join(root, `sound-${repeat}-${mode}.wav`), start = performance.now();
            if (mode === 'node') await mixSounds({sounds, timeline, output, sampleRate: 48000});
            else await renderMedia({composition: {...composition, props: audioProps}, inputProps: audioProps,
              serveUrl, puppeteerInstance: browser, codec: 'wav', enforceAudioTrack: true, outputLocation: output,
              sampleRate: 48000, concurrency: Math.max(1, Math.min(4, Math.floor(concurrency / 2)))});
            const seconds = (performance.now() - start) / 1000;
            hashes.push(await sha256(output));
            console.log(JSON.stringify({pass: 'sound', repeat, mode, seconds, hash: hashes.at(-1)}));
          }
          assert.equal(hashes[0], hashes[1], 'the Node and browser soundtracks must be byte-identical');
        }
      } finally {
        await browser.close({silent: true});
      }
    }
  } finally {
    await staged.cleanup();
  }
} finally {
  await rm(root, {recursive: true, force: true});
}
