// What draws (avg-dcf.6.13): a change to a module that never shapes a frame —
// the loudness pass, the render audit, the audio volume, how segments are
// encoded and cut — keeps a layout sheet current; a change to anything else
// makes it stale. The render cache also misses when the encoding changes.

import {strict as assert} from 'node:assert';
import {cpSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {drawingCodeHash, drawsPictures, NOT_DRAWING} from '../src/identity.js';
import {runtimeCodeHashes} from '../src/cached-render.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('the top-level modules that never draw, whatever their extension; a kit always draws', () => {
  for (const file of ['audit.ts', 'loudness.js', 'volume.js', 'render-cache.ts', 'cached-render.js', 'cli.ts', 'sheet-cli.js']) assert.equal(drawsPictures(file), false, file);
  // the probe counts a clip's frames, which decide when the clip holds or loops: it draws
  for (const file of ['probe.ts', 'Timeline.tsx', 'kits/room/1.0.0.tsx', 'kits/loudness/1.0.0.tsx', 'kits/x/volume.js', 'render.ts', 'layers.js', 'foo.ts', 'audition.ts']) assert.equal(drawsPictures(file), true, file);
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

test("the render cache's Node-side hash keeps its segments when only the loudness pass or the audit changes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drawing-code-'));
  try {
    cpSync(SRC, dir, {recursive: true});
    const before = JSON.stringify(await runtimeCodeHashes(dir));
    writeFileSync(path.join(dir, 'loudness.ts'), '// another loudness pass\n');
    writeFileSync(path.join(dir, 'audit.ts'), '// another audit\n');
    assert.equal(JSON.stringify(await runtimeCodeHashes(dir)), before);
    writeFileSync(path.join(dir, 'cached-render.ts'), '// another encoding\n');
    const encoded = JSON.stringify(await runtimeCodeHashes(dir));
    assert.notEqual(encoded, before, 'segments encoded differently are new segments');
    writeFileSync(path.join(dir, 'probe.ts'), '// another probe\n');
    const probed = JSON.stringify(await runtimeCodeHashes(dir));
    assert.notEqual(probed, encoded);
    writeFileSync(path.join(dir, 'kits', 'room', '1.0.0.tsx'), '// another room\n');
    assert.notEqual(JSON.stringify(await runtimeCodeHashes(dir)), probed);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
