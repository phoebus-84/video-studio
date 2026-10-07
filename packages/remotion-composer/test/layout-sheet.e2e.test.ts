// A real layout sheet through Remotion (avg-3th.1). Slow, and it needs
// headless Chrome: only with REMOTION_E2E=1, against the build in dist/ (run
// `npm run build` first).

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
const size = (file: string) => {
  const out = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {encoding: 'utf8'}).stdout) as {streams: {width: number; height: number}[]};
  return [out.streams[0]!.width, out.streams[0]!.height];
};
const remotionTemp = () => readdirSync(tmpdir()).filter((n) => /remotion|react-motion/.test(n)).sort();

describe('renderLayoutSheet end to end', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
  let sandbox: string;
  const previousTmpdir = process.env.TMPDIR;
  before(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'composer-sheet-sandbox-'));
    process.env.TMPDIR = sandbox;
  });
  after(async () => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    await rm(sandbox, {recursive: true, force: true});
  });

  it('renders the explainer\'s stills and a labelled grid of them', async () => {
    const {renderLayoutSheet, kitLockHash} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-sheet-'));
    const doc = clone(fixture('explainer.json'));
    const colors = ['0x2e7d32', '0x6a1b9a', '0xef6c00'];
    let i = 0;
    for (const asset of Object.values(doc.assets) as {path: string; hash: string}[]) {
      await mkdir(path.dirname(path.join(root, asset.path)), {recursive: true});
      ffmpeg(['-f', 'lavfi', '-i', `color=c=${colors[i++]}:s=1920x1080`, '-frames:v', '1', path.join(root, asset.path)]);
      asset.hash = await sha256(path.join(root, asset.path));
    }
    const outDir = path.join(root, 'sheet');
    const picks = [{frame: 0, label: 'first'}, {frame: 300, label: 'middle'}, {frame: 764, label: 'last'}];
    const leftoversBefore = remotionTemp();
    const result = await renderLayoutSheet({timeline: doc, assetRoot: root, picks, outDir, columns: 2});
    assert.deepEqual(remotionTemp(), leftoversBefore, 'a sheet must leave no bundle or staging directory behind');

    assert.deepEqual(result.frames.map((f: {index: number; frame: number; seconds: number; label: string}) => [f.index, f.frame, f.seconds, f.label]),
      [[0, 0, 0, 'first'], [1, 300, 10, 'middle'], [2, 764, 25.467, 'last']]);
    for (const f of result.frames) {
      assert.equal(f.path, path.join(outDir, 'frames', `${String(f.index).padStart(3, '0')}.jpg`));
      assert.deepEqual(size(f.path), [480, 270]);
      assert.equal(f.hash, await sha256(f.path));
    }
    assert.deepEqual({...result.sheet, hash: undefined}, {path: path.join(outDir, 'sheet.jpg'), hash: undefined, columns: 2, rows: 2, width: 960, height: 620});
    assert.deepEqual(size(result.sheet.path), [960, 620]);
    assert.equal(result.sheet.hash, await sha256(result.sheet.path));
    assert.deepEqual(result.kits, [
      {name: 'captions', version: '1.0.0', hash: kitLockHash('captions', '1.0.0')},
      {name: 'still', version: '1.0.0', hash: kitLockHash('still', '1.0.0')},
    ]);
    await rm(root, {recursive: true, force: true});
  });
});
