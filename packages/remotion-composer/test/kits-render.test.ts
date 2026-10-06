// One real frame per example of every kit version (avg-tk7.3): rendered with
// Remotion's headless Chrome, checked for size and for not being blank. Runs
// in `npm test` and CI; Remotion downloads Chrome on first use.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';

/** Luma range of an image: max − min, from ffmpeg's signalstats. */
function lumaRange(file: string): number {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], {encoding: 'utf8'});
  const value = (key: string) => Number(new RegExp(`lavfi\\.signalstats\\.${key}=(\\d+)`).exec(r.stdout)?.[1]);
  const range = value('YMAX') - value('YMIN');
  assert.ok(r.status === 0 && Number.isFinite(range), `signalstats failed on ${file}: ${r.stderr}`);
  return range;
}

function size(file: string): [number, number] {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  assert.equal(r.status, 0, `ffprobe failed on ${file}: ${r.stderr}`);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return [w!, h!];
}

describe('every kit example renders a real frame', () => {
  let work = '';
  let serveUrl = '';
  before(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'kit-render-test-'));
    serveUrl = await bundlePreviews(path.join(work, 'bundle'));
  });
  after(async () => {
    if (work) await rm(work, {recursive: true, force: true});
  });

  for (const kit of KIT_VERSIONS) {
    for (const example of kit.examples) {
      const id = previewCompositionId(kit.name, kit.version, example.id);
      it(`${kit.name}@${kit.version} ${example.id}`, async () => {
        const composition = await selectComposition({serveUrl, id, inputProps: {}});
        const output = path.join(work, `${id}.png`);
        await renderStill({composition, serveUrl, output, frame: example.frame, imageFormat: 'png'});
        assert.deepEqual(size(output), [1920, 1080]);
        assert.ok(lumaRange(output) > 16, `${id} rendered a blank frame`);
      });
    }
  }
});
