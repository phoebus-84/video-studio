// One real frame per example of every kit version, in every output profile
// (avg-tk7.3, avg-tk7.4): rendered with Remotion's headless Chrome. Fill kits
// must have the profile's size and not be blank; overlay kits are drawn on a
// transparent background and the box of what they drew must lie inside the
// profile's safe zone. Runs in `npm test` and CI; Remotion downloads Chrome on
// first use.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';
import {outputProfiles, type CatalogProfile} from './helpers.js';

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

interface Box {left: number; top: number; right: number; bottom: number}

/** The box of every pixel with any opacity, from the alpha plane and cropdetect; null when nothing was drawn. */
function drawnBox(file: string): Box | null {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'alphaextract,cropdetect=limit=0:round=1:reset=0:skip=0', '-f', 'null', '-'], {encoding: 'utf8'});
  assert.equal(r.status, 0, `cropdetect failed on ${file}: ${r.stderr.slice(-400)}`);
  const m = /x1:(-?\d+) x2:(-?\d+) y1:(-?\d+) y2:(-?\d+)/.exec(r.stderr);
  assert.ok(m, `cropdetect printed no box for ${file}`);
  const [x1, x2, y1, y2] = m.slice(1).map(Number) as [number, number, number, number];
  return x2 < x1 || y2 < y1 ? null : {left: x1, top: y1, right: x2, bottom: y2};
}

/** How far a drawn box crosses each edge of the safe zone, in pixels; empty when inside. */
export function overflow(box: Box, profile: CatalogProfile): string[] {
  const {top, right, bottom, left} = profile.safeZone;
  const out: string[] = [];
  if (box.top < top) out.push(`${top - box.top} px above`);
  if (box.bottom > profile.height - 1 - bottom) out.push(`${box.bottom - (profile.height - 1 - bottom)} px below`);
  if (box.left < left) out.push(`${left - box.left} px left of`);
  if (box.right > profile.width - 1 - right) out.push(`${box.right - (profile.width - 1 - right)} px right of`);
  return out;
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
            const box = drawnBox(output);
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
