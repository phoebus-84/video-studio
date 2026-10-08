# What Draws Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.6.13`. A change to a composer module that never shapes a frame (the loudness pass, the render audit, the media probe, the audio volume) keeps a layout sheet current and the render cache's segments.

**Architecture:**
- `identity.ts` gains `NOT_DRAWING` and `drawsPictures(file)`. `drawingCodeHash` (the sheet's) uses them.
- `cached-render.ts`'s Node-side `runtime` hash uses them too. The browser bundle stays hashed whole.

**Tech Stack:** TypeScript, `node:test` (the composer).

**Spec:** `docs/superpowers/specs/2026-10-08-drawing-code-design.md`, on this branch.

Prototype: the local commit `1aa200f` on `scratch/drawing-code`. Never push or merge it. It passed:
- composer 428 (2 skipped);
- episode 243 (4 skipped);
- root `npm run check`.

## Global Constraints

- Work on branch `feat/drawing-code`, in the main checkout.
- Never push or merge without the user's go.
- Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`. Never run `bd`. Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes.
- Episode reads the composer from `dist/`: run `npm run build --workspace @av/remotion-composer` before its tests.
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **A drawing module must never be left out.**
  - `drawsPictures` matches whole top-level module names only: `audition.ts` still draws.
  - A file in a folder (any kit, even `kits/loudness/1.0.0.tsx`) always draws. The test pins both.
- **The list can't rot.** Every name in `NOT_DRAWING` must be a module in `src/`. The guard test pins this.
- **The cache key still changes for a renderer fix** in any other Node-side module (`render-cache.ts`, `cached-render.ts`, `assets.ts`). Only the four named modules are left out.

---

### Task 1: What draws

**Files:**
- Modify:
  - `packages/remotion-composer/src/identity.ts`;
  - `packages/remotion-composer/src/cached-render.ts`;
  - `packages/remotion-composer/src/index.ts`;
  - `packages/remotion-composer/README.md`.
- Create: `packages/remotion-composer/test/drawing-code.test.ts`.

**Interfaces:**
- Produces: `NOT_DRAWING: ReadonlySet<string>` and `drawsPictures(file: string): boolean`, both exported from the package.

- [ ] **Step 1: Write the failing test.**

Create `packages/remotion-composer/test/drawing-code.test.ts`:

````ts
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
````

- [ ] **Step 2: Run it, and see it fail.** `cd packages/remotion-composer && node --import tsx --test test/drawing-code.test.ts`. Expect `drawsPictures` not to be exported.

- [ ] **Step 3: Implement.**

````diff
diff --git a/packages/remotion-composer/README.md b/packages/remotion-composer/README.md
index 651190f..cfc4921 100644
--- a/packages/remotion-composer/README.md
+++ b/packages/remotion-composer/README.md
@@ -212,7 +212,11 @@ anything is written. Which frames to pick, and where an episode keeps its
 sheet, are the studio's (`@studio/episode`). `timelineKits(timeline)` lists
 the kits a timeline draws with and their code hashes without rendering. `drawingCodeHash()` names the rest of what draws the pictures —
 this package's built code and its Remotion and React versions — so a sheet
-made before a composer upgrade can be told apart from one made after.
+made before a composer upgrade can be told apart from one made after. The
+modules that never change a frame (`NOT_DRAWING`: `audit`, `loudness`,
+`probe`, `volume`) are left out of it, and out of the render cache's key: a
+fix to the final file's sound keeps the sheet current and the cached segments.
+A new module counts as drawing until it is named there.
 
 ## Partial render cache
 
diff --git a/packages/remotion-composer/src/cached-render.ts b/packages/remotion-composer/src/cached-render.ts
index 24d6a08..b0b4da6 100644
--- a/packages/remotion-composer/src/cached-render.ts
+++ b/packages/remotion-composer/src/cached-render.ts
@@ -7,6 +7,7 @@ import {promisify} from 'node:util';
 import {ensureBrowser, openBrowser, renderMedia} from '@remotion/renderer';
 import type {VideoConfig} from 'remotion';
 import {sha256} from './assets.js';
+import {drawsPictures} from './identity.js';
 import {cachedVideo, cacheKey, planVideo, type CacheReport} from './render-cache.js';
 import type {TimelineProps} from './Timeline.js';
 
@@ -20,12 +21,12 @@ const encoding = {
   pixelFormat: 'yuv420p', colorSpace: 'bt709', muted: true,
 } as const;
 
-async function codeHashes(dir: string): Promise<unknown[]> {
+async function codeHashes(dir: string, keep: (file: string) => boolean = () => true, base = dir): Promise<unknown[]> {
   const rows: unknown[] = [];
   for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
     // Never hash staged media as renderer code: it belongs in per-segment keys.
-    if (entry.isDirectory() && entry.name !== 'public') rows.push([entry.name, await codeHashes(path.join(dir, entry.name))]);
-    else if (entry.isFile() && /\.(js|tsx?|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
+    if (entry.isDirectory() && entry.name !== 'public') rows.push([entry.name, await codeHashes(path.join(dir, entry.name), keep, base)]);
+    else if (entry.isFile() && /\.(js|tsx?|json)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && keep(path.relative(base, path.join(dir, entry.name)))) {
       rows.push([entry.name, await sha256(path.join(dir, entry.name))]);
     }
   }
@@ -42,9 +43,10 @@ async function rendererKey(serveUrl: string): Promise<string> {
     cacheVersion: 1, encoding, platform: process.platform, arch: process.arch,
     node: process.version, browser: await sha256(browser.path), dependencies,
     // The bundle includes the actual kit/React/Remotion code. Node-side code
-    // is also hashed, so a renderer fix invalidates entries without a version bump.
+    // is also hashed, so a renderer fix invalidates entries without a version
+    // bump — but not the modules that never draw (a loudness fix keeps them).
     bundle: await codeHashes(serveUrl),
-    runtime: await codeHashes(path.dirname(fileURLToPath(import.meta.url))),
+    runtime: await codeHashes(path.dirname(fileURLToPath(import.meta.url)), drawsPictures),
     ffmpeg: (await exec(ffmpeg(), ['-version'])).stdout,
   });
 }
diff --git a/packages/remotion-composer/src/identity.ts b/packages/remotion-composer/src/identity.ts
index 1b8b7c2..e16fe94 100644
--- a/packages/remotion-composer/src/identity.ts
+++ b/packages/remotion-composer/src/identity.ts
@@ -1,6 +1,7 @@
 // What draws a sheet's pictures besides the timeline (avg-3th.1): this
-// package's own code — the compositions, the kits and the helpers they share —
-// and the Remotion and React versions it draws with. A layout sheet records
+// package's own code — the compositions, the kits and the helpers they share,
+// not the modules that never draw (NOT_DRAWING, avg-dcf.6.13) — and the
+// Remotion and React versions it draws with. A layout sheet records
 // it, so a composer upgrade makes the sheet stale even when no kit version
 // changed.
 
@@ -12,12 +13,30 @@ import {fileURLToPath} from 'node:url';
 
 const CODE = /\.(js|ts|tsx|json)$/;
 
+/**
+ * The modules whose code never changes a frame (avg-dcf.6.13): the rendered
+ * file's checks, the final file's sound, reading media, per-frame audio gain.
+ * A sheet stays current, and the render cache keeps its segments, when only
+ * these change. Every other module counts as drawing until it is named here.
+ */
+export const NOT_DRAWING: ReadonlySet<string> = new Set(['audit', 'loudness', 'probe', 'volume']);
+
+/**
+ * Whether a code file can change what a frame shows. `file` is its path from
+ * the package's code root (src/ or its build): only a top-level module can be
+ * one that never draws — a kit is always drawing, whatever its name.
+ */
+export function drawsPictures(file: string): boolean {
+  if (/[\\/]/.test(file)) return true;
+  return !NOT_DRAWING.has(file.replace(/\.(tsx?|jsx?|json)$/, ''));
+}
+
 function codeFiles(dir: string, base = dir): [string, string][] {
   const rows: [string, string][] = [];
   for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
     const full = path.join(dir, entry.name);
     if (entry.isDirectory()) rows.push(...codeFiles(full, base));
-    else if (entry.isFile() && CODE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
+    else if (entry.isFile() && CODE.test(entry.name) && !entry.name.endsWith('.d.ts') && drawsPictures(path.relative(base, full))) {
       rows.push([path.relative(base, full).split(path.sep).join('/'), createHash('sha256').update(readFileSync(full)).digest('hex')]);
     }
   }
diff --git a/packages/remotion-composer/src/index.ts b/packages/remotion-composer/src/index.ts
index ce8e5e6..a597bab 100644
--- a/packages/remotion-composer/src/index.ts
+++ b/packages/remotion-composer/src/index.ts
@@ -3,7 +3,7 @@ export {type CacheReport} from './render-cache.js';
 export {validateTimeline} from './validate.js';
 export {renderLayoutSheet, sheetTime, MAX_SHEET_PICKS, type LayoutSheetOptions, type LayoutSheetResult, type LayoutSheetFrame} from './layout-sheet.js';
 export {kitLockHash, timelineKits, type LockedKit} from './kit-lock.js';
-export {drawingCodeHash} from './identity.js';
+export {drawingCodeHash, drawsPictures, NOT_DRAWING} from './identity.js';
 export {listKits, previewPath, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample, type KitProfile} from './kits/index.js';
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
 export {BUNDLED_FAMILIES} from './kits/lib/fonts/1.1.0.js';
````

- [ ] **Step 4: Run them, and see them pass.**
  - `cd packages/remotion-composer && npm test`: 428 pass, 2 skipped.
  - Then `npm run build --workspace @av/remotion-composer`.
  - `cd studio/episode && npx vitest run`: 243 pass, 4 skipped.
  - At the root, `npm run check`.

- [ ] **Step 5: Commit.**

```bash
git add packages/remotion-composer/src/identity.ts packages/remotion-composer/src/cached-render.ts packages/remotion-composer/src/index.ts packages/remotion-composer/README.md packages/remotion-composer/test/drawing-code.test.ts
git commit -m "What draws: an audio-only composer change keeps the sheet and the render cache (avg-dcf.6.13)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
