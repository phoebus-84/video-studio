// What a kit version draws with (ADR-0039): its file and the frozen library
// modules it imports, transitively — all covered by its lock hash — and the
// imports a kit and a module may make.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {kitSourceHash, moduleProblems, sourceFiles} from '../scripts/kit-source.js';

let kits: string;
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(kits, rel)), {recursive: true});
  writeFileSync(path.join(kits, rel), text);
  return path.join(kits, rel);
};

before(() => {
  kits = mkdtempSync(path.join(tmpdir(), 'kit-source-'));
  write('types.ts', 'export type X = 1;\n');
  write('lib/math/1.0.0.ts', "export const one = 1;\n");
  write('lib/shapes/1.0.0.tsx', "import {one} from '../math/1.0.0.js';\nexport const two = one + 1;\n");
  write('plain/1.0.0.tsx', "import React from 'react';\nimport type {X} from '../types.js';\nexport const k = 1;\n");
  write('shaped/1.0.0.tsx', "import {two} from '../lib/shapes/1.0.0.js';\nimport type {X} from '../types.js';\nexport const k = two;\n");
});
after(() => rmSync(kits, {recursive: true, force: true}));

describe('kit sources and their lock hash', () => {
  it('hashes a kit that imports no library module exactly as its file', () => {
    const file = path.join(kits, 'plain/1.0.0.tsx');
    assert.deepEqual(sourceFiles(file, kits), [file]);
    assert.equal(kitSourceHash(file, kits), `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`);
  });

  it('covers every library module a kit reaches, transitively', () => {
    const file = path.join(kits, 'shaped/1.0.0.tsx');
    assert.deepEqual(sourceFiles(file, kits).map((f) => path.relative(kits, f).split(path.sep).join('/')), ['lib/math/1.0.0.ts', 'lib/shapes/1.0.0.tsx', 'shaped/1.0.0.tsx']);
    const before = kitSourceHash(file, kits);
    write('lib/math/1.0.0.ts', "export const one = 2;\n");
    assert.notEqual(kitSourceHash(file, kits), before, 'an edit to a module two imports away changes the kit');
    write('lib/math/1.0.0.ts', "export const one = 1;\n");
    assert.equal(kitSourceHash(file, kits), before);
  });

  it('allows a kit react, remotion, zod, types and library modules; nothing else', () => {
    assert.deepEqual(moduleProblems(path.join(kits, 'shaped/1.0.0.tsx'), kits), []);
    const bad = write('bad/1.0.0.tsx', [
      "import fs from 'node:fs';",
      "import {k} from '../plain/1.0.0.js';",
      "import {X} from '../types.js';",
      "import {gone} from '../lib/missing/1.0.0.js';",
      "const f = () => import('@fontsource/anton/files/anton-latin-400-normal.woff2');",
    ].join('\n'));
    assert.deepEqual(moduleProblems(bad, kits).map((p) => p.split(':')[0]), [
      'imports node',
      'imports ../plain/1.0.0.js',
      'imports values from ../types.js',
      'imports ../lib/missing/1.0.0.js',
      'imports @fontsource/anton/files/anton-latin-400-normal.woff2',
    ]);
  });

  it('allows a library module font files, by dynamic import only', () => {
    const fonts = write('lib/fonts/1.0.0.ts', "export const load = () => import('@fontsource/anton/files/anton-latin-400-normal.woff2');\n");
    assert.deepEqual(moduleProblems(fonts, kits), []);
    const eager = write('lib/fonts/2.0.0.ts', "import url from '@fontsource/anton/files/anton-latin-400-normal.woff2';\nexport const u = url;\n");
    assert.equal(moduleProblems(eager, kits).length, 1);
  });
});
