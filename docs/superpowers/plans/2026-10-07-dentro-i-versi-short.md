# Dentro i versi · short Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.3` and its six children. The seven museum kits of CreativeStudio's `sala8` become clean, frozen kits sharing frozen library modules. Alongside them come the series compiler `dentro-i-versi-short@1.0.0`, its validator and template release, and the episode-side support they need: sounds as assets, and the voice's energy in every take's timing.

**Architecture:** Kits may now import frozen library modules (`src/kits/lib/<name>/<x.y.z>.ts(x)`), and the lock hashes a kit together with every module it reaches (ADR-0039). A kit may be restricted to some output profiles. The compiler is pure: from the spec's data and the measured takes, it computes everything `sala8` computed at render time and lays it out as kit items. Overlapping items go on separate lanes, because no track may overlap. The validator holds a hand-edited timeline to the format.

**Tech Stack:**
- TypeScript, React 19 and Remotion 4.0.505 for the kits (`node:test`), with zod props.
- `@fontsource` Anton, Fraunces and Inter 5.3.0.
- `@studio/series` (`node:test`) and `@studio/episode` (vitest).
- ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-07-dentro-i-versi-short-design.md` (two commits on this branch).

Every line of code below was run in a scratch worktree before this plan was written. That prototype is the local commit `99a6b41` on branch `scratch/div`; never push it, never merge it. What was run there:
- the composer suite, including one real frame of every example and the safe-zone check;
- the series suite (101 tests) and the episode suite (186);
- the typecheck, `check:boundaries` and `docs:check`;
- a real render of the golden episode (`REMOTION_E2E=1`): the layout sheet, and the 1129-frame video, which took 32 minutes;
- San Martino end to end with CreativeStudio's real takes aligned by Qwen. The user approved that look.

Generated files are taken from that commit with `git checkout 99a6b41 -- <path>`: sample pictures, previews, the golden fixture and the release's schema and manifest. Each task says which.

## Global Constraints

- Work on branch `feat/dentro-i-versi-short`, in the main checkout (`/Users/euripide/strange_things/video-studio`). It holds the spec commits.
- Never push or merge without the user's go.
- Leave the checkout's unrelated changes alone: `studio/gateway/src/workspace/filesystem-service.ts`, `studio/gateway/test/workspace-filesystem.test.ts` and `.beads/`. Never stage them; never run `bd`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git add` with explicit paths only.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- **A released kit or library module never changes.** Each lock entry is written once, by `npm run kits:lock`, and must equal the value given in its task. If it doesn't, the file differs from the plan: fix the file, never the lock.
- Only one dependency change: `@fontsource/anton`, `@fontsource/fraunces` and `@fontsource/inter`, all 5.3.0, in `@av/remotion-composer` (Task 2).
  - Run `bun install --lockfile-only --ignore-scripts`, then `bun install --frozen-lockfile`, in this checkout. Never run them in a worktree, and never install into `packages/voice/.venv`.
  - bun 1.2.0 rewrites `packages/remotion-composer/package.json`'s `bin` block. After installing, `git diff packages/remotion-composer/package.json` must show only the three dependency lines; restore anything else.
- Libraries read no environment variable.
- What other packages import is consumed through `dist/`, so rebuild it before testing the consumer:
  - `npm run build --workspace @av/remotion-composer`, before `@studio/series` tests;
  - `npm run build --workspace @studio/series`, before `@studio/episode` tests.
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.
- Channel specifics in code (the palette, costumes, poses, a series-specific compiler) are accepted for this format. `avg-d1x` restores the boundary; do not "fix" it here.

## Review Focus

- **A released library module edited by hand.** Every kit that reaches it must fail its lock, and a kit that imports nothing must keep its old hash. Task 1's `kit-source` tests pin this.
- **A museum kit used in a 16:9 timeline.** It must be refused as `wrong-profile` before its props are judged. Task 2's test "refuses a kit drawn for another output profile" pins this.
- **A long title or a long verse on screen.** It must stay inside the 9:16 safe zone. The one-frame tests check every overlay example against the safe zone, including lower-third `one-line` and verse-plate `long`, in Tasks 2 and 3.
- **A `voiceEndWord` that ends the voice early, or a recording longer than the video.** It must be refused with its path, or cut at the last frame, never left past the end. Task 8's tests "a voiceEndWord last said before the last verse" and "a take that runs past the end of the video is cut there" pin this.
- **A verse retyped by hand on its plate, or a plate removed.** The validator must refuse it (`verse-text`, `missing-verse`). Task 9's golden cases pin this.

---

### Task 1: Kits may share frozen library modules (lock, profiles, ADR-0039)

**Files:**
- Create: `packages/remotion-composer/scripts/kit-source.ts`, `packages/remotion-composer/test/kit-source.test.ts`, `docs/adr/0039-format-kits-share-frozen-libraries.md`
- Modify: `packages/remotion-composer/scripts/kits.ts`, `packages/remotion-composer/src/kits/types.ts`, `packages/remotion-composer/src/kits/index.ts`, `packages/remotion-composer/test/kits.test.ts`, `packages/remotion-composer/test/kits-render.test.ts`, `docs/index.md`

**Interfaces:**
- Produces:
  - `kitSourceHash(kitFile: string, kitsDir?: string): string`;
  - `sourceFiles(kitFile, kitsDir?): string[]`;
  - `moduleProblems(file, kitsDir?): string[]`;
  - `libraryFile(from, spec, kitsDir?): string | null`;
  - `importsOf(file): {spec, typeOnly, dynamic}[]`;
  - `KitVersion.profiles?: string[]`;
  - `drawnFor(kit, profileId): boolean`;
  - `KitListing.profiles?`.

- [ ] **Step 1: Write the failing test**

Create `packages/remotion-composer/test/kit-source.test.ts`:

````ts
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
    assert.deepEqual(sourceFiles(file, kits).map((f) => path.relative(kits, f)), ['lib/math/1.0.0.ts', 'lib/shapes/1.0.0.tsx', 'shaped/1.0.0.tsx']);
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
````

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd packages/remotion-composer && node --import tsx --test test/kit-source.test.ts`
Expected: FAIL — `Cannot find module '../scripts/kit-source.js'`.

- [ ] **Step 3: Implement**

Create `packages/remotion-composer/scripts/kit-source.ts`:

````ts
// What a kit version draws with, and its lock hash (avg-tk7.3, ADR-0039).
//
// A kit version is its own file plus the frozen library modules it imports,
// transitively: src/kits/lib/<name>/<x.y.z>.ts(x). The lock hash covers all
// of them, so a released kit cannot change by an edit to a module it uses —
// a change to a released module is a new module version, and a new kit
// version to use it. A kit that imports no module hashes exactly as before:
// its file's sha256.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const KITS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/kits');
const LIB = /^\.\.?\/(?:\.\.\/)?(?:lib\/)?([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/(\d+\.\d+\.\d+)\.js$/;
const FONT_FILE = /^@fontsource\/[a-z0-9-]+\/files\/[a-z0-9-]+\.woff2$/;

export interface ModuleRef {
  spec: string;
  typeOnly: boolean;
  /** import('…') or require('…'), as opposed to a declaration. */
  dynamic: boolean;
}

/** Every module a file reaches: import/export declarations, import = require(), import() and require(). */
export function importsOf(file: string): ModuleRef[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const refs: ModuleRef[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly)));
      refs.push({spec: node.moduleSpecifier.text, typeOnly, dynamic: false});
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly, dynamic: false});
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      refs.push({spec: ts.isStringLiteral(expr) ? expr.text : '<computed>', typeOnly: node.isTypeOnly, dynamic: false});
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      refs.push({spec: arg && ts.isStringLiteral(arg) ? arg.text : '<computed>', typeOnly: false, dynamic: true});
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

/** The file a library import names, from the importing file: ../lib/<name>/<v>.js (a kit) or ../<name>/<v>.js (a module). */
export function libraryFile(from: string, spec: string, kitsDir = KITS_DIR): string | null {
  const m = LIB.exec(spec);
  if (!m) return null;
  const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ''));
  if (!base.startsWith(path.join(kitsDir, 'lib') + path.sep)) return null;
  for (const ext of ['.tsx', '.ts']) if (existsSync(base + ext)) return base + ext;
  return null;
}

const isLibrary = (file: string, kitsDir: string) => file.startsWith(path.join(kitsDir, 'lib') + path.sep);

/** What a kit file or a library module may import; empty when it keeps the rules. */
export function moduleProblems(file: string, kitsDir = KITS_DIR): string[] {
  const library = isLibrary(file, kitsDir);
  const types = library ? '../../types.js' : '../types.js';
  const problems: string[] = [];
  for (const {spec, typeOnly, dynamic} of importsOf(file)) {
    if (['react', 'remotion', 'zod'].includes(spec)) continue;
    if (spec === types) {
      if (!typeOnly) problems.push(`imports values from ${types}: only types may come from there (use import type)`);
      continue;
    }
    if (LIB.test(spec)) {
      if (!libraryFile(file, spec, kitsDir)) problems.push(`imports ${spec}: no such library module (src/kits/lib/<name>/<x.y.z>.ts(x))`);
      continue;
    }
    if (library && dynamic && FONT_FILE.test(spec)) continue;
    problems.push(`imports ${spec}: only react, remotion, zod, types from ${types}, library modules${library ? ' and @fontsource font files (dynamic import)' : ''} are allowed`);
  }
  return problems;
}

/** The kit's file and every library module it reaches, sorted by path. */
export function sourceFiles(kitFile: string, kitsDir = KITS_DIR): string[] {
  const seen = new Set<string>([kitFile]);
  const queue = [kitFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const {spec, typeOnly} of importsOf(file)) {
      if (typeOnly) continue;
      const lib = libraryFile(file, spec, kitsDir);
      if (lib && !seen.has(lib)) {
        seen.add(lib);
        queue.push(lib);
      }
    }
  }
  return [...seen].sort();
}

/** The lock hash: the file's sha256 alone, or over every file it draws with (`<path>\0<bytes>` each, in path order). */
export function kitSourceHash(kitFile: string, kitsDir = KITS_DIR): string {
  const files = sourceFiles(kitFile, kitsDir);
  const hash = createHash('sha256');
  if (files.length === 1) hash.update(readFileSync(kitFile));
  else for (const file of files) hash.update(`${path.relative(kitsDir, file).split(path.sep).join('/')}\0`).update(readFileSync(file));
  return `sha256:${hash.digest('hex')}`;
}
````

- [ ] **Step 4: Run it to make sure it passes**

Run: `node --import tsx --test test/kit-source.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: The lock, the kit tests and the previews use it; kits may name their profiles**

````diff
diff --git a/packages/remotion-composer/scripts/kits.ts b/packages/remotion-composer/scripts/kits.ts
index dc4c1ef..e99a38e 100644
--- a/packages/remotion-composer/scripts/kits.ts
+++ b/packages/remotion-composer/scripts/kits.ts
@@ -2,30 +2,30 @@
 // npm run kits:previews  render previews/<name>@<version>.<profile>.png: the first
 //                        example in every output profile, at a third of its size
 
