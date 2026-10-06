// One real frame per example of every kit version, in every output profile
// (avg-tk7.3, avg-tk7.4): rendered with Remotion's headless Chrome. Fill kits
// must have the profile's size and not be blank; overlay kits are drawn on a
// transparent background and the box of every pixel they drew, however faint,
// must lie inside the profile's safe zone. Runs in `npm test` and CI; Remotion
// downloads Chrome on first use.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';
import {drawnBox, overflow} from './drawn-box.js';
import {outputProfiles} from './helpers.js';

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

describe('every kit example renders a real frame in every output profile', () => {
  let work = '';
  let serveUrl = '';
  before(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'kit-render-test-'));
    serveUrl = await bundlePreviews(path.join(work, 'bundle'));
  });
  after(async () => {
    if (work) await rm(work, {recursive: true, force: true});
  });

  for (const profile of outputProfiles()) {
    for (const kit of KIT_VERSIONS) {
      for (const example of kit.examples) {
        const id = previewCompositionId(kit.name, kit.version, example.id);
        const name = `${kit.name}@${kit.version} ${example.id} in ${profile.id}`;
        it(name, async () => {
          const overlay = kit.layer === 'overlay';
          const inputProps = {profile, transparent: overlay};
          const composition = await selectComposition({serveUrl, id, inputProps});
          const output = path.join(work, `${id}.${profile.id}.png`);
          await renderStill({composition, serveUrl, output, inputProps, frame: example.frame, imageFormat: 'png'});
          assert.deepEqual(size(output), [profile.width, profile.height]);
          if (overlay) {
            const box = drawnBox(output, profile.width, profile.height);
            assert.ok(box, `${name} drew nothing`);
            const out = overflow(box, profile);
            assert.deepEqual(out, [], `${name}: ${out.join(', ')} the safe zone`);
          } else {
            assert.ok(lumaRange(output) > 16, `${name} rendered a blank frame`);
          }
        });
      }
    }
  }
});
