import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ComposerError} from '../src/errors.js';
import {kitLockHash, timelineKits} from '../src/kit-lock.js';
import {drawingCodeHash} from '../src/identity.js';
import {renderLayoutSheet, sheetTime} from '../src/layout-sheet.js';
import {CAPTION_HEIGHT, sheetSize} from '../src/Sheet.js';
import {CONTRACT_FIXTURES, clone, fixture} from './helpers.js';

// What renderLayoutSheet refuses before it renders anything (avg-3th.1). The
// rendering itself is layout-sheet.e2e.test.ts.

const refusal = async (options: Partial<Parameters<typeof renderLayoutSheet>[0]>) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sheet-refused-'));
  try {
    await renderLayoutSheet({timeline: fixture('explainer.json'), assetRoot: outDir, picks: [{frame: 0, label: 'first'}], outDir, ...options});
    assert.fail('expected a refusal');
  } catch (e) {
    assert.ok(e instanceof ComposerError, String(e));
    // Nothing was written: refusals come before staging and rendering.
    assert.deepEqual(await readdir(outDir), []);
    return {code: e.code, message: e.message};
  } finally {
    await rm(outDir, {recursive: true, force: true});
  }
};

describe('renderLayoutSheet refuses before rendering', () => {
  it('a timeline the composer cannot render', async () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit.version = '9.9.9';
    assert.equal((await refusal({timeline: doc})).code, 'unknown-kit');
  });

  it('no frames, too many, a frame outside the timeline, a fraction, a repeat', async () => {
    const cases: [Parameters<typeof renderLayoutSheet>[0]['picks'], RegExp][] = [
      [[], /at least one frame/],
      [Array.from({length: 121}, (_, i) => ({frame: i, label: 'x'})), /at most 120 frames, not 121/],
      [[{frame: 765, label: 'x'}], /frame 765 is not a frame of this timeline \(0–764\)/],
      [[{frame: -1, label: 'x'}], /frame -1/],
      [[{frame: 1.5, label: 'x'}], /frame 1.5/],
      [[{frame: 3, label: 'a'}, {frame: 3, label: 'b'}], /frame 3 is picked twice/],
    ];
    for (const [picks, message] of cases) {
      const {code, message: actual} = await refusal({picks});
      assert.equal(code, 'bad-sheet');
      assert.match(actual, message);
    }
  });

  it('a scale or a column count it cannot use', async () => {
    for (const scale of [0, -0.25, 1.5, Number.NaN]) assert.match((await refusal({scale})).message, /scale/);
    for (const columns of [0, 2.5]) assert.match((await refusal({columns})).message, /columns/);
  });
});

describe('the sheet grid', () => {
  it('writes times as mm:ss.ff', () => {
    assert.equal(sheetTime(0, 30), '00:00.00');
    assert.equal(sheetTime(29, 30), '00:00.29');
    assert.equal(sheetTime(30 * 61 + 7, 30), '01:01.07');
    // A fractional rate still prints whole frames.
    assert.equal(sheetTime(45, 29.97), '00:01.15');
  });

  it('is as wide as its columns and as tall as its rows of tile and caption', () => {
    const tiles = Array.from({length: 13}, () => ({src: '', caption: ''}));
    assert.deepEqual(sheetSize({tiles, columns: 6, tileWidth: 480, tileHeight: 270}), {width: 2880, height: 3 * (270 + CAPTION_HEIGHT)});
  });

  it('knows each released kit\'s code hash', () => {
    assert.match(kitLockHash('still', '1.0.0') ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.equal(kitLockHash('still', '9.9.9'), undefined);
  });

  it('lists the kits a timeline draws with, once each, sorted, with their code hashes', () => {
    const doc = fixture('explainer.json');
    assert.deepEqual(timelineKits(doc as never), [
      {name: 'captions', version: '1.0.0', hash: kitLockHash('captions', '1.0.0')},
      {name: 'still', version: '1.0.0', hash: kitLockHash('still', '1.0.0')},
    ]);
    doc.tracks[0].items[0].kit.version = '9.9.9';
    assert.equal(timelineKits(doc as never), null);
  });
});

describe('drawingCodeHash', () => {
  it('names this package\'s own code and the Remotion and React it draws with', () => {
    assert.match(drawingCodeHash(), /^sha256:[a-f0-9]{64}$/);
    assert.equal(drawingCodeHash(), drawingCodeHash());
  });

  it('changes when any code file under the directory changes, and only then', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'drawing-code-'));
    try {
      await mkdir(path.join(dir, 'kits', 'still'), {recursive: true});
      await writeFile(path.join(dir, 'Timeline.js'), 'export const a = 1;');
      await writeFile(path.join(dir, 'kits', 'still', '1.0.0.js'), 'export const b = 1;');
      const before = drawingCodeHash(dir);
      // Declarations, maps and other files do not draw anything.
      await writeFile(path.join(dir, 'Timeline.d.ts'), 'export declare const a: number;');
      await writeFile(path.join(dir, 'Timeline.js.map'), '{}');
      await writeFile(path.join(dir, 'notes.txt'), 'hello');
      assert.equal(drawingCodeHash(dir), before);
      await writeFile(path.join(dir, 'kits', 'still', '1.0.0.js'), 'export const b = 2;');
      assert.notEqual(drawingCodeHash(dir), before);
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});

describe('the layout-sheet CLI', () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/sheet-cli.ts', ...args], {encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..')});

  it('refuses times that are not numbers of seconds, before reading anything', () => {
    for (const times of ['1,,2', '0x10', '-1', '2s', '']) {
      const r = cli(path.join(CONTRACT_FIXTURES, 'valid', 'explainer.json'), 'out', '--assets', '.', '--times', times);
      assert.equal(r.status, 1, times);
      assert.match(r.stderr, times === '' ? /^Usage: layout-sheet/ : /^--times: ".*" is not a number of seconds/, times);
    }
  });

  it('says a timeline file it cannot read or parse is the problem, without a stack', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sheet-cli-'));
    try {
      await writeFile(path.join(dir, 'bad.json'), '{ half');
      for (const file of [path.join(dir, 'bad.json'), path.join(dir, 'missing.json')]) {
        const r = cli(file, path.join(dir, 'out'), '--assets', dir, '--times', '0');
        assert.equal(r.status, 1);
        assert.match(r.stderr, /^cannot read the timeline /);
        assert.doesNotMatch(r.stderr, /\n\s+at /);
      }
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});
