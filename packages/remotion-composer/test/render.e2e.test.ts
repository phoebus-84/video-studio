// Real renders through Remotion and FFmpeg. Slow, and they need headless
// Chrome (Remotion downloads it the first time): only with REMOTION_E2E=1,
// against the build in dist/ (run `npm run build` first).

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from '../src/assets.js';
import {clone, fixture} from './helpers.js';

const enabled = process.env.REMOTION_E2E === '1';
const ffmpeg = (args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
};
const probe = (file: string) =>
  JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'}).stdout) as {
    streams: {codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string}[];
  };
/** Temporary directories Remotion and this package create. */
const remotionTemp = () => readdirSync(tmpdir()).filter((n) => /remotion|react-motion/.test(n)).sort();
const measure = (file: string) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {encoding: 'utf8'});
  const text = r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1);
  return JSON.parse(text) as {input_i: string; input_tp: string};
};

describe('renderTimeline end to end', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
  let sandbox: string;
  const previousTmpdir = process.env.TMPDIR;
  before(async () => {
    // Test files run in separate processes, but share the OS temp directory.
    // Count only THIS process's render leftovers, not concurrent kit/cache tests.
    sandbox = await mkdtemp(path.join(tmpdir(), 'composer-e2e-sandbox-'));
    process.env.TMPDIR = sandbox;
  });
  after(async () => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    await rm(sandbox, {recursive: true, force: true});
  });

  it('renders the migrated explainer at 1920x1080, 30 fps, 765 frames, with an audio track', async () => {
    const {renderTimeline} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-'));
    const doc = clone(fixture('explainer.json'));
    const colors = ['0x2e7d32', '0x6a1b9a', '0xef6c00'];
    let i = 0;
    for (const asset of Object.values(doc.assets) as {path: string; hash: string}[]) {
      await mkdir(path.dirname(path.join(root, asset.path)), {recursive: true});
      ffmpeg(['-f', 'lavfi', '-i', `color=c=${colors[i++]}:s=1920x1080`, '-frames:v', '1', path.join(root, asset.path)]);
      asset.hash = await sha256(path.join(root, asset.path));
    }
    const out = path.join(root, 'renders', 'nested', 'out.mp4'); // a directory that does not exist yet
    const leftoversBefore = remotionTemp();
    const result = await renderTimeline({timeline: doc, assetRoot: root, outputPath: out});
    // Only what this render added counts: test files run side by side, and
    // theirs remove their own directories meanwhile.
    assert.deepEqual(remotionTemp().filter((d) => !leftoversBefore.includes(d)), [], 'a render must leave no bundle or staging directory behind');
    const info = probe(out);
    const video = info.streams.find((s) => s.codec_type === 'video')!;
    assert.equal(video.codec_name, 'h264');
    assert.deepEqual([video.width, video.height, video.r_frame_rate], [1920, 1080, '30/1']);
    assert.equal(Number(video.nb_frames), 765);
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'));
    assert.equal(result.durationSeconds, 25.5);
    assert.equal(result.loudness, null);
    assert.deepEqual(result.kits, [{name: 'still', version: '1.0.0'}, {name: 'captions', version: '1.0.0'}]);
    assert.equal(result.profile, 'youtube-1920x1080');
    assert.match(result.hash, /^sha256:[a-f0-9]{64}$/);
    await rm(root, {recursive: true, force: true});
  });

  it('mixes a voice and ducked music, then normalises to -15 LUFS', async () => {
    const {renderTimeline} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-audio-'));
    await mkdir(path.join(root, 'assets'), {recursive: true});
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x123456:s=640x360', '-frames:v', '1', path.join(root, 'assets/bg.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '48000', path.join(root, 'assets/voice.wav')]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-ar', '48000', path.join(root, 'assets/music.wav')]);
    const timeline = {
      apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
      episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1,
      fps: 30, durationInFrames: 120, resolution: {width: 640, height: 360},
      // A profile outside the catalog: the timeline carries everything the render needs.
      profile: {
        id: 'test-640x360', width: 640, height: 360,
        safeZone: {top: 18, right: 32, bottom: 18, left: 32},
        loudness: {integrated: -15, truePeak: -1, range: 11},
      },
      assets: {
        bg: {path: 'assets/bg.png', hash: await sha256(path.join(root, 'assets/bg.png')), kind: 'image'},
        voice: {path: 'assets/voice.wav', hash: await sha256(path.join(root, 'assets/voice.wav')), kind: 'audio'},
        music: {path: 'assets/music.wav', hash: await sha256(path.join(root, 'assets/music.wav')), kind: 'audio'},
      },
      tracks: [
        {id: 'main', type: 'visual', z: 0, items: [{id: 'bg', from: 0, duration: 120, kit: {name: 'still', version: '1.0.0'}, props: {src: {$asset: 'bg'}}}]},
        {id: 'voice', type: 'audio', items: [{id: 'v', from: 30, duration: 60, asset: 'voice'}]},
        {id: 'music', type: 'audio', duck: {under: ['voice'], gain: 0.4, attack: 6, release: 9}, items: [{id: 'm', from: 0, duration: 120, asset: 'music', gain: 0.6, fadeOut: 15}]},
      ],
    };
    const out = path.join(root, 'out.mp4');
    const result = await renderTimeline({timeline, assetRoot: root, outputPath: out, cacheDir: path.join(root, 'cache')});
    assert.ok(result.loudness);
    const measured = measure(out);
    assert.ok(Math.abs(Number(measured.input_i) + 15) <= 1, `integrated ${measured.input_i}`);
    assert.ok(Number(measured.input_tp) <= -1, `true peak ${measured.input_tp}`);
    await rm(root, {recursive: true, force: true});
  });

  it('mixes the sound without a browser exactly as the browser pass does', async () => {
    const {stageAssets} = await import('../dist/assets.js');
    const {libraryEntry} = await import('../dist/library-kits.js');
    const {mixSounds, placeSounds} = await import('../dist/sound-mix.js');
    const {bundle} = await import('@remotion/bundler');
    const {renderMedia, selectComposition} = await import('@remotion/renderer');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-mix-'));
    await mkdir(path.join(root, 'assets'), {recursive: true});
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '44100', '-ac', '1', path.join(root, 'assets/voice.wav')]);
    ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=5:c=pink:a=0.3', '-ar', '48000', '-ac', '2', path.join(root, 'assets/music.wav')]);
    const asset = async (p: string) => ({path: p, hash: await sha256(path.join(root, p)), kind: 'audio'});
    const timeline = {
      apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
      episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1,
      fps: 30, durationInFrames: 150, resolution: {width: 640, height: 360},
      assets: {voice: await asset('assets/voice.wav'), voiceAlias: await asset('assets/voice.wav'), music: await asset('assets/music.wav')},
      tracks: [
        {id: 'voice', type: 'audio', items: [{id: 'v1', from: 20, duration: 40, asset: 'voice', trimStart: 15}, {id: 'v2', from: 80, duration: 50, asset: 'voice', gain: 0.7, fadeIn: 5}]},
        // Different staged URLs for the same file must both sound; only
        // identical browser source identities may be deduplicated.
        {id: 'alias', type: 'audio', items: [{id: 'a', from: 20, duration: 40, asset: 'voiceAlias', trimStart: 15, gain: 0.3}]},
        {id: 'music', type: 'audio', duck: {under: ['voice'], gain: 0.3, attack: 6, release: 9}, items: [{id: 'm', from: 0, duration: 150, asset: 'music', gain: 0.6, fadeIn: 10, fadeOut: 20}]},
      ],
    };
    const staging = await stageAssets(timeline as never, root);
    assert.ok(staging.ok);
    const {staged} = staging;
    const inputProps = {timeline, files: staged.files, assetFrames: {}, pass: 'sound'};
    const serveUrl = await bundle({entryPoint: await libraryEntry({versions: [], sources: []}), publicDir: staged.publicDir, outDir: path.join(root, 'bundle')});
    const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
    const browser = path.join(root, 'browser.wav'), mixed = path.join(root, 'mixed.wav');
    await renderMedia({composition, serveUrl, inputProps, codec: 'wav', enforceAudioTrack: true, outputLocation: browser, sampleRate: 48000});
    const sounds = placeSounds({timeline: timeline as never, soundItems: [], files: staged.files, sources: staged.sources, assetFrames: {}});
    assert.ok(sounds);
    await mixSounds({sounds, timeline: timeline as never, output: mixed, sampleRate: 48000});
    assert.equal(await sha256(mixed), await sha256(browser));
    await staged.cleanup();
    await rm(root, {recursive: true, force: true});
  });

  it('renders the 9:16 fixture at 1080x1920 and normalises to its profile, -14 LUFS', async () => {
    const {renderTimeline} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-vertical-'));
    const doc = clone(fixture('vertical-short.json'));
    await mkdir(path.join(root, 'assets/images'), {recursive: true});
    await mkdir(path.join(root, 'assets/takes'), {recursive: true});
    ffmpeg(['-f', 'lavfi', '-i', 'gradients=s=1080x1920:c0=0x1b1f3b:c1=0x3b2f5b:seed=7', '-frames:v', '1', path.join(root, doc.assets.sky.path)]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-af', 'volume=0.3', '-ar', '48000', path.join(root, doc.assets.verse.path)]);
    for (const asset of Object.values(doc.assets) as {path: string; hash: string}[]) asset.hash = await sha256(path.join(root, asset.path));
    const out = path.join(root, 'out.mp4');
    const result = await renderTimeline({timeline: doc, assetRoot: root, outputPath: out});
    const video = probe(out).streams.find((s) => s.codec_type === 'video')!;
    assert.deepEqual([video.width, video.height, Number(video.nb_frames)], [1080, 1920, 150]);
    assert.equal(result.profile, 'vertical-1080x1920');
    assert.deepEqual(result.kits, [{name: 'still', version: '1.0.0'}, {name: 'captions', version: '1.1.0'}]);
    assert.ok(result.loudness);
    const measured = measure(out);
    assert.ok(Math.abs(Number(measured.input_i) + 14) <= 1, `integrated ${measured.input_i}`);
    assert.ok(Number(measured.input_tp) <= -1, `true peak ${measured.input_tp}`);
    await rm(root, {recursive: true, force: true});
  });
});