-import {createHash} from 'node:crypto';
 import {existsSync, readFileSync, writeFileSync} from 'node:fs';
 import {copyFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import path from 'node:path';
 import {fileURLToPath} from 'node:url';
 import {renderStill, selectComposition} from '@remotion/renderer';
-import {KIT_VERSIONS, previewCompositionId, previewPath} from '../src/kits/index.js';
+import {KIT_VERSIONS, drawnFor, previewCompositionId, previewPath} from '../src/kits/index.js';
 import {bundlePreviews} from '../src/preview-bundle.js';
 import {outputProfiles} from '../test/helpers.js';
+import {kitSourceHash} from './kit-source.js';
 
 const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
 const lockFile = path.join(root, 'kits.lock.json');
 const sourceOf = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
-const hash = (file: string) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
 
 async function lock() {
   const current: Record<string, string> = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {};
   const next = {...current};
   for (const kit of KIT_VERSIONS) {
     const id = `${kit.name}@${kit.version}`;
-    const actual = hash(sourceOf(kit.name, kit.version));
+    // The kit's file and the library modules it draws with (ADR-0039).
+    const actual = kitSourceHash(sourceOf(kit.name, kit.version));
     if (current[id] && current[id] !== actual) {
-      throw new Error(`${id} is released and its file changed: restore it and add a new version instead`);
+      throw new Error(`${id} is released and its file or a library module it uses changed: restore it and add a new version instead`);
     }
     if (!current[id]) {
       next[id] = actual;
@@ -43,7 +43,7 @@ async function previews() {
     // Render all first, then copy: a failure halfway leaves previews/ as it was.
     const rendered: [string, string][] = [];
     for (const profile of outputProfiles()) {
-      for (const kit of KIT_VERSIONS) {
+      for (const kit of KIT_VERSIONS.filter((k) => drawnFor(k, profile.id))) {
         const example = kit.examples[0]!;
         const id = previewCompositionId(kit.name, kit.version, example.id);
         const inputProps = {profile};
diff --git a/packages/remotion-composer/src/kits/types.ts b/packages/remotion-composer/src/kits/types.ts
index 46d7867..98c83e4 100644
--- a/packages/remotion-composer/src/kits/types.ts
+++ b/packages/remotion-composer/src/kits/types.ts
@@ -43,6 +43,12 @@ export interface KitVersion {
    * the profile's safe zone (checked on every example). Absent: fills the frame.
    */
   layer?: 'overlay';
+  /**
+   * The output profiles the kit is drawn for (ADR-0039); absent: every
+   * profile. A format's kit laid out for 9:16 says so, and is neither tested
+   * nor accepted in another profile.
+   */
+  profiles?: string[];
   /** Validates props as a timeline writes them. */
   props: ZodTypeAny;
   component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
diff --git a/packages/remotion-composer/test/kits-render.test.ts b/packages/remotion-composer/test/kits-render.test.ts
index 00e46f0..5166488 100644
--- a/packages/remotion-composer/test/kits-render.test.ts
+++ b/packages/remotion-composer/test/kits-render.test.ts
@@ -12,7 +12,7 @@ import {mkdtemp, rm} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import path from 'node:path';
 import {renderStill, selectComposition} from '@remotion/renderer';
-import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
+import {KIT_VERSIONS, drawnFor, previewCompositionId} from '../src/kits/index.js';
 import {bundlePreviews} from '../src/preview-bundle.js';
 import {drawnBox, overflow} from './drawn-box.js';
 import {outputProfiles} from './helpers.js';
@@ -45,7 +45,7 @@ describe('every kit example renders a real frame in every output profile', () =>
   });
 
   for (const profile of outputProfiles()) {
-    for (const kit of KIT_VERSIONS) {
+    for (const kit of KIT_VERSIONS.filter((k) => drawnFor(k, profile.id))) {
       for (const example of kit.examples) {
         const id = previewCompositionId(kit.name, kit.version, example.id);
         const name = `${kit.name}@${kit.version} ${example.id} in ${profile.id}`;
diff --git a/packages/remotion-composer/test/kits.test.ts b/packages/remotion-composer/test/kits.test.ts
index bfe9dcf..c7c7e9e 100644
--- a/packages/remotion-composer/test/kits.test.ts
+++ b/packages/remotion-composer/test/kits.test.ts
@@ -4,55 +4,20 @@
 
 import {describe, it} from 'node:test';
 import assert from 'node:assert/strict';
-import {createHash} from 'node:crypto';
 import {existsSync, readFileSync, readdirSync} from 'node:fs';
 import path from 'node:path';
 import {spawnSync} from 'node:child_process';
 import {fileURLToPath} from 'node:url';
-import ts from 'typescript';
-import {KIT_VERSIONS, previewPath} from '../src/kits/index.js';
+import {KIT_VERSIONS, drawnFor, previewPath} from '../src/kits/index.js';
 import {outputProfiles} from './helpers.js';
+import {kitSourceHash, moduleProblems, sourceFiles} from '../scripts/kit-source.js';
 
 const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
 const source = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
 const lock = JSON.parse(readFileSync(path.join(root, 'kits.lock.json'), 'utf8')) as Record<string, string>;
-const ALLOWED_IMPORTS = new Set(['react', 'remotion', 'zod', '../types.js']);
 /** The branch whose lock a change must keep: every entry there stays, unchanged. */
 const LOCK_BASE = process.env.KITS_LOCK_BASE ?? 'origin/main';
 
-/**
- * Every module a file reaches: import/export declarations, `import x =
- * require()`, dynamic `import()` and `require()`. `../types.js` may only be
- * reached for types, so nothing shared at runtime can change an old version.
- */
-function moduleProblems(file: string): string[] {
-  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
-  const problems: string[] = [];
-  const check = (spec: string, typeOnly: boolean) => {
-    if (!ALLOWED_IMPORTS.has(spec)) problems.push(`imports ${spec}: only ${[...ALLOWED_IMPORTS].join(', ')} are allowed`);
-    else if (spec === '../types.js' && !typeOnly) problems.push('imports values from ../types.js: only types may come from there (use import type)');
-  };
-  const visit = (node: ts.Node) => {
-    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
-      const clause = node.importClause;
-      const bindings = clause?.namedBindings;
-      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly)));
-      check(node.moduleSpecifier.text, typeOnly);
-    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
-      check(node.moduleSpecifier.text, node.isTypeOnly);
-    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
-      const expr = node.moduleReference.expression;
-      check(ts.isStringLiteral(expr) ? expr.text : '<computed>', node.isTypeOnly);
-    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
-      const arg = node.arguments[0];
-      check(arg && ts.isStringLiteral(arg) ? arg.text : '<computed>', false);
-    }
-    ts.forEachChild(node, visit);
-  };
-  visit(sf);
-  return problems;
-}
-
 describe('kit versions', () => {
   for (const kit of KIT_VERSIONS) {
     const id = `${kit.name}@${kit.version}`;
@@ -76,20 +41,21 @@ describe('kit versions', () => {
         }
       });
 
-      it('lives in its own self-contained file', () => {
+      it('lives in its own file, sharing only frozen library modules', () => {
         const file = source(kit.name, kit.version);
         assert.ok(existsSync(file), `${path.relative(root, file)} must hold ${id}`);
-        assert.deepEqual(moduleProblems(file), [], id);
+        for (const f of sourceFiles(file)) assert.deepEqual(moduleProblems(f), [], path.relative(root, f));
       });
 
-      it('is frozen by kits.lock.json', () => {
-        const actual = `sha256:${createHash('sha256').update(readFileSync(source(kit.name, kit.version))).digest('hex')}`;
+      it('is frozen by kits.lock.json, with the library modules it uses', () => {
         assert.ok(lock[id], `${id} is not in kits.lock.json: run npm run kits:lock`);
-        assert.equal(actual, lock[id], `${id} is released: restore its file and add ${kit.name}/<next version>.tsx instead`);
+        assert.equal(kitSourceHash(source(kit.name, kit.version)), lock[id],
+          `${id} is released: restore its file and the library modules it uses, and add ${kit.name}/<next version>.tsx (and new module versions) instead`);
       });
 
-      it('has a committed preview in every output profile', () => {
-        for (const profile of outputProfiles()) {
+      it('has a committed preview in every output profile it is drawn for', () => {
+        assert.ok(outputProfiles().some((p) => drawnFor(kit, p.id)), `${id} names no known output profile`);
+        for (const profile of outputProfiles().filter((p) => drawnFor(kit, p.id))) {
           const file = previewPath(kit.name, kit.version, profile.id);
           assert.ok(existsSync(path.join(root, file)), `${file} is missing: run npm run kits:previews`);
         }
@@ -98,7 +64,7 @@ describe('kit versions', () => {
   }
 
   it('keeps no preview that no version and profile has', () => {
-    const expected = new Set(KIT_VERSIONS.flatMap((k) => outputProfiles().map((p) => path.basename(previewPath(k.name, k.version, p.id)))));
+    const expected = new Set(KIT_VERSIONS.flatMap((k) => outputProfiles().filter((p) => drawnFor(k, p.id)).map((p) => path.basename(previewPath(k.name, k.version, p.id)))));
     assert.deepEqual(readdirSync(path.join(root, 'previews')).filter((f) => !expected.has(f)), []);
   });
 
@@ -120,7 +86,7 @@ describe('kit versions', () => {
     const registered = new Set(KIT_VERSIONS.map((k) => `${k.name}@${k.version}`));
     assert.deepEqual(Object.keys(lock).filter((id) => !registered.has(id)), []);
     const files = readdirSync(path.join(root, 'src/kits'), {withFileTypes: true})
-      .filter((d) => d.isDirectory())
+      .filter((d) => d.isDirectory() && d.name !== 'lib')
       .flatMap((d) => readdirSync(path.join(root, 'src/kits', d.name)).filter((f) => f.endsWith('.tsx')).map((f) => `${d.name}@${f.replace(/\.tsx$/, '')}`));
     assert.deepEqual(files.filter((id) => !registered.has(id)), []);
   });
````

In `packages/remotion-composer/src/kits/index.ts`, apply only this part of the change for now. The kit imports and `KIT_VERSIONS` come with each kit's task.

````diff
@@ export const previewPath = (name: string, version: string, profileId: string): string =>
   `previews/${name}@${version}.${profileId}.png`;
 
+/** Whether a kit version is drawn for a profile (a kit without `profiles` is drawn for all). */
+export const drawnFor = (kit: Pick<KitVersion, 'profiles'>, profileId: string): boolean =>
+  !kit.profiles || kit.profiles.includes(profileId);
+
 export interface KitListing {
   name: string;
   version: string;
   description: string;
   layer: 'overlay' | 'fill';
   examples: string[];
-  /** Output profile id → preview path, for the profiles asked for. */
+  /** The profiles it is drawn for, when not all (ADR-0039). */
+  profiles?: string[];
+  /** Output profile id → preview path, for the profiles asked for that it is drawn for. */
   previews: Record<string, string>;
 }
@@ export const listKits = (profileIds: readonly string[] = []): KitListing[] =>
       description: k.description,
       layer: k.layer ?? 'fill',
       examples: k.examples.map((e) => e.id),
-      previews: Object.fromEntries(profileIds.map((id) => [id, previewPath(k.name, k.version, id)])),
+      ...(k.profiles ? {profiles: [...k.profiles]} : {}),
+      previews: Object.fromEntries(profileIds.filter((id) => drawnFor(k, id)).map((id) => [id, previewPath(k.name, k.version, id)])),
     }));
````

- [ ] **Step 6: Nothing released changes**

Run: `npm run kits:lock && git diff --exit-code kits.lock.json && npm test`
Expected: the lock is unchanged; every existing kit hashes as before, because none imports a library module. All tests pass.

- [ ] **Step 7: ADR-0039**

Create `docs/adr/0039-format-kits-share-frozen-libraries.md`:

````markdown
# ADR-0039: Format kits share frozen libraries

## Status

Accepted (`avg-dcf.3`). The kits of the Dentro i versi short —
`museum-hall`, `room-effect`, `verse-plate`, `interprete`, `lower-third`,
`title-chip`, `brand-mark`, all `1.0.0` — are the first to import library
modules, and `remotion-composer`'s lock covers them.

## Context

A kit version never changes (ADR-0034): a delivered episode must re-render
as it was. So far a kit file could import only `react`, `remotion`, `zod`
and types, which kept it self-contained and its lock entry — the file's
sha256 — honest. CreativeStudio's museum format is seven pieces drawn with
the same math (smoothstep ramps, envelopes, deterministic noise), the same
palette and fonts, the same picture and room effects and the same actor.
Copying all of it into each of seven files would freeze seven diverging
copies; importing ordinary shared code would let a later edit change every
released kit that uses it, silently.

## Decision

**Kits may import frozen library modules**: `src/kits/lib/<name>/<version>.ts`
(or `.tsx`), imported by exact version — `../lib/stage-math/1.0.0.js`. A
library module follows the kit rule: it imports only `react`, `remotion`,
`zod`, types, and other library modules by exact version; the one exception
is a font file, which a library module may import dynamically (`import()`
of an `@fontsource/*` `.woff2`), so the browser loads it and Node never
does.

**The lock covers what a kit draws with.** A kit's hash in `kits.lock.json`
is the sha256 over its file and every library module it reaches, each as
its path relative to `src/kits` and its bytes, in sorted order. A kit that
imports no library module hashes exactly as before — its file's sha256 —
so every existing entry stays valid. Editing a released library module
therefore fails the lock of every kit that reaches it; the fix is a new
module version next to the old one, imported by a new kit version.

A kit may declare `profiles`: the output profiles it is drawn for. A
timeline that uses it in another profile is refused (`wrong-profile`)
before its props are checked; previews and one-frame tests cover only
those profiles. The museum kits are drawn for `vertical-1080x1920`.

Fonts are pinned packages, never system fonts: `@fontsource/anton`,
`@fontsource/fraunces` and `@fontsource/inter` 5.3.0 (OFL), loaded inside
the browser through `FontFace` with Remotion's `delayRender`, so no frame
is drawn before its fonts.

## Consequences

- Shared drawing code is written once per version and frozen like a kit;
  seven kits share one actor, one set of effects, one palette.
- The lock check reads imports: a library import that is not
  `<name>/<version>.js`, or a module that imports beyond the rule, fails
  `npm test`.
- Channel specifics now live in composer code (`lib/dentro-i-versi` — the
  palette —, the actor's costumes and poses, the series compiler). That is
  against the boundary the studio is moving to (`avg-d1x`): looks and
  parameters as library data, the application executing, composers and
  channel-neutral kits as plugins. Accepted for this format; `avg-d1x`
  restores the boundary.
````

````diff
diff --git a/docs/index.md b/docs/index.md
index a8abdf7..401a57e 100644
--- a/docs/index.md
+++ b/docs/index.md
@@ -56,7 +56,7 @@ synced into the site at build time from where they live next to the code.
 
 ## Decision records
 
-[`adr/`](./adr/0038-word-timing-comes-from-forced-alignment) holds 38 accepted
+[`adr/`](./adr/0039-format-kits-share-frozen-libraries) holds 39 accepted
 decisions. The ones that most shape the code:
 
 | ADR | Decision |
@@ -72,6 +72,7 @@ decisions. The ones that most shape the code:
 | [0036](./adr/0036-the-studio-renders-episodes-through-the-edit-timeline) | The studio renders episodes through the edit timeline, with Remotion |
 | [0037](./adr/0037-series-templates-pin-editorial-standards) | Series templates pin editorial standards |
 | [0038](./adr/0038-word-timing-comes-from-forced-alignment) | Word timing comes from forced alignment against the text |
+| [0039](./adr/0039-format-kits-share-frozen-libraries) | Format kits share frozen libraries, locked with them |
 
 ADR-0022 (independent repositories per module) is superseded by 0032.
 ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.
````

- [ ] **Step 8: Commit**

```bash
git add packages/remotion-composer/scripts/kit-source.ts packages/remotion-composer/scripts/kits.ts \
  packages/remotion-composer/src/kits/types.ts packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/test/kit-source.test.ts packages/remotion-composer/test/kits.test.ts \
  packages/remotion-composer/test/kits-render.test.ts docs/adr/0039-format-kits-share-frozen-libraries.md docs/index.md
git commit -m "Kits share frozen library modules, locked with them; kits may name their profiles (ADR-0039, avg-dcf.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Titles — brand-mark, lower-third, title-chip, fonts, palette (avg-dcf.3.1)

**Files:**
- Modify: `packages/remotion-composer/package.json`, `bun.lock`, `packages/remotion-composer/src/errors.ts`, `packages/remotion-composer/src/validate.ts`, `packages/remotion-composer/src/kits/index.ts`, `packages/remotion-composer/test/validate.test.ts`, `packages/remotion-composer/kits.lock.json`
- Create:
  - library modules: `packages/remotion-composer/src/kits/lib/stage-math/1.0.0.ts`, `lib/fonts/1.0.0.ts`, `lib/fonts.d.ts`, `lib/dentro-i-versi/1.0.0.ts`;
  - kits: `src/kits/brand-mark/1.0.0.tsx`, `src/kits/lower-third/1.0.0.tsx`, `src/kits/title-chip/1.0.0.tsx`;
  - previews: `previews/{brand-mark,lower-third,title-chip}@1.0.0.vertical-1080x1920.png`.

**Interfaces:**
- Consumes: Task 1's library rule and `profiles`.
- Produces:
  - `stage-math`: `clamp`, `smoothstep`, `ease`, `ramp`, `pulse`, `win`, `mix`, `rnd`, `rnd2`, `Envelope`, `envelope`, `sumOf`, `maxOf`;
  - `fonts`: `ANTON`, `SERIF`, `SANS`, `useFonts()`;
  - `dentro-i-versi`: `HALL`, `TITLES`, `LIGHT`, `TEXT_SHADOW`;
  - the error code `wrong-profile`.

- [ ] **Step 1: Add the fonts**

In `packages/remotion-composer/package.json`, add to `dependencies` (sorted, before `@remotion/bundler`):

```json
    "@fontsource/anton": "5.3.0",
    "@fontsource/fraunces": "5.3.0",
    "@fontsource/inter": "5.3.0",
```

Then, from the repository root: `bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile`. Check that `git diff packages/remotion-composer/package.json` shows only the three lines; restore the `bin` block if bun rewrote it. Check that `git diff bun.lock` adds only the three `@fontsource` packages.

- [ ] **Step 2: Write the failing test**

In `packages/remotion-composer/test/validate.test.ts`, add after the test "refuses kits it does not have, by name or by version":

```ts
  it('refuses a kit drawn for another output profile', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit = {name: 'title-chip', version: '1.0.0'};
    doc.tracks[0].items[0].props = {title: 'San Martino'};
    assert.deepEqual(problems(doc), [['wrong-profile', '$.tracks[0].items[0].kit']]);
    const result = validateTimeline(doc);
    assert.match(result.ok ? '' : result.problems[0]!.message, /title-chip@1\.0\.0 is drawn for vertical-1080x1920, not youtube-1920x1080/);
  });
```

Replace the test "lists every kit version with what the catalog needs" with:

```ts
  it('lists every kit version with what the catalog needs', () => {
    const ids = outputProfiles().map((p) => p.id);
    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer]), [
      ['brand-mark', '1.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['clip', '1.0.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['still', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
    ]);
    const captions = listKits(ids).find((k) => k.name === 'captions' && k.version === '1.1.0')!;
    assert.deepEqual(captions.examples, ['bottom', 'top', 'center', 'long', 'overflowing']);
    assert.deepEqual(captions.previews, {
      'youtube-1920x1080': 'previews/captions@1.1.0.youtube-1920x1080.png',
      'vertical-1080x1920': 'previews/captions@1.1.0.vertical-1080x1920.png',
    });
    // A format's kit is listed with the profiles it is drawn for, and previews only there.
    const chip = listKits(ids).find((k) => k.name === 'title-chip')!;
    assert.deepEqual([chip.profiles, chip.previews], [['vertical-1080x1920'], {'vertical-1080x1920': 'previews/title-chip@1.0.0.vertical-1080x1920.png'}]);
    assert.deepEqual(listKits()[1]!.previews, {});
    assert.ok(listKits().every((k) => k.description.length > 0));
  });
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL. `title-chip` is an unknown kit, and the listing lacks the three title kits.

- [ ] **Step 4: The library modules**

Create `packages/remotion-composer/src/kits/lib/stage-math/1.0.0.ts`:

````ts
// stage-math@1.0.0 — released: never edit this file; add stage-math/<next>.ts instead (ADR-0039).
// The small maths every stage kit animates with, rewritten from CreativeStudio's
// stages: easing curves, ramps and windows over seconds, a deterministic noise,
// and the Envelope a compiler writes into props.

export const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, Number.isFinite(x) ? x : 0));
/** Smoothstep: the titles' and the glass' easing. */
export const smoothstep = (x: number): number => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
/** Smootherstep: the stage's easing (hall, camera, actor, verses). */
export const ease = (x: number): number => {
  const v = clamp(x);
  return v * v * v * (v * (v * 6 - 15) + 10);
};
/** 0 → 1 between seconds a and b, eased. */
export const ramp = (t: number, a: number, b: number): number => ease((t - a) / (b - a));
/** In over 0.9 s from a, out over 0.9 s before b. */
export const pulse = (t: number, a: number, b: number): number => ramp(t, a, a + 0.9) * (1 - ramp(t, b - 0.9, b));
/** In over d from a, out over d before b. */
export const win = (t: number, a: number, b: number, d = 0.3): number => ramp(t, a, a + d) * (1 - ramp(t, b - d, b));
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Deterministic noise in [0, 1). */
export const rnd = (i: number): number => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};
/** A second deterministic noise, for what must not move with `rnd`. */
export const rnd2 = (i: number): number => {
  const x = Math.sin(i * 91.7 + 3.1) * 43758.5453;
  return x - Math.floor(x);
};

/** A value that rises over rampIn from `from`, holds, and falls over rampOut to `to`. Seconds from the item's start. */
export interface Envelope {
  from: number;
  to: number;
  rampIn: number;
  rampOut: number;
  amount: number;
}

export const envelope = (t: number, e: Envelope): number =>
  e.amount * ramp(t, e.from, e.from + e.rampIn) * (1 - ramp(t, e.to - e.rampOut, e.to));
export const sumOf = (t: number, es: readonly Envelope[]): number => es.reduce((s, e) => s + envelope(t, e), 0);
export const maxOf = (t: number, es: readonly Envelope[]): number => es.reduce((m, e) => Math.max(m, envelope(t, e)), 0);
````

Create `packages/remotion-composer/src/kits/lib/fonts/1.0.0.ts`:

````ts
// fonts@1.0.0 — released: never edit this file; add fonts/<next>.ts instead (ADR-0039).
// Anton, Fraunces (italic, regular and bold) and Inter (300, 400, 600) from
// @fontsource (OFL), bundled with the composer: no network at render time.
// The files are imported only when a kit renders — in the browser, where the
// bundler made them URLs — and every frame waits for them.

import {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';

export const ANTON = 'Studio Anton';
export const SERIF = 'Studio Fraunces';
export const SANS = 'Studio Inter';

type Face = [family: string, weight: string, style: string, file: () => Promise<{default: string}>];
const FACES: Face[] = [
  [ANTON, '400', 'normal', () => import('@fontsource/anton/files/anton-latin-400-normal.woff2')],
  [SERIF, '400', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-400-italic.woff2')],
  [SERIF, '700', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-700-italic.woff2')],
  [SANS, '300', 'normal', () => import('@fontsource/inter/files/inter-latin-300-normal.woff2')],
  [SANS, '400', 'normal', () => import('@fontsource/inter/files/inter-latin-400-normal.woff2')],
  [SANS, '600', 'normal', () => import('@fontsource/inter/files/inter-latin-600-normal.woff2')],
];

let loading: Promise<void> | null = null;

function loadAll(): Promise<void> {
  loading ??= Promise.all(FACES.map(async ([family, weight, style, file]) => {
    const url = (await file()).default;
    const face = new FontFace(family, `url(${url}) format('woff2')`, {weight, style});
    await face.load();
    // FontFaceSet is set-like; the DOM typings here lack its add().
    (document.fonts as unknown as Set<FontFace>).add(face);
  })).then(() => undefined);
  return loading;
}

/** Hold the frame until every face is loaded. */
export function useFonts(): void {
  const [handle] = useState(() => delayRender('fonts@1.0.0'));
  useEffect(() => {
    loadAll().then(() => continueRender(handle), (error: unknown) => {
      throw error instanceof Error ? error : new Error(String(error));
    });
  }, [handle]);
}
````

Create `packages/remotion-composer/src/kits/lib/fonts.d.ts`:

````ts
// The bundler turns a font file into its URL (asset/resource).
declare module '*.woff2' {
  const url: string;
  export default url;
}
````

Create `packages/remotion-composer/src/kits/lib/dentro-i-versi/1.0.0.ts`:

````ts
// dentro-i-versi@1.0.0 — released: never edit this file; add dentro-i-versi/<next>.ts instead (ADR-0039).
// The colours of "Dentro i versi" (CreativeStudio's poesie-museo runtime):
// the hall's ink and accents, and the titles' light-on-dark palette.
// Channel specifics in code — accepted for now; avg-d1x moves them to the library.

/** The hall and the verses. */
export const HALL = {ink: '#0c1230', ink2: '#2b3766', accent: '#5a3fd6', cyan: '#3fc8f0', led: '#e9fbff'} as const;
/** The titles. */
export const TITLES = {text: '#f6f8ff', dim: 'rgba(244,247,255,.92)', cyan: '#5fdcff', amber: '#ffbf5e', ice: '#bfefff', plate: 'rgba(8,12,36,.92)', chip: 'rgba(8,12,36,.86)', pill: 'rgba(8,12,36,.72)'} as const;
/** The glass, the lightning and the teleport. */
export const LIGHT = {line: 'rgba(255,255,255,.62)', cyan: '#5fdcff', ice: '#bfefff', violet: '#c3b8ff'} as const;
/** The titles' text shadow. */
export const TEXT_SHADOW = '0 2px 3px rgba(6,10,32,.85), 0 0 14px rgba(6,10,32,.55)';
````

- [ ] **Step 5: The kits**

Create `packages/remotion-composer/src/kits/brand-mark/1.0.0.tsx`:

````tsx
// brand-mark@1.0.0 — released: never edit this file; add brand-mark/<next>.tsx instead.
// The programme's mark: a lightning bolt and its name on a dark glass pill,
// top left (Dentro i versi's titles, from CreativeStudio's sala8).
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {SANS, useFonts} from '../lib/fonts/1.0.0.js';
import {TITLES} from '../lib/dentro-i-versi/1.0.0.js';

const BrandMark: KitVersion['component'] = ({props}) => {
  useFonts();
  const x = (props.x as number | undefined) ?? 60;
  const y = (props.y as number | undefined) ?? 120;
  return (
    <div style={{position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px 10px 16px', borderRadius: 999, background: TITLES.pill, border: '1px solid rgba(255,255,255,.38)'}}>
      <svg width="20" height="28" viewBox="0 0 18 26"><path d="M11 0 L1 15 H8 L6 26 L17 10 H10 Z" fill={TITLES.amber} /></svg>
      <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 24, letterSpacing: 6, color: TITLES.text, whiteSpace: 'nowrap'}}>{(props.text as string | undefined) ?? 'DENTRO I VERSI'}</div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'brand-mark',
  version: '1.0.0',
  description: "The programme's mark — a lightning bolt and its name on a dark glass pill — at the top left of a 9:16 frame.",
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: z.object({
    text: z.string().min(1).max(40).optional(),
    x: z.number().min(0).optional(),
    y: z.number().min(0).optional(),
  }).strict(),
  component: BrandMark,
  examples: [
    {id: 'default', props: {}, durationInFrames: 30, frame: 0},
    {id: 'renamed', props: {text: 'POESIE'}, durationInFrames: 30, frame: 0},
  ],
};
````

Create `packages/remotion-composer/src/kits/lower-third/1.0.0.tsx`:

````tsx
// lower-third@1.0.0 — released: never edit this file; add lower-third/<next>.tsx instead.
// The poem's card at the opening and at the bow: the eyebrow (author ·
// collection) in cyan, the title in Anton on its lines, a cyan rule that
// grows, the author. Bottom-anchored, so a longer card grows upwards; its
// shadow is kept short so every pixel stays in the safe zone. From
// CreativeStudio's sala8.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {ANTON, SANS, useFonts} from '../lib/fonts/1.0.0.js';
import {TEXT_SHADOW, TITLES} from '../lib/dentro-i-versi/1.0.0.js';
import {smoothstep} from '../lib/stage-math/1.0.0.js';

const LowerThird: KitVersion['component'] = ({props}) => {
  useFonts();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const ruleGrow = (props.ruleGrow as number | undefined) ?? 1.2;
  const maxWidth = props.maxWidth as number;
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 90, top: ((props.bottom as number | undefined) ?? 1500), transform: 'translateY(-100%)'}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', maxWidth, boxSizing: 'border-box', padding: '24px 36px 28px 30px', borderRadius: 16, background: TITLES.plate, border: '1px solid rgba(255,255,255,.45)', boxShadow: `0 10px 24px rgba(4,6,20,.45), inset 0 2px 0 ${TITLES.cyan}`}}>
        <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 28, letterSpacing: 7, color: TITLES.cyan, lineHeight: 1.3, maxWidth: maxWidth - 66}}>{props.kicker as string}</div>
        <div style={{fontFamily: ANTON, fontSize: props.size as number, letterSpacing: 3, color: TITLES.text, lineHeight: 1, marginTop: 18, textShadow: TEXT_SHADOW, whiteSpace: 'nowrap', textTransform: 'uppercase'}}>
          {(props.titleLines as string[]).map((line, i) => <div key={i}>{line}</div>)}
        </div>
        <div style={{height: 3, background: TITLES.cyan, marginTop: 16, width: `${100 * (ruleGrow > 0 ? smoothstep(t / ruleGrow) : 1)}%`, boxShadow: `0 0 14px ${TITLES.cyan}`}} />
        <div style={{fontFamily: SANS, fontWeight: 400, fontSize: 30, color: TITLES.text, lineHeight: 1.25, marginTop: 16}}>{props.author as string}</div>
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'lower-third',
  version: '1.0.0',
  description: "The poem's card for a 9:16 frame — eyebrow, title in Anton on one or two lines, a growing cyan rule, author — anchored by its bottom edge so it grows upwards.",
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: z.object({
    kicker: z.string().min(1),
    titleLines: z.array(z.string().min(1)).min(1).max(2),
    author: z.string().min(1),
    /** The card's widest extent (the compiler keeps it clear of the actor). */
    maxWidth: z.number().positive(),
    /** Anton size of the title, fitted by the compiler to maxWidth. */
    size: z.number().positive().max(160),
    x: z.number().min(0).optional(),
    /** Where the card's bottom edge sits. */
    bottom: z.number().positive().optional(),
    /** Seconds the cyan rule takes to grow; 0: full. */
    ruleGrow: z.number().min(0).optional(),
  }).strict(),
  component: LowerThird,
  examples: [
    {id: 'opening', props: {kicker: 'GIOSUÈ CARDUCCI · RIME NUOVE', titleLines: ['SAN', 'MARTINO'], author: 'Giosuè Carducci', maxWidth: 557, size: 118}, durationInFrames: 60, frame: 45},
    {id: 'one-line', props: {kicker: 'GIOVANNI PASCOLI · MYRICAE', titleLines: ['IL LAMPO'], author: 'Giovanni Pascoli', maxWidth: 557, size: 104, ruleGrow: 0}, durationInFrames: 30, frame: 0},
    {id: 'rule-growing', props: {kicker: 'GIOSUÈ CARDUCCI', titleLines: ['SAN', 'MARTINO'], author: 'Giosuè Carducci', maxWidth: 557, size: 118}, durationInFrames: 60, frame: 12},
  ],
};
````

Create `packages/remotion-composer/src/kits/title-chip/1.0.0.tsx`:

````tsx
// title-chip@1.0.0 — released: never edit this file; add title-chip/<next>.tsx instead.
// A compact title · author chip at the top right while the poem is recited
// (Dentro i versi, from CreativeStudio's sala8). Long titles drop the author.
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {ANTON, SANS, useFonts} from '../lib/fonts/1.0.0.js';
import {TITLES} from '../lib/dentro-i-versi/1.0.0.js';

const TitleChip: KitVersion['component'] = ({props}) => {
  useFonts();
  const author = props.author as string | undefined;
  return (
    <div style={{position: 'absolute', right: (props.right as number | undefined) ?? 140, top: (props.y as number | undefined) ?? 120, display: 'inline-flex', alignItems: 'baseline', gap: 14, padding: '10px 22px 12px', borderRadius: 12, background: TITLES.chip, border: '1px solid rgba(255,255,255,.45)', boxShadow: `inset 0 2px 0 ${TITLES.cyan}`}}>
      <span style={{fontFamily: ANTON, fontSize: 36, letterSpacing: 2, color: TITLES.text, textTransform: 'uppercase', whiteSpace: 'nowrap'}}>{props.title as string}</span>
      {author ? <span style={{fontFamily: SANS, fontWeight: 600, fontSize: 18, letterSpacing: 4, color: TITLES.cyan, whiteSpace: 'nowrap'}}>{author.toUpperCase()}</span> : null}
    </div>
  );
};

export const kit: KitVersion = {
  name: 'title-chip',
  version: '1.0.0',
  description: 'A compact title · author chip at the top right of a 9:16 frame; without an author for a long title.',
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: z.object({
    title: z.string().min(1).max(40),
    author: z.string().min(1).optional(),
    /** Distance of the chip's right edge from the frame's. */
    right: z.number().min(0).optional(),
    y: z.number().min(0).optional(),
  }).strict(),
  component: TitleChip,
  examples: [
    {id: 'with-author', props: {title: 'San Martino', author: 'Giosuè Carducci'}, durationInFrames: 30, frame: 0},
    {id: 'long-title', props: {title: 'Frate Sole e Sora Luna'}, durationInFrames: 30, frame: 0},
  ],
};
````

- [ ] **Step 6: Register them, and refuse a kit outside its profiles**

````diff
diff --git a/packages/remotion-composer/src/errors.ts b/packages/remotion-composer/src/errors.ts
index 8c104e6..132a92c 100644
--- a/packages/remotion-composer/src/errors.ts
+++ b/packages/remotion-composer/src/errors.ts
@@ -2,6 +2,7 @@ export type ComposerErrorCode =
   | 'invalid-timeline'
   | 'unknown-kit'
   | 'bad-props'
+  | 'wrong-profile'
   | 'missing-asset'
   | 'hash-mismatch'
   | 'render-failed'
diff --git a/packages/remotion-composer/src/validate.ts b/packages/remotion-composer/src/validate.ts
index cbd6883..7f73d43 100644
--- a/packages/remotion-composer/src/validate.ts
+++ b/packages/remotion-composer/src/validate.ts
@@ -54,6 +54,14 @@ export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimelin
         problems.push({code: 'unknown-kit', message: `${item.kit.name}@${item.kit.version}: ${known}`, path: `${p}.kit`});
         return;
       }
+      if (kit.profiles && !kit.profiles.includes(profile.id)) {
+        problems.push({
+          code: 'wrong-profile',
+          message: `${item.kit.name}@${item.kit.version} is drawn for ${kit.profiles.join(', ')}, not ${profile.id}`,
+          path: `${p}.kit`,
+        });
+        return;
+      }
       const props = kit.props.safeParse(item.props);
       if (!props.success) {
         for (const issue of props.error.issues) {
````

In `packages/remotion-composer/src/kits/index.ts`, import the three kits after `captions110`:

```ts
import {kit as brandMark100} from './brand-mark/1.0.0.js';
import {kit as lowerThird100} from './lower-third/1.0.0.js';
import {kit as titleChip100} from './title-chip/1.0.0.js';
```

and make `KIT_VERSIONS`:

```ts
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([
  still100, clip100, captions100, captions110,
  brandMark100, lowerThird100, titleChip100,
]);
```

- [ ] **Step 7: Lock, previews, tests**

Run: `npm run kits:lock`. The new entries must be exactly:

```json
  "brand-mark@1.0.0": "sha256:766d79b97478c93112f7e49254bbbae1a4483f04a8e52b28aab8b6fa97f6f000",
  "lower-third@1.0.0": "sha256:ba8238a9c1868f7e69dbcc9321f65b84f5b76adf618e22ef4ce7682e0fd0ef2e",
  "title-chip@1.0.0": "sha256:565749b3569d1a6278091d6bdf441a622620e8511b6fc1ddef87102b68a7e924",
```

Take the previews rendered in the prototype rather than running `npm run kits:previews`, which would re-render every kit's previews:

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/previews/brand-mark@1.0.0.vertical-1080x1920.png \
  packages/remotion-composer/previews/lower-third@1.0.0.vertical-1080x1920.png \
  packages/remotion-composer/previews/title-chip@1.0.0.vertical-1080x1920.png
```

Run: `npm run typecheck && npm test`
Expected: PASS. That includes one real frame of every example, with every overlay pixel inside the 9:16 safe zone, and no 16:9 frame for the new kits.

- [ ] **Step 8: Commit**

```bash
git add packages/remotion-composer/package.json bun.lock packages/remotion-composer/src/errors.ts \
  packages/remotion-composer/src/validate.ts packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/src/kits/lib packages/remotion-composer/src/kits/brand-mark \
  packages/remotion-composer/src/kits/lower-third packages/remotion-composer/src/kits/title-chip \
  packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json \
  packages/remotion-composer/previews/brand-mark@1.0.0.vertical-1080x1920.png \
  packages/remotion-composer/previews/lower-third@1.0.0.vertical-1080x1920.png \
  packages/remotion-composer/previews/title-chip@1.0.0.vertical-1080x1920.png
git commit -m "Titles kits: brand-mark, lower-third, title-chip, with bundled fonts and the Dentro i versi palette (avg-dcf.3.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: verse-plate (avg-dcf.3.2)

**Files:**
- Create: `packages/remotion-composer/src/kits/verse-plate/1.0.0.tsx`, `previews/verse-plate@1.0.0.vertical-1080x1920.png`
- Modify: `src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`

- [ ] **Step 1: Write the failing test**

In `test/validate.test.ts`'s listing, add after `['title-chip', '1.0.0', 'overlay'],`:

```ts
      ['verse-plate', '1.0.0', 'overlay'],
```

Run: `node --import tsx --test test/validate.test.ts`. Expected: FAIL (no `verse-plate`).

- [ ] **Step 2: The kit**

Create `packages/remotion-composer/src/kits/verse-plate/1.0.0.tsx`:

````tsx
// verse-plate@1.0.0 — released: never edit this file; add verse-plate/<next>.tsx instead.
// One verse on a light, opaque plate (Dentro i versi, from CreativeStudio's
// sala8, mode "sober"): the whole verse visible from the start, each word
// dimmed until it is said and then lit; strong words bold, turning violet;
// a cyan rule that grows; the paraphrase visible for the whole verse
// (UP-55, UP-59). No word moves. The plate's top sits at `y` and it grows
// upwards when it would pass `bottom`; its shadow is kept short so every
// pixel stays in the safe zone.
import React from 'react';
import {interpolateColors, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {SANS, SERIF, useFonts} from '../lib/fonts/1.0.0.js';
import {HALL} from '../lib/dentro-i-versi/1.0.0.js';
import {ease} from '../lib/stage-math/1.0.0.js';

/** A word as `strong` lists it: lower case, letters only. */
const key = (token: string) => token.toLocaleLowerCase('it-IT').replace(/[^\p{L}]+/gu, '');
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

const VersePlate: KitVersion['component'] = ({props}) => {
  useFonts();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const text = props.text as string;
  const words = props.words as {text: string; at: number}[];
  const strong = new Set((props.strong as string[] | undefined) ?? []);
  const dim = (props.dim as number | undefined) ?? 0.42;
  const start = (props.start as number | undefined) ?? 0.28;
  const enter = (props.enter as number | undefined) ?? 0.27;
  const y = (props.y as number | undefined) ?? 1240;
  const bottom = (props.bottom as number | undefined) ?? 1500;
  const vIn = enter > 0 ? ease(t / enter) : 1;
  let k = 0;
  const verse = text.split(/(\s+)/).map((token, i) => {
    if (!token.trim()) return token;
    const at = words[k++]?.at ?? start;
    const q = ease((t - at + 0.04) / 0.22);
    const isStrong = strong.has(key(token));
    return (
      <span key={i} style={{opacity: dim + (1 - dim) * q, fontWeight: isStrong ? 700 : 400, color: isStrong ? interpolateColors(q, [0, 1], [HALL.ink, HALL.accent]) : HALL.ink}}>
        {token}
      </span>
    );
  });
  const gloss = ease((t - start - 0.1) / 0.45);
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 90, bottom: 1920 - bottom, width: (props.width as number | undefined) ?? 500, minHeight: bottom - y, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', opacity: vIn, transform: `translateY(${16 * (1 - vIn)}px)`}}>
      <div style={{padding: '20px 16px 24px', borderRadius: 16, background: 'rgb(248,250,255)', border: '1px solid #ffffff', boxShadow: `0 10px 24px rgba(10,16,50,.3), inset 0 3px 0 ${HALL.cyan}`}}>
        <div style={{fontFamily: SERIF, fontStyle: 'italic', fontSize: 46, lineHeight: 1.2, textAlign: 'center', whiteSpace: 'pre-line', color: HALL.ink}}>
          <span>{verse}</span>
        </div>
        <div style={{margin: '12px auto 0', width: 72 * ease((t - start) / 0.5), height: 4, borderRadius: 2, background: HALL.cyan, boxShadow: `0 0 10px ${HALL.cyan}`}} />
        <div style={{marginTop: 18, textAlign: 'center', fontFamily: SANS, fontWeight: 400, fontSize: 30, lineHeight: 1.26, color: HALL.ink2, opacity: gloss, transform: `translateY(${(1 - gloss) * 10}px)`}}>
          {props.gloss as string}
        </div>
      </div>
    </div>
  );
};

const Props = z.object({
  /** The verse as written; lines by \n. */
  text: z.string().min(1),
  /** One per word of `text`, in order: when it is said, in seconds from the item's start. */
  words: z.array(z.object({text: z.string().min(1), at: z.number().min(0)}).strict()),
  /** Words to set bold and violet, lower case, letters only. */
  strong: z.array(z.string().min(1)).optional(),
  /** The paraphrase. */
  gloss: z.string().min(1),
  /** When the verse starts being said, in seconds from the item's start (the rule and the paraphrase start then). */
  start: z.number().min(0).optional(),
  /** Seconds the plate takes to rise in; 0: already there. */
  enter: z.number().min(0).optional(),
  /** Opacity of a word not yet said. */
  dim: z.number().min(0).max(1).optional(),
  x: z.number().min(0).optional(),
  /** Where the plate's top sits when it fits. */
  y: z.number().min(0).optional(),
  /** The lowest its bottom edge may go: above it, the plate grows upwards. */
  bottom: z.number().positive().optional(),
  width: z.number().positive().optional(),
}).strict().superRefine((p, ctx) => {
  const expected = tokens(p.text).length;
  if (p.words.length !== expected) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['words'], message: `the verse has ${expected} words; words lists ${p.words.length}`});
  }
});

const SAN_MARTINO = {
  text: 'La nebbia\nagli irti colli\npiovigginando sale,',
  words: [['La', 0.28], ['nebbia', 0.5], ['agli', 1.3], ['irti', 1.6], ['colli', 1.9], ['piovigginando', 2.9], ['sale,', 3.8]].map(([text, at]) => ({text, at})),
  strong: ['nebbia', 'colli'],
  gloss: 'La nebbia sale sui colli spogli, con una pioggia fine,',
};

export const kit: KitVersion = {
  name: 'verse-plate',
  version: '1.0.0',
  description: 'One verse on a light plate in a 9:16 frame: the whole verse visible, each word lit when it is said, strong words bold and violet, the paraphrase below for the whole verse.',
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: VersePlate,
  examples: [
    // Halfway: "La nebbia agli irti" said, "colli" being said, the rest dim.
    {id: 'halfway', props: SAN_MARTINO, durationInFrames: 150, frame: 58},
    {id: 'all-said', props: SAN_MARTINO, durationInFrames: 150, frame: 140},
    {
      id: 'long',
      props: {
        text: 'stormi d\'uccelli neri,\ncom\'esuli pensieri,\nnel vespero migrar.',
        words: ['stormi', 'd\'uccelli', 'neri,', 'com\'esuli', 'pensieri,', 'nel', 'vespero', 'migrar.'].map((text, i) => ({text, at: 0.28 + i * 0.4})),
        strong: ['uccelli', 'pensieri'],
        gloss: 'stormi di uccelli neri che, come pensieri di chi è in esilio, migrano verso la sera.',
      },
      durationInFrames: 150,
      frame: 149,
    },
  ],
};
````

In `src/kits/index.ts`, add `import {kit as versePlate100} from './verse-plate/1.0.0.js';` after the title-chip import, and `versePlate100` after `titleChip100` in `KIT_VERSIONS`.

- [ ] **Step 3: Lock, preview, tests**

Run: `npm run kits:lock`. The new entry must be `"verse-plate@1.0.0": "sha256:10ddc27131ea7564dccee32099922e118c6b7d06aad559fbb26b2a2374b5a99f"`.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/previews/verse-plate@1.0.0.vertical-1080x1920.png
```

Run: `npm run typecheck && npm test`. Expected: PASS. That includes the `long` example, which grows upwards and stays inside the safe zone.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/verse-plate packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json \
  packages/remotion-composer/previews/verse-plate@1.0.0.vertical-1080x1920.png
git commit -m "verse-plate kit: the whole verse, words lit as they are said, the paraphrase (avg-dcf.3.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: museum-hall, with the shared props and hall effects (avg-dcf.3.3)

**Files:**
- Create:
  - `packages/remotion-composer/src/kits/lib/stage-props/1.0.0.ts`, `src/kits/lib/hall-fx/1.0.0.tsx`, `src/kits/museum-hall/1.0.0.tsx`;
  - samples `kits/samples/{hall,picture-a,picture-b,fog,caustics}.png`;
  - `previews/museum-hall@1.0.0.vertical-1080x1920.png`.
- Modify: `src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`

**Interfaces:**
- Produces:
  - `stage-props`: `EnvelopeSchema`, `CameraSchema`, `FlashSchema`, `BoxSchema`, `AssetUrl`, `cameraStyle`, `Camera`;
  - `hall-fx`: `Glass`, `Cover`, `Shatter`, `LiveBolt`, `Teleport`, `pictureCamera`, `strikeAt`, `PICTURE_FX`, `pictureFx`, `pictureFxInRoom`, `ROOM_FX`, `roomFx`, `Box`, `FigureOpt`, `RoomFx`, `PictureFx`.
- The interprete and room-effect kits (Tasks 5, 6) use `stage-props` and `hall-fx`. Both modules are complete here, because a module is frozen when first locked.

- [ ] **Step 1: Write the failing test**

In `test/validate.test.ts`'s listing, add after `['lower-third', '1.0.0', 'overlay'],`:

```ts
      ['museum-hall', '1.0.0', 'fill'],
```

Run it; expected FAIL.

- [ ] **Step 2: The modules, the samples, the kit**

Create `packages/remotion-composer/src/kits/lib/stage-props/1.0.0.ts`:

````ts
// stage-props@1.0.0 — released: never edit this file; add stage-props/<next>.ts instead (ADR-0039).
// The props the stage kits share, so they are written and checked the same
// way everywhere: envelopes, the camera, the lightning flash, the screen.

import React from 'react';
import {z} from 'zod';
import {maxOf, rnd, sumOf, type Envelope} from '../stage-math/1.0.0.js';

export const EnvelopeSchema = z.object({
  from: z.number(),
  to: z.number(),
  rampIn: z.number().min(0),
  rampOut: z.number().min(0),
  amount: z.number(),
}).strict().refine((e) => e.to >= e.from, {message: 'an envelope ends after it starts'});

/** The hall's camera, shared by every layer inside it: zoom (summed) and shake (px, the strongest). */
export const CameraSchema = z.object({
  origin: z.tuple([z.number(), z.number()]),
  zoom: z.array(EnvelopeSchema),
  shake: z.array(EnvelopeSchema),
}).strict();
export type Camera = z.infer<typeof CameraSchema>;

/** Lightning instants that light up the hall, the screen and the actor. */
export const FlashSchema = z.object({strikes: z.array(z.number())}).strict();

export const BoxSchema = z.object({x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive()}).strict();

/** A `{ "$asset": "<id>" }` reference, as a timeline writes it (the kit receives its URL). */
export const AssetUrl = z.object({$asset: z.string().min(1)}).strict();

/** The camera's CSS transform at t: zoom about its origin, and a shake jittered 24 times a second. */
export const cameraStyle = (t: number, camera: Camera): React.CSSProperties => {
  const scale = 1 + sumOf(t, camera.zoom as Envelope[]);
  const shake = maxOf(t, camera.shake as Envelope[]);
  const sx = (rnd(Math.floor(t * 24)) - 0.5) * 2 * shake;
  const sy = (rnd(Math.floor(t * 24) + 7) - 0.5) * 1.2 * shake;
  return {transformOrigin: `${camera.origin[0]}px ${camera.origin[1]}px`, transform: `translate(${sx}px, ${sy}px) scale(${scale})`};
};
````

Create `packages/remotion-composer/src/kits/lib/hall-fx/1.0.0.tsx`:

````tsx
// hall-fx@1.0.0 — released: never edit this file; add hall-fx/<next>.tsx instead (ADR-0039).
// What happens in a museum hall: the glass screen, the shards of a picture
// that shatters, lightning, the teleport column, and the named effects that
// live in a picture and come out of it into the hall. Rewritten from
// CreativeStudio's poesie-museo runtime (fx.tsx, v10/ui.tsx, v10/fx7.tsx):
// same drawing, with every SVG id made unique per instance and every image a
// URL its caller resolved (textures and silhouettes are assets, never paths).

import React, {useId} from 'react';
import {Img} from 'remotion';
import {clamp, ease as easeStage, rnd, smoothstep} from '../stage-math/1.0.0.js';
import {LIGHT} from '../dentro-i-versi/1.0.0.js';

/** CreativeStudio's effects use the gentler easing (smoothstep) and their own ramp(t, a, b). */
const ease = smoothstep;
const ramp = (t: number, a: number, b: number) => ease((t - a) / (b - a));
const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --------------------------------------------------------------- glass screen
/** A glass panel: blurred behind, a thin edge, a line of light, its reflection on the floor. */
export const Glass: React.FC<{box: Box; t: number; flash?: number; tilt?: number; children?: React.ReactNode}> = ({box, t, flash = 0, tilt = 0, children}) => (
  <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, perspective: 2200}}>
    <div style={{position: 'absolute', inset: 0, transform: `rotateY(${tilt}deg) translateY(${Math.sin(t * 0.6) * 3}px)`, transformOrigin: '50% 50%', WebkitBoxReflect: 'below 26px linear-gradient(transparent 62%, rgba(255,255,255,.16))'} as React.CSSProperties}>
      <div style={{position: 'absolute', inset: 0, borderRadius: 14, background: 'rgba(10,16,48,.42)', backdropFilter: 'blur(14px) saturate(1.25)', border: `1px solid ${LIGHT.line}`, boxShadow: `0 0 0 1px rgba(95,220,255,${0.18 + 0.3 * flash}), 0 40px 90px rgba(18,24,70,.32), inset 0 1px 0 rgba(255,255,255,.7), 0 0 ${40 + 80 * flash}px rgba(95,220,255,${0.12 + 0.35 * flash})`, overflow: 'hidden'}}>
        <div style={{position: 'absolute', inset: 10, borderRadius: 8, overflow: 'hidden'}}>{children}</div>
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 70%, rgba(255,255,255,.08) 100%)', pointerEvents: 'none'}} />
        <div style={{position: 'absolute', left: 24, right: 24, top: 0, height: 2, background: LIGHT.cyan, opacity: 0.9, boxShadow: `0 0 18px ${LIGHT.cyan}`}} />
      </div>
    </div>
  </div>
);

/** An image covering a box, centred on (cx, cy) of the image. */
export const Cover: React.FC<{src: string; box: Box; cx?: number; cy?: number; zoom?: number; ratio?: number}> = ({src, box, cx = 0.5, cy = 0.5, zoom = 1, ratio = 0.75}) => {
  const w0 = Math.max(box.w, box.h * ratio);
  const w = w0 * zoom;
  const h = w / ratio;
  const left = clamp(box.w / 2 - cx * w, box.w - w, 0);
  const top = clamp(box.h / 2 - cy * h, box.h - h, 0);
  return (
    <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
      <Img src={src} style={{position: 'absolute', left, top, width: w, height: h}} />
    </div>
  );
};

const SHARDS = (() => {
  const cols = 5;
  const rows = 3;
  const pts: [number, number][][] = [];
  const P = (i: number, j: number): [number, number] => {
    const edgeX = i === 0 || i === cols;
    const edgeY = j === 0 || j === rows;
    return [i / cols + (edgeX ? 0 : (rnd(i * 7 + j * 13) - 0.5) * 0.12), j / rows + (edgeY ? 0 : (rnd(i * 5 + j * 11 + 3) - 0.5) * 0.18)];
  };
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if ((i + j) % 2) pts.push([a, b, c], [a, c, d]);
      else pts.push([a, b, d], [b, c, d]);
    }
  }
  return pts;
})();

/** The picture breaks into triangles that fly into the hall (k 0 → 1). */
export const Shatter: React.FC<{src: string; box: Box; k: number}> = ({src, box, k}) => (
  <>
    {SHARDS.map((tri, i) => {
      const mx = tri.reduce((s, p) => s + p[0], 0) / 3;
      const my = tri.reduce((s, p) => s + p[1], 0) / 3;
      const dirX = (mx - 0.5) * 2 + (rnd(i + 40) - 0.5) * 0.8;
      const dirY = (my - 0.5) * 1.4 - 0.6 + (rnd(i + 50) - 0.5) * 0.5;
      const tx = dirX * 900 * k;
      const ty = dirY * 500 * k + 1500 * k * k;
      const rot = (rnd(i + 60) - 0.5) * 260 * k;
      return (
        <div key={i} style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, clipPath: `polygon(${tri.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',')})`, transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${1 - 0.25 * k})`, transformOrigin: `${mx * 100}% ${my * 100}%`, opacity: 1 - clamp((k - 0.7) / 0.3), filter: `drop-shadow(0 0 6px rgba(190,240,255,${0.6 * Math.min(1, k * 4)}))`}}>
          <Cover src={src} box={{x: 0, y: 0, w: box.w, h: box.h}} />
          <div style={{position: 'absolute', inset: 0, background: `linear-gradient(${rnd(i) * 360}deg, rgba(255,255,255,${0.25 * Math.min(1, k * 5)}), rgba(255,255,255,0) 50%)`}} />
        </div>
      );
    })}
  </>
);

// --------------------------------------------------------------- lightning
export const boltPoints = (x0: number, y0: number, x1: number, y1: number, n: number, seed: number, jitter = 90): [number, number][] =>
  Array.from({length: n}, (_, i) => {
    const k = i / (n - 1);
    const j = i === 0 || i === n - 1 ? 0 : (rnd(seed + i * 3.1) - 0.5) * jitter * (1 - Math.abs(k - 0.5));
    return [x0 + (x1 - x0) * k + j, y0 + (y1 - y0) * k + (rnd(seed + i) - 0.5) * 12];
  });
export const ptsPath = (p: [number, number][]) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

/** A live bolt, redrawn every few frames, branching, glowing; `grow` 0 → 1 draws it down. */
export const LiveBolt: React.FC<{t: number; x0: number; y0: number; x1: number; y1: number; op: number; seed?: number; grow?: number}> = ({t, x0, y0, x1, y1, op, seed = 1, grow = 1}) => {
  const id = sid(useId());
  if (op <= 0) return null;
  const s = Math.floor(t * 10) + seed;
  const pts = boltPoints(x0, y0, x1, y1, 12, s, 70);
  const n = Math.max(2, Math.round(pts.length * clamp(grow)));
  const main = pts.slice(0, n);
  const fl = 0.55 + 0.45 * rnd(Math.floor(t * 30) + seed);
  const br = [3, 6, 9].filter((i) => i < n - 1).map((i) => boltPoints(pts[i]![0], pts[i]![1], pts[i]![0] + (rnd(s + i) - 0.5) * 260, pts[i]![1] + 90 + rnd(s + i + 1) * 120, 5, s + i, 30));
  return (
    <g opacity={op * fl}>
      <defs><filter id={`${id}b`}><feGaussianBlur stdDeviation="8" /></filter></defs>
      <path d={ptsPath(main)} stroke={LIGHT.violet} strokeWidth={16} fill="none" opacity={0.35} filter={`url(#${id}b)`} />
      <path d={ptsPath(main)} stroke="#f4f1ff" strokeWidth={4} fill="none" />
      {br.map((b, j) => <path key={j} d={ptsPath(b)} stroke="#dcd6ff" strokeWidth={2} fill="none" opacity={0.8} />)}
    </g>
  );
};

/** How bright the hall is under the lightning at t, from the strike instants (sala8's curve). */
export const strikeAt = (t: number, strikes: readonly number[]): number =>
  strikes.reduce((m, a) => {
    const d = t - a;
    return d < 0 || d > 0.7 ? m : Math.max(m, d < 0.06 ? 1 : d < 0.12 ? 0.35 : d < 0.2 ? 0.85 : Math.exp(-(d - 0.2) * 6) * 0.6);
  }, 0);

// --------------------------------------------------------------- teleport
/**
 * A column of light, rings on the floor, the figure breaking into slices and
 * sparks rising: k = 0 the whole figure, 1 gone. `floorY` is where it stands.
 */
export const Teleport: React.FC<{t: number; k: number; x: number; h: number; w?: number; floorY: number; children: React.ReactNode}> = ({t, k, x, h, w = 240, floorY, children}) => {
  const id = sid(useId());
  const peak = Math.sin(Math.PI * clamp(k));
  const top = floorY - h - 40;
  const N = 34;
  const sh = (h + 60) / N;
  const f = Math.floor(t * 30);
  return (
    <g>
      <defs>
        <linearGradient id={`${id}beam`} x1="0" x2="1"><stop offset="0" stopColor={LIGHT.cyan} stopOpacity="0" /><stop offset=".35" stopColor={LIGHT.cyan} stopOpacity=".35" /><stop offset=".5" stopColor="#ffffff" stopOpacity=".85" /><stop offset=".65" stopColor={LIGHT.cyan} stopOpacity=".35" /><stop offset="1" stopColor={LIGHT.cyan} stopOpacity="0" /></linearGradient>
        <filter id={`${id}cy`} x="-30%" y="-10%" width="160%" height="120%"><feFlood floodColor="#bff4ff" /><feComposite in2="SourceAlpha" operator="in" result="s" /><feGaussianBlur in="s" stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="s" /></feMerge></filter>
        <mask id={`${id}m`}>
          {Array.from({length: N}, (_, j) => {
            const v = clamp((1 - k) * 1.7 - (j / N) * 0.4 - rnd(j * 7.3) * 0.3);
            return <rect key={j} x={x - w} y={top + j * sh} width={2 * w} height={sh * v + 0.6} fill="#fff" />;
          })}
        </mask>
      </defs>
      <rect x={x - w * 0.62} y={0} width={w * 1.24} height={floorY + 10} fill={`url(#${id}beam)`} opacity={peak * 0.95} />
      <rect x={x - 3} y={0} width={6} height={floorY} fill="#fff" opacity={peak * 0.9} />
      {[0, 1, 2].map((j) => {
        const ph = (t * 1.4 + j / 3) % 1;
        return <ellipse key={j} cx={x} cy={floorY - ph * (h + 30)} rx={w * (0.55 + 0.15 * Math.sin(ph * Math.PI))} ry={22} fill="none" stroke={LIGHT.cyan} strokeWidth={3} opacity={peak * (1 - ph) * 0.9} />;
      })}
      <ellipse cx={x} cy={floorY} rx={w * 0.7} ry={30} fill={LIGHT.cyan} opacity={peak * 0.35} />
      <ellipse cx={x} cy={floorY} rx={w * (0.5 + 0.4 * peak)} ry={26} fill="none" stroke="#fff" strokeWidth={4} opacity={peak} />
      <g mask={`url(#${id}m)`}>
        <g opacity={1 - 0.35 * peak}>{children}</g>
        <g filter={`url(#${id}cy)`} opacity={peak * 0.75} transform={`translate(${(rnd(f) - 0.5) * 26 * peak} 0)`}>{children}</g>
      </g>
      {Array.from({length: 46}, (_, j) => {
        const sp = 0.35 + rnd(j + 3) * 0.6;
        const yy = floorY - ((t * sp + rnd(j)) % 1) * (h + 120);
        const xx = x + (rnd(j + 11) - 0.5) * w * 1.3;
        return <circle key={j} cx={xx} cy={yy} r={1.6 + rnd(j + 5) * 3} fill={j % 3 ? '#e8fbff' : LIGHT.cyan} opacity={peak * (0.4 + 0.6 * rnd(j + (f % 7)))} />;
      })}
    </g>
  );
};

// --------------------------------------------------------------- the camera
/** Seconds-based camera: the slow drift of a picture inside the screen (sala8's `camera(i)`). */
export const pictureCamera = (t: number, at: number, next: number, first: boolean, scale: number, move: {dx: number; dy: number; z: number; r: number}): React.CSSProperties => {
  const k = easeStage(clamp((t - at) / Math.max(0.4, next - at)));
  const drift = easeStage(clamp((k - 0.04) / 0.96));
  const pu = first ? 0 : 1 - easeStage(clamp((t - at) / 1.1));
  const mix = (a: number, b: number, q: number) => a + (b - a) * q;
  return {
    transform: `translate3d(${mix(-move.dx * 0.22, move.dx, drift) - 18 * pu}px,${mix(-move.dy * 0.22, move.dy, drift)}px,0) scale(${scale * (1 + move.z * k) * (1 + 0.05 * pu)}) rotate(${mix(-move.r * 0.35, move.r, k)}deg)`,
    filter: `brightness(${1.02 + 0.025 * k}) contrast(${1.045 + 0.025 * k}) saturate(${1.04 + 0.07 * k})`,
  };
};

// --------------------------------------------------------------- named effects
export interface FxContext {
  t: number;
  t0: number;
  t1: number;
  /** The screen's box in the frame. */
  frame: Box;
  color: string;
  /** Texture URLs the caller resolved: horizontal fog, water caustics. */
  textures: {fog?: string; caustics?: string};
}

type LiveFx = 'embers' | 'wind' | 'rain' | 'rays' | 'glow' | 'sweep' | 'fog' | 'water' | 'leaves' | 'birds';
const flick = (t: number) => 0.5 + 0.5 * (0.5 * Math.sin(t * 9.1) + 0.3 * Math.sin(t * 13.7 + 1) + 0.2 * Math.sin(t * 5.3 + 2));

/** Light and atmosphere in a picture (w × h), or leaking from it into the room (`room`: the screen's box). */
const LivingFx: React.FC<{fx: LiveFx; t: number; t0: number; w: number; h: number; c: string; room?: Box; fog?: string}> = ({fx, t, t0, w, h, c, room, fog}) => {
  const id = sid(useId());
  const dt = t - t0;
  const n = (k: number) => Array.from({length: k}, (_, i) => i + (room ? 40 : 0));
  let body: React.ReactNode = null;
  if (fx === 'embers') {
    const rise = room ? 420 : h * 0.8;
    body = (
      <>
        {!room && <rect x="0" y="0" width={w} height={h} fill={`url(#${id}glow)`} opacity={0.3 + 0.3 * flick(t)} />}
        {n(room ? 16 : 15).map((i) => {
          const P = 1.6 + 1.4 * rnd(i);
          const ph = ((t + rnd(i + 7) * P) % P) / P;
          const x0 = room ? (i % 3 === 0 ? room.x + rnd(i + 3) * room.w : room.x - 4) : rnd(i + 3) * w;
          const y0 = room ? (i % 3 === 0 ? room.y + 8 : room.y + room.h * (0.3 + 0.65 * rnd(i + 5))) : h * 0.98;
          const curl = Math.sin(ph * 5 + i * 2);
          const x = x0 + 20 * curl * ph - (room ? (90 + 170 * rnd(i + 9)) * ph : 0);
          const y = y0 - rise * ph;
          const len = 8 + 8 * rnd(i + 11);
          const tilt = 7 * Math.cos(ph * 5 + i * 2);
          const o = Math.sin(Math.PI * ph) ** 1.4 * (room ? 0.9 : 1);
          const d = `M${x} ${y} l${-tilt} ${len}`;
          return <g key={i} opacity={o}><path d={d} stroke={room ? '#ff8a1e' : '#ff9a3c'} strokeWidth="5" strokeLinecap="round" opacity=".3" /><path d={d} stroke={room ? '#e8590c' : '#ffe6a8'} strokeWidth={1.4 + 0.8 * rnd(i + 2)} strokeLinecap="round" /></g>;
        })}
      </>
    );
  }
  if (fx === 'wind') {
    body = (
      <>
        {!room && fog && <image href={fog} x={-dt * 110} y={h * 0.1} width={w + 500} height={h * 0.8} preserveAspectRatio="none" opacity=".22" />}
        {n(room ? 11 : 10).map((i) => {
          const sp = (room ? 300 : 400) + 180 * rnd(i);
          const L = 120 + 130 * rnd(i + 2);
          const span = room ? room.x + L : w + L;
          const dd = (t * sp + rnd(i + 4) * 3000) % span;
          const x = room ? room.x + 10 - dd : -L + dd;
          const y = (room ? room.y + 70 + rnd(i + 6) * (room.h - 140) : 24 + rnd(i + 6) * (h - 48)) + 5 * Math.sin(t * 2.2 + i);
          const o = room ? 0.9 * clamp((x + L) / (room.x * 0.7)) : 0.7;
          return <path key={i} d={`M${x} ${y} q${L / 2} ${-8 - 10 * rnd(i)} ${L} 0`} stroke={`url(#${id}wind)`} strokeWidth={room ? 1.6 + 1.8 * rnd(i + 8) : 1 + 1.5 * rnd(i + 8)} fill="none" strokeLinecap="round" opacity={o} />;
        })}
      </>
    );
  }
  if (fx === 'glow' || fx === 'water' || fx === 'leaves' || fx === 'birds') body = <rect x="0" y="0" width={w} height={h} fill={`url(#${id}soft)`} opacity={0.35 + 0.15 * Math.sin(t * 1.4)} />;
  if (fx === 'sweep') {
    const kk = ((t * 0.33) % 1.3) - 0.15;
    body = <rect x={-w} y={-h} width={w * 0.35} height={h * 3} fill={`url(#${id}sweep)`} transform={`translate(${kk * w * 2.2} 0) rotate(20)`} />;
  }
  if (fx === 'fog' && fog) body = <image href={fog} x={-dt * 16} y={h * 0.2} width={w + 120} height={h * 0.75} preserveAspectRatio="none" opacity=".6" />;
  return (
    <svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible', mixBlendMode: room ? 'normal' : 'screen'}}>
      <defs>
        <radialGradient id={`${id}glow`} cx=".5" cy="1" r=".9"><stop offset="0" stopColor="#ff8a2a" stopOpacity=".8" /><stop offset="1" stopColor="#ff8a2a" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}soft`} cx=".5" cy=".2" r=".8"><stop offset="0" stopColor={c} stopOpacity=".7" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}wind`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={room ? '#6b8199' : '#ffffff'} stopOpacity="0" /><stop offset=".6" stopColor={room ? '#6b8199' : '#ffffff'} stopOpacity=".95" /><stop offset="1" stopColor={room ? '#6b8199' : '#ffffff'} stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}sweep`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff6d8" stopOpacity=".45" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      {body}
    </svg>
  );
};

/** Water light: a caustic texture drifting in two layers around and below the picture. */
const Caustics: React.FC<{t: number; fr: Box; texture?: string}> = ({t, fr, texture}) => {
  if (!texture) return null;
  const cx = fr.x + fr.w / 2 - 60;
  const cy = fr.y + fr.h * 0.72;
  const tex = `url(${texture})`;
  const layer = (size: number, dx: number, dy: number, op: number): React.CSSProperties => ({position: 'absolute', inset: 0, background: '#3d8cff', opacity: op, maskImage: tex, WebkitMaskImage: tex, maskSize: `${size}px ${size}px`, WebkitMaskSize: `${size}px ${size}px`, maskPosition: `${dx}px ${dy}px`, WebkitMaskPosition: `${dx}px ${dy}px`} as React.CSSProperties);
  const area = `radial-gradient(ellipse ${fr.w * 1.15}px ${fr.h * 0.8}px at ${cx}px ${cy}px, #000 0%, rgba(0,0,0,.6) 55%, rgba(0,0,0,0) 100%)`;
  return (
    <div style={{position: 'absolute', inset: 0, maskImage: area, WebkitMaskImage: area} as React.CSSProperties}>
      <div style={layer(420, t * 22, Math.sin(t * 0.8) * 18, 0.46)} />
      <div style={layer(300, -t * 16, t * 9, 0.3)} />
    </div>
  );
};

/** A small flock leaves the picture and crosses the hall. */
const Birds: React.FC<{t: number; t0: number; fr: Box; n?: number}> = ({t, t0, fr, n = 9}) => {
  const birds = Array.from({length: n}, (_, i) => ({d: 0.7 + 0.28 * i + 0.2 * rnd(i + 50), dur: 4.4 + 0.8 * rnd(i + 60), sx: 0.15 + 0.7 * rnd(i + 70), sy: 0.12 + 0.3 * rnd(i + 80), ex: fr.w + 120 + 160 * rnd(i + 90), ey: -260 - 260 * rnd(i + 95), s: 0.6 + 0.45 * rnd(i + 99)}));
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      {birds.map((b, i) => {
        const k = (t - t0 - b.d) / b.dur;
        if (k < 0 || k > 1) return null;
        const e = ease(k);
        const x = fr.x + fr.w * b.sx + (b.ex - fr.w * b.sx) * e;
        const y = fr.y + fr.h * b.sy + b.ey * e - 30 * Math.sin(Math.PI * k);
        const flap = Math.sin((t - t0) * 15 + i * 2.3);
        const o = clamp(k / 0.08) * clamp((1 - k) / 0.2);
        return (
          <g key={i} transform={`translate(${x} ${y}) scale(${1.8 * b.s * (1 + 0.4 * k)})`} opacity={o}>
            <path d={`M-18 ${-6 * flap} Q-9 ${-10 * flap - 4} 0 0 Q9 ${-10 * flap - 4} 18 ${-6 * flap}`} stroke="#1c1416" strokeWidth="3.6" fill="none" strokeLinecap="round" />
            <ellipse cx="0" cy="1" rx="5" ry="3" fill="#1c1416" />
          </g>
        );
      })}
    </svg>
  );
};

/** Dry leaves falling out of the picture. */
const Leaves: React.FC<{t: number; t0: number; fr: Box}> = ({t, t0, fr}) => {
  const cols = ['#b8562a', '#d98a2b', '#8a4a22', '#c9702e', '#a8642a', '#e0a040'];
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      {cols.map((c, i) => {
        const k = (t - t0 - 0.4 - 0.45 * i - 0.2 * rnd(i + 20)) / (4.2 + 0.8 * rnd(i + 30));
        if (k < 0 || k > 1) return null;
        const e = ease(k);
        const x0 = fr.x + fr.w * (0.1 + 0.75 * rnd(i + 40));
        const y0 = fr.y + fr.h * (0.35 + 0.5 * rnd(i + 45));
        const x = x0 - (260 + 200 * rnd(i + 50)) * e + 28 * Math.sin((t - t0) * 2.2 + i);
        const y = y0 + (260 + 220 * rnd(i + 55)) * e;
        const o = clamp(k / 0.1) * clamp((1 - k) / 0.25);
        const rot = (t - t0) * (70 + 60 * rnd(i + 60)) * (i % 2 ? 1 : -1);
        const sc = 1.3 + 0.5 * rnd(i + 65);
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rot}) scale(${sc} ${sc * (0.55 + 0.45 * Math.abs(Math.cos((t - t0) * 3 + i)))})`} opacity={o}>
            <path d="M0 -14 Q11 -4 0 14 Q-11 -4 0 -14Z" fill={c} stroke="#5a2e12" strokeWidth="1.4" />
            <path d="M0 -12 L0 16" stroke="#5a2e12" strokeWidth="1.2" />
          </g>
        );
      })}
    </svg>
  );
};

const STRIKES = [0.35, 1.7, 2.55, 4.1, 5.6, 6.4, 8.0, 9.5];
const bolt = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
  let d = `M${x0} ${y0}`;
  for (let i = 1; i <= 9; i++) {
    const k = i / 9;
    const j = i === 9 ? 0 : (rnd(seed + i) - 0.5) * 90;
    d += ` L${x0 + (x1 - x0) * k + j} ${y0 + (y1 - y0) * k + j * 0.35}`;
  }
  return d;
};

/** Lightning in a picture, or coming out of it into the hall with flashes on the wall. */
const Lightning: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; room: boolean; w?: number; h?: number}> = ({t, t0, t1, fr, color, room, w = 1080, h = 1920}) => {
  const id = sid(useId());
  const dt = t - t0;
  let fl = 0;
  let idx = -1;
  STRIKES.forEach((s, i) => {
    if (t0 + s > t1 - 0.4) return;
    const v = Math.exp(-((dt - s) ** 2) / 0.012) + 0.5 * Math.exp(-((dt - s - 0.16) ** 2) / 0.006);
    if (v > fl) {
      fl = v;
      idx = i;
    }
  });
  if (fl < 0.02) return null;
  if (!room) {
    return (
      <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
        <rect width={w} height={h} fill="#eef0ff" opacity={0.55 * fl} />
        <path d={bolt(w * (0.3 + 0.4 * rnd(idx + 3)), 0, w * (0.2 + 0.6 * rnd(idx + 9)), h * 0.75, idx * 13)} stroke="#fff" strokeWidth="5" fill="none" opacity={fl} />
      </svg>
    );
  }
  const side = idx % 3;
  const sx = side === 0 ? fr.x + 6 : side === 1 ? fr.x + fr.w * (0.25 + 0.5 * rnd(idx)) : fr.x + fr.w - 6;
  const sy = side === 1 ? fr.y + fr.h - 6 : fr.y + fr.h * (0.3 + 0.4 * rnd(idx + 1));
  const ex = side === 0 ? sx - 260 - 200 * rnd(idx + 2) : side === 1 ? sx + (rnd(idx + 4) - 0.5) * 500 : Math.min(1060, sx + 120);
  const ey = side === 1 ? sy + 380 + 160 * rnd(idx + 5) : sy + 300 + 260 * rnd(idx + 6);
  const d = bolt(sx, sy, ex, ey, idx * 31);
  const d2 = bolt(sx, sy, (sx + ex) / 2 + (rnd(idx + 8) - 0.5) * 220, (sy + ey) / 2 + 120, idx * 47);
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs><filter id={`${id}g`}><feGaussianBlur stdDeviation="9" /></filter></defs>
      <rect width="1080" height="1920" fill={color} opacity={0.14 * fl} style={{mixBlendMode: 'screen'}} />
      <rect width="1080" height="1920" fill="#f4f2ff" opacity={0.1 * fl} />
      <g opacity={Math.min(1, fl * 1.2)}>
        <path d={d} stroke={color} strokeWidth="26" fill="none" filter={`url(#${id}g)`} opacity=".9" />
        <path d={d} stroke="#ffffff" strokeWidth="5.5" fill="none" strokeLinejoin="round" />
        <path d={d2} stroke="#ffffff" strokeWidth="2.6" fill="none" opacity=".8" />
      </g>
    </svg>
  );
};

const JOLTS = [0.55, 1.45, 2.15, 3.2, 4.05, 5.3, 6.4, 7.6];
const jolt = (dt: number) => JOLTS.reduce((m, s, i) => Math.max(m, Math.exp(-((dt - s) ** 2) / 0.006) * (0.75 + 0.25 * rnd(i + 5))), 0);

/** The earth breathing and jolting: livid light from below in the picture, seismograph lines under it in the hall. */
const Tremor: React.FC<{t: number; t0: number; fr: Box; color: string; room: boolean; w?: number; h?: number}> = ({t, t0, fr, color, room, w = 1080, h = 1920}) => {
  const id = sid(useId());
  const dt = t - t0;
  if (dt < 0) return null;
  const k = ramp(t, t0, t0 + 0.5);
  const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * dt) / 1.7);
  const j = jolt(dt);
  const wave = (x0: number, x1: number, y: number, amp: number, seed: number) => {
    let d = '';
    for (let x = x0, i = 0; x <= x1; x += 8, i++) {
      const n = Math.sin(i * 0.9 + seed + dt * 31) * 0.6 + Math.sin(i * 2.3 + seed * 2 + dt * 47) * 0.4;
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + (y + n * amp).toFixed(1);
    }
    return d;
  };
  if (!room) {
    return (
      <div style={{position: 'absolute', inset: 0, opacity: k, transform: `translate(${(6 * j * Math.sin(dt * 90)).toFixed(2)}px,${(3 * j).toFixed(2)}px)`}}>
        <div style={{position: 'absolute', inset: 0, mixBlendMode: 'screen', background: `linear-gradient(to top, ${color} 0%, rgba(0,0,0,0) ${55 + 12 * breath}%)`, opacity: 0.22 + 0.28 * breath + 0.25 * j}} />
        <div style={{position: 'absolute', inset: 0, background: '#eef3ff', opacity: 0.12 * j}} />
        <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
          {[0, 1, 2].map((i) => <path key={i} d={wave(0, w, h * (0.8 + 0.07 * i), 3 + 18 * j, i * 7)} stroke={color} strokeWidth={2.2} fill="none" opacity={(0.18 + 0.5 * j) * (1 - 0.25 * i)} />)}
        </svg>
      </div>
    );
  }
  const x0 = fr.x + 10;
  const x1 = fr.x + fr.w - 10;
  const y0 = fr.y + fr.h + 48;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible', opacity: k}}>
      <defs><filter id={`${id}g`}><feGaussianBlur stdDeviation="5" /></filter></defs>
      {[0, 1, 2].map((i) => {
        const d = wave(x0, x1, y0 + i * 30, 2 + 26 * j * (1 - 0.2 * i), i * 11);
        return (
          <g key={i} opacity={(0.3 + 0.15 * breath + 0.5 * j) * (1 - 0.22 * i)}>
            <path d={d} stroke={color} strokeWidth={9} fill="none" filter={`url(#${id}g)`} opacity={0.7} />
            <path d={d} stroke="#f2f4ff" strokeWidth={1.8} fill="none" />
          </g>
        );
      })}
    </svg>
  );
};

/** Fog pouring from the base of the screen over the hall's floor. */
const RoomMist: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; fog?: string}> = ({t, t0, t1, fr, color, fog}) => {
  const k = ease(clamp((t - t0) / 2.6));
  const out = 1 - ease(clamp((t - (t1 - 1.6)) / 1.6));
  const dt = t - t0;
  if (k <= 0 || out <= 0 || !fog) return null;
  const cx = fr.x + fr.w / 2;
  const base = fr.y + fr.h;
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden'}}>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = base - 80 + i * 175 * k;
        const w = (fr.w + (1500 - fr.w) * k) * (1 + 0.12 * i);
        const dir = i % 2 ? 1 : -1;
        const x = cx - w / 2 + dir * (dt * (18 + 6 * i)) + 40 * Math.sin(dt * 0.4 + i);
        return <Img key={i} src={fog} style={{position: 'absolute', left: x, top: y, width: w, height: 300 + 60 * i, objectFit: 'cover', opacity: (0.62 - 0.07 * i) * k * out, filter: `blur(${4 + 2 * i}px) brightness(1.15) drop-shadow(0 0 30px ${color})`, mixBlendMode: 'screen', transform: `scaleX(${dir})`}} />;
      })}
      <div style={{position: 'absolute', left: 0, right: 0, top: base + 260 * k, height: 900, opacity: 0.35 * k * out, background: 'linear-gradient(rgba(235,240,255,.0), rgba(235,240,255,.75) 35%, rgba(235,240,255,.5))', filter: 'blur(18px)'}} />
    </div>
  );
};

