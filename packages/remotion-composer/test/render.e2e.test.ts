// Real renders through Remotion and FFmpeg. Slow, and they need headless
// Chrome (Remotion downloads it the first time): only with REMOTION_E2E=1,
// against the build in dist/ (run `npm run build` first).

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
const measure = (file: string) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {encoding: 'utf8'});
  const text = r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1);
  return JSON.parse(text) as {input_i: string; input_tp: string};
};

describe('renderTimeline end to end', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
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
    const out = path.join(root, 'out.mp4');
    const result = await renderTimeline({timeline: doc, assetRoot: root, outputPath: out});
    const info = probe(out);
    const video = info.streams.find((s) => s.codec_type === 'video')!;
    assert.equal(video.codec_name, 'h264');
    assert.deepEqual([video.width, video.height, video.r_frame_rate], [1920, 1080, '30/1']);
    assert.equal(Number(video.nb_frames), 765);
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'));
    assert.equal(result.durationSeconds, 25.5);
    assert.equal(result.loudness, null);
    assert.deepEqual(result.kits, [{name: 'still', version: '1.0.0'}, {name: 'captions', version: '1.0.0'}]);
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
    const result = await renderTimeline({timeline, assetRoot: root, outputPath: out});
    assert.ok(result.loudness);
    const measured = measure(out);
    assert.ok(Math.abs(Number(measured.input_i) + 15) <= 1, `integrated ${measured.input_i}`);
    assert.ok(Number(measured.input_tp) <= -1, `true peak ${measured.input_tp}`);
    await rm(root, {recursive: true, force: true});
  });
});
