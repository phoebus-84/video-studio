import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {drawnBox, overflow} from './drawn-box.js';

let dir = '';
/** A 400x300 transparent PNG with one filled rectangle w×h at (x, y) of the given alpha (0-255). */
function png(name: string, rect?: {x: number; y: number; w: number; h: number; alpha: number}): string {
  const file = path.join(dir, name);
  const base = 'color=c=black@0:s=400x300,format=rgba';
  const args = rect
    ? ['-f', 'lavfi', '-i', base, '-f', 'lavfi', '-i', `color=c=white:s=${rect.w}x${rect.h},format=rgba,colorchannelmixer=aa=${rect.alpha / 255}`,
       '-filter_complex', `[0][1]overlay=${rect.x}:${rect.y}:format=auto,format=rgba`]
    : ['-f', 'lavfi', '-i', base];
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, '-frames:v', '1', file], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  return file;
}

describe('drawnBox', () => {
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kit-drawn-box-'));
  });
  after(async () => {
    if (dir) await rm(dir, {recursive: true, force: true});
  });

  it('finds the exact inclusive box of a drawn rectangle', () => {
    assert.deepEqual(drawnBox(png('block.png', {x: 50, y: 60, w: 100, h: 50, alpha: 255}), 400, 300), {left: 50, top: 60, right: 149, bottom: 109});
  });

  it('counts a single isolated pixel', () => {
    assert.deepEqual(drawnBox(png('dot.png', {x: 399, y: 0, w: 1, h: 1, alpha: 255}), 400, 300), {left: 399, top: 0, right: 399, bottom: 0});
  });

  it('counts the faintest shadow', () => {
    assert.deepEqual(drawnBox(png('faint.png', {x: 10, y: 280, w: 30, h: 20, alpha: 3}), 400, 300), {left: 10, top: 280, right: 39, bottom: 299});
  });

  it('returns null when nothing was drawn', () => {
    assert.equal(drawnBox(png('empty.png'), 400, 300), null);
  });
});

describe('overflow', () => {
  const profile = {width: 400, height: 300, safeZone: {top: 10, right: 20, bottom: 30, left: 40}};

  it('is empty for a box touching the safe zone from inside', () => {
    assert.deepEqual(overflow({left: 40, top: 10, right: 379, bottom: 269}, profile), []);
  });

  it('names every side and its overflow in pixels', () => {
    assert.deepEqual(overflow({left: 39, top: 9, right: 380, bottom: 270}, profile), ['1 px above', '1 px below', '1 px left of', '1 px right of']);
  });
});