/** Warm steam rising in curls from the lower part of the picture. */
const Steam: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string}> = ({t, t0, t1, fr, color}) => {
  const id = sid(useId());
  const on = ease(clamp((t - t0) / 0.8)) * (1 - ease(clamp((t - (t1 - 1)) / 1)));
  if (on <= 0) return null;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs><filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12" /></filter></defs>
      {Array.from({length: 14}, (_, i) => {
        const P = 3.2 + 1.2 * rnd(i + 3);
        const ph = ((t - t0 + rnd(i + 9) * P) % P) / P;
        const x0 = fr.x + fr.w * (0.12 + 0.76 * rnd(i + 5));
        const y0 = fr.y + fr.h * (0.62 + 0.25 * rnd(i + 11));
        const rise = 520 + 320 * rnd(i + 13);
        const y = y0 - rise * ph;
        const sw = 48 * Math.sin(ph * Math.PI * 1.6 + i);
        const o = Math.sin(Math.PI * ph) * 0.58 * on;
        const w = 40 + 80 * ph;
        const d = `M ${x0} ${y + 90} C ${x0 + sw} ${y + 50}, ${x0 - sw} ${y + 20}, ${x0 + sw * 0.6} ${y - 40}`;
        return <g key={i} opacity={o} filter={`url(#${id}b)`}><path d={d} stroke="#fff6f0" strokeWidth={w} strokeLinecap="round" fill="none" /><path d={d} stroke={color} strokeWidth={w * 0.5} strokeLinecap="round" fill="none" opacity={0.35} /></g>;
      })}
    </svg>
  );
};

/** Ribbons of light turning around the picture and widening into the hall. */
const Spell: React.FC<{t: number; t0: number; fr: Box; color: string}> = ({t, t0, fr, color}) => {
  const id = sid(useId());
  const dt = t - t0;
  const cx = fr.x + fr.w / 2;
  const cy = fr.y + fr.h / 2;
  const k = ease(clamp(dt / 1.6));
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs>
        <filter id={`${id}g`}><feGaussianBlur stdDeviation="7" /></filter>
        <linearGradient id={`${id}s`} x1="0" x2="1"><stop offset="0" stopColor={color} stopOpacity="0" /><stop offset=".5" stopColor="#fff3c4" stopOpacity="1" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 1, 2].map((i) => {
        const rx = fr.w * (0.62 + 0.14 * i) * (0.6 + 0.4 * k);
        const ry = fr.h * (0.5 + 0.08 * i) * (0.6 + 0.4 * k);
        const rot = dt * (38 - 11 * i) * (i % 2 ? -1 : 1) + i * 40;
        const L = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
        return (
          <g key={i} transform={`rotate(${rot * 0.25} ${cx} ${cy})`}>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={20 - 4 * i} strokeDasharray={`${L * 0.3} ${L * 0.7}`} strokeDashoffset={-dt * (260 + 60 * i)} filter={`url(#${id}g)`} opacity={0.55 * k} />
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`url(#${id}s)`} strokeWidth={5 - i} strokeDasharray={`${L * 0.3} ${L * 0.7}`} strokeDashoffset={-dt * (260 + 60 * i)} opacity={0.95 * k} strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
};

/** Notes of a whistle or a song flying out of the picture towards (x, y). */
const Notes: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; x?: number; y?: number}> = ({t, t0, t1, fr, color, x: X = 140, y: Y = 700}) => {
  const id = sid(useId());
  const sx = fr.x + fr.w * 0.4;
  const sy = fr.y + fr.h * 0.42;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs><filter id={`${id}g`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="6" /></filter></defs>
      {Array.from({length: 8}, (_, i) => {
        const a = t0 + 0.5 * i;
        if (a > t1 - 1.4) return null;
        const k = clamp((t - a) / 3.4);
        if (k <= 0 || k >= 1) return null;
        const e = ease(k);
        const x = sx + (X - sx) * e + 26 * Math.sin(k * 9 + i);
        const y = sy + (Y - sy) * e - 120 * Math.sin(Math.PI * e) + 18 * Math.cos(k * 7 + i);
        const op = clamp(k / 0.12) * clamp((1 - k) / 0.3);
        const sc = (2.4 + 0.8 * rnd(i + 2)) * (0.5 + 0.5 * clamp(k / 0.25));
        const rot = -12 + 24 * Math.sin(k * 5 + i);
        const dbl = i % 3 === 1;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rot}) scale(${sc})`} opacity={op}>
            <g filter={`url(#${id}g)`} opacity={0.7}><ellipse cx={0} cy={0} rx={13} ry={9} transform="rotate(-20)" fill={color} /></g>
            <ellipse cx={0} cy={0} rx={12} ry={8.5} transform="rotate(-20)" fill="#2a1a10" stroke={color} strokeWidth={2} />
            <path d={`M 10 -3 L 10 -46 ${dbl ? 'L 40 -54 L 40 -11' : 'Q 26 -38 24 -20'}`} stroke="#2a1a10" strokeWidth={4} fill="none" strokeLinecap="round" />
            {dbl && <ellipse cx={30} cy={-8} rx={12} ry={8.5} transform="rotate(-20 30 -8)" fill="#2a1a10" stroke={color} strokeWidth={2} />}
          </g>
        );
      })}
    </svg>
  );
};

/** Options of a figure coming out of the picture. */
export interface FigureOpt {
  src?: string;
  x?: number;
  y?: number;
  w?: number;
  mode?: 'sale' | 'salpa' | 'scende';
  exit?: 'rientra' | 'svanisce';
  glow?: string;
}
const qbez = (a: number, b: number, c: number, k: number) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * b + k * k * c;

/** A cut-out figure leaves the picture with a flash and a trail of light, lives in the hall, and goes back (or fades). */
const Apparition: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; o: FigureOpt}> = ({t, t0, t1, fr, color, o}) => {
  const id = sid(useId());
  if (!o.src || t < t0 - 0.05 || t > t1 + 0.6) return null;
  const mode = o.mode ?? 'sale';
  const glow = o.glow ?? color;
  const cx0 = fr.x + fr.w / 2;
  const cy0 = fr.y + fr.h * 0.5;
  const X = o.x ?? cx0;
  const Y = o.y ?? fr.y + fr.h + 150;
  const W = o.w ?? 380;
  const IN = mode === 'salpa' ? 2.2 : 1.8;
  const OUT = 1.5;
  const dt = t - t0;
  const kin = ease(clamp(dt / IN));
  const back = o.exit === 'svanisce' ? 0 : ease(clamp((t - (t1 - OUT)) / OUT));
  const k = kin * (1 - back);
  const vx = mode === 'salpa' ? Math.min(cx0, X) - 140 : (cx0 + X) / 2 + 90;
  const vy = mode === 'scende' ? Math.max(cy0, Y) + 60 : Math.min(cy0, Y) - 170;
  const live = clamp(dt / IN) * (1 - back);
  const bob = mode === 'salpa' ? 14 * Math.sin(dt * 1.7) : 10 * Math.sin((dt * 2 * Math.PI) / 3.4);
  const x = qbez(cx0, vx, X, k) + (mode === 'salpa' ? 26 * Math.sin(dt * 0.55) * live : 0);
  const y = qbez(cy0, vy, Y, k) + bob * live;
  const rot = (mode === 'salpa' ? 3.2 * Math.sin(dt * 1.7 + 0.6) : 1.6 * Math.sin(dt * 1.3)) * live + (1 - k) * (mode === 'salpa' ? -14 : 8);
  const s = 0.16 + 0.84 * k;
  const fade = o.exit === 'svanisce' ? 1 - ease(clamp((t - (t1 - 1.1)) / 1.1)) : 1 - clamp((t - (t1 - 0.25)) / 0.25);
  const op = clamp(dt / 0.3) * fade;
  const mat = 1 - ease(clamp((dt - 0.2) / (IN * 0.8)));
  const flash = Math.max(Math.exp(-((dt - 0.18) ** 2) / 0.05), o.exit === 'svanisce' ? 0 : Math.exp(-((t - t1 + 0.15) ** 2) / 0.05));
  const trail = Math.sin(Math.PI * clamp(dt / (IN * 1.1))) * (1 - back) + Math.sin(Math.PI * back) * 0.8;
  const H = W * 1.05;
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs>
          <radialGradient id={`${id}F`}><stop offset="0" stopColor="#fffbea" stopOpacity="1" /><stop offset=".35" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></radialGradient>
          <filter id={`${id}B`}><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        {flash > 0.01 && <ellipse cx={cx0} cy={cy0} rx={fr.w * 0.85} ry={fr.h * 0.7} fill={`url(#${id}F)`} opacity={0.95 * flash} />}
        {trail > 0.01 && (
          <g filter={`url(#${id}B)`} opacity={0.85 * trail}>
            <path d={`M${cx0} ${cy0} Q${vx} ${vy} ${x} ${y}`} stroke={glow} strokeWidth="34" fill="none" strokeLinecap="round" opacity=".55" />
            <path d={`M${cx0} ${cy0} Q${vx} ${vy} ${x} ${y}`} stroke="#fffbea" strokeWidth="10" fill="none" strokeLinecap="round" />
          </g>
        )}
        <ellipse cx={x} cy={y + H * 0.12} rx={W * 0.62 * s} ry={H * 0.5 * s} fill={`url(#${id}F)`} opacity={(0.32 + 0.08 * Math.sin(dt * 2.4)) * op} />
      </svg>
      <Img src={o.src} style={{position: 'absolute', left: x - W / 2, top: y - H / 2, width: W, height: H, objectFit: 'contain', opacity: op, transform: `rotate(${rot}deg) scale(${s},${s})`, transformOrigin: '50% 60%', filter: `brightness(${1 + 1.6 * mat}) saturate(${1.15 - 0.4 * mat}) drop-shadow(0 0 3px #fffdf2) drop-shadow(0 0 3px #fffdf2) drop-shadow(0 0 22px ${glow}) drop-shadow(16px 26px 12px rgba(40,22,10,${0.3 * k}))`}} />
    </div>
  );
};

