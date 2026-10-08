// What draws (avg-dcf.6.13): a change to a module that never shapes a frame —
// the loudness pass, the render audit, the media probe, the audio volume —
// keeps a layout sheet current and the render cache's segments; a change to
// anything else makes them stale.

import {strict as assert} from 'node:assert';
import {cpSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {drawingCodeHash, drawsPictures, NOT_DRAWING} from '../src/identity.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('the top-level modules that never draw, whatever their extension; a kit always draws', () => {
  for (const file of ['audit.ts', 'loudness.js', 'probe.ts', 'volume.js']) assert.equal(drawsPictures(file), false, file);
  for (const file of ['Timeline.tsx', 'kits/room/1.0.0.tsx', 'kits/loudness/1.0.0.tsx', 'kits/x/volume.js', 'render-cache.ts', 'layers.js', 'foo.ts', 'audition.ts']) assert.equal(drawsPictures(file), true, file);
});

test('every module the list names is a module of the composer', () => {
  for (const name of NOT_DRAWING) assert.ok(existsSync(path.join(SRC, `${name}.ts`)), `${name}.ts is not in src/`);
});

test('a sheet stays current when only a module that never draws changes, and goes stale when drawing code does', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drawing-code-'));
  try {
    cpSync(SRC, dir, {recursive: true});
    const before = drawingCodeHash(dir);
    writeFileSync(path.join(dir, 'loudness.ts'), '// another loudness pass\n');
    writeFileSync(path.join(dir, 'audit.ts'), '// another audit\n');
    assert.equal(drawingCodeHash(dir), before);
    writeFileSync(path.join(dir, 'Timeline.tsx'), '// another timeline\n');
    assert.notEqual(drawingCodeHash(dir), before);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a kit change makes the sheet stale', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drawing-code-'));
  try {
    cpSync(SRC, dir, {recursive: true});
    const before = drawingCodeHash(dir);
    writeFileSync(path.join(dir, 'kits', 'room', '1.0.0.tsx'), '// another room\n');
    assert.notEqual(drawingCodeHash(dir), before);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
