// The actual browser lanes, not mocked renderRun callbacks: compare every
// decoded frame, including run boundaries and a final partial second.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from '../src/assets.js';
import {cacheTimeline} from './cache-fixture.js';

const ffmpeg = (args: string[]) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {maxBuffer: 32 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};

it('two browser lanes preserve every frame versus one browser, including the short tail', {
  skip: process.env.REMOTION_E2E !== '1' && 'set REMOTION_E2E=1', timeout: 120_000,
}, async () => {
  const {renderTimeline} = await import('../dist/index.js');
  const root = await mkdtemp(path.join(tmpdir(), 'composer-lanes-e2e-'));
  try {
    const timeline = cacheTimeline();
    timeline.tracks = timeline.tracks.filter((track) => track.type === 'visual');
    delete timeline.assets.voice;
    for (const [id, color] of [['a', 'red'], ['b', 'blue']]) {
      const asset = timeline.assets[id]!;
      ffmpeg(['-f', 'lavfi', '-i', `color=${color}:s=320x180`, '-frames:v', '1', path.join(root, asset.path)]);
      asset.hash = await sha256(path.join(root, asset.path));
    }
    const outputs: Buffer[] = [];
    for (const browsers of [1, 2]) {
      const result = await renderTimeline({timeline, assetRoot: root, concurrency: 2, browsers,
        cacheDir: path.join(root, `cache-${browsers}`), outputPath: path.join(root, `out-${browsers}.mp4`)});
      assert.equal(result.cache!.segmentsRendered, 3);
      outputs.push(ffmpeg(['-i', result.path, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']));
    }
    const frameSize = 320 * 180 * 3, frames = timeline.durationInFrames;
    assert.equal(outputs[0]!.length, frames * frameSize);
    assert.equal(outputs[1]!.length, frames * frameSize);
    for (let frame = 0; frame < frames; frame++) {
      let error = 0;
      for (let i = frame * frameSize; i < (frame + 1) * frameSize; i++) error += Math.abs(outputs[0]![i]! - outputs[1]![i]!);
      assert.ok(error / frameSize < 3, `frame ${frame}: mean pixel error ${error / frameSize}`);
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