/** A translucent presence leaves the picture, floats like a veil, and dissolves rising (or goes back). */
const Ghost: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; o: FigureOpt}> = ({t, t0, t1, fr, color, o}) => {
  const id = sid(useId());
  if (t < t0 - 0.05 || t > t1 + 0.8) return null;
  const glow = o.glow ?? (color === '#ffffff' ? '#7fa6d9' : color);
  const dt = t - t0;
  const cx0 = fr.x + fr.w / 2;
  const cy0 = fr.y + fr.h * 0.5;
  const X = o.x ?? fr.x + fr.w * 0.2;
  const Y = o.y ?? fr.y + fr.h + 170;
  const W = o.w ?? 330;
  const H = W * 1.25;
  const IN = 2.4;
  const OUT = 2.0;
  const kin = ease(clamp(dt / IN));
  const back = o.exit === 'rientra' ? ease(clamp((t - (t1 - OUT)) / OUT)) : 0;
  const k = kin * (1 - back);
  const vx = (cx0 + X) / 2 - 60;
  const vy = Math.min(cy0, Y) - 120;
  const live = clamp(dt / IN);
  const out = o.exit === 'rientra' ? 0 : ease(clamp((t - (t1 - OUT)) / OUT));
  const x = qbez(cx0, vx, X, k) + 34 * Math.sin(dt * 0.7) * live;
  const y = qbez(cy0, vy, Y, k) + 16 * Math.sin(dt * 1.3) * live - 90 * out;
  const s = (0.3 + 0.7 * k) * (1 + 0.08 * out);
  const flickr = 0.86 + 0.14 * Math.sin(dt * 11) * Math.sin(dt * 3.7);
  const op = clamp(dt / 0.6) * (1 - out) * (o.exit === 'rientra' ? 1 - clamp((t - (t1 - 0.3)) / 0.3) : 1) * flickr;
  const seed = Math.floor(dt * 12) % 97;
  const bf = 0.01 + 0.004 * Math.sin(dt * 1.1);
  const fig = (dx: number, dy: number, a: number, key: string) =>
    o.src ? (
      <Img key={key} src={o.src} style={{position: 'absolute', left: x - W / 2 + dx, top: y - H / 2 + dy, width: W, height: H, objectFit: 'contain', opacity: a, transform: `scale(${s},${s})`, transformOrigin: '50% 70%', filter: `url(#${id}w) grayscale(1) sepia(.35) hue-rotate(175deg) saturate(1.6) brightness(1.08) contrast(1.05) drop-shadow(0 0 2px rgba(30,50,90,.55)) drop-shadow(0 0 18px ${glow})`}} />
    ) : (
      <svg key={key} width={W} height={H} viewBox="0 0 200 250" style={{position: 'absolute', left: x - W / 2 + dx, top: y - H / 2 + dy, opacity: a, transform: `scale(${s},${s})`, transformOrigin: '50% 70%', overflow: 'visible', filter: `url(#${id}w) drop-shadow(0 0 2px rgba(30,50,90,.6)) drop-shadow(0 0 16px ${glow})`}}>
        <defs><linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4f8ff" stopOpacity=".97" /><stop offset=".5" stopColor="#b9cff0" stopOpacity=".85" /><stop offset=".8" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></linearGradient></defs>
        <path d={`M100 18 C70 18 56 44 58 74 C40 96 34 140 30 196 C44 ${214 + 8 * Math.sin(dt * 2)} 60 ${238 + 6 * Math.sin(dt * 2.6)} 78 ${226 + 8 * Math.sin(dt * 1.7)} C92 ${244 + 6 * Math.sin(dt * 2.2)} 108 ${244 + 6 * Math.sin(dt * 1.9)} 122 ${226 + 8 * Math.sin(dt * 2.4)} C140 ${238 + 6 * Math.sin(dt * 1.5)} 156 ${214 + 8 * Math.sin(dt * 2.1)} 170 196 C166 140 160 96 142 74 C144 44 130 18 100 18Z`} fill={`url(#${id}g)`} />
        <path d="M58 92 C42 120 34 150 26 170 M142 92 C158 120 166 150 174 170" stroke={glow} strokeOpacity=".5" strokeWidth="6" fill="none" strokeLinecap="round" />
        <ellipse cx="88" cy="66" rx="6" ry="9" fill="#2b3550" opacity=".55" />
        <ellipse cx="112" cy="66" rx="6" ry="9" fill="#2b3550" opacity=".55" />
      </svg>
    );
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <svg width="0" height="0" style={{position: 'absolute'}}><filter id={`${id}w`} x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency={`${bf} ${bf * 2.2}`} numOctaves="2" seed={seed} /><feDisplacementMap in="SourceGraphic" scale={10 + 8 * (1 - k)} xChannelSelector="R" yChannelSelector="G" /></filter></svg>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs><radialGradient id={`${id}m`}><stop offset="0" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></radialGradient><filter id={`${id}b`}><feGaussianBlur stdDeviation="14" /></filter></defs>
        <ellipse cx={cx0} cy={cy0} rx={fr.w * 0.7} ry={fr.h * 0.55} fill={`url(#${id}m)`} opacity={0.6 * Math.exp(-((dt - 0.4) ** 2) / 0.4)} />
        <path d={`M${cx0} ${cy0} Q${vx} ${vy} ${x} ${y}`} stroke={glow} strokeWidth="60" fill="none" strokeLinecap="round" filter={`url(#${id}b)`} opacity={0.35 * Math.sin(Math.PI * clamp(dt / (IN * 1.3)))} />
        <ellipse cx={x} cy={y + H * 0.42 * s} rx={W * 0.55 * s} ry={40 * s} fill={`url(#${id}m)`} opacity={0.5 * op} />
      </svg>
      {fig(-26 * Math.sin(dt * 0.7), 10, op * 0.18, 'e2')}
      {fig(-13 * Math.sin(dt * 0.7), 5, op * 0.32, 'e1')}
      {fig(0, 0, op * 0.82, 'f')}
    </div>
  );
};

// --------------------------------------------------------------- the catalogues
/** The effects a picture may carry: drawn inside the screen, and some also in the hall. */
export const PICTURE_FX = ['nebbia', 'vento', 'acqua', 'bagliore', 'fuoco', 'riflesso', 'uccelli', 'fulmini', 'sussulto'] as const;
export type PictureFx = (typeof PICTURE_FX)[number];

/** Inside the screen (w × h: the screen's inner size). */
export const pictureFx = (name: PictureFx, c: FxContext & {w: number; h: number}): React.ReactNode => {
  const live = (fx: LiveFx) => <LivingFx fx={fx} t={c.t} t0={c.t0} w={c.w} h={c.h} c={c.color} fog={c.textures.fog} />;
  switch (name) {
    case 'nebbia': return live('fog');
    case 'vento': return live('wind');
    case 'acqua': return live('water');
    case 'bagliore': return live('glow');
    case 'fuoco': return live('embers');
    case 'riflesso': return live('sweep');
    case 'uccelli': return live('birds');
    case 'fulmini': return <Lightning t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} room={false} w={c.w} h={c.h} />;
    case 'sussulto': return <Tremor t={c.t} t0={c.t0} fr={c.frame} color={c.color} room={false} w={c.w} h={c.h} />;
  }
};

/** What a picture's effect does in the hall, around the screen (null for those that stay inside). */
export const pictureFxInRoom = (name: PictureFx, c: FxContext): React.ReactNode => {
  switch (name) {
    case 'vento': return <LivingFx fx="wind" t={c.t} t0={c.t0} w={1080} h={1920} c={c.color} room={c.frame} />;
    case 'acqua': return <Caustics t={c.t} fr={c.frame} texture={c.textures.caustics} />;
    case 'fuoco': return <LivingFx fx="embers" t={c.t} t0={c.t0} w={1080} h={1920} c={c.color} room={c.frame} />;
    case 'uccelli': return <Birds t={c.t} t0={c.t0} fr={c.frame} n={12} />;
    case 'fulmini': return <Lightning t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} room />;
    case 'sussulto': return <Tremor t={c.t} t0={c.t0} fr={c.frame} color={c.color} room />;
    default: return null;
  }
};

/** The effects that live in the hall on their own (a room-effect item each). */
export const ROOM_FX = ['nebbia-sala', 'vapore', 'note', 'uccelli', 'foglie', 'incanto', 'apparizione', 'fantasma'] as const;
export type RoomFx = (typeof ROOM_FX)[number];

export const roomFx = (name: RoomFx, c: FxContext & {figure: FigureOpt}): React.ReactNode => {
  switch (name) {
    case 'nebbia-sala': return <RoomMist t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color === '#ffffff' ? '#dfe8ff' : c.color} fog={c.textures.fog} />;
    case 'vapore': return <Steam t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} />;
    case 'note': return <Notes t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color === '#ffffff' ? '#ffd38a' : c.color} {...(c.figure.x !== undefined ? {x: c.figure.x} : {})} {...(c.figure.y !== undefined ? {y: c.figure.y} : {})} />;
    case 'uccelli': return <Birds t={c.t} t0={c.t0} fr={c.frame} n={12} />;
    case 'foglie': return <Leaves t={c.t} t0={c.t0} fr={c.frame} />;
    case 'incanto': return <Spell t={c.t} t0={c.t0} fr={c.frame} color={c.color} />;
    case 'apparizione': return <Apparition t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} o={c.figure} />;
    case 'fantasma': return <Ghost t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} o={c.figure} />;
  }
};
````

Create `packages/remotion-composer/src/kits/museum-hall/1.0.0.tsx`:

````tsx
// museum-hall@1.0.0 — released: never edit this file; add museum-hall/<next>.tsx instead.
// The hall of "Dentro i versi · short" (CreativeStudio's sala8): the room, the
// glass installation screen with the poem's pictures and their slow camera,
// the pictures' effects inside the screen and out in the hall, the lightning,
// the lights per stanza and the dark with its pools of light (on the screen
// and on the actor), the pedestal, wind, shatter, and the blackout with its
// bolt. Everything inside the hall moves with the shared camera.
import React from 'react';
import {AbsoluteFill, Img, interpolateColors, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {clamp, ease, envelope, maxOf, mix, ramp, rnd2, type Envelope} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, EnvelopeSchema, FlashSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Glass, LiveBolt, PICTURE_FX, Shatter, pictureCamera, pictureFx, pictureFxInRoom, strikeAt, type Box, type PictureFx} from '../lib/hall-fx/1.0.0.js';
import {HALL} from '../lib/dentro-i-versi/1.0.0.js';

interface Picture {src: string; at: number; scale: number; origin: string; move: {dx: number; dy: number; z: number; r: number}; fx: PictureFx[]; spill: string}
interface Light {at: number; dark: number; spot: string; w: number}

/** Wind through the hall: streaks and leaves crossing to the right. */
const WindIn: React.FC<{t: number; k: number}> = ({t, k}) => {
  if (k <= 0) return null;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, opacity: Math.min(1, k)}}>
      {Array.from({length: 12}, (_, i) => {
        const sp = 700 + rnd2(i * 3) * 700, len = 160 + rnd2(i * 5) * 280, x = ((rnd2(i * 7) * 1500 + t * sp) % 1500) - 200, y = 300 + rnd2(i * 11) * 1100, a = 16 * Math.sin(t * 2 + i);
        return <path key={i} d={`M${x} ${y} q ${len * 0.5} ${a} ${len} ${len * 0.08}`} stroke="#ffffff" strokeWidth={1.5 + rnd2(i) * 2.5} fill="none" strokeLinecap="round" opacity={0.25 + 0.45 * rnd2(i * 17)} />;
      })}
      {Array.from({length: 16}, (_, i) => {
        const sp = 420 + rnd2(i * 23) * 520, x = ((rnd2(i * 29) * 1500 + t * sp) % 1500) - 150, y = 260 + rnd2(i * 31) * 1250 + Math.sin(t * 3 + i) * 50;
        return <ellipse key={'l' + i} cx={x} cy={y} rx={13} ry={5.5} fill={i % 3 ? '#7fae6a' : '#c2a95a'} transform={`rotate(${(t * 360 * (1 + rnd2(i))) % 360} ${x} ${y})`} opacity=".9" />;
      })}
    </svg>
  );
};

const MuseumHall: KitVersion['component'] = ({props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const fr = props.screen as Box;
  const pictures = props.pictures as Picture[];
  const camera = props.camera as Camera;
  const strikes = (props.flash as {strikes: number[]}).strikes;
  const lights = [...(props.lights as Light[])].sort((a, b) => a.at - b.at);
  const blackout = props.blackout as Envelope | undefined;
  const bolt = props.bolt as {at: number; dur: number} | undefined;
  const wind = (props.wind as Envelope[] | undefined) ?? [];
  const shatter = (props.shatter as {at: number; picture: number; dur: number}[] | undefined) ?? [];
  const actor = props.actor as {x: number; scale: number; liveFrom: number; liveTo: number};
  const textures = (props.textures as {fog?: string; caustics?: string} | undefined) ?? {};
  const iw = fr.w - 20;
  const ih = fr.h - 20;

  const fl = strikeAt(t, strikes);
  const lightAt = () => {
    let i = 0;
    while (i + 1 < lights.length && t >= lights[i + 1]!.at) i++;
    const a = lights[i]!, b = lights[Math.min(i + 1, lights.length - 1)]!;
    const k = b === a ? 0 : ease(clamp((t - a.at) / Math.max(0.01, b.at - a.at)));
    return {dark: 0.38 * mix(a.dark, b.dark, k), col: interpolateColors(k, [0, 1], [a.spot, b.spot]), tint: '#0a1030', w: mix(a.w, b.w, k)};
  };
  const lt = lightAt();
  const bo = blackout ? envelope(t, blackout) : 0;
  const dark = Math.max(lt.dark, bo);
  const pcx = fr.x + fr.w / 2, pcy = fr.y + fr.h / 2;
  const ax = actor.x + 5 * Math.sin((2 * Math.PI * t) / 8.5) * actor.scale * ramp(t, actor.liveFrom, actor.liveTo);
  const curSpill = pictures.reduce((c, p) => (t >= p.at ? p.spill : c), pictures[0]!.spill);
  const shatterOf = (i: number) => shatter.find((s) => s.picture === i);
  const qop = (i: number) => {
    const a = pictures[i]!.at, b = i < pictures.length - 1 ? pictures[i + 1]!.at : 1e9;
    const inn = i === 0 ? 1 : ease(clamp((t - a) / 0.8));
    const out = 1 - ease(clamp((t - b) / 0.8));
    const sh = shatterOf(i);
    return clamp(inn * out) * (sh && t >= sh.at ? 0 : 1);
  };
  const end = 1e9;
  return (
    <AbsoluteFill style={{background: '#0b1030', overflow: 'hidden'}}>
      <AbsoluteFill style={cameraStyle(t, camera)}>
        <Img src={props.room as string} style={{position: 'absolute', inset: 0, width: 1080, height: 1920, filter: `brightness(${1 + fl * 0.2})`}} />
        <AbsoluteFill style={{mixBlendMode: 'screen', background: `radial-gradient(ellipse 900px 1500px at ${pcx}px ${pcy}px, rgba(210,225,255,${fl * 0.6}), rgba(210,225,255,0) 72%)`}} />
        <div style={{position: 'absolute', left: 0, right: 0, top: 1100, bottom: 0, mixBlendMode: 'screen', background: `linear-gradient(100deg, rgba(220,232,255,${fl * 0.4}) 0%, rgba(220,232,255,0) 55%)`}} />
        <Glass box={fr} t={t} flash={fl}>
          {pictures.map((p, i) => {
            const o = qop(i);
            const next = i < pictures.length - 1 ? pictures[i + 1]!.at : p.at + 40;
            return o <= 0 ? null : (
              <div key={i} style={{position: 'absolute', inset: 0, opacity: o}}>
                <Img src={p.src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transformOrigin: p.origin, ...pictureCamera(t, p.at, next, i === 0, p.scale, p.move)}} />
                {p.fx.map((n) => <React.Fragment key={n}>{pictureFx(n, {t, t0: p.at, t1: end, frame: fr, color: p.spill, textures, w: iw, h: ih})}</React.Fragment>)}
              </div>
            );
          })}
        </Glass>
        {props.pedestal ? (
          <>
            <div style={{position: 'absolute', left: fr.x + 30, top: fr.y + fr.h + 6, width: fr.w - 60, height: 16, borderRadius: 8, background: 'linear-gradient(180deg, #ffffff, #cfe9ff)', boxShadow: `0 0 26px ${HALL.cyan}, 0 0 60px rgba(63,200,240,.5)`}} />
            <div style={{position: 'absolute', left: fr.x - 60, top: fr.y + fr.h + 10, width: fr.w + 120, height: 120, borderRadius: '50%', background: 'radial-gradient(ellipse at 50% 30%, rgba(160,225,255,.45), rgba(160,225,255,0) 70%)'}} />
          </>
        ) : null}
        <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}>
          <defs>
            <radialGradient id="hallHole"><stop offset="0" stopColor="#000" stopOpacity="1" /><stop offset=".55" stopColor="#000" stopOpacity=".85" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
            <mask id="hallSpots">
              <rect width="1080" height="1920" fill="#fff" />
              <ellipse cx={pcx} cy={pcy} rx={fr.w * 0.8} ry={fr.h * 0.66} fill="url(#hallHole)" />
              <ellipse cx={ax} cy={1480} rx={230 * lt.w} ry={470} fill="url(#hallHole)" />
            </mask>
          </defs>
          <rect width="1080" height="1920" fill={lt.tint} opacity={dark * (1 - fl * 0.7)} mask={bo > 0 ? undefined : 'url(#hallSpots)'} />
        </svg>
        <AbsoluteFill style={{mixBlendMode: 'soft-light', background: `radial-gradient(ellipse ${fr.w * 1.1}px ${fr.h * 0.8}px at ${pcx}px ${pcy}px, ${lt.col}, rgba(0,0,0,0) 72%), radial-gradient(ellipse ${220 * lt.w}px 460px at ${ax}px 1470px, ${lt.col}, rgba(0,0,0,0) 72%)`}} />
        <AbsoluteFill style={{mixBlendMode: 'screen', opacity: 0.14 + 0.26 * lt.dark, background: `radial-gradient(ellipse ${fr.w * 1.1}px ${fr.h * 0.8}px at ${pcx}px ${pcy + 200}px, ${curSpill}, rgba(0,0,0,0) 72%)`}} />
        {pictures.map((p, i) => {
          const nb = i < pictures.length - 1 ? pictures[i + 1]!.at : 1e9;
          const o = (i === 0 ? 1 : ease(clamp((t - p.at) / 1))) * (1 - ease(clamp((t - nb - 0.4) / 1.6)));
          if (o <= 0) return null;
          return <div key={'room' + i} style={{position: 'absolute', inset: 0, opacity: o}}>{p.fx.map((n) => <React.Fragment key={n}>{pictureFxInRoom(n, {t, t0: p.at, t1: end, frame: fr, color: p.spill, textures})}</React.Fragment>)}</div>;
        })}
        {shatter.map((s, i) => {
          const k = clamp((t - s.at) / s.dur);
          if (t < s.at || k >= 1) return null;
          const p = pictures[s.picture];
          return p ? <div key={'sh' + i} style={{position: 'absolute', inset: 0}}><Shatter src={p.src} box={{x: fr.x + 10, y: fr.y + 10, w: iw, h: ih}} k={ease(k)} /></div> : null;
        })}
        <WindIn t={t} k={maxOf(t, wind)} />
      </AbsoluteFill>
      {bo > 0 && <AbsoluteFill style={{background: `rgba(0,0,0,${bo})`}} />}
      {bolt && bo > 0 && t >= bolt.at && t < bolt.at + bolt.dur + 0.4 && (() => {
        const k = (t - bolt.at) / bolt.dur;
        const fl2 = k < 0.08 ? 1 : k < 0.16 ? 0.3 : k < 0.3 ? 0.9 : Math.max(0, Math.exp(-(k - 0.3) * 4) * 0.7);
        return (
          <>
            <AbsoluteFill style={{background: `rgba(200,215,255,${fl2 * 0.35})`}} />
            <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}><LiveBolt t={t} x0={700} y0={-20} x1={420} y1={1150} op={fl2} seed={13} grow={clamp(k * 5)} /></svg>
          </>
        );
      })()}
    </AbsoluteFill>
  );
};

const Props = z.object({
  room: AssetUrl,
  screen: BoxSchema,
  pictures: z.array(z.object({
    src: AssetUrl,
    /** Seconds from the item's start; the first is shown from the start. */
    at: z.number().min(0),
    scale: z.number().positive(),
    origin: z.string().min(1),
    move: z.object({dx: z.number(), dy: z.number(), z: z.number(), r: z.number()}).strict(),
    fx: z.array(z.enum(PICTURE_FX)),
    spill: z.string().min(1),
  }).strict()).min(1),
  camera: CameraSchema,
  flash: FlashSchema,
  /** The hall's light per stanza: how dark, the colour of the spots, how wide the actor's pool. */
  lights: z.array(z.object({at: z.number(), dark: z.number().min(0).max(1), spot: z.string().min(1), w: z.number().positive()}).strict()).min(1),
  blackout: EnvelopeSchema.optional(),
  bolt: z.object({at: z.number(), dur: z.number().positive()}).strict().optional(),
  wind: z.array(EnvelopeSchema).optional(),
  shatter: z.array(z.object({at: z.number(), picture: z.number().int().min(0), dur: z.number().positive()}).strict()).optional(),
  pedestal: z.boolean().optional(),
  /** Where the actor stands, for the pool of light that follows it. */
  actor: z.object({x: z.number(), scale: z.number().positive(), liveFrom: z.number(), liveTo: z.number()}).strict(),
  /** Textures the fog, wind and water effects draw with. */
  textures: z.object({fog: AssetUrl.optional(), caustics: AssetUrl.optional()}).strict().optional(),
}).strict();

const sample = (extra: Record<string, unknown> = {}) => ({
  room: {$asset: 'room'},
  screen: {x: 360, y: 215, w: 620, h: 910},
  pictures: [
    {src: {$asset: 'pic-a'}, at: 0, scale: 1.07, origin: '50% 40%', move: {dx: -10, dy: -14, z: 0.15, r: -0.16}, fx: ['nebbia'], spill: '#b9a8ff'},
    {src: {$asset: 'pic-b'}, at: 4, scale: 1.07, origin: '50% 40%', move: {dx: 14, dy: -8, z: 0.16, r: 0.14}, fx: ['vento', 'acqua'], spill: '#8fd3ff'},
  ],
  camera: {origin: [600, 1100], zoom: [{from: 0.5, to: 9, rampIn: 6, rampOut: 1.4, amount: 0.025}], shake: []},
  flash: {strikes: [3.95]},
  lights: [{at: 0, dark: 0.05, spot: '#eaf4ff', w: 1}],
  pedestal: true,
  actor: {x: 770, scale: 0.95, liveFrom: 0, liveTo: 0.8},
  textures: {fog: {$asset: 'fog'}, caustics: {$asset: 'caustics'}},
  ...extra,
});
const samples = {room: 'hall.png', 'pic-a': 'picture-a.png', 'pic-b': 'picture-b.png', fog: 'fog.png', caustics: 'caustics.png'};

export const kit: KitVersion = {
  name: 'museum-hall',
  version: '1.0.0',
  description: "A museum hall in a 9:16 frame: room, glass screen with the pictures and their slow camera, their effects inside and out, lightning, lights and dark, pedestal, wind, shatter and blackout, all under one shared camera.",
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: MuseumHall,
  examples: [
    {id: 'first-picture', props: sample(), samples, durationInFrames: 300, frame: 60},
    {id: 'lightning', props: sample(), samples, durationInFrames: 300, frame: 120},
    {id: 'second-picture', props: sample({wind: [{from: 5, to: 9, rampIn: 0.6, rampOut: 0.8, amount: 0.75}]}), samples, durationInFrames: 300, frame: 210},
    {id: 'shatter', props: sample({shatter: [{at: 6, picture: 1, dur: 1.5}]}), samples, durationInFrames: 300, frame: 195},
    {id: 'blackout', props: sample({blackout: {from: 5, to: 9.5, rampIn: 0.5, rampOut: 0.8, amount: 1}, bolt: {at: 5.7, dur: 0.75}}), samples, durationInFrames: 300, frame: 173},
  ],
};
````

The samples are generated placeholders: a sketched hall, flat pictures, noise textures.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/kits/samples/hall.png \
  packages/remotion-composer/kits/samples/picture-a.png \
  packages/remotion-composer/kits/samples/picture-b.png \
  packages/remotion-composer/kits/samples/fog.png \
  packages/remotion-composer/kits/samples/caustics.png
```

In `src/kits/index.ts`, import `museumHall100` from `./museum-hall/1.0.0.js` after the verse-plate import, and add it after `versePlate100` in `KIT_VERSIONS`.

- [ ] **Step 3: Lock, preview, tests**

Run: `npm run kits:lock`. The new entry must be `"museum-hall@1.0.0": "sha256:ba419b6ddb1b182fb86f923316246a4ef1848852437151d578634a16ff1ddcec"`.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/previews/museum-hall@1.0.0.vertical-1080x1920.png
```

Run: `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/lib/stage-props packages/remotion-composer/src/kits/lib/hall-fx \
  packages/remotion-composer/src/kits/museum-hall packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/kits/samples/hall.png packages/remotion-composer/kits/samples/picture-a.png \
  packages/remotion-composer/kits/samples/picture-b.png packages/remotion-composer/kits/samples/fog.png \
  packages/remotion-composer/kits/samples/caustics.png packages/remotion-composer/test/validate.test.ts \
  packages/remotion-composer/kits.lock.json packages/remotion-composer/previews/museum-hall@1.0.0.vertical-1080x1920.png
git commit -m "museum-hall kit: the hall, the installation screen, camera and hall effects (avg-dcf.3.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: interprete (avg-dcf.3.4)

**Files:**
- Create: `packages/remotion-composer/src/kits/lib/interprete/1.0.0.tsx`, `src/kits/interprete/1.0.0.tsx`, `previews/interprete@1.0.0.vertical-1080x1920.png`
- Modify: `src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`

- [ ] **Step 1: Write the failing test**

In `test/validate.test.ts`'s listing, add after `['clip', '1.0.0', 'fill'],`:

```ts
      ['interprete', '1.0.0', 'fill'],
```

The lesson excerpt (a 16:9 fixture) uses `interprete`. Once a 9:16 `interprete@1.0.0` exists, it is refused as `wrong-profile` rather than as unknown. Replace the start of "refuses kits it does not have, by name or by version" with:

```ts
  it('refuses kits it does not have, by name or by version', () => {
    // The lesson excerpt uses sala, interprete and verse-bar: sala and verse-bar do not exist yet,
    // and interprete@1.0.0 is drawn for 9:16 only (the long lesson's comes with avg-dcf.4).
    const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
    assert.deepEqual([...codes].sort(), ['unknown-kit', 'wrong-profile']);
```

Run it; expected FAIL.

- [ ] **Step 2: The puppet and the kit**

Create `packages/remotion-composer/src/kits/lib/interprete/1.0.0.tsx`:

````tsx
// interprete@1.0.0 — released: never edit this file; add interprete/<next>.tsx instead (ADR-0039).
// The interprete: an SVG actor or actress (CreativeStudio's characters/
// interprete), a purely visual figure on an angular pose rig. Whoever uses it
// works out pose, expression, gaze, mouth, blink, bow and liveliness from the
// time and passes them in. Rewritten clean: the palette travels as a value
// (never a module-level variable), so two figures in one frame never mix.

import React from 'react';

export interface Pose {
  /** Upper arm and forearm angles, left and right (degrees). */
  lu: number;
  lf: number;
  ru: number;
  rf: number;
  head: number;
  lean: number;
  /** 0 open hands, 1 fists. */
  grip: number;
  step: number;
  twist: number;
  dip: number;
}
export const REST: Pose = {lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0};

/** Gestures, merged with explicit angles. */
export const POSE_PRESETS: Record<string, Partial<Pose>> = {
  riposo: {},
  invoca: {lu: 20, lf: 54, ru: 20, rf: 54, head: -2, step: 1},
  'mani-al-cuore': {lu: 38, lf: 92, ru: 22, rf: 60, head: -4, lean: 2},
  indica: {ru: 126, rf: 140, head: 4},
  apre: {lu: 62, lf: 72, ru: 62, rf: 72, head: -4, step: 1},
  chiede: {lu: 56, lf: 72, ru: 56, rf: 72, head: -4, step: 1},
  dialoga: {lu: 34, lf: 88, ru: 34, rf: 88, head: -5, dip: 1},
  spalle: {lu: 24, lf: 110, ru: 24, rf: 110, head: -3, twist: 1},
  'braccio-alto': {lu: 66, lf: 78, ru: 20, rf: 58, head: -3, step: 1},
};

/** Eyebrows (inner, outer; left, right) and the resting smile. */
export interface Expr {
  li: number;
  lo: number;
  ri: number;
  ro: number;
  sm: number;
}
/** N neutral, A frowning, W amazed, I curious, M melancholy, S smiling. */
export const EXPR: Record<'N' | 'A' | 'W' | 'I' | 'M' | 'S', Expr> = {
  N: {li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25},
  A: {li: -6, lo: 3, ri: -6, ro: 3, sm: -0.5},
  W: {li: 7, lo: 6, ri: 7, ro: 6, sm: 0},
  I: {li: 7, lo: 5, ri: -2, ro: 0, sm: 0.8},
  M: {li: 6, lo: -3, ri: 6, ro: -3, sm: -0.6},
  S: {li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9},
};

export interface Palette {
  ink: string;
  shirt: string;
  shirtDark: string;
  vest: string;
  vestLight: string;
  button: string;
  inner: string;
  innerDark: string;
  skin: string;
  skinDark: string;
  trousers: string;
  shoe: string;
  sole: string;
  hair?: string;
  hairHi?: string;
  hairGloss?: string;
  lip?: string;
  freckles?: string;
}
/** Costumes: colours change with every poem, never period costumes. */
export const PALETTES: Record<string, Palette> = {
  'attore-saffo': {ink: '#2e2620', shirt: '#c52f87', shirtDark: '#8d1f60', vest: '#c52f87', vestLight: '#f064ad', button: '#164f56', inner: '#0799a5', innerDark: '#056a73', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#34373b', shoe: '#fafaf5', sole: '#dcd8cc'},
  'attore-infinito': {ink: '#2e2620', shirt: '#12a6b8', shirtDark: '#ff5a4e', vest: '#12a6b8', vestLight: '#0b7480', button: '#1d3a40', inner: '#ff5a4e', innerDark: '#d63c32', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#1b2a5c', shoe: '#fafaf5', sole: '#dcd8cc'},
  'attrice-saffo': {ink: '#2e2620', shirt: '#d26068', shirtDark: '#9f3e4b', vest: '#078c78', vestLight: '#55c9ae', button: '#f0bd43', inner: '#d26068', innerDark: '#9f3e4b', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#49334f', shoe: '#fafaf5', sole: '#dcd8cc'},
  'attrice-dante': {ink: '#2e2620', shirt: '#f2b632', shirtDark: '#c4860f', vest: '#1f4fbf', vestLight: '#5f8ae6', button: '#f7e6a6', inner: '#f2b632', innerDark: '#c4860f', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#2a2452', shoe: '#fafaf5', sole: '#dcd8cc', hair: '#3b2216', hairHi: '#6e4127', hairGloss: '#a06a43'},
};

export interface Gaze {
  x: number;
  y: number;
  h: number;
}

export type Variant = 'attore' | 'attrice';

const HAIR_DEFAULTS: Record<Variant, Required<Pick<Palette, 'hair' | 'hairHi' | 'hairGloss' | 'lip' | 'freckles'>>> = {
  attore: {hair: '#111214', hairHi: '#8fa6c9', hairGloss: '#ffffff', lip: '#7a4636', freckles: '#b96b4c'},
  attrice: {hair: '#ad4d2c', hairHi: '#f08a4b', hairGloss: '#ffd0a2', lip: '#a34258', freckles: '#b96b4c'},
};
/** A costume with the variant's hair, lips and freckles where it gives none. */
export const fullPalette = (p: Palette, v: Variant): Required<Palette> =>
  ({...HAIR_DEFAULTS[v], ...Object.fromEntries(Object.entries(p).filter(([, x]) => x !== undefined))}) as Required<Palette>;

const rad = (a: number) => (a * Math.PI) / 180;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
type C = Required<Palette>;

const finger = (c: C, x: number, w: number, len: number) => (
  <path d={`M${x} 9 L${x} ${len - 6} Q${x} ${len + 2.5} ${x + w / 2} ${len + 2.5} Q${x + w} ${len + 2.5} ${x + w} ${len - 6} L${x + w} 9 Z`} fill={c.skin} stroke={c.ink} strokeWidth="2.1" strokeLinejoin="round" />
);

/** Open hand (palm, four fingers, thumb) or fist. */
const Hand: React.FC<{c: C; side: number; grip: number}> = ({c, side, grip}) => (
  <g transform={`scale(${-side} 1)`}>
    {grip > 0.5 ? (
      <g>
        <path d="M-14 -5 Q0 -12 14 -5 L14 13 Q14 25 0 27 Q-14 25 -14 13 Z" fill={c.skin} stroke={c.ink} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M-12 -4 Q-9 -10 -6 -4 M-3 -4 Q0 -10 3 -4 M5 -4 Q8 -10 11 -4" fill="none" stroke={c.ink} strokeWidth="2" strokeLinecap="round" />
        <path d="M-14 8 Q-20 12 -18 19 Q-14 24 -8 22" fill={c.skin} stroke={c.ink} strokeWidth="2.2" strokeLinejoin="round" />
      </g>
    ) : (
      <g>
        <path d="M-15 -4 L15 -4 L15 7 Q16 15 8 17 L-8 17 Q-16 15 -15 7 Z" fill={c.skin} stroke={c.ink} strokeWidth="2.3" strokeLinejoin="round" />
        {finger(c, -13, 6.5, 27)}
        {finger(c, -6, 6.5, 32)}
        {finger(c, 1, 6.5, 28)}
        {finger(c, 8, 6.5, 21)}
        <path d="M-15 4 Q-21 2 -23 8 Q-23 15 -17 17 L-11 15 Q-14 11 -15 4 Z" fill={c.skin} stroke={c.ink} strokeWidth="2.1" strokeLinejoin="round" />
        <path d="M-7 0 L-7 13 M0 0 L0 14 M7 0 L7 12" stroke={c.skinDark} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
    )}
  </g>
);

const Arm: React.FC<{c: C; side: number; u: number; f: number; grip: number}> = ({c, side, u, f, grip}) => {
  const sx = side * 65;
  const sy = 179;
  const ex = sx + side * Math.sin(rad(u)) * 98;
  const ey = sy + Math.cos(rad(u)) * 98;
  const wx = ex + side * Math.sin(rad(f)) * 86;
  const wy = ey + Math.cos(rad(f)) * 86;
  return (
    <g>
      <path d={`M${sx} ${sy} L${ex} ${ey} L${wx} ${wy}`} fill="none" stroke={c.ink} strokeWidth="40" strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M${sx} ${sy} L${ex} ${ey} L${wx} ${wy}`} fill="none" stroke={c.shirt} strokeWidth="33" strokeLinejoin="round" strokeLinecap="round" />
      <g transform={`translate(${wx} ${wy}) rotate(${-side * f})`}>
        <Hand c={c} side={side} grip={grip} />
        <rect x="-18" y="-10" width="36" height="13" rx="4" fill={c.shirtDark} stroke={c.ink} strokeWidth="3" />
      </g>
    </g>
  );
};

const Shoe: React.FC<{c: C; x: number}> = ({c, x}) => (
  <g transform={`translate(${x} 614)`}>
    <path d="M-19 -18 Q0 -25 19 -18 L24 11 Q24 25 0 27 Q-24 25 -24 11Z" fill={c.shoe} stroke={c.ink} strokeWidth="3.8" />
    <path d="M-22 15 Q0 24 22 15 L23 22 Q0 33 -23 22Z" fill={c.sole} stroke={c.ink} strokeWidth="2.8" />
    <path d="M-9 -8 Q0 -12 9 -8" stroke="#55555c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
  </g>
);

export interface InterpreteProps {
  /** Seconds. */
  t: number;
  variant?: Variant;
  outfit?: 'gilet' | 'giacca';
  hairstyle?: 'coda' | 'corto';
  accessories?: {earrings?: boolean; freckles?: boolean};
  palette: Palette;
  pose: Pose;
  ex?: Expr;
  gaze?: Gaze;
  /** Mouth opening 0..9 (from the voice's energy). */
  mouth?: number;
  /** 0..1. */
  blink?: number;
  /** 0..1: the final bow. */
  thanks?: number;
  /** 0..1: the figure comes alive just before the first verse (still before). */
  live?: number;
  /** Where the figure's origin (its feet's line, ~1000 units high) goes, and its scale. */
  x: number;
  y: number;
  scale?: number;
}

/** Actor or actress: same geometry, same poses, different costume and hair. */
export const Interprete: React.FC<InterpreteProps> = ({t, variant = 'attore', outfit, hairstyle, accessories, palette, pose, ex = EXPR.N, gaze = {x: 0, y: 0, h: 0}, mouth = 0, blink = 0, thanks = 0, live = 1, x, y, scale = 1.2}) => {
  const c = fullPalette(palette, variant);
  const lx = -36;
  const rx = 36;
  // The weight passes slowly from one foot to the other; breathing keeps the figure alive between gestures.
  const sway = (5 * Math.sin((2 * Math.PI * t) / 8.5) + 2 * Math.sin((2 * Math.PI * t) / 13.1)) * live;
  const shift = (pose.lean + sway) * (1 - thanks);
  const breath = Math.sin((2 * Math.PI * t) / 3.6);
  const lk = (lx - 20 + shift - 56) / 2;
  const rk = (rx + 20 + shift + 56) / 2;
  const headRot = pose.head * (1 - thanks) + gaze.h + (1.2 * Math.sin(t * 1.1) + 0.7 * Math.sin(t * 0.53 + 1)) * live + 4 * pose.dip;
  const dipY = 12 * pose.dip;
  const lift = -1.8 * breath;
  const s = scale * (1 + 0.035 * pose.step);
  const brow = (side: number, inner: number, outer: number) => {
    const ox = side * 31;
    const ix = side * 12;
    return `M${ox} ${75 - outer} Q${side * 21} ${71 - (inner + outer) / 2} ${ix} ${74 - inner}`;
  };
  const A = variant === 'attrice';
  const style = hairstyle ?? (A ? 'coda' : 'corto');
  const dress = outfit ?? (A ? 'gilet' : 'giacca');
  const showEarrings = accessories?.earrings ?? A;
  const showFreckles = accessories?.freckles ?? A;
  return (
    <g transform={`translate(${x} ${y + 10 * pose.step}) scale(${s})`}>
      <path d={`M${shift - 56} 335 L${shift + 56} 335 L${rk} 461 L${rx + 21} 603 L${rx - 21} 603 L${rk - 42} 461 L${shift} 403 L${lk + 42} 461 L${lx + 21} 603 L${lx - 21} 603 L${lk} 461Z`} fill={c.trousers} stroke={c.ink} strokeWidth="4" strokeLinejoin="round" />
      <path d={`M${shift} 360 L${shift} 399`} fill="none" stroke="#4a4f58" strokeWidth="3" strokeLinecap="round" />
      <Shoe c={c} x={lx} />
      <Shoe c={c} x={rx} />
      <g transform={`translate(${shift} ${dipY}) rotate(${-2.5 * pose.twist} 0 340)`}>
        <g transform={`translate(0 350) scale(${(1 + 0.01 * thanks + 0.006 * breath) * (1 - 0.07 * pose.twist)} ${(1 - 0.07 * thanks) * (1 + 0.008 * breath)}) translate(0 -350)`}>
          {dress === 'gilet' ? (
            <>
              <path d="M-24 149 Q-45 150 -66 166 L-61 235 L-57 343 Q0 359 57 343 L61 235 L66 166 Q44 150 24 149Z" fill={c.shirt} stroke={c.ink} strokeWidth="4" strokeLinejoin="round" />
              <path d="M-30 154 Q-48 160 -51 181 L-46 338 Q0 351 46 338 L51 181 Q48 160 30 154 L18 153 Q0 184 -18 153Z" fill={c.vest} stroke={c.ink} strokeWidth="3.5" strokeLinejoin="round" />
              <path d="M-38 188 L-34 330 M38 188 L34 330 M-26 294 L26 294" stroke={c.vestLight} strokeWidth="2.4" strokeLinecap="round" opacity=".85" />
              {[226, 267, 308].map((yy) => <circle key={yy} cx="0" cy={yy} r="3.4" fill={c.button} stroke={c.ink} strokeWidth="1.5" />)}
              {[-42, -35, 35, 42].map((xx) => <path key={xx} d={`M${xx} 194 L${xx * 0.82} 329`} stroke={c.vestLight} strokeWidth="1.5" opacity=".5" />)}
              <path d="M-24 137 L-24 161 Q0 179 24 161 L24 137Z" fill={c.skin} stroke={c.ink} strokeWidth="3.5" />
              <path d="M-24 151 Q0 176 24 151" fill="none" stroke="#f49aa0" strokeWidth="5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M-24 149 Q-45 150 -66 166 L-61 235 L-57 343 Q0 359 57 343 L61 235 L66 166 Q44 150 24 149Z" fill={c.inner} stroke={c.ink} strokeWidth="4" strokeLinejoin="round" />
              <path d="M-22 156 Q-46 156 -58 168 L-56 346 Q-28 355 -3 352 L-3 268Z M22 156 Q46 156 58 168 L56 346 Q28 355 3 352 L3 268Z" fill={c.vest} stroke={c.ink} strokeWidth="3.5" strokeLinejoin="round" />
              <path d="M-48 290 L-26 290 M26 290 L48 290" stroke={c.vestLight} strokeWidth="3" strokeLinecap="round" />
              {[288, 312, 336].map((yy) => <circle key={yy} cx="-10" cy={yy} r="3.4" fill={c.button} stroke={c.ink} strokeWidth="1.5" />)}
              {[-50, -43, -36, -29, 36, 43, 50].map((xx) => <path key={xx} d={`M${xx} 190 L${xx} 338`} stroke={c.vestLight} strokeWidth="1.6" opacity=".55" />)}
              <path d="M-24 137 L-24 154 Q0 177 24 154 L24 137Z" fill={c.skin} stroke={c.ink} strokeWidth="3.5" />
              <path d="M-25 138 L25 138 L28 162 Q0 172 -28 162Z" fill={c.inner} stroke={c.ink} strokeWidth="3.2" strokeLinejoin="round" />
              {[-16, -8, 0, 8, 16].map((xx) => <path key={xx} d={`M${xx} 142 L${xx} 164`} stroke={c.innerDark} strokeWidth="2" />)}
            </>
          )}
          <g transform={`translate(0 ${5 * thanks + lift}) rotate(${headRot} 0 133) translate(0 133) scale(${1 + 0.02 * thanks}) translate(0 -133)`}>
            {style === 'coda' && (
              <>
                <path d="M-51 54 Q-60 9 0 5 Q61 5 52 56 L55 131 Q41 151 24 139 Q13 157 0 143 Q-14 158 -27 140 Q-44 151 -55 130Z" fill={c.hair} stroke={c.ink} strokeWidth="4" />
                <path d="M43 43 Q88 41 97 78 Q104 109 79 134 Q64 149 41 146 Q59 115 44 88Z" fill={c.hair} stroke={c.ink} strokeWidth="4" />
                <path d="M54 61 Q79 64 83 84 M55 85 Q75 93 75 111" fill="none" stroke={c.hairHi} strokeWidth="4" strokeLinecap="round" opacity=".88" />
              </>
            )}
            <ellipse cx="-48" cy="87" rx="10" ry="16" fill={c.skin} stroke={c.ink} strokeWidth="3.4" />
            <ellipse cx="48" cy="87" rx="10" ry="16" fill={c.skin} stroke={c.ink} strokeWidth="3.4" />
            <path d="M-47 54 Q-44 19 0 19 Q44 19 47 54 L45 103 Q38 140 0 144 Q-38 140 -45 103Z" fill={c.skin} stroke={c.ink} strokeWidth="4" />
            <path d="M-45 76 Q-62 39 -35 20 Q-16 5 8 14 Q42 3 52 33 Q59 55 44 76 L36 47 Q14 61 -9 44 Q-22 56 -41 53Z" fill={c.hair} stroke={c.ink} strokeWidth="3.5" strokeLinejoin="round" />
            {style === 'coda' ? (
              <path d="M-34 32 Q-14 14 14 18 M18 16 Q38 18 46 36 M-31 51 Q-17 58 -6 44" stroke={c.hairHi} strokeWidth="4.2" fill="none" strokeLinecap="round" opacity=".9" />
            ) : (
              <path d="M-34 32 Q-14 14 14 18 M18 16 Q38 18 46 36" stroke={c.hairHi} strokeWidth="4.2" fill="none" strokeLinecap="round" opacity=".85" />
            )}
            <path d="M-26 28 Q-12 20 4 22" stroke={c.hairGloss} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8" />
            <g>
              <path d={`${brow(-1, ex.li, ex.lo)} ${brow(1, ex.ri, ex.ro)}`} stroke={c.ink} strokeWidth="4.2" fill="none" strokeLinecap="round" />
              {blink > 0.6 ? (
                <path d="M-29 87 Q-22 92 -15 87 M15 87 Q22 92 29 87" fill="none" stroke={c.ink} strokeWidth="3.5" strokeLinecap="round" />
              ) : (
                <>
                  <ellipse cx="-22" cy="87" rx="8.5" ry="8.8" fill="#fffaf0" stroke={c.ink} strokeWidth="2.2" />
                  <ellipse cx="22" cy="87" rx="8.5" ry="8.8" fill="#fffaf0" stroke={c.ink} strokeWidth="2.2" />
                  <ellipse cx={-22 + gaze.x} cy={87 + gaze.y} rx="3.9" ry="5" fill={c.ink} />
                  <ellipse cx={22 + gaze.x} cy={87 + gaze.y} rx="3.9" ry="5" fill={c.ink} />
                </>
              )}
              <path d="M1 89 L-4 102 L4 103" fill="none" stroke={c.skinDark} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {mouth > 1 ? (
                <ellipse cx="0" cy="118" rx="10" ry={3 + mouth * 0.55} fill="#7a4636" />
              ) : (
                <path d={`M-12 ${117 - 3.5 * ex.sm} Q0 ${121 + 4 * ex.sm} 12 ${117 - 3.5 * ex.sm}`} stroke={c.lip} strokeWidth="3.5" fill="none" strokeLinecap="round" />
              )}
              {showFreckles && (
                <g fill={c.freckles} opacity=".72"><circle cx="-14" cy="103" r="1.2" /><circle cx="-8" cy="106" r="1.1" /><circle cx="9" cy="105" r="1.1" /><circle cx="15" cy="102" r="1.2" /></g>
              )}
              {showEarrings && (
                <>
                  <circle cx="-49" cy="111" r="5" fill="#e8b03d" stroke={c.ink} strokeWidth="2.2" />
                  <circle cx="49" cy="111" r="5" fill="#e8b03d" stroke={c.ink} strokeWidth="2.2" />
                </>
              )}
            </g>
          </g>
        </g>
        <g transform={`translate(0 ${lift * 0.6})`}>
          <Arm c={c} side={-1} u={mix(pose.lu, 3, thanks)} f={mix(pose.lf, 2, thanks)} grip={pose.grip} />
          <Arm c={c} side={1} u={mix(pose.ru, 3, thanks)} f={mix(pose.rf, 2, thanks)} grip={pose.grip} />
        </g>
      </g>
    </g>
  );
};
````

Create `packages/remotion-composer/src/kits/interprete/1.0.0.tsx`:

````tsx
// interprete@1.0.0 — released: never edit this file; add interprete/<next>.tsx instead.
// The actor of "Dentro i versi · short" (CreativeStudio's sala8): the SVG
// interprete in the hall's camera, above the verse plate (hands may pass in
// front of it, UP-56), with its contact shadow and its reflection on the
// floor, lit by the lightning, hidden by the blackout, teleporting in and
// out. Pose, expression, gaze, blinks, mouth (from the voice's energy),
// liveliness and bow are worked out here from the keyframes in its props.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {clamp, ease, envelope, mix, pulse, ramp, win, type Envelope} from '../lib/stage-math/1.0.0.js';
import {CameraSchema, EnvelopeSchema, FlashSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Teleport, strikeAt} from '../lib/hall-fx/1.0.0.js';
import {Interprete, REST, type Expr, type Palette, type Pose} from '../lib/interprete/1.0.0.js';

const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const EXPR_KEYS = ['li', 'lo', 'ri', 'ro', 'sm'] as const;

/** Keyframes held until the next one, blended into it over `blend` seconds (smootherstep). */
function keyed<T extends Record<string, number>>(keys: readonly string[], frames: {at: number; value: T}[], t: number, blend: number): T {
  let out = frames[0]!.value;
  for (let i = 1; i < frames.length; i++) {
    if (t < frames[i]!.at) break;
    const prev = frames[i - 1]!.value, next = frames[i]!.value, k = ramp(t, frames[i]!.at, frames[i]!.at + blend);
    out = Object.fromEntries(keys.map((key) => [key, mix(prev[key]!, next[key]!, k)])) as T;
  }
  return out;
}

interface Mouth {energy: {rate: number; values: number[]}; speech: [number, number][]; from: number; to: number}

const Actor: KitVersion['component'] = ({props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const camera = props.camera as Camera;
  const fl = strikeAt(t, (props.flash as {strikes: number[]}).strikes);
  const blackout = props.blackout as Envelope | undefined;
  const bo = blackout ? envelope(t, blackout) : 0;
  const x = props.x as number;
  const footY = (props.footY as number | undefined) ?? 1800;
  const scale = (props.scale as number | undefined) ?? 0.95;
  const poses = [...(props.poses as {at: number; pose: Pose}[])].sort((a, b) => a.at - b.at).map((p) => ({at: p.at, value: p.pose as unknown as Record<string, number>}));
  const expressions = [...(props.expressions as {at: number; ex: Expr}[])].sort((a, b) => a.at - b.at).map((e) => ({at: e.at, value: e.ex as unknown as Record<string, number>}));
  const gazes = (props.gaze as {from: number; to: number; x: number; y: number; h: number}[] | undefined) ?? [];
  const blinks = (props.blinks as number[] | undefined) ?? [];
  const liveW = props.live as {from: number; to: number};
  const bow = props.bow as {from: number; to: number};
  const mouthP = props.mouth as Mouth;
  const tp = (props.teleport as {in?: {at: number; dur: number}; out?: {at: number; dur: number}} | undefined) ?? {};

  const pose = (poses.length ? keyed(POSE_KEYS, poses, t, 0.6) : REST) as unknown as Pose;
  const ex = (expressions.length ? keyed(EXPR_KEYS, expressions, t, 0.5) : undefined) as unknown as Expr | undefined;
  const gaze = gazes.reduce((g, w) => {
    const k = win(t, w.from, w.to);
    return {x: g.x + w.x * k, y: g.y + w.y * k, h: g.h + w.h * k};
  }, {x: 0, y: 0, h: 0});
  const thanks = pulse(t, bow.from, bow.to);
  const live = ramp(t, liveW.from, liveW.to);
  const e = mouthP.energy.values.length ? mouthP.energy.values : [0];
  const ei = Math.round(t * mouthP.energy.rate);
  const speaking = t >= mouthP.from && t < mouthP.to && mouthP.speech.some(([a, b]) => t >= a && t <= b);
  const speech = speaking ? [-2, -1, 0, 1, 2].reduce((v, k) => v + (e[Math.max(0, Math.min(ei + k, e.length - 1))] || 0), 0) / 5 : 0;
  const mouth = Math.min(9, Math.max(0, speech - 0.045) * 12);
  const blink = blinks.reduce((v, a) => v + Math.sin(Math.PI * clamp((t - a) / 0.2)) ** 2, 0);
  const ax = x + 5 * Math.sin((2 * Math.PI * t) / 8.5) * scale * live;
  const tin = tp.in ? 1 - ease(clamp((t - tp.in.at) / tp.in.dur)) : 0;
  const tout = tp.out ? ease(clamp((t - tp.out.at) / tp.out.dur)) : 0;
  const holo = Math.max(tin, tout);
  const FY = footY;
  const figure = (
    <Interprete t={t} variant={props.variant as 'attore' | 'attrice'} outfit={props.outfit as 'gilet' | 'giacca' | undefined} hairstyle={props.hairstyle as 'coda' | 'corto' | undefined}
      accessories={props.accessories as {earrings?: boolean; freckles?: boolean} | undefined} palette={props.palette as Palette} pose={pose} {...(ex ? {ex} : {})} gaze={gaze}
      mouth={mouth} blink={blink} thanks={thanks} live={live} x={ax} y={FY - 641 * scale} scale={scale} />
  );
  if (bo >= 0.97) return null;
  return (
    <AbsoluteFill style={cameraStyle(t, camera)}>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, opacity: (1 - bo) ** 2}}>
        <defs>
          <filter id="actorSil" x="-50%" y="-50%" width="200%" height="200%"><feColorMatrix type="matrix" values="0 0 0 0 .06  0 0 0 0 .08  0 0 0 0 .2  0 0 0 1 0" /><feGaussianBlur stdDeviation="7" /></filter>
          <filter id="actorRefl"><feGaussianBlur stdDeviation="2" /></filter>
          <filter id="actorContact"><feGaussianBlur stdDeviation="5" /></filter>
          <linearGradient id="actorFade" gradientUnits="userSpaceOnUse" x1="0" y1={FY} x2="0" y2={FY + 140}><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id="actorReflMask"><rect x="0" y={FY - 4} width="1080" height="400" fill="url(#actorFade)" /></mask>
          <filter id="actorLit" x="-40%" y="-20%" width="180%" height="140%">
            <feComponentTransfer in="SourceGraphic" result="lit"><feFuncR type="linear" slope={1 + fl * 0.7} /><feFuncG type="linear" slope={1 + fl * 0.75} /><feFuncB type="linear" slope={1 + fl * 0.85} /></feComponentTransfer>
            <feGaussianBlur in="SourceAlpha" stdDeviation={6 + 6 * fl} result="halo" /><feFlood floodColor="#ffffff" floodOpacity={0.1 + 0.45 * fl} />
            <feComposite in2="halo" operator="in" result="glow" /><feMerge><feMergeNode in="glow" /><feMergeNode in="lit" /></feMerge>
          </filter>
        </defs>
        {holo < 1 && (
          <g opacity={1 - holo}>
            <g opacity=".22" transform={`translate(${ax} ${FY}) skewX(-30) scale(1 -.3) translate(${-ax} ${-FY})`}><g filter="url(#actorSil)">{figure}</g></g>
            <ellipse cx={ax + 6} cy={FY - 2} rx="78" ry="10" fill="#1a2250" opacity=".35" filter="url(#actorContact)" />
            <g mask="url(#actorReflMask)"><g opacity=".22" filter="url(#actorRefl)" transform={`translate(0 ${FY}) scale(1 -.6) translate(0 ${-FY})`}>{figure}</g></g>
          </g>
        )}
        {holo <= 0 ? <g filter="url(#actorLit)">{figure}</g> : holo < 1 && <Teleport t={t} k={holo} x={ax} h={641 * scale} w={300 * scale} floorY={FY}>{figure}</Teleport>}
      </svg>
    </AbsoluteFill>
  );
};

const PoseSchema = z.object(Object.fromEntries(POSE_KEYS.map((k) => [k, z.number()])) as Record<keyof Pose, z.ZodNumber>).strict();
const ExprSchema = z.object({li: z.number(), lo: z.number(), ri: z.number(), ro: z.number(), sm: z.number()}).strict();
const Window = z.object({from: z.number(), to: z.number()}).strict();
const color = z.string().min(1);
const PaletteSchema = z.object({ink: color, shirt: color, shirtDark: color, vest: color, vestLight: color, button: color, inner: color, innerDark: color, skin: color, skinDark: color, trousers: color, shoe: color, sole: color, hair: color.optional(), hairHi: color.optional(), hairGloss: color.optional(), lip: color.optional(), freckles: color.optional()}).strict();

const Props = z.object({
  variant: z.enum(['attore', 'attrice']),
  outfit: z.enum(['gilet', 'giacca']).optional(),
  hairstyle: z.enum(['coda', 'corto']).optional(),
  accessories: z.object({earrings: z.boolean().optional(), freckles: z.boolean().optional()}).strict().optional(),
  palette: PaletteSchema,
  x: z.number(),
  footY: z.number().positive().optional(),
  scale: z.number().positive().optional(),
  /** Full poses at their instants, blended over 0.6 s; the first holds from the start. */
  poses: z.array(z.object({at: z.number(), pose: PoseSchema}).strict()).min(1),
  /** Expressions at their instants, blended over 0.5 s. */
  expressions: z.array(z.object({at: z.number(), ex: ExprSchema}).strict()).min(1),
  gaze: z.array(z.object({from: z.number(), to: z.number(), x: z.number(), y: z.number(), h: z.number()}).strict()).optional(),
  blinks: z.array(z.number()).optional(),
  /** The figure comes alive over this window (still before). */
  live: Window,
  /** The bow, in and out over 0.9 s at each end. */
  bow: Window,
  /** The mouth follows the voice's energy (samples per second) while it speaks within [from, to). */
  mouth: z.object({energy: z.object({rate: z.number().positive(), values: z.array(z.number().min(0))}).strict(), speech: z.array(z.tuple([z.number(), z.number()])), from: z.number(), to: z.number()}).strict(),
  teleport: z.object({in: z.object({at: z.number(), dur: z.number().positive()}).strict().optional(), out: z.object({at: z.number(), dur: z.number().positive()}).strict().optional()}).strict().optional(),
  camera: CameraSchema,
  flash: FlashSchema,
  blackout: EnvelopeSchema.optional(),
}).strict();

const REST_POSE = {lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0};
const sample = (extra: Record<string, unknown> = {}) => ({
  variant: 'attore',
  outfit: 'gilet',
  palette: {ink: '#2e2620', shirt: '#eef2ff', shirtDark: '#c3cbe8', vest: '#eef2ff', vestLight: '#ffffff', button: '#5fdcff', inner: '#ffbf5e', innerDark: '#e09a2e', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#283066', shoe: '#fafaf5', sole: '#dcd8cc'},
  x: 770,
  poses: [{at: 0, pose: REST_POSE}, {at: 3, pose: {...REST_POSE, lu: 20, lf: 54, ru: 20, rf: 54, head: -2, step: 1}}, {at: 6, pose: {...REST_POSE, ru: 126, rf: 140, head: 4}}],
  expressions: [{at: 0, ex: {li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25}}, {at: 3, ex: {li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9}}],
  gaze: [{from: 4, to: 5.4, x: 3.5, y: -3, h: 5}],
  blinks: [1.1, 3.6, 6.2],
  live: {from: 1, to: 1.8},
  bow: {from: 8.5, to: 10.7},
  mouth: {energy: {rate: 30, values: Array.from({length: 330}, (_, i) => 0.05 + 0.25 * Math.abs(Math.sin(i / 2.3)))}, speech: [[2, 8]], from: 2, to: 8},
  teleport: {in: {at: 0.35, dur: 1}, out: {at: 9.8, dur: 0.95}},
  camera: {origin: [600, 1100], zoom: [{from: 2, to: 9, rampIn: 6, rampOut: 1.4, amount: 0.025}], shake: []},
  flash: {strikes: [5.2]},
  ...extra,
});

export const kit: KitVersion = {
  name: 'interprete',
  version: '1.0.0',
  description: "The poem's SVG actor in a 9:16 museum hall: poses, expressions, gaze, blinks and a mouth that follows the voice, its shadow and reflection, the lightning on it, the blackout, the bow, the teleport in and out — in the hall's shared camera.",
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: Actor,
  examples: [
    {id: 'reciting', props: sample(), durationInFrames: 330, frame: 120},
    {id: 'teleport-in', props: sample(), durationInFrames: 330, frame: 25},
    {id: 'pointing-lit', props: sample(), durationInFrames: 330, frame: 157},
    {id: 'bow', props: sample(), durationInFrames: 330, frame: 285},
  ],
};
````

In `src/kits/index.ts`, import `interprete100` from `./interprete/1.0.0.js` after the museum-hall import, and add it after `museumHall100` in `KIT_VERSIONS`.

- [ ] **Step 3: Lock, preview, tests**

Run: `npm run kits:lock`. The new entry must be `"interprete@1.0.0": "sha256:e2feca893785f4304bde643096037edd303ca3dc9e979c5c79019a1e3e1ee40d"`.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/previews/interprete@1.0.0.vertical-1080x1920.png
```

Run: `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/lib/interprete packages/remotion-composer/src/kits/interprete \
  packages/remotion-composer/src/kits/index.ts packages/remotion-composer/test/validate.test.ts \
  packages/remotion-composer/kits.lock.json packages/remotion-composer/previews/interprete@1.0.0.vertical-1080x1920.png
git commit -m "interprete kit: the SVG actor — poses, expressions, mouth from the voice, bow, teleport (avg-dcf.3.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: room-effect, and the composer README (avg-dcf.3.5)

**Files:**
- Create: `packages/remotion-composer/src/kits/room-effect/1.0.0.tsx`, `kits/samples/figure.png`, `previews/room-effect@1.0.0.vertical-1080x1920.png`
- Modify: `src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`, `packages/remotion-composer/README.md`

- [ ] **Step 1: Write the failing test**

In `test/validate.test.ts`'s listing, add after `['museum-hall', '1.0.0', 'fill'],`:

```ts
      ['room-effect', '1.0.0', 'fill'],
```

Run it; expected FAIL.

- [ ] **Step 2: The kit**

Create `packages/remotion-composer/src/kits/room-effect/1.0.0.tsx`:

````tsx
// room-effect@1.0.0 — released: never edit this file; add room-effect/<next>.tsx instead.
// One named effect living in the museum hall (CreativeStudio's roomFx): fog
// pouring over the floor, steam, the notes of a whistle, birds, falling
// leaves, ribbons of light, a cut-out figure coming out of the picture
// (apparizione) or a ghost. Drawn in the hall's shared camera, around its
// screen, hidden by the blackout. Effects that stay in the hall fade in over
// 0.6 s and out over 0.8 s; figures make their own entrance and exit.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {envelope, ramp, type Envelope} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, EnvelopeSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {ROOM_FX, roomFx, type Box, type FigureOpt, type RoomFx} from '../lib/hall-fx/1.0.0.js';

/** Figures and notes come out in front of the screen and keep their own timing. */
const FRONT: ReadonlySet<RoomFx> = new Set<RoomFx>(['note', 'apparizione', 'fantasma']);

const RoomEffect: KitVersion['component'] = ({props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const effect = props.effect as RoomFx;
  const start = (props.start as number | undefined) ?? 0;
  const end = props.end as number;
  const blackout = props.blackout as Envelope | undefined;
  const bo = blackout ? envelope(t, blackout) : 0;
  const figure = (props.figure as FigureOpt | undefined) ?? {};
  const drawn = roomFx(effect, {t, t0: start, t1: end, frame: props.screen as Box, color: (props.color as string | undefined) ?? '#ffffff', textures: (props.textures as {fog?: string} | undefined) ?? {}, figure});
  const o = FRONT.has(effect) ? 1 : ramp(t, start, start + 0.6) * (1 - ramp(t, end - 0.8, end));
  if (o <= 0 || bo >= 1) return null;
  return (
    <AbsoluteFill style={cameraStyle(t, props.camera as Camera)}>
      <AbsoluteFill style={{opacity: o * (1 - bo)}}>{drawn}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const Props = z.object({
  effect: z.enum(ROOM_FX),
  color: z.string().min(1).optional(),
  /** When the effect starts and ends, in seconds from the item's start. */
  start: z.number().min(0).optional(),
  end: z.number().positive(),
  screen: BoxSchema,
  camera: CameraSchema,
  blackout: EnvelopeSchema.optional(),
  textures: z.object({fog: AssetUrl.optional()}).strict().optional(),
  /** For apparizione and fantasma: the cut-out, where it settles (x, y, w), how it moves and leaves; for note: where the notes fly (x, y). */
  figure: z.object({
    src: AssetUrl.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().positive().optional(),
    mode: z.enum(['sale', 'salpa', 'scende']).optional(),
    exit: z.enum(['rientra', 'svanisce']).optional(),
    glow: z.string().min(1).optional(),
  }).strict().optional(),
}).strict().superRefine((p, ctx) => {
  if (p.effect === 'apparizione' && !p.figure?.src) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['figure', 'src'], message: 'an apparizione needs its cut-out'});
  if (p.effect === 'nebbia-sala' && !p.textures?.fog) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['textures', 'fog'], message: 'nebbia-sala draws with the fog texture'});
});

const base = {screen: {x: 360, y: 215, w: 620, h: 910}, camera: {origin: [600, 1100], zoom: [], shake: []}};
export const kit: KitVersion = {
  name: 'room-effect',
  version: '1.0.0',
  description: 'One named effect in a 9:16 museum hall — fog over the floor, steam, notes, birds, leaves, ribbons of light, a figure or a ghost coming out of the picture — in the shared camera.',
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: RoomEffect,
  examples: [
    {id: 'apparizione', props: {...base, effect: 'apparizione', end: 7, figure: {src: {$asset: 'figure'}, x: 190, y: 760, w: 360, mode: 'sale', exit: 'rientra', glow: '#ff6a8a'}}, samples: {figure: 'figure.png'}, durationInFrames: 240, frame: 90},
    {id: 'nebbia-sala', props: {...base, effect: 'nebbia-sala', end: 6, color: '#dfe8ff', textures: {fog: {$asset: 'fog'}}}, samples: {fog: 'fog.png'}, durationInFrames: 180, frame: 90},
    {id: 'incanto', props: {...base, effect: 'incanto', end: 5, color: '#ffb347'}, durationInFrames: 150, frame: 60},
    {id: 'note', props: {...base, effect: 'note', end: 5, color: '#ffd38a', figure: {x: 230, y: 640}}, durationInFrames: 150, frame: 70},
    {id: 'fantasma', props: {...base, effect: 'fantasma', end: 7, figure: {x: 250, y: 900, w: 330, exit: 'svanisce', glow: '#dfe6ff'}}, durationInFrames: 210, frame: 100},
    {id: 'vapore', props: {...base, effect: 'vapore', end: 5, color: '#c2185b'}, durationInFrames: 150, frame: 60},
    {id: 'uccelli', props: {...base, effect: 'uccelli', end: 6}, durationInFrames: 180, frame: 75},
    {id: 'foglie', props: {...base, effect: 'foglie', end: 6}, durationInFrames: 180, frame: 75},
  ],
};
````

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/kits/samples/figure.png
```

In `src/kits/index.ts`, import `roomEffect100` from `./room-effect/1.0.0.js` after the interprete import, and add it after `interprete100`. The array must end up:

```ts
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([
  still100, clip100, captions100, captions110,
  brandMark100, lowerThird100, titleChip100, versePlate100, museumHall100, interprete100, roomEffect100,
]);
```

- [ ] **Step 3: Lock, preview, tests, README**

Run: `npm run kits:lock`. The new entry must be `"room-effect@1.0.0": "sha256:b7935b0e8d5ab955c0151f4339ee3c60ed1b434209af36b673cc3b3f1c926294"`. Run `git diff --exit-code 99a6b41 -- kits.lock.json src/kits`: the lock and every kit and module now equal the prototype's.

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  packages/remotion-composer/previews/room-effect@1.0.0.vertical-1080x1920.png
```

````diff
diff --git a/packages/remotion-composer/README.md b/packages/remotion-composer/README.md
index 9cf5895..9cf3e87 100644
--- a/packages/remotion-composer/README.md
+++ b/packages/remotion-composer/README.md
@@ -28,8 +28,26 @@ Kits in this version: `still@1.0.0`, `clip@1.0.0`, `captions@1.0.0`, and
 `captions@1.1.0`, which keeps its text inside the profile's safe zone and cuts
 text that does not fit at the zone's edge (keep captions short). A
 timeline gets exactly the version it names; `listKits(profileIds)` gives each
-version's description, layer, examples and a preview per profile
-(`previews/<name>@<version>.<profile>.png`).
+version's description, layer, profiles, examples and a preview per profile
+it is drawn for (`previews/<name>@<version>.<profile>.png`).
+
+The Dentro i versi short's kits (CreativeStudio's `sala8`, drawn for
+`vertical-1080x1920` only; ADR-0039):
+
+| Kit | Layer | What it draws |
+|---|---|---|
+| `museum-hall@1.0.0` | fill | The hall: room image, the screen with its pictures, their camera moves and picture effects, lightning, lights and spill, wind, shatter, pedestal, blackout and its bolt |
+| `room-effect@1.0.0` | fill | One effect in the room, inside the camera: `nebbia-sala`, `vapore`, `note`, `uccelli`, `foglie`, `incanto`, `apparizione` (a cut-out figure), `fantasma` |
+| `verse-plate@1.0.0` | overlay | A verse on its plate, words lit as they are said, strong words bold, the paraphrase under it |
+| `interprete@1.0.0` | fill | The actor: poses, expressions, gaze, blinks, the mouth from the voice's energy, teleport in and out, the bow |
+| `lower-third@1.0.0` | overlay | The title card: kicker, Anton title on one or two lines, growing cyan rule, author |
+| `title-chip@1.0.0` | overlay | The compact title · author chip |
+| `brand-mark@1.0.0` | overlay | The «DENTRO I VERSI» mark |
+
+They share frozen library modules in `src/kits/lib/` — `stage-math`,
+`fonts`, `stage-props`, `hall-fx`, `interprete`, `dentro-i-versi` (the
+palette) — and load Anton, Fraunces and Inter from `@fontsource` 5.3.0
+before the first frame.
 
 ## Adding a kit or a version
 
@@ -38,24 +56,31 @@ was. A change — even a fix — is a new version next to the old one.
 
 1. Write `src/kits/<name>/<version>.tsx` exporting `kit: KitVersion` (name,
    version, one-sentence description, zod `props`, `component`, `examples`).
-   It may import only `react`, `remotion`, `zod`, and types (`import type`)
-   from `../types.js`: shared runtime code changing would silently change old
-   versions. For a new version, copy the previous file and edit the copy.
+   It may import only `react`, `remotion`, `zod`, types (`import type`)
+   from `../types.js`, and frozen library modules by exact version
+   (`../lib/<name>/<x.y.z>.js`, ADR-0039): ordinary shared code changing would
+   silently change old versions. A library module keeps the same rule (and
+   may load an `@fontsource` font file with a dynamic `import()`); a change
+   to one is a new module version. For a new version, copy the previous file
+   and edit the copy. A kit drawn for some output profiles only lists them
+   in `profiles`; elsewhere a timeline using it is refused (`wrong-profile`).
    A kit that draws text or graphics over the picture declares
    `layer: "overlay"` and lays itself out inside `context.profile.safeZone`.
 2. Give it at least one example: props as a timeline writes them, a
    `durationInFrames`, the `frame` to preview, and `samples` mapping its
    `$asset` ids to files in `kits/samples/`.
 3. Add it to `KIT_VERSIONS` in `src/kits/index.ts`.
-4. `npm run kits:lock` records the file's sha256 in `kits.lock.json` (it
+4. `npm run kits:lock` records the kit's hash in `kits.lock.json` — the
+   file's sha256, or, when it imports library modules, the sha256 over the
+   file and every module it reaches, path and bytes in sorted order (it
    never rewrites an existing entry); `npm run kits:previews` renders the
-   first example in every output profile to
+   first example in every output profile the kit is drawn for to
    `previews/<name>@<version>.<profile>.png` (a third of the size: 640×360,
    360×640). Commit both.
 5. `npm test` checks the metadata, the self-contained imports and the lock
    — including that every version locked on `origin/main` (or
    `$KITS_LOCK_BASE`) is still there, unchanged — and renders one real frame
-   of every example in every output profile. An overlay kit is drawn on a
+   of every example in every output profile it is drawn for. An overlay kit is drawn on a
    transparent background, and the box of what it drew must lie inside the
    profile's safe zone; the failure says by how many pixels and on which side.
 
````

Run: `npm run typecheck && npm test && npm run build`. Expected: PASS. The build is what `@studio/series` validates kits against in Task 8.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/room-effect packages/remotion-composer/src/kits/index.ts \
  packages/remotion-composer/kits/samples/figure.png packages/remotion-composer/test/validate.test.ts \
  packages/remotion-composer/kits.lock.json packages/remotion-composer/previews/room-effect@1.0.0.vertical-1080x1920.png \
  packages/remotion-composer/README.md
git commit -m "room-effect kit: the effects that come out of the pictures, apparitions included (avg-dcf.3.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Episodes offer sounds; takes carry the voice's energy

**Files:**
- Modify:
  - `studio/episode/src/series-compile.ts`, `studio/episode/src/speech-align.ts`, `studio/episode/src/take-align.ts`;
  - `studio/episode/tests/series-compile.test.ts`, `studio/episode/tests/take-align.test.ts`;
  - `studio/episode/README.md`, `docs/adr/0038-word-timing-comes-from-forced-alignment.md`.

**Interfaces:**
- Produces:
  - `loadEpisode` offers `sound-<name>` (kind `audio`) for `assets/sounds/*`;
  - `measureEnergy(audioPath, durationSeconds): Promise<{rate: 30, values: number[]}>`;
  - `ENERGY_RATE`;
  - `alignTake` writes `energy` into the WordTiming.

- [ ] **Step 1: Write the failing tests**

````diff
diff --git a/studio/episode/tests/series-compile.test.ts b/studio/episode/tests/series-compile.test.ts
index 5ea431d..2ecc523 100644
--- a/studio/episode/tests/series-compile.test.ts
+++ b/studio/episode/tests/series-compile.test.ts
@@ -193,6 +193,29 @@ describe("loadEpisode", () => {
     expect(Object.keys(loaded.input.inputs)).toHaveLength(13);
     expect(Object.keys(loaded.input.assets).sort()).toEqual(["image-cat", "image-morning-room", "image-teacup", "narration-cup", "narration-light"]);
   });
+
+  it("offers every sound in assets/sounds as sound-<name>, hashed", () => {
+    mkdirSync(at("assets/sounds"), { recursive: true });
+    writeFileSync(at("assets/sounds/applause.wav"), "clapping");
+    writeFileSync(at("assets/sounds/Thunder.MP3"), "rumble");
+    writeFileSync(at("assets/sounds/credits.txt"), "who recorded what");
+    writeFileSync(at("assets/sounds/.DS_Store"), "finder");
+    const loaded = loadEpisode(dir(), { episodeRef: REF });
+    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
+    expect(loaded.input.assets["sound-applause"]).toEqual({ path: "assets/sounds/applause.wav", hash: sha256("clapping"), kind: "audio" });
+    expect(loaded.input.assets["sound-Thunder"]?.path).toBe("assets/sounds/Thunder.MP3");
+    expect(loaded.input.inputs["assets/sounds/applause.wav"]).toBe(sha256("clapping"));
+    expect(Object.keys(loaded.input.assets).filter((id) => id.startsWith("sound-")).sort()).toEqual(["sound-Thunder", "sound-applause"]);
+  });
+
+  it("ambiguous-asset: two files for one sound", () => {
+    mkdirSync(at("assets/sounds"), { recursive: true });
+    writeFileSync(at("assets/sounds/applause.wav"), "clapping");
+    writeFileSync(at("assets/sounds/applause.mp3"), "clapping again");
+    const loaded = loadEpisode(dir(), { episodeRef: REF });
+    expect(loaded.ok).toBe(false);
+    if (!loaded.ok) expect(loaded.problems.map((p) => [p.code, p.path])).toEqual([["ambiguous-asset", "assets/sounds/applause.wav"]]);
+  });
 });
 
 describe("checkEpisode", () => {
diff --git a/studio/episode/tests/take-align.test.ts b/studio/episode/tests/take-align.test.ts
index e6b9188..1063432 100644
--- a/studio/episode/tests/take-align.test.ts
+++ b/studio/episode/tests/take-align.test.ts
@@ -85,6 +85,14 @@ describe("alignTake with the local aligner", () => {
     for (const w of timing.words) expect(w.end <= pauseStart + 0.001 || w.start >= pauseEnd - 0.001).toBe(true);
     expect(result.pauses).toHaveLength(1);
     expect(result.pauses[0]).toBeGreaterThan(0.5);
+    // The voice's energy, 30 samples a second, for the actor's mouth: loud in the tones, nothing in the pause.
+    expect(timing.energy.rate).toBe(30);
+    expect(timing.energy.values).toHaveLength(Math.round(timing.audio.durationSeconds * 30));
+    expect(Math.max(...timing.energy.values)).toBe(1);
+    const sample = (t: number) => timing.energy.values[Math.floor(t * 30)];
+    expect(sample(0.5)).toBeGreaterThan(0.5);
+    expect(sample((pauseStart + pauseEnd) / 2)).toBe(0);
+    expect(sample(2.2)).toBeGreaterThan(0.5);
 
     const after = takes();
     expect(after.takes[0].timing).toEqual({ path: "artifacts/timing/light.json", hash: sha256(readFileSync(at(result.path))) });
````

Run: `cd studio/episode && npx vitest run tests/series-compile.test.ts tests/take-align.test.ts`
Expected: FAIL. No `sound-*` asset is offered, and `timing.energy` is undefined.

- [ ] **Step 2: Implement**

````diff
diff --git a/studio/episode/src/series-compile.ts b/studio/episode/src/series-compile.ts
index dc80d39..892ecec 100644
--- a/studio/episode/src/series-compile.ts
+++ b/studio/episode/src/series-compile.ts
@@ -19,7 +19,11 @@ import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } fr
 import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
 
 export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
-const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
+/** What the loader offers from assets/: every file in each folder, as <prefix>-<name>. */
+const OFFERED = [
+  { dir: "images", prefix: "image", kind: "image", extensions: [".png", ".jpg", ".jpeg", ".webp"] },
+  { dir: "sounds", prefix: "sound", kind: "audio", extensions: [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"] },
+] as const;
 
 /** Located as `<file relative to the episode>#<JSON path>`, or a bare file. */
 export interface SeriesCompileProblem {
@@ -236,22 +240,25 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     timings[take.id] = timing;
   });
 
-  // ── Images ────────────────────────────────────────────────────────────────
-  // Every picture in assets/images is offered as image-<name>; the compiler
-  // says which it needs. Two files with one name is a choice nobody made.
-  const imagesDir = join(episodeDir, "assets", "images");
-  const images = existsSync(imagesDir)
-    ? readdirSync(imagesDir, { withFileTypes: true })
-      .filter((e) => !e.isDirectory() && !e.name.startsWith(".") && IMAGE_EXTENSIONS.includes(extname(e.name).toLowerCase()))
-      .map((e) => e.name)
-      .sort()
-    : [];
-  for (const file of images) {
-    const id = `image-${file.slice(0, -extname(file).length)}`;
-    const path = `assets/images/${file}`;
-    if (assets[id]) stop("ambiguous-asset", path, `${assets[id].path} and ${path} are both ${id.slice(6)}: keep one`);
-    read(join(episodeDir, path), episodeDir, () => stop("missing-asset", path, `${path} is missing`));
-    assets[id] = { path, hash: inputs[path]!, kind: "image" };
+  // ── Images and sounds ─────────────────────────────────────────────────────
+  // Every picture in assets/images is offered as image-<name>, every sound in
+  // assets/sounds as sound-<name>; the compiler says which it needs. Two files
+  // with one name is a choice nobody made.
+  for (const { dir, prefix, kind, extensions } of OFFERED) {
+    const folder = join(episodeDir, "assets", dir);
+    const files = existsSync(folder)
+      ? readdirSync(folder, { withFileTypes: true })
+        .filter((e) => !e.isDirectory() && !e.name.startsWith(".") && (extensions as readonly string[]).includes(extname(e.name).toLowerCase()))
+        .map((e) => e.name)
+        .sort()
+      : [];
+    for (const file of files) {
+      const id = `${prefix}-${file.slice(0, -extname(file).length)}`;
+      const path = `assets/${dir}/${file}`;
+      if (assets[id]) stop("ambiguous-asset", path, `${assets[id].path} and ${path} are both ${id.slice(prefix.length + 1)}: keep one`);
+      read(join(episodeDir, path), episodeDir, () => stop("missing-asset", path, `${path} is missing`));
+      assets[id] = { path, hash: inputs[path]!, kind };
+    }
   }
 
   return { ok: true, input: { spec, template, narration, timings, assets, inputs }, releaseKey };
diff --git a/studio/episode/src/speech-align.ts b/studio/episode/src/speech-align.ts
index bf94318..9d2c8f0 100644
--- a/studio/episode/src/speech-align.ts
+++ b/studio/episode/src/speech-align.ts
@@ -243,3 +243,34 @@ export async function measureSilences(audioPath: string): Promise<{ silences: [n
   if (durationSeconds - at > 0.02) speech.push([ms(at), ms(durationSeconds)]);
   return { silences, speech, durationSeconds };
 }
+
+/** Samples per second of a take's energy envelope. */
+export const ENERGY_RATE = 30;
+/** Decoded at this sample rate to measure it. */
+const ENERGY_SAMPLE_RATE = 24000;
+
+/**
+ * The voice's loudness over time — RMS per 1/30 s, divided by the loudest —
+ * for what moves with the voice (an actor's mouth). As many samples as the
+ * take lasts at ENERGY_RATE, the last padded with silence.
+ */
+export async function measureEnergy(audioPath: string, durationSeconds: number): Promise<{ rate: number; values: number[] }> {
+  let pcm: Buffer;
+  try {
+    ({ stdout: pcm } = await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", audioPath, "-ac", "1", "-ar", String(ENERGY_SAMPLE_RATE), "-f", "s16le", "-"],
+      { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }));
+  } catch (error) {
+    throw new AlignError("bad-audio", `ffmpeg could not read ${audioPath}: ${(error as Error).message}`);
+  }
+  const step = ENERGY_SAMPLE_RATE / ENERGY_RATE;
+  const total = pcm.length >> 1;
+  const rms = Array.from({ length: Math.round(durationSeconds * ENERGY_RATE) }, (_, i) => {
+    let sum = 0;
+    const end = Math.min(total, (i + 1) * step);
+    for (let j = i * step; j < end; j++) sum += (pcm.readInt16LE(j * 2) / 32768) ** 2;
+    return end > i * step ? Math.sqrt(sum / (end - i * step)) : 0;
+  });
+  const peak = Math.max(0, ...rms);
+  return { rate: ENERGY_RATE, values: rms.map((v) => (peak > 0 ? ms(v / peak) : 0)) };
+}
+
diff --git a/studio/episode/src/take-align.ts b/studio/episode/src/take-align.ts
index ee387d4..c4fd9fa 100644
--- a/studio/episode/src/take-align.ts
+++ b/studio/episode/src/take-align.ts
@@ -18,7 +18,7 @@ import { dirname, isAbsolute, join, relative, resolve } from "node:path";
 import { ELEVENLABS_PROFILES, ElevenLabsError, forcedAlignment } from "@av/elevenlabs";
 import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
 import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
-import { AlignError, mapToText, measureSilences, snapToSilences, type RawWord } from "./speech-align.js";
+import { AlignError, mapToText, measureEnergy, measureSilences, snapToSilences, type RawWord } from "./speech-align.js";
 
 export const TAKES_PATH = "artifacts/narration/takes.json";
 /** Where a take's timing goes when takes.json names none. */
@@ -165,6 +165,7 @@ export async function alignTake(episodeDir: string, options: AlignTakeOptions):
   const { words, unmapped } = mapToText(take.text, aligned.words);
   const measured = await measureSilences(audioPath);
   const timed = snapToSilences(words, measured.silences, measured.durationSeconds);
+  const energy = await measureEnergy(audioPath, take.audio.durationSeconds);
 
   const timing = {
     apiVersion: "studio.video/v1alpha1",
@@ -177,6 +178,7 @@ export async function alignTake(episodeDir: string, options: AlignTakeOptions):
     alignment: { provider, model: aligned.model, method: "forced", createdAt: new Date().toISOString() },
     words: timed,
     speech: measured.speech,
+    energy,
   };
   const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
   if (timingProblems.length > 0) {
````

- [ ] **Step 3: Run them to make sure they pass**

Run: `npx vitest run tests/series-compile.test.ts tests/take-align.test.ts tests/speech-align.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Docs**

````diff
diff --git a/docs/adr/0038-word-timing-comes-from-forced-alignment.md b/docs/adr/0038-word-timing-comes-from-forced-alignment.md
index 13ca9e5..4bb6206 100644
--- a/docs/adr/0038-word-timing-comes-from-forced-alignment.md
+++ b/docs/adr/0038-word-timing-comes-from-forced-alignment.md
@@ -72,3 +72,6 @@ run 19–43 s.
   unmatched.
 - Verifying a take against its text (missing words, long pauses) is
   `avg-8hs.3`; this only reports the pauses over 0.35 s.
+- Added with `avg-dcf.3`: the timing also carries the take's energy — RMS
+  per 1/30 s, divided by the loudest — measured with ffmpeg, whatever the
+  provider; what moves with the voice (the interprete's mouth) reads it.
diff --git a/studio/episode/README.md b/studio/episode/README.md
index d891985..9a52e48 100644
--- a/studio/episode/README.md
+++ b/studio/episode/README.md
@@ -16,14 +16,14 @@ adapters both call this package, so a tool and a stage never disagree.
 | `narration-manifest.ts` | The canonical `artifacts/narration/narration-manifest.json`: build, measure, validate, write |
 | `scene-images.ts` | Scene images in reading order and their lengths (legacy episodes) |
 | `edit-timeline-builder.ts` | `buildEditTimeline`: the timeline of an episode without a spec |
-| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules |
+| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules; offers `assets/images/*` as `image-<name>` and `assets/sounds/*` as `sound-<name>` |
 | `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
 | `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |
 | `references.ts` | `proposeReference`: freeze an episode as a proposed golden reference |
 | `sheet-instants.ts` | `sheetInstants`: the frames a layout sheet shows, from the timeline and the release's `sheet` rules (pure) |
 | `layout-sheet.ts` | `makeLayoutSheet`, `layoutSheetStatus`: `artifacts/layout-sheet/`, and whether it still shows what a render would use |
 | `version-diff.ts` | `alignInstants`, `measure`, `judge`: which frames two versions compare, how different they are, the verdict (pure) |
-| `speech-align.ts` | `mapToText`, `snapToSilences`, `measureSilences`: a provider's words made into a take's words (ADR-0038) |
+| `speech-align.ts` | `mapToText`, `snapToSilences`, `measureSilences`, `measureEnergy`: a provider's words made into a take's words, and the take's energy (ADR-0038) |
 | `take-align.ts` | `alignTake`: a take's WordTiming by forced alignment, local or ElevenLabs, written beside it and named in `takes.json` |
 | `version-compare.ts` | `compareVersions`: two renders, or a render and a golden reference, decoded with ffmpeg at the same instants, into `reviews/compare/<old>--<new>/` |
 
````

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/series-compile.ts studio/episode/src/speech-align.ts studio/episode/src/take-align.ts \
  studio/episode/tests/series-compile.test.ts studio/episode/tests/take-align.test.ts studio/episode/README.md \
  docs/adr/0038-word-timing-comes-from-forced-alignment.md
git commit -m "Episodes offer assets/sounds as sound-<name>; alignTake writes the voice's energy (avg-dcf.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The compiler `dentro-i-versi-short@1.0.0` and its template release (avg-dcf.3.6)

**Files:**
- Create:
  - `studio/series/src/compilers/dentro-i-versi-short/1.0.0.ts`, `studio/series/test/dentro-i-versi-short.test.ts`;
  - `studio/series/fixtures/dentro-i-versi-short/1.0.0/{input.json, expected-timeline.json}`;
  - `studio/series/fixtures/dentro-i-versi-short/1.0.0/release/{series-template.json, episode-spec.schema.json, episode-spec.template.json, FORMAT.md}`.
- Modify: `studio/series/src/registry.ts`

**Interfaces:**
- Consumes: the seven kits (validated against the composer's `dist/`, built in Task 6).
- Produces:
  - `compiler` `dentro-i-versi-short@1.0.0`;
  - tracks `hall`, `room-N`, `verses-N`, `actor`, `card`, `chip`, `brand`, `voice`, `sfx-N`, `applause`, `music`;
  - sections `title`, `verse-N`, `bow`;
  - `metadata.voiceEnd`.

- [ ] **Step 1: The fixture and the release**

The fixture is a synthetic San Martino. Its text, data and the recital's word timing and energy come from CreativeStudio's San Martino short; the title's words are synthetic, and the hashes are placeholders. The release's schema and manifest were generated (the manifest pins the other files' hashes), so take them as they are:

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 99a6b41 -- \
  studio/series/fixtures/dentro-i-versi-short/1.0.0/input.json \
  studio/series/fixtures/dentro-i-versi-short/1.0.0/release/series-template.json \
  studio/series/fixtures/dentro-i-versi-short/1.0.0/release/episode-spec.schema.json \
  studio/series/fixtures/dentro-i-versi-short/1.0.0/release/episode-spec.template.json \
  studio/series/fixtures/dentro-i-versi-short/1.0.0/release/FORMAT.md
```

`release/FORMAT.md` and `release/episode-spec.template.json` read:

Create `studio/series/fixtures/dentro-i-versi-short/1.0.0/release/FORMAT.md`:

````markdown
# Dentro i versi · short — version 1.0.0

Rewritten from CreativeStudio's `poesie-museo-short` standard (version 1.4.0,
runtime `sala8`; approved references San Martino and Il lampo). Compiler and
validator: `dentro-i-versi-short@1.0.0`.

## Standard

The style, direction, script and edit are final: every episode reproduces
the references and only the poem's data changes. A requested change needs a
new template version and its reason written here.

- **Contract.** Italian; 1080×1920 at 30 fps; 25–90 s. No host, no call to
  action. The first and the last frame are the empty hall with the title, so
  the video loops. Structure: the title said, the whole poem recited in a
  science-fiction museum hall, applause.
- **Hall.** A white room without windows (`hall.room`), a vertical screen
  (620×910 at x 360, y 215) with the poem's pictures and their slow camera
  moves; lightning in the hall only at picture changes.
- **Titles.** The «DENTRO I VERSI» mark; a dark lower third (kicker, Anton
  title on one or two lines, cyan rule, author) at the opening and at the
  bow, never wider than the space left of the actor; a compact title chip
  during the poem. No information nobody asked for (dates, feasts,
  anecdotes).
- **Verses.** One plate per verse at the bottom left, Fraunces italic: the
  whole verse visible, words not yet said dimmed then lit, strong words in
  bold violet; the paraphrase (Inter) readable from the verse's start until
  the next verse. No movement or glow.
- **Actor.** The interprete in the costume the spec gives, x 770, scale
  0.95, inside the camera and above the plates (hands may pass in front of a
  plate, never off screen). Teleport in under the title and out after the
  bow, each with a magic sound.
- **Cover.** The first picture is also the thumbnail: strong and readable
  small.
- **Effects.** Chosen from the text, rich but sober in movement: `wind`
  (wind, storm), `shake` (a start, a scream), `shatter` (ruin), `blackout`
  and `bolt` (dark, night); in the room, two apparitions of at least 5 s
  (cut-out silhouettes, free area on the left, away from the body) and
  scene effects born from the poem's images (`nebbia-sala`, `vapore`,
  `note`, `foglie`, `uccelli`, `incanto`). One sound per effect.
- **Voice.** A female voice says the title; a male voice recites the poem
  in one take with the exact text on screen; about 1 s between title and
  poem; measured pauses between verses, longer at the end of a stanza.

## Procedure

Instantiate the pinned draft and fill every `__FILL__`: the poem's verses
with strong words and paraphrase, the pictures (`assets/images`) with their
times and effects, the actor's costume, poses, expressions and gazes, the
lights, the hall's effects, the room effects, the sounds
(`assets/sounds`), applause and music. Times are seconds or `verse:N`,
`verseEnd:N`, `word:parola`, `end`, `picture:N`, each with an optional
`±seconds`. Record the title and recital takes in the unit `recital` (title
first), align them, compile, review the layout sheet (teleports,
apparitions, every verse), render, and seek the user's approval before
publishing. Never invent approval or silently change the voice or profile.
````

Create `studio/series/fixtures/dentro-i-versi-short/1.0.0/release/episode-spec.template.json`:

````json
{
  "title": "__FILL__",
  "author": "__FILL__",
  "verses": [
    {
      "text": "__FILL__",
      "strong": [],
      "gloss": "__FILL__"
    }
  ],
  "pictures": [
    {
      "assetId": "__FILL__",
      "fx": []
    }
  ],
  "actor": {
    "variant": "__FILL__"
  },
  "poses": [],
  "expressions": "__FILL__",
  "gaze": [],
  "lights": [],
  "hall": {
    "room": "__FILL__",
    "pedestal": true,
    "teleport": {
      "in": [
        0.35,
        1.0
      ],
      "out": [
        "end+4.85",
        0.95
      ]
    },
    "wind": [],
    "shake": [],
    "shatter": []
  },
  "roomFx": [],
  "sfx": [],
  "applause": {
    "assetId": "__FILL__"
  }
}
````

- [ ] **Step 2: Write the failing test**

Create `studio/series/test/dentro-i-versi-short.test.ts`:

````ts
// What dentro-i-versi-short@1.0.0 does with a spec and its takes. The
// fixture is a synthetic San Martino with CreativeStudio's timing: the title
// take (3 s) from 0.3 s, a 0.69 s pause, the recital from 3.99 s; its first
// word "La" at 4.09 s, its last, "migrar.", ends at 31.63 s — the end of the
// voice. The video lasts until 6 s later: 37.63 s, 1129 frames.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "dentro-i-versi-short", "1.0.0", "input.json");
const load = (): CompileInput & { spec: { data: any }; narration: any } => JSON.parse(readFileSync(FIXTURE, "utf-8"));

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems.map((p) => [p.code, p.path]);
};
const items = (r: ReturnType<typeof compiled>, prefix: string) =>
  r.timeline.tracks.filter((t) => t.id === prefix || t.id.startsWith(`${prefix}-`)).flatMap((t) => t.items as any[]).sort((a, b) => a.from - b.from);
const only = (r: ReturnType<typeof compiled>, id: string) => items(r, id)[0]!;
const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a}, not ${b}`);

test("the video lasts until 6 s after the end of the voice; verses start on their first word", () => {
  const r = compiled(load());
  assert.equal(r.timeline.durationInFrames, 1129);
  assert.equal((r.timeline.metadata as any).voiceEnd, 31.63);
  const sections = Object.fromEntries(r.timeline.sections!.map((s) => [s.id, s.from]));
  assert.equal(sections["title"], 0);
  assert.equal(sections["verse-1"], 123); // 4.09 s
  assert.equal(sections["bow"], 949); // 31.63 s
});

test("the takes play from 0.3 s, the recital after its pause", () => {
  const voice = items(compiled(load()), "voice");
  assert.deepEqual(voice.map((v) => [v.asset, v.from]), [["narration-titolo", 9], ["narration-recita", 120]]);
});

test("the voice ends on voiceEndWord, matched without punctuation or case, in the last verse", () => {
  const input = load();
  input.spec.data.voiceEndWord = "Vespero";
  const r = compiled(input);
  const vespero = input.timings.recita!.words.find((w: any) => w.text === "vespero")!;
  close((r.timeline.metadata as any).voiceEnd, Math.round((vespero.end + 3.99) * 1000) / 1000, "voice end");
});

test("a take that runs past the end of the video is cut there", () => {
  const input = load();
  // 40 s of recording after the poem's last word: the video ends 6 s after it.
  input.narration.takes[1].audio.durationSeconds = 40;
  input.timings.recita!.audio.durationSeconds = 40;
  const r = compiled(input);
  const voice = items(r, "voice");
  assert.equal(voice.at(-1).from + voice.at(-1).duration, r.timeline.durationInFrames);
});

test("lightning strikes at each picture change during the voice, 0.05 s before it", () => {
  const hall = only(compiled(load()), "hall");
  // Pictures 2–8 change on verses 2–8; picture 9 comes back at end + 4.3 s, after the voice.
  assert.deepEqual(hall.props.flash.strikes, [7.48, 11.34, 14.51, 18.81, 22.22, 25.97, 29.22]);
  assert.equal(hall.props.pictures[8].at, 35.93);
});

test("the camera breathes over the poem and pushes on the spec's verses", () => {
  const { zoom } = only(compiled(load()), "hall").props.camera;
  assert.deepEqual(zoom[0], { from: 4.09, to: 33.43, rampIn: 27.54, rampOut: 1.4, amount: 0.025 });
  assert.equal(zoom.length, 4); // the body and pushVerses [1, 5, 7]
  assert.deepEqual(zoom[1], { from: 3.84, to: 7.95, rampIn: 0.8, rampOut: 0.8, amount: 0.027 });
});

test("shake, wind and room effects take their times from the words", () => {
  const r = compiled(load());
  const { shake } = only(r, "hall").props.camera;
  const urla = load().timings.recita!.words.find((w: any) => w.text === "urla")!;
  close(shake[0].from, Math.round((urla.start + 3.99 - 0.1) * 1000) / 1000, "shake from");
  assert.equal(shake[0].amount, 4);
  // nebbia-sala from verse 1 + 0.2 s: its item starts on that frame, the effect at its start.
  const fog = items(r, "room").find((i) => i.id === "room-1")!;
  assert.equal(fog.from, Math.round((4.09 + 0.2) * 30));
  assert.ok(fog.props.start >= 0 && fog.props.start < 1 / 30);
  assert.deepEqual(fog.props.textures, { fog: { $asset: "image-nebbia-texture" } });
});

test("blinks start at 1.1 s, 2–5 s apart, until the end", () => {
  const { blinks } = only(compiled(load()), "actor").props;
  assert.equal(blinks[0], 1.1);
  for (let i = 1; i < blinks.length; i++) {
    const gap = blinks[i] - blinks[i - 1];
    assert.ok(gap >= 2 && gap <= 5, `blink ${i} comes ${gap} s after the one before`);
  }
  assert.ok(blinks.at(-1) < 37.63 && blinks.at(-1) > 37.63 - 5);
});

test("the actor rests at 0 and at the end of the voice, and opens the mouth only while speaking", () => {
  const actor = only(compiled(load()), "actor").props;
  assert.equal(actor.poses[0].at, 0);
  assert.equal(actor.poses.at(-1).at, 31.63);
  assert.deepEqual(actor.poses.at(-1).pose, { lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0 });
  assert.deepEqual(actor.mouth.from, 3.99);
  assert.deepEqual(actor.mouth.to, 31.63);
  // The energy starts with 0.3 s of silence: the takes start at 0.3 s.
  assert.deepEqual(actor.mouth.energy.values.slice(0, 9), new Array(9).fill(0));
  assert.deepEqual(actor.bow, { from: 34.13, to: 36.33 });
});

test("the title card fits the space left of the actor: one line when it fits at 100 px, else two", () => {
  const card = only(compiled(load()), "card");
  assert.equal(card.props.maxWidth, 514);
  // "SAN MARTINO" would be 86 px on one line: two lines, sized by the longer.
  assert.deepEqual(card.props.titleLines, ["SAN", "MARTINO"]);
  assert.equal(card.props.size, 124);
  const input = load();
  input.spec.data.title = "Alla sera";
  delete input.spec.data.titleLines;
  const short = only(compiled(input), "card");
  assert.deepEqual(short.props.titleLines, ["ALLA SERA"]);
  assert.equal(short.props.size, 105);
});

test("the chip names the author only for a short title", () => {
  assert.equal(only(compiled(load()), "chip").props.author, "Giosuè Carducci");
  const input = load();
  input.spec.data.title = "Il cinque maggio";
  assert.equal(only(compiled(input), "chip").props.author, undefined);
});

test("each verse plate lights its words at their times, relative to the plate", () => {
  const plate = items(compiled(load()), "verses")[0]!;
  assert.equal(plate.from, Math.round((4.09 - 0.28) * 30));
  assert.equal(plate.props.words[0].text, "La");
  close(plate.props.words[0].at, plate.props.start, "the first word lights at the verse's start");
  assert.equal(plate.props.words.length, 7);
});

test("no track has overlapping items: overlaps go to the next lane", () => {
  const r = compiled(load());
  for (const track of r.timeline.tracks) {
    const sorted = [...(track.items as any[])].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].from >= sorted[i - 1].from + sorted[i - 1].duration, `${track.id}: ${sorted[i].id} overlaps`);
  }
  assert.ok(r.timeline.tracks.some((t) => t.id === "verses-2"));
  assert.ok(r.timeline.tracks.some((t) => t.id === "sfx-2"));
});

test("refuses, with the path of the cause", async (t) => {
  const cases: [string, (input: ReturnType<typeof load>) => void, [string, string][]][] = [
    ["a word the recital does not say", (i) => { i.spec.data.roomFx[1].at = "word:vendemmia"; }, [["unknown-word", "$.data.roomFx[1].at"]]],
    ["a time that is not one", (i) => { i.spec.data.poses[0].at = "verso:1"; }, [["bad-time", "$.data.poses[0].at"]]],
    ["a picture that does not exist", (i) => { i.spec.data.gaze[1].from = "picture:12"; }, [["bad-time", "$.data.gaze[1].from"]]],
    ["a verse that is not what was said", (i) => { i.spec.data.verses[2].text = "ma per le vie del borgo dal ribollir dei tini"; }, [["verse-mismatch", "$.data.verses[2].text"]]],
    ["verses with more words than the recital", (i) => { i.spec.data.verses[7].text += " ancora"; }, [["verse-mismatch", "$.data.verses"]]],
    ["a picture with no image", (i) => { i.spec.data.pictures[3].assetId = "sm-04-mancante"; }, [["missing-asset", "$.data.pictures[3].assetId"]]],
    ["a sound with no file", (i) => { i.spec.data.sfx[0].assetId = "pioggia-mancante"; }, [["missing-asset", "$.data.sfx[0].assetId"]]],
    ["an unknown pose", (i) => { i.spec.data.poses[2].preset = "saluta"; }, [["unknown-pose", "$.data.poses[2].preset"]]],
    ["an unknown costume", (i) => { i.spec.data.actor.base = "attore-dante"; }, [["unknown-palette", "$.data.actor.base"]]],
    ["a voiceEndWord never said", (i) => { i.spec.data.voiceEndWord = "fine"; }, [["unknown-word", "$.data.voiceEndWord"]]],
    ["a voiceEndWord last said before the last verse", (i) => { i.spec.data.voiceEndWord = "il"; }, [["voice-end-early", "$.data.voiceEndWord"]]],
    ["a sound after the end", (i) => { i.spec.data.sfx[0].at = "end+6.5"; }, [["after-end", "$.data.sfx[0].at"]]],
    ["a room effect after the end", (i) => { i.spec.data.roomFx[0].at = "end+7"; i.spec.data.roomFx[0].to = "end+9"; }, [["after-end", "$.data.roomFx[0].at"]]],
    ["the poem without its title", (i) => { i.narration.units[0].sequence = [{ take: "recita" }]; }, [["missing-take", "$.units"]]],
    ["no recital unit", (i) => { i.narration.units[0].id = "poem"; }, [["missing-unit", "$.units"]]],
  ];
  for (const [name, change, expected] of cases) {
    await t.test(name, () => {
      const input = load();
      change(input);
      assert.deepEqual(problems(compileSpec(input)), expected);
    });
  }
});
````

Run: `cd studio/series && node --import tsx --test test/dentro-i-versi-short.test.ts`
Expected: FAIL. No compiler `dentro-i-versi-short@1.0.0` is registered.

- [ ] **Step 3: The compiler**

Create `studio/series/src/compilers/dentro-i-versi-short/1.0.0.ts`:

````ts
// dentro-i-versi-short@1.0.0 — released: never edit this file; add dentro-i-versi-short/<next>.ts instead.
//
// "Dentro i versi · short": the title said, the whole poem recited in a
// science-fiction museum hall, applause (CreativeStudio's poesie-museo-short,
// sala8). From the spec's data and the recital's measured words it works out
// what sala8 computed on the fly — the camera, the lightning, the lights, the
// actor's poses, expressions, gazes, blinks and mouth, the titles' sizes — and
// lays the hall, room effects, verse plates, actor and titles out as items of
// the museum kits, with the takes, sounds, applause and music.
//
// Channel specifics in code (palettes, poses, layout): accepted for now; the
// boundary to restore is avg-d1x.

import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler } from "../../types.js";

const FPS = 30;
const UNIT = "recital";
const SPEC_PATH = "episode-spec.json";
const PROFILE = "vertical-1080x1920";
/** The voice starts this long after the first frame (the title is said under the teleport). */
const LEAD = 0.3;
/** After the end of the voice: the bow and the applause. */
const TAIL = 6.0;
/** The actor's place in the hall. */
const ACTOR = { x: 770, footY: 1800, scale: 0.95 };
const SCREEN = { x: 360, y: 215, w: 620, h: 910 };
const CAMERA_ORIGIN: [number, number] = [600, 1100];
/** Where the plates and the lower third start (left), inside the profile's safe zone. */
const PLATE_X = 90;

const KIT = (name: string) => ({ name, version: "1.0.0" });

const DEFAULT_CAMS = [
  { dx: -10, dy: -14, z: 0.15, r: -0.16 }, { dx: 14, dy: -8, z: 0.16, r: 0.14 }, { dx: -12, dy: 10, z: 0.17, r: -0.12 },
  { dx: 8, dy: -12, z: 0.14, r: 0.10 }, { dx: -10, dy: 8, z: 0.18, r: -0.12 }, { dx: 12, dy: -8, z: 0.15, r: 0.12 },
];
const REST = { lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0 };
type Pose = typeof REST;
const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const POSE_PRESETS: Record<string, Partial<Pose>> = {
  riposo: {},
  invoca: { lu: 20, lf: 54, ru: 20, rf: 54, head: -2, step: 1 },
  "mani-al-cuore": { lu: 38, lf: 92, ru: 22, rf: 60, head: -4, lean: 2 },
  indica: { ru: 126, rf: 140, head: 4 },
  apre: { lu: 62, lf: 72, ru: 62, rf: 72, head: -4, step: 1 },
  chiede: { lu: 56, lf: 72, ru: 56, rf: 72, head: -4, step: 1 },
  dialoga: { lu: 34, lf: 88, ru: 34, rf: 88, head: -5, dip: 1 },
  spalle: { lu: 24, lf: 110, ru: 24, rf: 110, head: -3, twist: 1 },
  "braccio-alto": { lu: 66, lf: 78, ru: 20, rf: 58, head: -3, step: 1 },
};
const EXPRESSIONS: Record<string, { li: number; lo: number; ri: number; ro: number; sm: number }> = {
  N: { li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25 },
  A: { li: -6, lo: 3, ri: -6, ro: 3, sm: -0.5 },
  W: { li: 7, lo: 6, ri: 7, ro: 6, sm: 0 },
  I: { li: 7, lo: 5, ri: -2, ro: 0, sm: 0.8 },
  M: { li: 6, lo: -3, ri: 6, ro: -3, sm: -0.6 },
  S: { li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9 },
};
const PALETTES: Record<string, Record<string, string>> = {
  "attore-saffo": { ink: "#2e2620", shirt: "#c52f87", shirtDark: "#8d1f60", vest: "#c52f87", vestLight: "#f064ad", button: "#164f56", inner: "#0799a5", innerDark: "#056a73", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#34373b", shoe: "#fafaf5", sole: "#dcd8cc" },
  "attore-infinito": { ink: "#2e2620", shirt: "#12a6b8", shirtDark: "#ff5a4e", vest: "#12a6b8", vestLight: "#0b7480", button: "#1d3a40", inner: "#ff5a4e", innerDark: "#d63c32", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#1b2a5c", shoe: "#fafaf5", sole: "#dcd8cc" },
  "attrice-saffo": { ink: "#2e2620", shirt: "#d26068", shirtDark: "#9f3e4b", vest: "#078c78", vestLight: "#55c9ae", button: "#f0bd43", inner: "#d26068", innerDark: "#9f3e4b", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#49334f", shoe: "#fafaf5", sole: "#dcd8cc" },
  "attrice-dante": { ink: "#2e2620", shirt: "#f2b632", shirtDark: "#c4860f", vest: "#1f4fbf", vestLight: "#5f8ae6", button: "#f7e6a6", inner: "#f2b632", innerDark: "#c4860f", skin: "#f6b386", skinDark: "#cf7c4e", trousers: "#2a2452", shoe: "#fafaf5", sole: "#dcd8cc", hair: "#3b2216", hairHi: "#6e4127", hairGloss: "#a06a43" },
};
const FRONT_FX = new Set(["note", "apparizione", "fantasma"]);

type TimeRef = number | string;
interface Data {
  title: string;
  author: string;
  kicker?: string;
  titleLines?: string[];
  voiceEndWord?: string;
  verses: { text: string; strong?: string[]; gloss: string }[];
  pictures: { assetId: string; at?: TimeRef; sc?: number; org?: string; spill?: string; cam?: { dx: number; dy: number; z: number; r: number }; fx?: string[] }[];
  actor: { variant: "attore" | "attrice"; outfit?: "gilet" | "giacca"; hairstyle?: "coda" | "corto"; accessories?: { earrings?: boolean; freckles?: boolean }; base?: string; palette?: Record<string, string> };
  poses?: ({ at: TimeRef; preset?: string } & Partial<Pose>)[];
  expressions?: string;
  gaze?: { from: TimeRef; to: TimeRef; x: number; y: number; h: number }[];
  pushVerses?: number[];
  lights?: { at: TimeRef; dark?: number; spot?: string; w?: number }[];
  hall: {
    room: string;
    textures?: { fog?: string; caustics?: string };
    pedestal?: boolean;
    teleport?: { in?: [TimeRef, number]; out?: [TimeRef, number] };
    wind?: { from: TimeRef; to: TimeRef; strength?: number }[];
    shake?: { from: TimeRef; to: TimeRef; amp?: number }[];
    shatter?: { at: TimeRef; picture: number; dur?: number }[];
    blackout?: { at: TimeRef; to: TimeRef; dark?: number };
    bolt?: { at: TimeRef; dur?: number };
  };
  roomFx?: { fx: string; at: TimeRef; to?: TimeRef; color?: string; assetId?: string; x?: number; y?: number; w?: number; mode?: string; exit?: string; glow?: string }[];
  sfx?: { assetId: string; at: TimeRef; dur: number | string; gain?: number; offset?: number }[];
  applause?: { assetId: string; gain?: number; dur?: number; delay?: number };
  music?: { assetId: string; gain?: number; duck?: number };
}

interface Envelope { from: number; to: number; rampIn: number; rampOut: number; amount: number }

const frames = (seconds: number) => Math.round(seconds * FPS);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) => s.toLocaleLowerCase("it-IT").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
/** CreativeStudio's deterministic noise (the blinks' spacing). */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};
const shift = (e: Envelope, by: number): Envelope => ({ ...e, from: round3(e.from - by), to: round3(e.to - by) });
const env = (from: number, to: number, rampIn: number, rampOut: number, amount: number): Envelope =>
  ({ from: round3(from), to: round3(to), rampIn: round3(rampIn), rampOut: round3(rampOut), amount: round3(amount) });

/** Items into the first lane whose last item ends before they start: no track has overlaps. */
function lanes<T extends { from: number; duration: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  for (const item of [...items].sort((a, b) => a.from - b.from)) {
    const lane = out.find((l) => l[l.length - 1]!.from + l[l.length - 1]!.duration <= item.from);
    if (lane) lane.push(item);
    else out.push([item]);
  }
  return out;
}

function compile(input: CompileInput): CompileResult {
  const data = input.spec.data as unknown as Data;
  const problems: CompileProblem[] = [];
  const warnings: string[] = [];
  const profile = outputProfile(PROFILE)!;
  const specHash = input.inputs[SPEC_PATH];
  if (!specHash) problems.push({ code: "missing-input", path: "$.inputs", message: `the hash of ${SPEC_PATH} was not supplied` });

  // ── The recital: title take, then the poem ───────────────────────────────
  const unit = input.narration.units.find((u) => u.id === UNIT);
  if (!unit) return { ok: false, problems: [{ code: "missing-unit", path: "$.units", message: `takes.json has no unit "${UNIT}" (the title take, then the poem)` }] };
  if (unit.sequence.length < 2) {
    return { ok: false, problems: [{ code: "missing-take", path: "$.units", message: `unit "${UNIT}" must say the title, then the poem: it has ${unit.sequence.length} take(s)` }] };
  }
  const laid = layoutUnit(input.narration, UNIT, input.timings);
  if ("problems" in laid) return { ok: false, problems: laid.problems as CompileProblem[] };
  const layout = laid.layout;
  const takeText = new Map(input.narration.takes.map((t) => [t.id, t.text]));
  const titleWords = tokens(takeText.get(unit.sequence[0]!.take) ?? "").length;
  const words = layout.timing.words.map((w) => ({ text: w.text, start: w.start + LEAD, end: w.end + LEAD }));
  const poem = words.slice(titleWords);

  // ── Verses on the poem's words ───────────────────────────────────────────
  const counts = data.verses.map((v) => tokens(v.text).length);
  const total = counts.reduce((s, n) => s + n, 0);
  if (total !== poem.length) {
    return { ok: false, problems: [{ code: "verse-mismatch", path: "$.data.verses", message: `the verses have ${total} words; the recital says ${poem.length} after the title` }] };
  }
  const verseWords: (typeof poem)[] = [];
  let k = 0;
  data.verses.forEach((v, i) => {
    const said = poem.slice(k, k + counts[i]!);
    k += counts[i]!;
    const written = tokens(v.text);
    const off = written.findIndex((w, j) => norm(w) !== norm(said[j]!.text));
    if (off !== -1) problems.push({ code: "verse-mismatch", path: `$.data.verses[${i}].text`, message: `verse ${i + 1} writes "${written[off]}" where the recital says "${said[off]!.text}"` });
    verseWords.push(said);
  });
  if (problems.length > 0) return { ok: false, problems };
  const LN = verseWords.map((w) => ({ start: w[0]!.start, end: w[w.length - 1]!.end }));
  const L = (n: number) => LN[Math.max(0, Math.min(LN.length, n) - 1)]!.start;
  const E = (n: number) => LN[Math.max(0, Math.min(LN.length, n) - 1)]!.end;

  let voiceEnd = poem[poem.length - 1]!.end;
  if (data.voiceEndWord) {
    const key = norm(data.voiceEndWord);
    const lastVerse = verseWords[verseWords.length - 1]!;
    const said = poem.map((w, i) => ({ w, i })).filter(({ w }) => norm(w.text) === key);
    const last = said[said.length - 1];
    if (!last) problems.push({ code: "unknown-word", path: "$.data.voiceEndWord", message: `the recital does not say "${data.voiceEndWord}"` });
    else if (last.i < poem.length - lastVerse.length) {
      problems.push({ code: "voice-end-early", path: "$.data.voiceEndWord", message: `"${data.voiceEndWord}" is last said before the last verse: the voice ends on a word of the last verse` });
    } else voiceEnd = last.w.end;
  }
  const VE = voiceEnd;
  const durationInFrames = Math.ceil((VE + TAIL) * FPS - 1e-6);
  const END = durationInFrames / FPS;

  // ── Times: verse:N, verseEnd:N, word:parola, end, picture:N (± seconds) ───
  let pictureAt: number[] = [];
  const tref = (ref: TimeRef | undefined, path: string, fallback = 0): number => {
    if (ref === undefined) return fallback;
    if (typeof ref === "number") return ref;
    const m = /^(verse|verseEnd|end|word|picture)(?::([^+-]+))?([+-][0-9.]+)?$/.exec(ref.trim());
    if (!m) {
      problems.push({ code: "bad-time", path, message: `"${ref}" is not a time (verse:N, verseEnd:N, word:parola, end, picture:N, ± seconds)` });
      return fallback;
    }
    const off = m[3] ? parseFloat(m[3]) : 0;
    switch (m[1]) {
      case "verse": return L(parseInt(m[2]!, 10)) + off;
      case "verseEnd": return E(parseInt(m[2]!, 10)) + off;
      case "end": return VE + off;
      case "word": {
        const key = norm(m[2]!);
        const word = poem.find((w) => norm(w.text) === key) ?? poem.find((w) => norm(w.text).startsWith(key));
        if (!word) {
          problems.push({ code: "unknown-word", path, message: `the recital does not say "${m[2]}"` });
          return fallback;
        }
        return word.start + off;
      }
      default: {
        const at = pictureAt[parseInt(m[2]!, 10)];
        if (at === undefined) {
          problems.push({ code: "bad-time", path, message: `there is no picture ${m[2]}` });
          return fallback;
        }
        return at + off;
      }
    }
  };

  // ── Assets ────────────────────────────────────────────────────────────────
  const assets: EditTimeline["assets"] = {};
  const image = (assetId: string, path: string) => {
    const id = `image-${assetId}`;
    const a = input.assets[id];
    if (!a) {
      problems.push({ code: "missing-asset", path, message: `no image "${assetId}" in assets/images` });
      return { $asset: id };
    }
    assets[id] = { ...a };
    return { $asset: id };
  };
  const sound = (assetId: string, path: string) => {
    const id = `sound-${assetId}`;
    const a = input.assets[id];
    if (!a) problems.push({ code: "missing-asset", path, message: `no sound "${assetId}" in assets/sounds` });
    else assets[id] = { ...a };
    return id;
  };

  // ── Pictures, camera, lightning, lights ──────────────────────────────────
  pictureAt = data.pictures.map((p, i) => (i === 0 ? 0 : tref(p.at, `$.data.pictures[${i}].at`, L(Math.min(i + 1, LN.length)))));
  const pictures = data.pictures.map((p, i) => ({
    src: image(p.assetId, `$.data.pictures[${i}].assetId`),
    at: round3(pictureAt[i]!),
    scale: p.sc ?? 1.07,
    origin: p.org ?? "50% 40%",
    move: p.cam ?? DEFAULT_CAMS[i % DEFAULT_CAMS.length]!,
    fx: p.fx ?? [],
    spill: p.spill ?? "#b9a8ff",
  }));
  const pushV = data.pushVerses ?? [1, Math.max(2, Math.round(LN.length * 0.4)), Math.max(3, Math.round(LN.length * 0.8)), LN.length];
  const camera = {
    origin: CAMERA_ORIGIN,
    zoom: [
      env(L(1), VE + 1.8, VE - L(1), 1.4, 0.025),
      ...pushV.map((n) => env(L(n) - 0.25, E(n) + 1.3, 0.8, 0.8, 0.06 * 0.45)),
    ],
    shake: (data.hall.shake ?? []).map((s, i) => env(tref(s.from, `$.data.hall.shake[${i}].from`), tref(s.to, `$.data.hall.shake[${i}].to`), 0.2, 0.3, s.amp ?? 7)),
  };
  const strikes = pictureAt.slice(1).map((a) => round3(a - 0.05)).filter((x) => x > 0.5 && x < VE);
  const lights = data.lights && data.lights.length > 0
    ? data.lights.map((l, i) => ({ at: round3(tref(l.at, `$.data.lights[${i}].at`)), dark: l.dark ?? 0.18, spot: l.spot ?? "#fff1d8", w: l.w ?? 1 }))
    : [{ at: 0, dark: 0.05, spot: "#eaf4ff", w: 1 }, { at: round3(VE + 1.8), dark: 0.03, spot: "#eaf4ff", w: 1.1 }];
  const hall = data.hall;
  const blackout = hall.blackout ? env(tref(hall.blackout.at, "$.data.hall.blackout.at"), tref(hall.blackout.to, "$.data.hall.blackout.to"), 0.5, 0.8, hall.blackout.dark ?? 0.8) : undefined;
  const bolt = hall.bolt ? { at: round3(tref(hall.bolt.at, "$.data.hall.bolt.at")), dur: hall.bolt.dur ?? 0.7 } : undefined;
  const wind = (hall.wind ?? []).map((w, i) => env(tref(w.from, `$.data.hall.wind[${i}].from`), tref(w.to, `$.data.hall.wind[${i}].to`), 0.6, 0.8, w.strength ?? 1));
  const shatter = (hall.shatter ?? []).map((s, i) => ({ at: round3(tref(s.at, `$.data.hall.shatter[${i}].at`)), picture: s.picture, dur: s.dur ?? 1.4 }));
  const textures = {
    ...(hall.textures?.fog ? { fog: image(hall.textures.fog, "$.data.hall.textures.fog") } : {}),
    ...(hall.textures?.caustics ? { caustics: image(hall.textures.caustics, "$.data.hall.textures.caustics") } : {}),
  };
  const live = { from: round3(L(1) - 1.0), to: round3(L(1) - 0.2) };
  const room = image(hall.room, "$.data.hall.room");

  // ── The actor ─────────────────────────────────────────────────────────────
  const actor = data.actor;
  const base = PALETTES[actor.base ?? (actor.variant === "attrice" ? "attrice-saffo" : "attore-saffo")];
  if (!base) problems.push({ code: "unknown-palette", path: "$.data.actor.base", message: `no costume "${actor.base}" (${Object.keys(PALETTES).join(", ")})` });
  const palette = { ...base, ...(actor.palette ?? {}) };
  const poses = [
    { at: 0, pose: REST },
    ...(data.poses ?? []).map((p, i) => {
      const { at, preset, ...angles } = p;
      if (preset && !POSE_PRESETS[preset]) problems.push({ code: "unknown-pose", path: `$.data.poses[${i}].preset`, message: `no pose "${preset}" (${Object.keys(POSE_PRESETS).join(", ")})` });
      const pose = { ...REST, ...(preset ? POSE_PRESETS[preset] ?? {} : {}), ...angles } as Pose;
      return { at: round3(tref(at, `$.data.poses[${i}].at`)), pose: Object.fromEntries(POSE_KEYS.map((key) => [key, pose[key]])) as Pose };
    }),
    { at: round3(VE), pose: REST },
  ].sort((a, b) => a.at - b.at);
  const letters = data.expressions ?? "N".repeat(LN.length);
  const expressions = [
    { at: 0, ex: EXPRESSIONS.N! },
    ...LN.map((l, i) => ({ at: round3(l.start - 0.15), ex: EXPRESSIONS[letters[i] ?? "N"] ?? EXPRESSIONS.N! })),
    { at: round3(VE + 0.3), ex: EXPRESSIONS.N! },
  ];
  const gaze = [
    ...pictureAt.slice(1).map((a) => ({ from: round3(a + 0.1), to: round3(a + 1.5), x: 3.5, y: -3, h: 5 })),
    ...(data.gaze ?? []).map((g, i) => ({ from: round3(tref(g.from, `$.data.gaze[${i}].from`)), to: round3(tref(g.to, `$.data.gaze[${i}].to`)), x: g.x, y: g.y, h: g.h })),
  ];
  const blinks: number[] = [];
  for (let b = 1.1, i = 0; b < VE + TAIL; i++) {
    blinks.push(round3(b));
    b += 2 + 3 * rnd(i + 3);
  }
  const energy = layout.energy
    ? { rate: layout.energy.rate, values: [...new Array(Math.round(LEAD * layout.energy.rate)).fill(0), ...layout.energy.values] }
    : { rate: FPS, values: [] as number[] };
  if (!layout.energy) warnings.push("the takes carry no energy at one rate: the actor's mouth stays closed");
  const speech: [number, number][] = [];
  for (const w of words) {
    const last = speech[speech.length - 1];
    if (last && w.start - last[1] < 0.2) last[1] = round3(Math.max(last[1], w.end));
    else speech.push([round3(w.start), round3(w.end)]);
  }
  const teleport = hall.teleport
    ? {
      ...(hall.teleport.in ? { in: { at: round3(tref(hall.teleport.in[0], "$.data.hall.teleport.in[0]")), dur: hall.teleport.in[1] } } : {}),
      ...(hall.teleport.out ? { out: { at: round3(tref(hall.teleport.out[0], "$.data.hall.teleport.out[0]")), dur: hall.teleport.out[1] } } : {}),
    }
    : undefined;

  // ── Room effects ──────────────────────────────────────────────────────────
  const roomItems = (data.roomFx ?? []).map((r, i) => {
    const a = tref(r.at, `$.data.roomFx[${i}].at`);
    const b = r.to === undefined ? a + 8 : tref(r.to, `$.data.roomFx[${i}].to`);
    const from = frames(a);
    const end = frames(b + (FRONT_FX.has(r.fx) ? 1 : 0));
    if (from >= durationInFrames) problems.push({ code: "after-end", path: `$.data.roomFx[${i}].at`, message: `${r.fx} starts at ${round3(a)} s, after the video ends (${round3(END)} s)` });
    const at0 = from / FPS;
    const figure = {
      ...(r.assetId ? { src: image(r.assetId, `$.data.roomFx[${i}].assetId`) } : {}),
      ...(r.x !== undefined ? { x: r.x } : {}), ...(r.y !== undefined ? { y: r.y } : {}), ...(r.w !== undefined ? { w: r.w } : {}),
      ...(r.mode ? { mode: r.mode } : {}), ...(r.exit ? { exit: r.exit } : {}), ...(r.glow ? { glow: r.glow } : {}),
    };
    return {
      id: `room-${i + 1}`,
      from,
      duration: Math.max(1, Math.min(end, durationInFrames) - from),
      kit: KIT("room-effect"),
      props: {
        effect: r.fx,
        ...(r.color ? { color: r.color } : {}),
        // The item starts on the frame nearest the effect: never before it in kit time.
        start: Math.max(0, round3(a - at0)),
        end: round3(b - at0),
        screen: SCREEN,
        camera: { ...camera, zoom: camera.zoom.map((e) => shift(e, at0)), shake: camera.shake.map((e) => shift(e, at0)) },
        ...(blackout ? { blackout: shift(blackout, at0) } : {}),
        ...(r.fx === "nebbia-sala" && textures.fog ? { textures: { fog: textures.fog } } : {}),
        ...(Object.keys(figure).length > 0 ? { figure } : {}),
      },
      source: `roomFx[${i}]`,
    };
  });

  // ── Verse plates ──────────────────────────────────────────────────────────
  const plateItems = data.verses.map((v, i) => {
    const from = frames(LN[i]!.start - 0.28);
    const out = i < LN.length - 1 ? LN[i + 1]!.start - 0.05 : VE + 1.0;
    const end = Math.max(from + 1, frames(out));
    const at0 = from / FPS;
    return {
      id: `verse-${i + 1}`,
      from,
      duration: end - from,
      kit: KIT("verse-plate"),
      props: {
        text: v.text,
        words: verseWords[i]!.map((w, j) => ({ text: tokens(v.text)[j]!, at: round3(w.start - at0) })),
        ...(v.strong ? { strong: v.strong } : {}),
        gloss: v.gloss,
        start: round3(LN[i]!.start - at0),
      },
      source: `verses[${i}]`,
      transitionOut: { type: "fade" as const, duration: i < LN.length - 1 ? frames(0.27) : frames(0.5) },
    };
  });

  // ── Titles ────────────────────────────────────────────────────────────────
  const tw = tokens(data.title);
  const titleLines = data.titleLines ?? [tw.slice(0, Math.ceil(tw.length / 2)).join(" "), tw.slice(Math.ceil(tw.length / 2)).join(" ")].filter(Boolean);
  const cardWidth = Math.round(ACTOR.x - 150 * ACTOR.scale - 24 - PLATE_X);
  const fit = (lines: string[]) => Math.min(124, Math.floor((cardWidth - 66) / (0.47 * Math.max(...lines.map((l) => l.length)))));
  const cardLines = fit([data.title]) >= 100 ? [data.title] : titleLines;
  const card = { kicker: data.kicker ?? data.author.toUpperCase(), titleLines: cardLines.map((l) => l.toUpperCase()), author: data.author, maxWidth: cardWidth, size: fit(cardLines) };
  const opening = frames(L(1) - 0.1);
  const bowFrom = frames(VE + 1.0);
  const chipFrom = frames(L(1) - 0.9);
  const chipEnd = frames(VE + 1.9);
  const titleItems = [
    { id: "card-opening", from: 0, duration: opening, kit: KIT("lower-third"), props: { ...card }, source: "title", transitionOut: { type: "fade" as const, duration: frames(0.8) } },
    { id: "card-bow", from: bowFrom, duration: durationInFrames - bowFrom, kit: KIT("lower-third"), props: { ...card, ruleGrow: 0 }, source: "title", transitionIn: { type: "fade" as const, duration: frames(0.9) } },
  ];
  const chipItem = {
    id: "chip", from: chipFrom, duration: chipEnd - chipFrom, kit: KIT("title-chip"),
    props: { title: data.title, ...(data.title.length > 13 ? {} : { author: data.author }) },
    source: "title",
    transitionIn: { type: "fade" as const, duration: frames(0.8) },
    transitionOut: { type: "fade" as const, duration: frames(0.9) },
  };

  // ── Audio ─────────────────────────────────────────────────────────────────
  const voiceItems = layout.pieces.map((piece, n) => {
    const from = frames(LEAD + piece.at);
    const id = `narration-${piece.take}`;
    const a = input.assets[id];
    if (!a) problems.push({ code: "missing-asset", path: "$.takes", message: `no audio "${id}" for take "${piece.take}"` });
    else assets[id] = { ...a };
    return {
      id: `voice-${n + 1}`, from, duration: Math.max(1, Math.min(frames(LEAD + piece.at + piece.duration), durationInFrames) - from), asset: id,
      ...(frames(piece.from) > 0 ? { trimStart: frames(piece.from) } : {}), source: "narration",
    };
  });
  const sfxItems = (data.sfx ?? []).map((s, i) => {
    const at = tref(s.at, `$.data.sfx[${i}].at`);
    const dur = typeof s.dur === "string" ? tref(s.dur, `$.data.sfx[${i}].dur`) - at : s.dur;
    const from = frames(at);
    if (from >= durationInFrames) problems.push({ code: "after-end", path: `$.data.sfx[${i}].at`, message: `the sound starts at ${round3(at)} s, after the video ends (${round3(END)} s)` });
    const duration = Math.max(1, Math.min(frames(at + dur), durationInFrames) - from);
    return {
      id: `sfx-${i + 1}`, from, duration, asset: sound(s.assetId, `$.data.sfx[${i}].assetId`),
      // A sound cut short by the end fades over at most half of what is left.
      gain: s.gain ?? 0.4, fadeIn: Math.min(9, duration >> 1), fadeOut: Math.min(18, duration >> 1), ...(s.offset ? { trimStart: frames(s.offset) } : {}), source: `sfx[${i}]`,
    };
  });
  const applause = data.applause
    ? (() => {
      const from = frames(VE + (data.applause.delay ?? 0.8));
      const dur = data.applause.dur ?? 5.7;
      return { id: "applause", from, duration: Math.max(1, Math.min(frames(VE + (data.applause.delay ?? 0.8) + dur), durationInFrames) - from), asset: sound(data.applause.assetId, "$.data.applause.assetId"), gain: data.applause.gain ?? 0.72, fadeIn: 12, fadeOut: 40, source: "applause" };
    })()
    : null;
  const music = data.music
    ? { id: "music", from: 0, duration: durationInFrames, asset: sound(data.music.assetId, "$.data.music.assetId"), gain: data.music.gain ?? 0.6, fadeIn: 15, fadeOut: 45, source: "music" }
    : null;
  if (problems.length > 0) return { ok: false, problems };

  // ── Tracks ────────────────────────────────────────────────────────────────
  const whole = { from: 0, duration: durationInFrames };
  const tracks: EditTimeline["tracks"] = [
    {
      id: "hall", type: "visual", z: 0, items: [{
        id: "hall", ...whole, kit: KIT("museum-hall"), source: "hall",
        props: {
          room, screen: SCREEN, pictures, camera, flash: { strikes }, lights,
          ...(blackout ? { blackout } : {}), ...(bolt ? { bolt } : {}), ...(wind.length ? { wind } : {}), ...(shatter.length ? { shatter } : {}),
          pedestal: hall.pedestal ?? true,
          actor: { x: ACTOR.x, scale: ACTOR.scale, liveFrom: live.from, liveTo: live.to },
          ...(Object.keys(textures).length ? { textures } : {}),
        },
      }],
    },
    ...lanes(roomItems).map((items, i) => ({ id: `room-${i + 1}`, type: "visual" as const, z: 10 + i, items })),
    ...lanes(plateItems).map((items, i) => ({ id: `verses-${i + 1}`, type: "visual" as const, z: 20 + i, items })),
    {
      id: "actor", type: "visual", z: 30, items: [{
        id: "actor", ...whole, kit: KIT("interprete"), source: "actor",
        props: {
          variant: actor.variant, ...(actor.outfit ? { outfit: actor.outfit } : {}), ...(actor.hairstyle ? { hairstyle: actor.hairstyle } : {}),
          ...(actor.accessories ? { accessories: actor.accessories } : {}), palette,
          x: ACTOR.x, footY: ACTOR.footY, scale: ACTOR.scale, poses, expressions, gaze, blinks, live,
          bow: { from: round3(VE + 2.5), to: round3(VE + 4.7) },
          mouth: { energy, speech, from: round3(L(1) - 0.1), to: round3(VE) },
          ...(teleport ? { teleport } : {}), camera, flash: { strikes }, ...(blackout ? { blackout } : {}),
        },
      }],
    },
    { id: "card", type: "visual", z: 40, items: titleItems },
    { id: "chip", type: "visual", z: 41, items: [chipItem] },
    { id: "brand", type: "visual", z: 50, items: [{ id: "brand", ...whole, kit: KIT("brand-mark"), props: {}, source: "brand" }] },
    { id: "voice", type: "audio", items: voiceItems },
  ] as EditTimeline["tracks"];
  lanes(sfxItems).forEach((items, i) => tracks.push({ id: `sfx-${i + 1}`, type: "audio", items } as never));
  if (applause) tracks.push({ id: "applause", type: "audio", items: [applause] } as never);
  if (music) tracks.push({ id: "music", type: "audio", duck: { under: ["voice"], gain: data.music!.duck ?? 0.75 }, items: [music] } as never);

  const sections = [
    { id: "title", from: 0, duration: Math.max(1, frames(L(1))), source: "title" },
    ...LN.map((l, i) => {
      const from = frames(l.start);
      const to = i < LN.length - 1 ? frames(LN[i + 1]!.start) : frames(VE);
      return { id: `verse-${i + 1}`, from, duration: Math.max(1, to - from), source: `verses[${i}]` };
    }),
    { id: "bow", from: frames(VE), duration: durationInFrames - frames(VE), source: "applause" },
  ];

  const timeline = {
    apiVersion: "studio.video/v1alpha2",
    kind: "EditTimeline",
    episodeRef: { ...input.spec.episodeRef },
    revision: 1,
    derivedFrom: { spec: { path: SPEC_PATH, hash: specHash!, revision: input.spec.revision }, compiler: { id: compiler.id, version: compiler.version } },
    fps: FPS,
    durationInFrames,
    resolution: { width: profile.width, height: profile.height },
    profile: structuredClone(profile),
    assets,
    tracks,
    sections,
    metadata: {
      builtBy: `@studio/series ${compiler.id}@${compiler.version}`,
      template: { ...input.spec.template },
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      voiceEnd: round3(VE),
      end: round3(END),
    },
  } as EditTimeline;
  return { ok: true, timeline, warnings };
}

export const compiler: SeriesCompiler = {
  id: "dentro-i-versi-short",
  version: "1.0.0",
  description: "Dentro i versi · short: the title said, the poem recited by the interprete in a museum hall with its pictures, effects and titles, applause.",
  compile,
};
````

````diff
diff --git a/studio/series/src/registry.ts b/studio/series/src/registry.ts
index 891fe62..9da6561 100644
--- a/studio/series/src/registry.ts
+++ b/studio/series/src/registry.ts
@@ -3,8 +3,9 @@
 
 import type { SeriesCompiler } from "./types.js";
 import { compiler as poetryShort100 } from "./compilers/poetry-short/1.0.0.js";
+import { compiler as dentroIVersiShort100 } from "./compilers/dentro-i-versi-short/1.0.0.js";
 
-export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100]);
+export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100, dentroIVersiShort100]);
 
 /** The compiler with exactly this id and version, or undefined. */
 export function resolveCompiler(id: string, version: string): SeriesCompiler | undefined {
````

- [ ] **Step 4: Run it to make sure it passes, then write the golden**

Run: `node --import tsx --test test/dentro-i-versi-short.test.ts`
Expected: PASS, 29 tests.

Run: `node --import tsx scripts/golden.ts dentro-i-versi-short 1.0.0 && shasum -a 256 fixtures/dentro-i-versi-short/1.0.0/expected-timeline.json`
Expected: `55723cc09d22c6b18a9a6f0445b123f021e28392df2de24367e4536e94b76b47`. That is the prototype's golden, byte for byte.

Run: `npm run typecheck && npm test`. Expected: PASS. The golden test now covers both compilers.

- [ ] **Step 5: Commit**

```bash
git add studio/series/src/compilers/dentro-i-versi-short studio/series/src/registry.ts \
  studio/series/test/dentro-i-versi-short.test.ts studio/series/fixtures/dentro-i-versi-short
git commit -m "dentro-i-versi-short@1.0.0: the compiler and its template release (avg-dcf.3.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The validator, the episode helper and the real render (avg-dcf.3.6)

**Files:**
- Create:
  - `studio/series/src/validators/dentro-i-versi-short/1.0.0.ts`, `studio/series/fixtures/validators/dentro-i-versi-short/1.0.0/cases.json`;
  - `studio/episode/tests/dentro-i-versi-short.e2e.test.ts`.
- Modify: `studio/series/src/validators.ts`, `studio/series/README.md`, `studio/episode/src/testing.ts`

**Interfaces:**
- Produces:
  - `validator` `dentro-i-versi-short@1.0.0`;
  - `divShortEpisode(episodeDir, episodeRef, options?)` in `@studio/episode/testing`;
  - `DivShortEpisodeOptions` (`image`, `audio`, `sound`).

- [ ] **Step 1: Write the failing golden cases**

Create `studio/series/fixtures/validators/dentro-i-versi-short/1.0.0/cases.json`:

````json
{
  "compiler": { "id": "dentro-i-versi-short", "version": "1.0.0" },
  "cases": [
    {
      "name": "the compiled timeline, untouched",
      "set": [],
      "expect": []
    },
    {
      "name": "a room effect moved by half a second and a light changed: within the rules",
      "set": [
        { "path": "$.tracks[1].items[0].from", "value": 144 },
        { "path": "$.tracks[0].items[0].props.lights[2].dark", "value": 0.2 }
      ],
      "expect": []
    },
    {
      "name": "a verse retyped on its plate",
      "set": [{ "path": "$.tracks[4].items[0].props.text", "value": "La nebbia agli irti colli piovigginando scende," }],
      "expect": [
        { "code": "verse-text", "severity": "error", "path": "$.tracks[4].items[0].props.text" },
        { "code": "missing-verse", "severity": "error", "path": "$.data.verses[0]" }
      ]
    },
    {
      "name": "a verse plate removed",
      "set": [{ "path": "$.tracks[5].items[0]", "value": null }],
      "expect": [{ "code": "missing-verse", "severity": "error", "path": "$.data.verses[1]" }]
    },
    {
      "name": "the brand mark drawn with another kit",
      "set": [{ "path": "$.tracks[9].items[0].kit", "value": { "name": "still", "version": "1.0.0" } }],
      "expect": [{ "code": "forbidden-kit", "severity": "error", "path": "$.tracks[9].items[0].kit" }]
    },
    {
      "name": "a kit at another version",
      "set": [{ "path": "$.tracks[7].items[0].kit.version", "value": "1.1.0" }],
      "expect": [{ "code": "forbidden-kit", "severity": "error", "path": "$.tracks[7].items[0].kit" }]
    },
    {
      "name": "the actor no longer teleports out",
      "set": [{ "path": "$.tracks[6].items[0].props.teleport.out", "value": null }],
      "expect": [{ "code": "missing-teleport", "severity": "error", "path": "$.tracks[6].items[0].props.teleport" }]
    },
    {
      "name": "the actor removed",
      "set": [{ "path": "$.tracks[6]", "value": null }],
      "expect": [{ "code": "missing-actor", "severity": "error", "path": "$.tracks" }]
    },
    {
      "name": "the recital moved by a frame",
      "set": [{ "path": "$.tracks[10].items[1].from", "value": 121 }],
      "expect": [{ "code": "altered-voice", "severity": "error", "path": "$.tracks[10].items[1]" }]
    },
    {
      "name": "the voice made louder",
      "set": [{ "path": "$.tracks[10].items[0].gain", "value": 1.2 }],
      "expect": [{ "code": "altered-voice", "severity": "error", "path": "$.tracks[10].items[0]" }]
    },
    {
      "name": "the profile changed",
      "set": [{ "path": "$.profile.loudness.integrated", "value": -16 }],
      "expect": [{ "code": "profile-changed", "severity": "error", "path": "$.profile" }]
    },
    {
      "name": "cut to 23 s",
      "set": [{ "path": "$.durationInFrames", "value": 690 }],
      "expect": [{ "code": "duration-range", "severity": "error", "path": "$.durationInFrames" }]
    },
    {
      "name": "one apparition only",
      "setInput": [{ "path": "$.spec.data.roomFx[4]", "value": null }],
      "set": [],
      "expect": [{ "code": "apparitions", "severity": "warning", "path": "$.tracks" }]
    },
    {
      "name": "an apparition of 3 s",
      "setInput": [{ "path": "$.spec.data.roomFx[2].to", "value": "verse:4+3.2" }],
      "set": [],
      "expect": [{ "code": "apparition-short", "severity": "warning", "path": "$.tracks[2].items[0].props" }]
    },
    {
      "name": "two seconds between the title and the poem",
      "setInput": [{ "path": "$.narration.units[0].sequence[1].pauseBefore", "value": 1.66 }],
      "set": [],
      "expect": [{ "code": "title-pause", "severity": "warning", "path": "$.units" }]
    }
  ]
}
````

`test/validators-golden.test.ts` runs the cases of every *registered* validator. So first register a stub that finds nothing: create `studio/series/src/validators/dentro-i-versi-short/1.0.0.ts` exporting `validator = { id: "dentro-i-versi-short", version: "1.0.0", description: "stub", validate: () => [] }`, and apply Step 2's `validators.ts` diff.

Run: `cd studio/series && node --import tsx --test test/validators-golden.test.ts`
Expected: FAIL. Every case that expects a finding gets none; the untouched and within-the-rules cases pass.

- [ ] **Step 2: The validator**

Replace the stub with:

Create `studio/series/src/validators/dentro-i-versi-short/1.0.0.ts`:

````ts
// dentro-i-versi-short@1.0.0 (validator) — released: never edit this file; add dentro-i-versi-short/<next>.ts instead.
//
// The mechanical rules of the Dentro i versi short, checked on the timeline
// that is about to be rendered — hand edits included — with what the
// compiler makes of the same inputs as the reference. A hand edit may move
// an effect or a light; it may not change the verses on screen, the kits,
// the voice, the profile or the loop (teleport in and out). Everything this
// version does is in this file, and its golden cases fail if its findings
// ever change.

import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import type { EditTimeline, Finding, SeriesValidator, ValidateInput } from "../../types.js";

/** 25 s at 30 fps. */
const MIN_FRAMES = 750;
/** 90 s at 30 fps. */
const MAX_FRAMES = 2700;
/** The kits of the format, at the versions this release draws with. */
const KITS = ["museum-hall", "room-effect", "verse-plate", "interprete", "lower-third", "title-chip", "brand-mark"].map((n) => `${n}@1.0.0`);
const APPARITIONS = new Set(["apparizione", "fantasma"]);
const APPARITION_COUNT = 2;
const APPARITION_SECONDS = 5;
/** Between the end of the title and the first word of the poem. */
const TITLE_PAUSE: [number, number] = [0.8, 1.4];

interface Data {
  verses: { text: string }[];
}

type Item = Record<string, any>;

const collapse = (text: string) => text.trim().split(/\s+/).join(" ");

/** JSON with sorted keys: equal values give equal text whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validate(input: ValidateInput): Finding[] {
  const { timeline, compiled } = input;
  const data = input.spec.data as unknown as Data;
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) => findings.push({ code, severity: "error", path, message });
  const warning = (code: string, path: string, message: string) => findings.push({ code, severity: "warning", path, message });

  // Every visual item with the track and item index that locates it.
  const visual: { item: Item; path: string }[] = [];
  timeline.tracks.forEach((track, i) => {
    if (track.type === "visual") (track.items as Item[]).forEach((item, j) => visual.push({ item, path: `$.tracks[${i}].items[${j}]` }));
  });
  const kitOf = (item: Item) => `${item.kit?.name}@${item.kit?.version}`;
  const withKit = (name: string) => visual.filter(({ item }) => item.kit?.name === name);

  // ── Errors ────────────────────────────────────────────────────────────────
  if (canonical(timeline.profile) !== canonical(compiled.profile)) {
    error("profile-changed", "$.profile", `the profile is ${timeline.profile.id}; this template renders ${compiled.profile.id}`);
  }
  if (timeline.fps !== compiled.fps) {
    error("fps-changed", "$.fps", `the timeline plays at ${timeline.fps} fps; this template renders ${compiled.fps}`);
  }
  const frames = timeline.durationInFrames;
  if (frames < MIN_FRAMES || frames > MAX_FRAMES) {
    error("duration-range", "$.durationInFrames", `${(frames / 30).toFixed(1)} s is outside 25–90 s: the poem and its applause decide the length, not the timeline`);
  }

  for (const { item, path } of visual) {
    if (item.kit && !KITS.includes(kitOf(item))) {
      error("forbidden-kit", `${path}.kit`, `"${item.id}" uses ${kitOf(item)}; this format draws only with ${KITS.join(", ")}`);
    }
  }

  // The verses on screen are the spec's, every one of them (UP-59).
  const verses = data.verses.map((v) => collapse(v.text));
  const plates = withKit("verse-plate");
  for (const { item, path } of plates) {
    const text = collapse(String(item.props?.text ?? ""));
    if (!verses.includes(text)) error("verse-text", `${path}.props.text`, `"${text}" is not a verse of the poem: change the spec, not the plate`);
  }
  const shown = new Set(plates.map(({ item }) => collapse(String(item.props?.text ?? ""))));
  verses.forEach((text, k) => {
    if (!shown.has(text)) error("missing-verse", `$.data.verses[${k}]`, `verse ${k + 1} ("${text}") has no plate`);
  });

  // The actor arrives and leaves by teleport: first and last frame are the empty hall.
  const actors = withKit("interprete");
  if (actors.length === 0) error("missing-actor", "$.tracks", "no interprete: the poem is recited by the actor");
  for (const { item, path } of actors) {
    const teleport = item.props?.teleport;
    if (!teleport?.in || !teleport?.out) {
      error("missing-teleport", `${path}.props.teleport`, `"${item.id}" does not teleport ${!teleport?.in ? "in" : "out"}: the first and the last frame are the empty hall`);
    }
  }

  // The voice is the takes, laid out as recorded.
  const voiceOf = (t: EditTimeline) => (t.tracks.find((track) => track.id === "voice")?.items ?? []) as Item[];
  const voiceAt = timeline.tracks.findIndex((track) => track.id === "voice");
  const voice = voiceOf(timeline);
  const reference = voiceOf(compiled);
  if (voice.length !== reference.length) {
    error("altered-voice", voiceAt === -1 ? "$.tracks" : `$.tracks[${voiceAt}]`, `the voice has ${voice.length} items; the takes are laid out in ${reference.length}`);
  } else {
    voice.forEach((item, j) => {
      const want = reference[j]!;
      const moved = item.from !== want.from || item.duration !== want.duration || item.asset !== want.asset
        || (item.trimStart ?? 0) !== (want.trimStart ?? 0);
      const reworked = ["gain", "fadeIn", "fadeOut", "transitionIn", "transitionOut"].filter((k) => item[k] !== undefined);
      if (moved || reworked.length > 0) {
        error("altered-voice", `$.tracks[${voiceAt}].items[${j}]`,
          moved
            ? `"${item.id}" is not where the takes put it (frame ${want.from}, ${want.duration} frames, ${want.asset}): takes are never cut or moved`
            : `"${item.id}" sets ${reworked.join(", ")}: takes are never reworked`);
      }
    });
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  // Two apparitions, each long enough to be seen (UP-58).
  const apparitions = withKit("room-effect").filter(({ item }) => APPARITIONS.has(item.props?.effect));
  if (apparitions.length !== APPARITION_COUNT) {
    warning("apparitions", "$.tracks", `${apparitions.length} apparitions; the format has ${APPARITION_COUNT}`);
  }
  for (const { item, path } of apparitions) {
    const seconds = Number(item.props?.end ?? 0) - Number(item.props?.start ?? 0);
    if (seconds < APPARITION_SECONDS) {
      warning("apparition-short", `${path}.props`, `"${item.id}" stays ${seconds.toFixed(1)} s, under ${APPARITION_SECONDS} s`);
    }
  }

  // About a second between the title and the poem.
  const unit = input.narration.units.find((u) => u.id === "recital");
  const laid = unit ? layoutUnit(input.narration, "recital", input.timings) : null;
  if (unit && laid && !("problems" in laid)) {
    const titleText = input.narration.takes.find((t) => t.id === unit.sequence[0]?.take)?.text ?? "";
    const n = titleText.split(/\s+/).filter(Boolean).length;
    const words = laid.layout.timing.words;
    if (n > 0 && words.length > n) {
      const pause = words[n]!.start - words[n - 1]!.end;
      if (pause < TITLE_PAUSE[0] || pause > TITLE_PAUSE[1]) {
        warning("title-pause", "$.units", `${pause.toFixed(2)} s between the title and the poem; the format wants ${TITLE_PAUSE[0]}–${TITLE_PAUSE[1]} s`);
      }
    }
  }

  return findings;
}

export const validator: SeriesValidator = {
  id: "dentro-i-versi-short",
  version: "1.0.0",
  description: "The Dentro i versi short's mechanical rules, on the timeline about to be rendered: 25–90 s, its kits only, every verse on its plate as written, the actor teleporting in and out, the voice untouched.",
  validate,
};
````

````diff
diff --git a/studio/series/src/validators.ts b/studio/series/src/validators.ts
index 5bdce4d..942ebac 100644
--- a/studio/series/src/validators.ts
+++ b/studio/series/src/validators.ts
@@ -5,8 +5,9 @@
 
 import type { CheckResult, SeriesValidator, ValidateInput } from "./types.js";
 import { validator as poetryShort100 } from "./validators/poetry-short/1.0.0.js";
+import { validator as dentroIVersiShort100 } from "./validators/dentro-i-versi-short/1.0.0.js";
 
-export const VALIDATORS: readonly SeriesValidator[] = Object.freeze([poetryShort100]);
+export const VALIDATORS: readonly SeriesValidator[] = Object.freeze([poetryShort100, dentroIVersiShort100]);
 
 /** The validator with exactly this id and version, or undefined. */
 export function resolveValidator(id: string, version: string): SeriesValidator | undefined {
````

Run: `npm run typecheck && npm test`
Expected: PASS, 101 tests, including the 15 golden cases.

- [ ] **Step 3: README**

````diff
diff --git a/studio/series/README.md b/studio/series/README.md
index 65bd7ef..7c5d3c5 100644
--- a/studio/series/README.md
+++ b/studio/series/README.md
@@ -24,7 +24,8 @@ Compilers are **pure**: they read no file, ask no clock and keep no state.
 Everything arrives already read, checked and hashed — in the studio, by
 `compileEpisode` in `@studio/episode` (`studio/episode/src/series-compile.ts`), which also decides
 the asset ids (`image-<name>` for `assets/images/<name>.<ext>`,
-`narration-<take>` for each take's audio). A timeline the validators refuse
+`sound-<name>` for `assets/sounds/<name>.<ext>`, `narration-<take>` for each
+take's audio). A timeline the validators refuse
 comes back with problem codes prefixed `timeline:` — a compiler bug, not bad
 input.
 
@@ -33,6 +34,7 @@ input.
 | Compiler | What it makes |
 |---|---|
 | `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |
+| `dentro-i-versi-short@1.0.0` | Dentro i versi · short (CreativeStudio's `sala8`): the `recital` unit — the title take, then the poem — from 0.3 s; the video lasts until 6 s after `voiceEndWord`. From the spec's data and the measured words it computes the camera's breathing, pushes and shakes, lightning at each picture change, lights, wind, shatter, blackout, the actor's poses, expressions, gazes, blinks, mouth (from the voice's energy), live and bow windows, and the title card's fit; it lays out the museum kits (`museum-hall`, `room-effect`, `verse-plate`, `interprete`, `lower-third`, `title-chip`, `brand-mark`), the sounds, applause and music. Times are seconds or `verse:N`, `verseEnd:N`, `word:parola`, `end`, `picture:N`, ± seconds. Items that overlap go on separate lanes (`verses-1`, `verses-2`, `room-1`…, `sfx-1`…). Sections: `title`, `verse-N`, `bow`. |
 
 ## Validators
 
@@ -50,6 +52,7 @@ const { validator, findings } = checkSeries({ ...input, timeline, compiled });
 | Validator | Rules |
 |---|---|
 | `poetry-short@1.0.0` | Errors: a track missing, `profile-changed`, `fps-changed`, `duration-range` (10–60 s), `extra-track`, `hidden-track`, `stacking-changed`, `forbidden-kit`, `forbidden-transition` (only a 12-frame crossfade in), `altered-voice` (takes never cut, moved or reworked), `asset-changed` (no picture or take swapped, added or removed by hand), `text-not-voice` (the captions say exactly what the compiler captioned from the voice), `missing-picture`, `uncovered-frames`. Warnings: `panel-flash` (under 1 s), `panel-long` (over 7 s), `caption-long` (over 42 characters). |
+| `dentro-i-versi-short@1.0.0` | Errors: `profile-changed`, `fps-changed`, `duration-range` (25–90 s), `forbidden-kit` (only the seven museum kits at 1.0.0), `verse-text` (a plate that is not a verse of the spec), `missing-verse`, `missing-actor`, `missing-teleport` (in and out: the first and last frame are the empty hall), `altered-voice`. Warnings: `apparitions` (not 2), `apparition-short` (under 5 s), `title-pause` (not 0.8–1.4 s between the title and the poem). |
 
 Like compilers, validators are pure, one file per version
 (`src/validators/<id>/<version>.ts`, registered in `src/validators.ts`, the
````

- [ ] **Step 4: The golden episode on disk, rendered for real**

````diff
diff --git a/studio/episode/src/testing.ts b/studio/episode/src/testing.ts
index aeb9345..27e1629 100644
--- a/studio/episode/src/testing.ts
+++ b/studio/episode/src/testing.ts
@@ -1,7 +1,8 @@
-// A spec-driven episode on disk, made from @studio/series's poetry-short
-// fixture: the contracts' example release copied into the series, the
-// fixture's spec, two narration takes with their word timing, three images.
-// Media are small placeholder files unless the caller writes real ones.
+// Spec-driven episodes on disk, made from @studio/series's fixtures: a
+// poetry-short episode (the contracts' example release copied into the
+// series, the fixture's spec, two narration takes with their word timing,
+// three images) and the dentro-i-versi-short golden San Martino. Media are
+// small placeholder files unless the caller writes real ones.
 
 import { createHash } from "node:crypto";
 import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
@@ -11,6 +12,7 @@ import { dirname, join } from "node:path";
 const require = createRequire(import.meta.url);
 const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
 const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
+const DIV_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-short/1.0.0/input.json");
 
 export const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
 
@@ -27,20 +29,55 @@ export function specEpisode(
   episodeRef: { channel: string; series: string; episode: string },
   options: SpecEpisodeOptions = {},
 ): void {
-  const input = JSON.parse(readFileSync(INPUT, "utf-8"));
+  layOut(episodeDir, episodeRef, INPUT, RELEASE, "poetry-short", options);
+}
+
+export interface DivShortEpisodeOptions extends SpecEpisodeOptions {
+  /** Write the sound at `path` (absolute); placeholder bytes by default. */
+  sound?: (path: string, assetId: string) => void;
+}
+
+/**
+ * Lay out the dentro-i-versi-short golden episode — a synthetic San Martino:
+ * its release, spec, two takes with their word timing and energy, every
+ * picture and sound the spec names — at `episodeDir`.
+ */
+export function divShortEpisode(
+  episodeDir: string,
+  episodeRef: { channel: string; series: string; episode: string },
+  options: DivShortEpisodeOptions = {},
+): void {
+  layOut(episodeDir, episodeRef, DIV_INPUT, join(dirname(DIV_INPUT), "release"), "dentro-i-versi-short", options);
+}
+
+function layOut(
+  episodeDir: string,
+  episodeRef: { channel: string; series: string; episode: string },
+  inputPath: string,
+  release: string,
+  templateId: string,
+  options: DivShortEpisodeOptions,
+): void {
+  const input = JSON.parse(readFileSync(inputPath, "utf-8"));
   const seriesDir = dirname(dirname(episodeDir));
   const write = (relative: string, content: string | Buffer) => {
     mkdirSync(dirname(join(episodeDir, relative)), { recursive: true });
     writeFileSync(join(episodeDir, relative), content);
   };
 
-  cpSync(RELEASE, join(seriesDir, "templates", "poetry-short", "1.0.0"), { recursive: true });
+  cpSync(release, join(seriesDir, "templates", templateId, input.template.version), { recursive: true });
 
-  for (const panel of input.spec.data.panels as { assetId: string }[]) {
-    const path = join(episodeDir, "assets", "images", `${panel.assetId}.png`);
+  // Every picture and sound the fixture names, by its asset id.
+  for (const [id, asset] of Object.entries<{ path: string; kind: string }>(input.assets)) {
+    const path = join(episodeDir, asset.path);
     mkdirSync(dirname(path), { recursive: true });
-    if (options.image) options.image(path, panel.assetId);
-    else writeFileSync(path, `image ${panel.assetId}`);
+    if (id.startsWith("image-")) {
+      if (options.image) options.image(path, id.slice(6));
+      else writeFileSync(path, `image ${id.slice(6)}`);
+    } else if (id.startsWith("sound-")) {
+      if (options.sound) options.sound(path, id.slice(6));
+      else writeFileSync(path, `sound ${id.slice(6)}`);
+    }
   }
 
   // Each take's audio, then its timing (bound to that audio's real hash),
````

Create `studio/episode/tests/dentro-i-versi-short.e2e.test.ts`:

````ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderEpisode } from "../src/episode-render.js";
import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
import { divShortEpisode } from "../src/testing.js";

/**
 * The dentro-i-versi-short golden episode (avg-dcf.3), rendered for real
 * through Remotion with every museum kit: its layout sheet, then the video.
 * Slow (the video takes about half an hour), and it needs headless Chrome and ffmpeg. Only with
 * REMOTION_E2E=1, against @av/remotion-composer's and @studio/series's dist/
 * (build them first).
 */

const enabled = process.env.REMOTION_E2E === "1";
const REF = { channel: "dentro-i-versi", series: "short", episode: "san-martino" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

beforeAll(() => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), "div-short-e2e-"));
  let i = 0;
  divShortEpisode(dir(), REF, {
    image: (path, id) => id === "nebbia-texture"
      ? ff("-f", "lavfi", "-i", "nullsrc=s=256x256,geq=lum='128+60*sin(X/9)*cos(Y/13)':cb=128:cr=128,format=rgba,colorchannelmixer=aa=0.6", "-frames:v", "1", path)
      : ff("-f", "lavfi", "-i", `color=c=0x${(0x305080 + 0x101010 * i++).toString(16)}:s=${id.includes("sagoma") ? "360x480" : "1024x1536"}`, "-frames:v", "1", path),
    sound: (path) => ff("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "8", path),
    audio: (path, _take, seconds) => ff("-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ar", "48000", path),
  });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe.skipIf(!enabled)("the dentro-i-versi-short golden episode, rendered", () => {
  it("makes its layout sheet at the teleports and every verse; the sheet is then current", async () => {
    const { report, sheetPath } = await makeLayoutSheet(dir(), { episodeRef: REF });
    const labels = report.frames.map((f) => f.label ?? "").join(" ");
    expect(labels).toContain("start+0.85s");
    expect(labels).toContain("end-0.7s");
    for (let n = 1; n <= 8; n++) expect(labels).toContain(`verse-${n}`);
    expect(readdirSync(join(dir(), "artifacts/layout-sheet/frames"))).toHaveLength(report.frames.length);
    expect(existsSync(sheetPath)).toBe(true);
    expect(layoutSheetStatus(dir(), { episodeRef: REF }).state).toBe("current");
  }, 300_000);

  it("renders the whole video: 1129 frames, 1080x1920", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF, label: "e2e" });
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets", "-of", "json", render.outputPath]).toString());
    expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920, nb_read_packets: "1129" });
    expect(JSON.parse(readFileSync(join(dir(), "output", `${render.renderId}.timeline.json`), "utf-8")).durationInFrames).toBe(1129);
  }, 3_600_000);
});
````

Run:

```bash
npm run build --workspace @studio/series
cd studio/episode && npx tsc --noEmit && npx vitest run
```

Expected: PASS, with the e2e test skipped.

Then run the real render. It takes about half an hour, and needs nothing else running:

```bash
REMOTION_E2E=1 npx vitest run tests/dentro-i-versi-short.e2e.test.ts
```

Expected: PASS, 2 tests:
- the layout sheet includes the frames at the teleports and every verse;
- the video is 1129 frames at 1080×1920.

- [ ] **Step 5: Commit**

```bash
git add studio/series/src/validators/dentro-i-versi-short studio/series/src/validators.ts \
  studio/series/fixtures/validators/dentro-i-versi-short studio/series/README.md \
  studio/episode/src/testing.ts studio/episode/tests/dentro-i-versi-short.e2e.test.ts
git commit -m "dentro-i-versi-short@1.0.0: the validator, the golden episode on disk and its real render (avg-dcf.3.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Whole-branch checks

- [ ] **Step 1:** `git diff --stat 99a6b41 HEAD -- packages studio docs/adr docs/index.md`. Every difference must be one of these: the spec commits, `validate.test.ts`'s chip-for-plate profile check (Task 2), and the scratch scripts that were never part of the prototype commit. Anything else is a deviation from the plan; explain or fix it.
- [ ] **Step 2:** From the root, run `npm run check && npm run docs:build`. Expected: PASS. `check:paths` passes in the main checkout.
- [ ] **Step 3:** No commit. Report the test counts, the lock entries and the e2e duration.
