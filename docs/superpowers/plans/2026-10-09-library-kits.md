# Kits a Channel or a Series Carries Implementation Plan (avg-d1x, phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel or a series can carry kits in the library.
- `vpr kit seal` builds `kit/index.tsx` into a sealed `kit.cjs` and writes `kit.json`.
- A series release pins the kits it draws with.
- The loader loads them, compiling validates their props, and render and the layout sheet draw them with the application's React and Remotion.

**Architecture:**
- **Composer:**
  - `registerLibraryKits` and `resolveKit(…, extra)`;
  - `library-kits.ts` (`loadLibraryKit`, `readLibraryKits`, `libraryEntry`, `resolveFromApplication`);
  - `validateTimeline(doc, {kits})`;
  - `timelineKits(timeline, library)`;
  - `renderTimeline` and `renderLayoutSheet` take `kits`.
- **Contracts:** the `KitRelease` schema (`kit.json`), `kit-releases.mjs`, and `SeriesTemplate.kits` pins.
- **Series:** `CompileInput.kits`, validated in `compileSpec`.
- **Episode:**
  - `kit-code.ts` (`sealKit`, `verifyKit`, `readKitRelease`, `pinnedKitHashes`);
  - `bundleSource`, generalized from phase 1's build;
  - the loader loading pins;
  - `libraryKitsOf` for render and sheet.
- **CLI:** `vpr kit seal|verify`.

**Tech Stack:** TypeScript, React, Remotion, esbuild (installed), zod, node:test and vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-channel-series-extensions-design.md` (decisions 1, 2, 3, 4 and 6 for kits; phase 2). ADR-0041 is phase 1.

Prototype: the local commit `88d77c2` on `scratch/library-kits`. Never push or merge it. It passed:
- the root `npm run check`;
- the composer's real end-to-end layout sheet with a library kit (`REMOTION_E2E=1`).

## Global Constraints

- Work on a new branch `feat/library-kits` from `main`, in the main checkout.
- Never push or merge without the user's go.
- **Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`.**
  - They hold the user's unrelated local changes. Never `git stash`.
  - Never run `bd`.
  - Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes.
- **Dist build order:** consumers read `dist/`. Build in this order before the next package's tests:
  1. `npm run build --workspace @av/remotion-composer`;
  2. `--workspace @studio/series`;
  3. `--workspace @studio/episode`;
  4. `--workspace @studio/runtime`.
- Composer tests run with `node --import tsx --test`. The composer's end-to-end test needs `REMOTION_E2E=1` and the built `dist/`.
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **One React.** A library kit must draw with the application's React and Remotion, never a copy. The composer's end-to-end test pins this: the card is drawn at frame 12 in its colour.
- **The bytes run are the bytes hashed.** This applies to the kit bundle in Node (`readLibraryKits`, `readKitRelease`) as it does to phase 1's code.
- **No library kit takes an application kit's `name@version`.** This is checked at seal, at load and at render (Tasks 1 and 3).
- **A sealed, pinned kit never changes.** `sealKit` refuses once a series release pins it, and `kit.json` and `kit.cjs` that are not the pinned or sealed ones are refused (Task 3).
- **Unchanged without library kits.** A timeline and a release without library kits render exactly as before. The package's own `remotion-entry.js` is used, with no webpack override.

---

### Task 1: The composer draws library kits

**Files:**
- Create:
  - `packages/remotion-composer/src/library-kits.ts`;
  - `packages/remotion-composer/test/library-kit-fixture.ts`;
  - `packages/remotion-composer/test/library-kits.test.ts`;
  - `packages/remotion-composer/test/library-kits.e2e.test.ts`.
- Modify:
  - `packages/remotion-composer/src/kits/index.ts`;
  - `packages/remotion-composer/src/validate.ts`;
  - `packages/remotion-composer/src/kit-lock.ts`;
  - `packages/remotion-composer/src/render.ts`;
  - `packages/remotion-composer/src/layout-sheet.ts`;
  - `packages/remotion-composer/src/errors.ts`;
  - `packages/remotion-composer/src/index.ts`.

**Interfaces:**
- Produces:
  - `LibraryKit {name, version, file, hash}`;
  - `loadLibraryKit(file, bytes, hash)`;
  - `readLibraryKits(kits)`;
  - `isApplicationKit(name, version)`;
  - `validateTimeline(doc, {kits?})`;
  - `timelineKits(timeline, library?)`;
  - `RenderTimelineOptions.kits` and `LayoutSheetOptions.kits`;
  - the error code `bad-kit`.

- [ ] **Step 1: Write the failing tests.**

Create `packages/remotion-composer/test/library-kit-fixture.ts`:

````ts
// A library kit (avg-d1x) built for the tests: a full-frame colour card with a
// line of text, compiled outside this package as `vpr kit seal` builds one —
// one CommonJS file, React, Remotion and zod left to the application.

import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

export const SAMPLE_KIT = (name: string, version: string) => `
import React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";
export const kit = {
  name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)},
  description: "A colour card from the library",
  props: z.object({ text: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/) }).strict(),
  component: ({ props }: { props: { text: string; color: string } }) =>
    <AbsoluteFill style={{ background: props.color, color: "#ffffff", fontSize: 96 }}>{props.text}</AbsoluteFill>,
  examples: [],
};
`;

/** Build the sample kit (or `source`) into `dir`/kit.cjs; its absolute path and "sha256:…". */
export async function buildLibraryKit(dir: string, options: {name?: string; version?: string; source?: string} = {}): Promise<{file: string; hash: string; bytes: Buffer}> {
  const esbuild = createRequire(import.meta.url)('esbuild') as typeof import('esbuild');
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'index.tsx'), options.source ?? SAMPLE_KIT(options.name ?? 'sample-card', options.version ?? '1.0.0'));
  const out = await esbuild.build({
    entryPoints: [path.join(dir, 'index.tsx')], bundle: true, format: 'cjs', platform: 'browser', write: false, jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'remotion', 'zod'], logLevel: 'silent',
  });
  const bytes = Buffer.from(out.outputFiles[0]!.contents);
  const file = path.join(dir, 'kit.cjs');
  await writeFile(file, bytes);
  return {file, bytes, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`};
}
````

Create `packages/remotion-composer/test/library-kits.test.ts`:

````ts
// Kits a channel or a series carries in the library (avg-d1x): loaded with the
// application's React, Remotion and zod, validated like the application's
// kits, locked by their bundle's hash, and registered by a generated entry.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ComposerError} from '../src/errors.js';
import {timelineKits} from '../src/kit-lock.js';
import {isApplicationKit, resolveKit} from '../src/kits/index.js';
import {libraryEntry, loadLibraryKit, readLibraryKits} from '../src/library-kits.js';
import {validateTimeline} from '../src/validate.js';
import {clone, fixture} from './helpers.js';
import {buildLibraryKit} from './library-kit-fixture.js';

/** The explainer's frame, drawn with one item of the sample kit. */
function cardTimeline(props: Record<string, unknown> = {text: 'from the library', color: '#1b2a4a'}) {
  const doc = clone(fixture('explainer.json'));
  doc.durationInFrames = 30;
  doc.assets = {};
  doc.tracks = [{id: 'main', type: 'visual', z: 0, items: [{id: 'card', from: 0, duration: 30, kit: {name: 'sample-card', version: '1.0.0'}, props}]}];
  return doc;
}

describe('library kits', () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'library-kits-')); });
  after(async () => { await rm(dir, {recursive: true, force: true}); });

  it('loads a sealed kit with the application’s packages and validates its props', async () => {
    const built = await buildLibraryKit(path.join(dir, 'sample'));
    const loaded = loadLibraryKit(built.file, built.bytes, built.hash);
    assert.ok(loaded.ok, !loaded.ok ? loaded.message : '');
    assert.equal(loaded.kit.name, 'sample-card');

    assert.equal(validateTimeline(cardTimeline()).ok, false, 'without the library kit the timeline names an unknown kit');
    assert.ok(validateTimeline(cardTimeline(), {kits: [loaded.kit]}).ok);
    const bad = validateTimeline(cardTimeline({text: 'x', color: 'red'}), {kits: [loaded.kit]});
    assert.deepEqual(!bad.ok && bad.problems.map((p) => p.code), ['bad-props']);
  });

  it('locks a library kit by its bundle’s hash', async () => {
    const built = await buildLibraryKit(path.join(dir, 'lock'));
    assert.equal(timelineKits(cardTimeline()), null);
    assert.deepEqual(timelineKits(cardTimeline(), [{name: 'sample-card', version: '1.0.0', hash: built.hash}]), [{name: 'sample-card', version: '1.0.0', hash: built.hash}]);
  });

  it('refuses a bundle that is not the sealed one, one that exports no kit, another name, and an application kit’s name', async () => {
    const built = await buildLibraryKit(path.join(dir, 'checks'));
    const code = async (kits: Parameters<typeof readLibraryKits>[0]) => {
      try {
        await readLibraryKits(kits);
        return 'ok';
      } catch (e) {
        assert.ok(e instanceof ComposerError);
        return `${e.code}: ${e.message}`;
      }
    };
    assert.equal(await code([{name: 'sample-card', version: '1.0.0', file: built.file, hash: built.hash}]), 'ok');
    assert.match(await code([{name: 'sample-card', version: '1.0.0', file: built.file, hash: `sha256:${'0'.repeat(64)}`}]), /^bad-kit: .*not the sealed bundle/);
    assert.match(await code([{name: 'other-card', version: '1.0.0', file: built.file, hash: built.hash}]), /^bad-kit: .*the bundle is sample-card@1\.0\.0/);
    assert.ok(isApplicationKit('still', '1.0.0'));
    assert.match(await code([{name: 'still', version: '1.0.0', file: built.file, hash: built.hash}]), /^bad-kit: still@1\.0\.0 is an application kit/);
    const empty = await buildLibraryKit(path.join(dir, 'empty'), {source: 'export const nothing = 1;\n'});
    assert.match(await code([{name: 'sample-card', version: '1.0.0', file: empty.file, hash: empty.hash}]), /^bad-kit: .*does not export a kit/);
  });

  it('writes a bundle entry that registers the library kits before the root, and keeps the package’s own without them', async () => {
    const built = await buildLibraryKit(path.join(dir, 'entry'));
    const own = await libraryEntry(dir, []);
    assert.equal(path.basename(own), 'remotion-entry.js');
    const entry = await libraryEntry(dir, [{name: 'sample-card', version: '1.0.0', file: built.file, hash: built.hash}]);
    const text = await readFile(entry, 'utf-8');
    assert.ok(text.indexOf('registerLibraryKits([kit0.kit])') < text.indexOf('registerRoot(RemotionRoot)'));
    assert.ok(text.includes(JSON.stringify(built.file)));
    // The application's own resolution never sees a library kit unless it is registered or handed.
    assert.equal(resolveKit('sample-card', '1.0.0'), undefined);
  });
});
````

Create `packages/remotion-composer/test/library-kits.e2e.test.ts`:

````ts
// A library kit drawn for real (avg-d1x): a layout sheet of a timeline whose
// only item is a kit built outside this package. Slow, and it needs headless
// Chrome: only with REMOTION_E2E=1, against the build in dist/.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {clone, fixture} from './helpers.js';
import {buildLibraryKit} from './library-kit-fixture.js';

const enabled = process.env.REMOTION_E2E === '1';

/** The colour at the still's centre, as "#rrggbb". */
function centre(file: string): string {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=2:2:iw/2:ih/2,format=rgb24,scale=1:1', '-f', 'rawvideo', '-'], {maxBuffer: 1 << 20});
  assert.equal(out.status, 0, out.stderr?.toString());
  return `#${[...out.stdout.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('a library kit in a real layout sheet', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
  it('draws the kit with the application\'s React and Remotion, and locks it by its hash', async () => {
    const {renderLayoutSheet} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'library-kit-sheet-'));
    try {
      const built = await buildLibraryKit(path.join(root, 'channel', 'kits', 'sample-card', '1.0.0'));
      const doc = clone(fixture('explainer.json'));
      doc.durationInFrames = 30;
      doc.assets = {};
      doc.tracks = [{id: 'main', type: 'visual', z: 0, items: [{id: 'card', from: 0, duration: 30, kit: {name: 'sample-card', version: '1.0.0'}, props: {text: '', color: '#1b2a4a'}}]}];
      const kits = [{name: 'sample-card', version: '1.0.0', file: built.file, hash: built.hash}];
      const result = await renderLayoutSheet({timeline: doc, assetRoot: root, picks: [{frame: 12, label: 'card'}], outDir: path.join(root, 'sheet'), kits});
      assert.deepEqual(result.kits, [{name: 'sample-card', version: '1.0.0', hash: built.hash}]);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(centre(result.frames[0]!.path).slice(i, i + 2), 16));
      // JPEG: near the card's colour, not exactly it.
      assert.ok(Math.abs(r! - 0x1b) < 8 && Math.abs(g! - 0x2a) < 8 && Math.abs(b! - 0x4a) < 8, `centre is ${centre(result.frames[0]!.path)}`);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
````

- [ ] **Step 2: Run them, and see them fail.** `cd packages/remotion-composer && node --import tsx --test test/library-kits.test.ts`. Expect the module `../src/library-kits.js` not to be found.

- [ ] **Step 3: Implement.**

Create `packages/remotion-composer/src/library-kits.ts`:

````ts
// ---------------------------------------------------------------------------
// Kits a channel or a series carries in the library (avg-d1x)
// ---------------------------------------------------------------------------
// A kit release holds a self-contained CommonJS bundle (`kit.cjs`, sealed by
// `vpr kit seal`) exporting `kit`, a KitVersion. React, Remotion and zod stay
// external: the kit draws with the application's own, in Node (props
// validation) and in the Remotion bundle (drawing).
// ---------------------------------------------------------------------------

import Module from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ComposerError} from './errors.js';
import {isApplicationKit} from './kits/index.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {KitVersion} from './kits/types.js';

/** A library kit as a render receives it: where its sealed bundle is, and that bundle's hash. */
export interface LibraryKit {
  name: string;
  version: string;
  /** Absolute path of the sealed kit.cjs. */
  file: string;
  /** "sha256:…" of its bytes. */
  hash: string;
}

const own = path.dirname(fileURLToPath(import.meta.url));
/** Where the kit's external packages resolve from: this package's node_modules and its ancestors'. */
const modulePaths = (Module as unknown as {_nodeModulePaths(dir: string): string[]})._nodeModulePaths(own);
const loaded = new Map<string, KitVersion>();

/**
 * The KitVersion a sealed kit bundle exports, run from the bytes whose hash
 * the caller checked, or why it is not one. One module per hash.
 */
export function loadLibraryKit(file: string, bytes: Buffer, hash: string): {ok: true; kit: KitVersion} | {ok: false; message: string} {
  const hit = loaded.get(hash);
  if (hit) return {ok: true, kit: hit};
  let exports: Record<string, unknown>;
  try {
    const ModuleCtor = Module as unknown as new (id: string) => {filename: string; paths: string[]; exports: Record<string, unknown>; _compile(code: string, file: string): void};
    const m = new ModuleCtor(file);
    m.filename = file;
    m.paths = modulePaths;
    m._compile(bytes.toString('utf-8'), file);
    exports = m.exports;
  } catch (e) {
    return {ok: false, message: `it does not load: ${e instanceof Error ? e.message : String(e)}`};
  }
  const kit = exports.kit as Partial<KitVersion> | undefined;
  if (!kit || typeof kit.name !== 'string' || typeof kit.version !== 'string' || typeof kit.component !== 'function' || !kit.props || typeof (kit.props as {safeParse?: unknown}).safeParse !== 'function') {
    return {ok: false, message: 'it does not export a kit (`export const kit` with name, version, props and component)'};
  }
  loaded.set(hash, kit as KitVersion);
  return {ok: true, kit: kit as KitVersion};
}

/**
 * The bundle entry for a render with library kits: the application's root,
 * with the kits registered first. Written into `dir`; returns its path.
 * Without library kits the package's own entry is used as before.
 */
export async function libraryEntry(dir: string, kits: readonly LibraryKit[]): Promise<string> {
  if (kits.length === 0) return path.join(own, 'remotion-entry.js');
  const lines = [
    `import {registerRoot} from 'remotion';`,
    `import {registerLibraryKits} from ${JSON.stringify(path.join(own, 'kits', 'index.js'))};`,
    `import {RemotionRoot} from ${JSON.stringify(path.join(own, 'Root.js'))};`,
    ...kits.map((k, i) => `import * as kit${i} from ${JSON.stringify(k.file)};`),
    `registerLibraryKits([${kits.map((_, i) => `kit${i}.kit`).join(', ')}]);`,
    `registerRoot(RemotionRoot);`,
  ];
  const entry = path.join(dir, 'library-entry.js');
  await writeFile(entry, `${lines.join('\n')}\n`);
  return entry;
}

/** A webpack override letting the library kits' external packages resolve from the application. */
export function resolveFromApplication<T extends {resolve?: {modules?: string[]}}>(config: T): T {
  return {...config, resolve: {...config.resolve, modules: [...(config.resolve?.modules ?? ['node_modules']), ...modulePaths]}};
}

/**
 * The library kits a render is handed, loaded and checked: each bundle's
 * bytes are the sealed ones, it exports the kit it is named as, and no
 * library kit takes an application kit's name@version.
 */
export async function readLibraryKits(kits: readonly LibraryKit[]): Promise<KitVersion[]> {
  const out: KitVersion[] = [];
  for (const k of kits) {
    const label = `${k.name}@${k.version}`;
    if (isApplicationKit(k.name, k.version)) throw new ComposerError('bad-kit', `${label} is an application kit: a library kit takes another name or version`);
    let bytes: Buffer;
    try {
      bytes = await readFile(k.file);
    } catch {
      throw new ComposerError('bad-kit', `${label}: ${k.file} is missing`);
    }
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== k.hash) throw new ComposerError('bad-kit', `${label}: ${k.file} is not the sealed bundle`);
    const loadedKit = loadLibraryKit(k.file, bytes, k.hash);
    if (!loadedKit.ok) throw new ComposerError('bad-kit', `${label}: ${loadedKit.message}`);
    if (loadedKit.kit.name !== k.name || loadedKit.kit.version !== k.version) {
      throw new ComposerError('bad-kit', `${label}: the bundle is ${loadedKit.kit.name}@${loadedKit.kit.version}`);
    }
    out.push(loadedKit.kit);
  }
  return out;
}
````

````diff
diff --git a/packages/remotion-composer/src/errors.ts b/packages/remotion-composer/src/errors.ts
index 132a92c..1a20aff 100644
--- a/packages/remotion-composer/src/errors.ts
+++ b/packages/remotion-composer/src/errors.ts
@@ -1,6 +1,7 @@
 export type ComposerErrorCode =
   | 'invalid-timeline'
   | 'unknown-kit'
+  | 'bad-kit'
   | 'bad-props'
   | 'wrong-profile'
   | 'missing-asset'
diff --git a/packages/remotion-composer/src/index.ts b/packages/remotion-composer/src/index.ts
index a597bab..43b694c 100644
--- a/packages/remotion-composer/src/index.ts
+++ b/packages/remotion-composer/src/index.ts
@@ -4,7 +4,8 @@ export {validateTimeline} from './validate.js';
 export {renderLayoutSheet, sheetTime, MAX_SHEET_PICKS, type LayoutSheetOptions, type LayoutSheetResult, type LayoutSheetFrame} from './layout-sheet.js';
 export {kitLockHash, timelineKits, type LockedKit} from './kit-lock.js';
 export {drawingCodeHash, drawsPictures, NOT_DRAWING} from './identity.js';
-export {listKits, previewPath, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample, type KitProfile} from './kits/index.js';
+export {loadLibraryKit, readLibraryKits, type LibraryKit} from './library-kits.js';
+export {listKits, previewPath, resolveKit, isApplicationKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample, type KitProfile} from './kits/index.js';
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
 export {BUNDLED_FAMILIES} from './kits/lib/fonts/1.1.0.js';
 export {type LoudnessTarget, type LoudnessResult} from './loudness.js';
diff --git a/packages/remotion-composer/src/kit-lock.ts b/packages/remotion-composer/src/kit-lock.ts
index e5801cb..aa21168 100644
--- a/packages/remotion-composer/src/kit-lock.ts
+++ b/packages/remotion-composer/src/kit-lock.ts
@@ -25,7 +25,7 @@ export interface LockedKit {
  * code hash; null for a kit the lock does not know (a timeline the composer
  * would refuse anyway).
  */
-export function timelineKits(timeline: Pick<EditTimeline, 'tracks'>): LockedKit[] | null {
+export function timelineKits(timeline: Pick<EditTimeline, 'tracks'>, library: readonly LockedKit[] = []): LockedKit[] | null {
   const kits = new Map<string, {name: string; version: string}>();
   for (const item of timeline.tracks.flatMap((t) => t.items)) {
     if (isAudioItem(item)) continue;
@@ -34,7 +34,8 @@ export function timelineKits(timeline: Pick<EditTimeline, 'tracks'>): LockedKit[
   }
   const locked: LockedKit[] = [];
   for (const {name, version} of [...kits.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
-    const hash = kitLockHash(name, version);
+    // A library kit's hash is its sealed bundle's (avg-d1x).
+    const hash = kitLockHash(name, version) ?? library.find((k) => k.name === name && k.version === version)?.hash;
     if (hash === undefined) return null;
     locked.push({name, version, hash});
   }
diff --git a/packages/remotion-composer/src/kits/index.ts b/packages/remotion-composer/src/kits/index.ts
index 18b059c..b1105ee 100644
--- a/packages/remotion-composer/src/kits/index.ts
+++ b/packages/remotion-composer/src/kits/index.ts
@@ -56,7 +56,22 @@ const key = (name: string, version: string) => `${name}@${version}`;
 const byKey = new Map(KIT_VERSIONS.map((k) => [key(k.name, k.version), k]));
 
 /** The exact version a timeline names, or undefined. */
-export const resolveKit = (name: string, version: string): KitVersion | undefined => byKey.get(key(name, version));
+/**
+ * Kits a channel or a series carries in the library (avg-d1x), registered by
+ * the generated bundle entry before the root renders. Node-side callers pass
+ * theirs explicitly instead (validateTimeline's `kits`).
+ */
+const library = new Map<string, KitVersion>();
+export function registerLibraryKits(kits: readonly KitVersion[]): void {
+  for (const k of kits) library.set(key(k.name, k.version), k);
+}
+
+/** The exact version a timeline names: the application's, else one of `extra`, else one registered from the library. */
+export const resolveKit = (name: string, version: string, extra?: readonly KitVersion[]): KitVersion | undefined =>
+  byKey.get(key(name, version)) ?? extra?.find((k) => k.name === name && k.version === version) ?? library.get(key(name, version));
+
+/** Whether the application itself has this kit version: a library kit may never take its name@version. */
+export const isApplicationKit = (name: string, version: string): boolean => byKey.has(key(name, version));
 
 /** The versions available for a kit name, e.g. ["1.0.0", "1.1.0"]. */
 export const kitVersions = (name: string): string[] =>
diff --git a/packages/remotion-composer/src/layout-sheet.ts b/packages/remotion-composer/src/layout-sheet.ts
index c79ef07..0f5a322 100644
--- a/packages/remotion-composer/src/layout-sheet.ts
+++ b/packages/remotion-composer/src/layout-sheet.ts
@@ -6,12 +6,12 @@
 import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import path from 'node:path';
-import {fileURLToPath} from 'node:url';
 import {bundle} from '@remotion/bundler';
 import {openBrowser, renderStill, selectComposition, type HeadlessBrowser} from '@remotion/renderer';
 import {stageAssets, sha256} from './assets.js';
 import {ComposerError} from './errors.js';
 import {timelineKits, type LockedKit} from './kit-lock.js';
+import {libraryEntry, readLibraryKits, resolveFromApplication, type LibraryKit} from './library-kits.js';
 import {sheetSize, type SheetProps} from './Sheet.js';
 import {validateTimeline} from './validate.js';
 import {videoFrames} from './probe.js';
@@ -36,6 +36,8 @@ export interface LayoutSheetOptions {
   columns?: number;
   /** Stills rendered at once. Default 6. */
   parallel?: number;
+  /** Kits the channel or the series carries (avg-d1x), beside the application's. */
+  kits?: readonly LibraryKit[];
 }
 
 export interface LayoutSheetFrame {
@@ -68,7 +70,8 @@ function refuse(message: string): never {
 }
 
 export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<LayoutSheetResult> {
-  const checked = validateTimeline(options.timeline);
+  const library = await readLibraryKits(options.kits ?? []);
+  const checked = validateTimeline(options.timeline, {kits: library});
   if (!checked.ok) {
     const code = checked.problems[0]!.code;
     throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
@@ -91,7 +94,7 @@ export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<La
   if (!(scale > 0 && scale <= 1)) refuse(`scale ${scale} is not in (0, 1]`);
   if (!Number.isInteger(columns) || columns < 1) refuse(`columns ${columns} is not a positive whole number`);
 
-  const kits = timelineKits(timeline) ?? refuse('a kit of this timeline is not in kits.lock.json');
+  const kits = timelineKits(timeline, options.kits ?? []) ?? refuse('a kit of this timeline is neither in kits.lock.json nor a library kit it was handed');
 
   const staging = await stageAssets(timeline, options.assetRoot, options.sharedRoots);
   if (!staging.ok) {
@@ -108,7 +111,7 @@ export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<La
       if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
     }
     await mkdir(path.join(outDir, 'frames'), {recursive: true});
-    const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remotion-entry.js');
+    const entryPoint = await libraryEntry(work, options.kits ?? []);
     const frames: LayoutSheetFrame[] = picks.map((p, index) => ({
       index,
       frame: p.frame,
@@ -120,7 +123,10 @@ export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<La
     const sheetPath = path.join(outDir, 'sheet.jpg');
     let sheet: SheetProps;
     try {
-      const serveUrl = await bundle({entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle')});
+      const serveUrl = await bundle({
+        entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle'),
+        ...(options.kits?.length ? {webpackOverride: resolveFromApplication} : {}),
+      });
       browser = await openBrowser('chrome');
       const inputProps = {timeline, files: staged.files, assetFrames};
       const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps, puppeteerInstance: browser});
diff --git a/packages/remotion-composer/src/render.ts b/packages/remotion-composer/src/render.ts
index acf4bcc..7abb7ce 100644
--- a/packages/remotion-composer/src/render.ts
+++ b/packages/remotion-composer/src/render.ts
@@ -5,7 +5,6 @@
 import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import path from 'node:path';
-import {fileURLToPath} from 'node:url';
 import {bundle} from '@remotion/bundler';
 import {renderMedia, selectComposition} from '@remotion/renderer';
 import {stageAssets, sha256} from './assets.js';
@@ -15,6 +14,7 @@ import {isAudioItem} from './schema.js';
 import {validateTimeline} from './validate.js';
 import {videoFrames} from './probe.js';
 import {renderWithCache} from './cached-render.js';
+import {libraryEntry, readLibraryKits, resolveFromApplication, type LibraryKit} from './library-kits.js';
 import type {CacheReport} from './render-cache.js';
 
 export interface RenderTimelineOptions {
@@ -31,6 +31,8 @@ export interface RenderTimelineOptions {
   onProgress?: (progress: number) => void;
   /** Overrides the timeline's `profile.loudness`. */
   loudness?: LoudnessTarget;
+  /** Kits the channel or the series carries (avg-d1x), beside the application's. */
+  kits?: readonly LibraryKit[];
 }
 
 export interface RenderResult {
@@ -47,7 +49,8 @@ export interface RenderResult {
 }
 
 export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderResult> {
-  const checked = validateTimeline(options.timeline);
+  const library = await readLibraryKits(options.kits ?? []);
+  const checked = validateTimeline(options.timeline, {kits: library});
   if (!checked.ok) {
     const code = checked.problems[0]!.code;
     throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
@@ -65,7 +68,7 @@ export async function renderTimeline(options: RenderTimelineOptions): Promise<Re
       if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
     }
     const inputProps = {timeline, files: staged.files, assetFrames};
-    const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remotion-entry.js');
+    const entryPoint = await libraryEntry(work, options.kits ?? []);
     const hasAudio = timeline.tracks.some((t) => t.type === 'audio' && !t.muted && t.items.some(isAudioItem));
     const output = path.resolve(options.outputPath);
     await mkdir(path.dirname(output), {recursive: true});
@@ -76,7 +79,10 @@ export async function renderTimeline(options: RenderTimelineOptions): Promise<Re
     try {
       // The bundle — which copies the staged public directory — lives in the work
       // directory, so it is removed with it, on success and on failure.
-      const serveUrl = await bundle({entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle')});
+      const serveUrl = await bundle({
+        entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle'),
+        ...(options.kits?.length ? {webpackOverride: resolveFromApplication} : {}),
+      });
       const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
       if (options.cacheDir) {
         cache = await renderWithCache({
diff --git a/packages/remotion-composer/src/validate.ts b/packages/remotion-composer/src/validate.ts
index 7f73d43..5a75832 100644
--- a/packages/remotion-composer/src/validate.ts
+++ b/packages/remotion-composer/src/validate.ts
@@ -12,7 +12,10 @@ const member = (key: string | number) =>
   typeof key === 'number' ? `[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
 const pathOf = (base: string, issue: ZodIssue) => base + issue.path.map(member).join('');
 
-export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimeline} | {ok: false; problems: ComposerProblem[]} {
+import type {KitVersion} from './kits/types.js';
+
+/** `kits`: the library kits (avg-d1x) the timeline may also draw with, beside the application's. */
+export function validateTimeline(doc: unknown, options: {kits?: readonly KitVersion[]} = {}): {ok: true; timeline: EditTimeline} | {ok: false; problems: ComposerProblem[]} {
   const parsed = EditTimelineSchema.safeParse(doc);
   if (!parsed.success) {
     return {ok: false, problems: parsed.error.issues.map((i) => ({code: 'invalid-timeline' as const, message: i.message, path: pathOf('$', i)}))};
@@ -47,7 +50,7 @@ export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimelin
     track.items.forEach((item, ii) => {
       if (isAudioItem(item)) return;
       const p = `$.tracks[${ti}].items[${ii}]`;
-      const kit = resolveKit(item.kit.name, item.kit.version);
+      const kit = resolveKit(item.kit.name, item.kit.version, options.kits ?? []);
       if (!kit) {
         const versions = kitVersions(item.kit.name);
         const known = versions.length > 0 ? `available ${versions.map((v) => `${item.kit.name}@${v}`).join(', ')}` : `no kit "${item.kit.name}"`;
````

- [ ] **Step 4: Run them, and see them pass.**
  - `node --import tsx --test test/library-kits.test.ts`: 4 pass.
  - `npm run build`, then `REMOTION_E2E=1 node --import tsx --test test/library-kits.e2e.test.ts`: 1 pass.
  - `npm test`: everything passes.
  - `npx tsc --noEmit -p .` is clean.

- [ ] **Step 5: Commit.**

```bash
git add packages/remotion-composer/src/library-kits.ts packages/remotion-composer/src/kits/index.ts packages/remotion-composer/src/validate.ts packages/remotion-composer/src/kit-lock.ts packages/remotion-composer/src/render.ts packages/remotion-composer/src/layout-sheet.ts packages/remotion-composer/src/errors.ts packages/remotion-composer/src/index.ts packages/remotion-composer/test/library-kit-fixture.ts packages/remotion-composer/test/library-kits.test.ts packages/remotion-composer/test/library-kits.e2e.test.ts
git commit -m "Composer: library kits, loaded with the application's React and Remotion, validated, locked by hash and registered by a generated bundle entry (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The contracts, and compiling with a release's library kits

**Files:**
- Create:
  - `studio/contracts/schemas/v1alpha1/kit-release.schema.json`;
  - `studio/contracts/src/kit-releases.mjs`;
  - `studio/contracts/src/kit-releases.d.mts`;
  - `studio/series/test/library-kits.test.ts`.
- Modify:
  - `studio/contracts/schemas/v1alpha1/series-template.schema.json`;
  - `studio/contracts/src/series-templates.d.mts`;
  - `studio/contracts/bindings/ts/` (regenerated);
  - `studio/series/src/types.ts`;
  - `studio/series/src/compile.ts`;
  - `studio/series/src/index.ts`.

**Interfaces:**
- Consumes: Task 1's `validateTimeline(doc, {kits})` and `KitVersion`.
- Produces:
  - `KIT_RELEASE_FILE`, `KIT_SOURCE`, `KIT_BUNDLE`, `kitReleasePath` and `validateKitRelease`;
  - `SeriesTemplate.kits?: KitPin[]`;
  - `CompileInput.kits?: LoadedLibraryKit[]`.

- [ ] **Step 1: Write the failing test.**

Create `studio/series/test/library-kits.test.ts`:

````ts
// A release's library kits (avg-d1x): a timeline may draw with a kit the
// release pins, handed in `input.kits`, and is held to its props like any
// application kit; without it, the kit is unknown.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { compileSpec, resolveCompiler, type CompileInput, type LoadedLibraryKit } from "../src/index.js";

const load = (): CompileInput => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0", "input.json"), "utf-8"));
const card: LoadedLibraryKit = {
  name: "sample-card", version: "1.0.0", file: "/library/sample/kits/sample-card/1.0.0/kit.cjs", hash: `sha256:${"b".repeat(64)}`,
  kit: { name: "sample-card", version: "1.0.0", description: "a card", props: z.object({ text: z.string() }).strict(), component: () => null, examples: [] },
};

/** poetry-short's own compile, plus one item of the library card: a release that draws with its channel's kit. */
function withCard(props: Record<string, unknown>): CompileInput {
  const input = load();
  const registered = resolveCompiler("poetry-short", "1.0.0")!;
  input.template = { ...input.template, compiler: { ...input.template.compiler, bundle: { path: "compiler/compiler.cjs", hash: card.hash } } };
  input.code = {
    compiler: {
      ...registered,
      compile: (i) => {
        const result = registered.compile(i);
        if (!result.ok) return result;
        result.timeline.tracks.push({ id: "library", type: "visual", z: 99, items: [{ id: "card", from: 0, duration: 10, kit: { name: "sample-card", version: "1.0.0" }, props }] } as never);
        return result;
      },
    },
  };
  return input;
}

test("a timeline draws with a library kit the release hands in, held to its props", () => {
  const withKit = withCard({ text: "from the channel" });
  withKit.kits = [card];
  const ok = compileSpec(withKit);
  assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.problems));

  const bad = withCard({ text: 3 });
  bad.kits = [card];
  const refused = compileSpec(bad);
  assert.deepEqual(!refused.ok && refused.problems.map((p) => p.code), ["timeline:bad-props"]);
});

test("without the release's library kits the kit is unknown", () => {
  const result = compileSpec(withCard({ text: "x" }));
  assert.deepEqual(!result.ok && result.problems.map((p) => p.code), ["timeline:unknown-kit"]);
});
````

- [ ] **Step 2: Run it, and see it fail.**
  - `npm run build --workspace @av/remotion-composer`.
  - Then `cd studio/series && node --import tsx --test test/library-kits.test.ts`.
  - Expect the first test to fail with `timeline:unknown-kit`, because `input.kits` is ignored.

- [ ] **Step 3: Implement.**

Create `studio/contracts/schemas/v1alpha1/kit-release.schema.json`:

````json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.studio.video/v1alpha1/kit-release.schema.json",
  "title": "A kit a channel or a series carries in the library: its sealed bundle (avg-d1x)",
  "$defs": {
    "KitRelease": {
      "type": "object",
      "additionalProperties": false,
      "required": ["apiVersion", "kind", "name", "version", "bundle"],
      "properties": {
        "apiVersion": { "const": "studio.video/v1alpha1" },
        "kind": { "const": "KitRelease" },
        "name": { "$ref": "identity.schema.json#/$defs/Slug" },
        "version": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
          "description": "An exact released version."
        },
        "bundle": {
          "type": "object",
          "additionalProperties": false,
          "required": ["path", "hash"],
          "properties": {
            "path": { "const": "kit.cjs" },
            "hash": { "$ref": "identity.schema.json#/$defs/ContentHash" }
          },
          "description": "The CommonJS bundle `vpr kit seal` built from kit/index.tsx, React, Remotion and zod left to the application; `hash` is its sha256."
        }
      },
      "description": "kit.json, at library/<channel>/kits/<name>/<version>/ or library/<channel>/series/<series>/kits/<name>/<version>/. Immutable once a series release pins it."
    }
  }
}
````

Create `studio/contracts/src/kit-releases.mjs`:

````js
// A kit a channel or a series carries in the library (avg-d1x): kit.json names
// the sealed bundle. Where a kit release sits, and what makes one valid.

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { join } from "node:path";
import identitySchema from "../schemas/v1alpha1/identity.schema.json" with { type: "json" };
import schema from "../schemas/v1alpha1/kit-release.schema.json" with { type: "json" };
import { channelPath, seriesPath } from "./layout.mjs";

export const KIT_RELEASE_FILE = "kit.json";
export const KIT_SOURCE = "kit/index.tsx";
export const KIT_BUNDLE = "kit.cjs";

/** library/<channel>/kits/<name>/<version>, or the series' own kits/ when `series` is given. */
export function kitReleasePath(root, channel, series, name, version) {
  return join(series ? seriesPath(root, channel, series) : channelPath(root, channel), "kits", name, version);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv);
ajv.addSchema(identitySchema).addSchema(schema);

/** Problems of a kit.json, as `{code, path, message}`; none when it is a KitRelease. */
export function validateKitRelease(doc) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/KitRelease`);
  if (validate(doc)) return [];
  return validate.errors.map((e) => ({ code: "schema", path: `$${e.instancePath.replace(/\//g, ".")}`, message: e.message }));
}
````

Create `studio/contracts/src/kit-releases.d.mts`:

````ts
export declare const KIT_RELEASE_FILE: "kit.json";
export declare const KIT_SOURCE: "kit/index.tsx";
export declare const KIT_BUNDLE: "kit.cjs";
export interface KitRelease {
  apiVersion: "studio.video/v1alpha1";
  kind: "KitRelease";
  name: string;
  version: string;
  bundle: { path: "kit.cjs"; hash: string };
}
export declare function kitReleasePath(root: string, channel: string, series: string | null, name: string, version: string): string;
export declare function validateKitRelease(doc: unknown): { code: string; path: string; message: string }[];
````

````diff
diff --git a/studio/contracts/schemas/v1alpha1/series-template.schema.json b/studio/contracts/schemas/v1alpha1/series-template.schema.json
index e87e456..304aed8 100644
--- a/studio/contracts/schemas/v1alpha1/series-template.schema.json
+++ b/studio/contracts/schemas/v1alpha1/series-template.schema.json
@@ -19,6 +19,17 @@
       },
       "description": "The compiler or validator the release runs: with `bundle`, the release's own sealed code (avg-d1x); without, the application's registered one."
     },
+    "KitPin": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["name", "version", "level", "hash"],
+      "properties": {
+        "name": { "$ref": "identity.schema.json#/$defs/Slug" },
+        "version": { "$ref": "#/$defs/TemplateVersion" },
+        "level": { "enum": ["channel", "series"], "description": "library/<channel>/kits/ or library/<channel>/series/<series>/kits/." },
+        "hash": { "$ref": "identity.schema.json#/$defs/ContentHash", "description": "sha256 of the kit release's kit.json." }
+      }
+    },
     "CodeBundle": {
       "type": "object",
       "additionalProperties": false,
@@ -97,6 +108,12 @@
         "compiler": { "$ref": "#/$defs/SeriesComponentRef" },
         "validator": { "$ref": "#/$defs/SeriesComponentRef" },
         "theme": { "$ref": "channel-theme.schema.json#/$defs/ThemePin", "description": "The channel theme release this series draws with (ADR-0040); absent: the kits' own look." },
+        "kits": {
+          "type": "array",
+          "maxItems": 64,
+          "items": { "$ref": "#/$defs/KitPin" },
+          "description": "The library kits this series' timelines may draw with besides the application's (avg-d1x): the channel's or the series' own, each pinned by the hash of its kit.json."
+        },
         "files": {
           "type": "object",
           "additionalProperties": false,
diff --git a/studio/contracts/src/series-templates.d.mts b/studio/contracts/src/series-templates.d.mts
index 381b8f5..0e3ee8e 100644
--- a/studio/contracts/src/series-templates.d.mts
+++ b/studio/contracts/src/series-templates.d.mts
@@ -11,6 +11,8 @@ export interface CodeBundle { path: string; hash: string }
 /** With `bundle`, the release's own code; without, the application's registered compiler or validator. */
 export interface SeriesComponentRef { id: string; version: string; bundle?: CodeBundle }
 export interface TemplatePin { id: string; version: string; hash: string }
+/** A library kit a series release may draw with (avg-d1x), pinned by its kit.json's hash. */
+export interface KitPin { name: string; version: string; level: "channel" | "series"; hash: string }
 export interface SeriesFileRef { path: string; hash: string }
 export interface SeriesEpisodeRef { channel: string; series: string; episode: string }
 /** One layout-sheet instant per matching section (avg-3th.1). */
@@ -28,6 +30,7 @@ export interface SeriesTemplate {
   version: string;
   compiler: SeriesComponentRef;
   validator?: SeriesComponentRef;
+  kits?: KitPin[];
   /** The channel theme release this series draws with (ADR-0040). */
   theme?: { id: string; version: string; hash: string };
   files: { schema: SeriesFileRef; template: SeriesFileRef; standard: SeriesFileRef };
diff --git a/studio/series/src/compile.ts b/studio/series/src/compile.ts
index f64beb8..b8b10a1 100644
--- a/studio/series/src/compile.ts
+++ b/studio/series/src/compile.ts
@@ -53,7 +53,7 @@ export function compileSpec(input: CompileInput): CompileResult {
   const problems: CompileProblem[] = validateEditTimeline(result.timeline)
     .map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" }));
   if (problems.length === 0) {
-    const composer = validateTimeline(result.timeline);
+    const composer = validateTimeline(result.timeline, { kits: (input.kits ?? []).map((k) => k.kit) });
     if (!composer.ok) {
       problems.push(...composer.problems.map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" })));
     }
diff --git a/studio/series/src/index.ts b/studio/series/src/index.ts
index 8f06b27..db9e2e0 100644
--- a/studio/series/src/index.ts
+++ b/studio/series/src/index.ts
@@ -10,6 +10,7 @@ export type {
   EditTimeline,
   EpisodeSpec,
   Finding,
+  LoadedLibraryKit,
   NarrationTakes,
   SeriesCompiler,
   SeriesTemplate,
diff --git a/studio/series/src/types.ts b/studio/series/src/types.ts
index bfdf646..fc3d47d 100644
--- a/studio/series/src/types.ts
+++ b/studio/series/src/types.ts
@@ -12,6 +12,7 @@ import type { NarrationTakes } from "@studio/contracts/bindings/ts/narration-tak
 import type { WordTiming } from "@studio/contracts/bindings/ts/word-timing.ts";
 import type { EditTimeline } from "@studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts";
 import type { ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
+import type { KitVersion } from "@av/remotion-composer";
 
 export type { ChannelTheme, EditTimeline, EpisodeSpec, NarrationTakes, SeriesTemplate, WordTiming };
 
@@ -56,6 +57,23 @@ export interface CompileInput {
    * or `validator.bundle` is. Not data: never in a fixture's input.json.
    */
   code?: { compiler?: SeriesCompiler; validator?: SeriesValidator };
+  /**
+   * The library kits the release pins (avg-d1x), loaded by the episode's
+   * loader: the timeline may draw with them besides the application's. Not
+   * data: never in a fixture's input.json.
+   */
+  kits?: LoadedLibraryKit[];
+}
+
+/** A library kit as a compile and a render need it: its sealed bundle, and the KitVersion it exports. */
+export interface LoadedLibraryKit {
+  name: string;
+  version: string;
+  /** Absolute path of its kit.cjs. */
+  file: string;
+  /** "sha256:…" of kit.cjs. */
+  hash: string;
+  kit: KitVersion;
 }
 
 /** Something in the input that stops compilation, located by a JSON path. */
````

Then run `cd studio/contracts && npm run bindings:generate`.

- [ ] **Step 4: Run them, and see them pass.**
  - `cd studio/contracts && npm run check`.
  - `cd studio/series && npm test`: everything passes, including the 2 new tests.
  - `npx tsc --noEmit -p studio/series` is clean.

- [ ] **Step 5: Commit.**

```bash
git add studio/contracts/schemas/v1alpha1/kit-release.schema.json studio/contracts/src/kit-releases.mjs studio/contracts/src/kit-releases.d.mts studio/contracts/schemas/v1alpha1/series-template.schema.json studio/contracts/src/series-templates.d.mts studio/contracts/bindings studio/series/src/types.ts studio/series/src/compile.ts studio/series/src/index.ts studio/series/test/library-kits.test.ts
git commit -m "Contracts: KitRelease and a series release's kit pins; compile validates against the release's library kits (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Sealing, verifying, loading and drawing a release's kits

**Files:**
- Create:
  - `studio/episode/src/kit-code.ts`;
  - `studio/series/fixtures/release-code/sample-card/kit/index.tsx`;
  - `studio/series/fixtures/release-code/sample-card/compiler.ts`;
  - `studio/episode/tests/library-kits.test.ts`.
- Modify:
  - `studio/episode/src/template-code.ts`;
  - `studio/episode/src/series-compile.ts`;
  - `studio/episode/src/episode-render.ts`;
  - `studio/episode/src/layout-sheet.ts`;
  - `studio/episode/src/index.ts`.

**Interfaces:**
- Consumes:
  - Task 1's `loadLibraryKit` and `isApplicationKit`;
  - Task 2's contracts and `CompileInput.kits`.
- Produces:
  - `KitPlace`, `kitDirOf` and `KIT_EXTERNALS`;
  - `sealKit(place, {dryRun})`;
  - `verifyKit(place)`;
  - `readKitRelease(dir, place)`;
  - `pinnedKitHashes(seriesDir, kits)`;
  - `bundleSource(root, entry, options)`;
  - `libraryKitsOf(episodeDir, options)`;
  - the load problem codes `missing-kit`, `kit-mismatch`, `kit-shadows` and `bad-kit`.

- [ ] **Step 1: The fixtures and the failing test.**

Create `studio/series/fixtures/release-code/sample-card/kit/index.tsx`:

````tsx
// A kit a channel carries in the library (avg-d1x): a full-frame colour card
// with a line of text. Sealed by `vpr kit seal` into kit.cjs; React, Remotion
// and zod are the application's.

import React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";

const props = z.object({ text: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/) }).strict();

export const kit = {
  name: "sample-card",
  version: "1.0.0",
  description: "A colour card with a line of text, from the channel's library",
  props,
  component: ({ props: p }: { props: Record<string, unknown> }) => {
    const { text, color } = p as z.infer<typeof props>;
    return <AbsoluteFill style={{ background: color, color: "#ffffff", fontSize: 96, justifyContent: "center", alignItems: "center" }}>{text}</AbsoluteFill>;
  },
  examples: [{ id: "navy", props: { text: "library", color: "#1b2a4a" }, durationInFrames: 30, frame: 12 }],
};
````

Create `studio/series/fixtures/release-code/sample-card/compiler.ts`:

````ts
// The poetry-short compiler (compiler/base.ts beside this file, once copied
// into a release), drawing one more item: the channel's sample card over its
// first second (avg-d1x).

import type { SeriesCompiler } from "@studio/series";
import { compiler as base } from "./base";

export const compiler: SeriesCompiler = {
  ...base,
  compile(input) {
    const result = base.compile(input);
    if (!result.ok) return result;
    result.timeline.tracks.push({
      id: "library", type: "visual", z: 99,
      items: [{ id: "card", from: 0, duration: 30, kit: { name: "sample-card", version: "1.0.0" }, props: { text: "from the channel", color: "#1b2a4a" } }],
    } as never);
    return result;
  },
};
````

Create `studio/episode/tests/library-kits.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileEpisode, libraryKitsOf, loadEpisode } from "../src/series-compile.js";
import { sealKit, verifyKit } from "../src/kit-code.js";
import { sealTemplateCode, TemplateCodeError } from "../src/template-code.js";
import { writeEditTimeline } from "../src/episode-render.js";
import { makeLayoutSheet } from "../src/layout-sheet.js";
import { editSpec, releaseCodeEpisode, sha256 } from "../src/testing.js";

/**
 * Kits a channel or a series carries (avg-d1x): sealed in the library,
 * pinned by a series release, loaded with it, drawn by its compiler and
 * handed to the layout sheet. The sheet's rendering is faked here; the
 * composer's own end-to-end test draws a library kit for real.
 */

const sheetCalls: { kits?: unknown }[] = [];
vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string; kits?: unknown }) => {
      sheetCalls.push(options);
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, "sheet");
      return { frames, sheet: { path, hash: sha256("sheet"), columns: 8, rows: 1, width: 2160, height: 1600 }, kits: actual.timelineKits(options.timeline, options.kits as never)! };
    },
  };
});

const require = createRequire(import.meta.url);
const FIXTURES = dirname(require.resolve("@studio/series/fixtures/release-code/sample-card/compiler.ts"));
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const channelDir = () => join(root, REF.channel);
const seriesDir = () => join(channelDir(), "series", REF.series);
const dir = () => join(seriesDir(), "episodes", REF.episode);
const opts = { episodeRef: REF };

/** The channel's sample card, sealed in library/<channel>/kits/sample-card/1.0.0 (or the series' own kits/). */
async function sealedCard(level: "channel" | "series" = "channel") {
  const kitDir = join(level === "series" ? seriesDir() : channelDir(), "kits", "sample-card", "1.0.0");
  cpSync(join(FIXTURES, "kit"), join(kitDir, "kit"), { recursive: true });
  const sealed = await sealKit({ channelDir: channelDir(), ...(level === "series" ? { series: REF.series } : {}), name: "sample-card", version: "1.0.0" });
  return { kitDir, sealed };
}

/** The release drawing the card: the wrapping compiler, the kit pinned, sealed again with the spec aside. */
async function releaseDrawingTheCard(level: "channel" | "series" = "channel") {
  const { releaseDir } = await releaseCodeEpisode(dir(), REF);
  cpSync(join(releaseDir, "compiler", "index.ts"), join(releaseDir, "compiler", "base.ts"));
  cpSync(join(FIXTURES, "compiler.ts"), join(releaseDir, "compiler", "index.ts"));
  const manifestFile = join(releaseDir, "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
  manifest.kits = [{ name: "sample-card", version: "1.0.0", level }];
  // poetry-short's rules allow no extra track: this release draws the card without them.
  delete manifest.validator;
  rmSync(join(releaseDir, "validator"), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const spec = join(dir(), "episode-spec.json");
  renameSync(spec, `${spec}.aside`);
  const sealed = await sealTemplateCode(seriesDir(), "poetry-short", "1.0.0");
  renameSync(`${spec}.aside`, spec);
  editSpec(dir(), (doc) => { doc.template.hash = sealed.hash; });
  return { releaseDir, manifestFile };
}

async function refusal(call: () => Promise<unknown>): Promise<TemplateCodeError> {
  try {
    await call();
  } catch (e) {
    if (e instanceof TemplateCodeError) return e;
    throw e;
  }
  throw new Error("expected a TemplateCodeError");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "library-kits-"));
  sheetCalls.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a kit the channel carries", () => {
  it("is sealed into kit.cjs and kit.json, pinned by the release, and drawn by its compiler", async () => {
    const { kitDir, sealed } = await sealedCard();
    const release = JSON.parse(readFileSync(join(kitDir, "kit.json"), "utf-8"));
    expect(release).toEqual({ apiVersion: "studio.video/v1alpha1", kind: "KitRelease", name: "sample-card", version: "1.0.0", bundle: { path: "kit.cjs", hash: sealed.bundle.hash } });
    expect(sealed.hash).toBe(sha256(readFileSync(join(kitDir, "kit.json"))));

    const { manifestFile } = await releaseDrawingTheCard();
    expect(JSON.parse(readFileSync(manifestFile, "utf-8")).kits).toEqual([{ name: "sample-card", version: "1.0.0", level: "channel", hash: sealed.hash }]);

    const compiled = compileEpisode(dir(), opts);
    expect(compiled.ok, JSON.stringify(!compiled.ok && compiled.problems)).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.timeline.tracks.find((t) => t.id === "library")!.items[0]).toMatchObject({ kit: { name: "sample-card", version: "1.0.0" } });
    const inputs = compiled.timeline.metadata!.inputs as Record<string, string>;
    expect(inputs["../../../../kits/sample-card/1.0.0/kit.json"]).toBe(sealed.hash);
    expect(inputs["../../../../kits/sample-card/1.0.0/kit.cjs"]).toBe(sealed.bundle.hash);
  });

  it("goes to the layout sheet, which locks it by its bundle's hash", async () => {
    const { sealed } = await sealedCard();
    await releaseDrawingTheCard();
    writeEditTimeline(dir(), opts);
    const kits = libraryKitsOf(dir(), opts);
    expect(kits).toEqual([{ name: "sample-card", version: "1.0.0", file: join(channelDir(), "kits", "sample-card", "1.0.0", "kit.cjs"), hash: sealed.bundle.hash }]);
    const sheet = await makeLayoutSheet(dir(), opts);
    expect(sheetCalls[0]!.kits).toEqual(kits);
    expect(sheet.report.kits).toContainEqual({ name: "sample-card", version: "1.0.0", hash: sealed.bundle.hash });
  });

  it("is refused when its bundle or its kit.json is not the sealed one", async () => {
    const { kitDir } = await sealedCard();
    await releaseDrawingTheCard();
    appendFileSync(join(kitDir, "kit.cjs"), "\n// changed");
    const bundle = loadEpisode(dir(), opts);
    expect(!bundle.ok && bundle.problems[0]!.code).toBe("kit-mismatch");

    const manifest = readFileSync(join(kitDir, "kit.json"), "utf-8");
    writeFileSync(join(kitDir, "kit.json"), manifest.replace('"1.0.0"', '"1.0.0" '));
    const pin = loadEpisode(dir(), opts);
    expect(!pin.ok && pin.problems[0]).toMatchObject({ code: "kit-mismatch", path: "../../../../kits/sample-card/1.0.0/kit.json" });
  });

  it("is never resealed once a release pins it, and a release cannot pin an unsealed kit", async () => {
    await sealedCard();
    await releaseDrawingTheCard();
    const again = await refusal(() => sealKit({ channelDir: channelDir(), name: "sample-card", version: "1.0.0" }));
    expect([again.code, again.message]).toEqual(["release-pinned", expect.stringContaining("poetry/poetry-short@1.0.0")]);

    rmSync(join(channelDir(), "kits"), { recursive: true });
    rmSync(join(dir(), "episode-spec.json"));
    const unsealed = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect([unsealed.code, unsealed.message]).toEqual(["bad-template", expect.stringContaining("channel kit sample-card@1.0.0")]);
  });

  it("refuses to seal a kit that is not its folder's name, or takes an application kit's", async () => {
    const kitDir = join(channelDir(), "kits", "other-card", "1.0.0");
    cpSync(join(FIXTURES, "kit"), join(kitDir, "kit"), { recursive: true });
    const other = await refusal(() => sealKit({ channelDir: channelDir(), name: "other-card", version: "1.0.0" }));
    expect([other.code, other.message]).toEqual(["bad-code", expect.stringContaining("exports sample-card@1.0.0")]);
    cpSync(join(FIXTURES, "kit"), join(channelDir(), "kits", "still", "1.0.0", "kit"), { recursive: true });
    expect((await refusal(() => sealKit({ channelDir: channelDir(), name: "still", version: "1.0.0" }))).message).toContain("application kit");
  });
});

it("a series' own kit works the same, from the series' kits/", async () => {
  const { kitDir } = await sealedCard("series");
  expect(kitDir).toBe(join(seriesDir(), "kits", "sample-card", "1.0.0"));
  await releaseDrawingTheCard("series");
  const compiled = compileEpisode(dir(), opts);
  expect(compiled.ok, JSON.stringify(!compiled.ok && compiled.problems)).toBe(true);
});

describe("verifying a kit", () => {
  it("passes a sealed kit, warns when its source moved on, and holds its examples to its props", async () => {
    const { kitDir } = await sealedCard();
    const place = { channelDir: channelDir(), name: "sample-card", version: "1.0.0" };
    expect(await verifyKit(place)).toEqual({ ok: true, problems: [], warnings: [], examples: [{ id: "navy", ok: true }] });
    appendFileSync(join(kitDir, "kit", "index.tsx"), "\nexport const extra = 1;\n");
    expect((await verifyKit(place)).warnings.map((w) => w.code)).toEqual(["rebuild-differs"]);
    appendFileSync(join(kitDir, "kit.cjs"), "\n// changed");
    expect((await verifyKit(place)).problems.map((p) => p.code)).toEqual(["kit-mismatch"]);
  });
});
````

- [ ] **Step 2: Run it, and see it fail.**
  - `npm run build --workspace @studio/series`.
  - Then `cd studio/episode && npx vitest run tests/library-kits.test.ts`.
  - Expect `../src/kit-code.js` not to be found.

- [ ] **Step 3: Implement.**

Create `studio/episode/src/kit-code.ts`:

````ts
// ---------------------------------------------------------------------------
// Sealing and verifying a kit a channel or a series carries (avg-d1x)
// ---------------------------------------------------------------------------
// A kit release, library/<channel>/kits/<name>/<version>/ (or the series'
// own kits/), holds its source, kit/index.tsx, exporting `kit` (a
// KitVersion). Sealing builds it into kit.cjs, leaving React, Remotion and
// zod to the application, checks it exports the kit its folder names, and
// writes kit.json with the bundle's hash. A series release pins the kit by
// that kit.json's hash.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isApplicationKit, loadLibraryKit } from "@av/remotion-composer";
import { KIT_BUNDLE, KIT_RELEASE_FILE, KIT_SOURCE, validateKitRelease } from "@studio/contracts/src/kit-releases.mjs";
import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
import { bundleSource, TemplateCodeError } from "./template-code.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** What a kit draws with that is the application's, never its own copy. */
export const KIT_EXTERNALS = ["react", "react-dom", "remotion", "@remotion", "zod"];

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code: ConstructorParameters<typeof TemplateCodeError>[0], message: string): never => {
  throw new TemplateCodeError(code, message);
};

/** Where a kit release sits: in the channel, or in one of its series. */
export interface KitPlace {
  /** library/<channel>. */
  channelDir: string;
  /** The series' slug, for a series' own kit; absent for the channel's. */
  series?: string;
  name: string;
  version: string;
}

export const kitDirOf = (place: KitPlace) =>
  join(place.series ? join(place.channelDir, "series", place.series) : place.channelDir, "kits", place.name, place.version);

function checkPlace(place: KitPlace): string {
  if (!SLUG.test(place.name)) fail("missing-template", `"${place.name}" is not a kit name`);
  if (!EXACT.test(place.version)) fail("missing-template", `"${place.version}" is not an exact x.y.z release`);
  if (place.series !== undefined && !SLUG.test(place.series)) fail("missing-template", `"${place.series}" is not a series`);
  const dir = kitDirOf(place);
  if (!existsSync(dir)) fail("missing-template", `${place.name}@${place.version} is not a kit release of ${place.series ? `series ${place.series}` : "the channel"}`);
  return dir;
}

/** The series releases that pin this kit (by name, version and level). */
function kitPinnedBy(place: KitPlace): string[] {
  const pins: string[] = [];
  const seriesRoot = join(place.channelDir, "series");
  const level = place.series ? "series" : "channel";
  for (const series of existsSync(seriesRoot) ? readdirSync(seriesRoot).sort() : []) {
    if (place.series && series !== place.series) continue;
    const templates = join(seriesRoot, series, "templates");
    for (const id of existsSync(templates) ? readdirSync(templates).sort() : []) {
      for (const version of readdirSync(join(templates, id)).sort()) {
        const manifest = join(templates, id, version, SERIES_TEMPLATE_MANIFEST);
        if (!existsSync(manifest)) continue;
        try {
          const kits = JSON.parse(readFileSync(manifest, "utf-8")).kits as { name: string; version: string; level: string }[] | undefined;
          if (kits?.some((k) => k.name === place.name && k.version === place.version && k.level === level)) pins.push(`${series}/${id}@${version}`);
        } catch {
          pins.push(`${series}/${id}@${version} (unreadable)`);
        }
      }
    }
  }
  return pins;
}

/**
 * Build kit/index.tsx into kit.cjs and write kit.json naming it, with its
 * hash. Refused once a series release pins the kit, for a kit that does not
 * export the name@version of its folder, and for an application kit's name@version.
 */
export async function sealKit(place: KitPlace, options: { dryRun?: boolean } = {}): Promise<{ hash: string; bundle: { path: string; hash: string } }> {
  const dir = checkPlace(place);
  const label = `${place.name}@${place.version}`;
  if (isApplicationKit(place.name, place.version)) fail("bad-code", `${label} is an application kit: a library kit takes another name or version`);
  const pinned = kitPinnedBy(place);
  if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: a pinned kit never changes; make a new version`);
  if (!existsSync(join(dir, KIT_SOURCE))) fail("no-code", `${label} has no ${KIT_SOURCE}`);
  const text = await bundleSource(dir, KIT_SOURCE, { platform: "neutral", external: KIT_EXTERNALS, jsx: true });
  const bundleHash = sha256(text);
  const loaded = loadLibraryKit(join(dir, KIT_BUNDLE), Buffer.from(text), bundleHash);
  if (!loaded.ok) fail("bad-code", `${KIT_SOURCE}: ${loaded.message}`);
  const kit = (loaded as { kit: { name: string; version: string } }).kit;
  if (kit.name !== place.name || kit.version !== place.version) fail("bad-code", `${KIT_SOURCE} exports ${kit.name}@${kit.version}, not the ${label} its folder names`);
  const manifest = { apiVersion: "studio.video/v1alpha1", kind: "KitRelease", name: place.name, version: place.version, bundle: { path: KIT_BUNDLE, hash: bundleHash } };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const result = { hash: sha256(manifestText), bundle: manifest.bundle };
  if (options.dryRun) return result;
  writeFileSync(join(dir, `${KIT_BUNDLE}.tmp`), text);
  renameSync(join(dir, `${KIT_BUNDLE}.tmp`), join(dir, KIT_BUNDLE));
  writeFileSync(join(dir, `${KIT_RELEASE_FILE}.tmp`), manifestText);
  renameSync(join(dir, `${KIT_RELEASE_FILE}.tmp`), join(dir, KIT_RELEASE_FILE));
  return result;
}

export interface KitVerification {
  ok: boolean;
  problems: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  /** Each example's props held to the kit's own schema. */
  examples: { id: string; ok: boolean; message?: string }[];
}

/** Is the kit's bundle the sealed one, does its source still build to it, and do its examples' props pass its schema? */
export async function verifyKit(place: KitPlace): Promise<KitVerification> {
  const dir = checkPlace(place);
  const problems: KitVerification["problems"] = [];
  const warnings: KitVerification["warnings"] = [];
  const examples: KitVerification["examples"] = [];
  const read = readKitRelease(dir, place);
  if (!read.ok) return { ok: false, problems: [{ code: read.code, message: read.message }], warnings, examples };
  if (existsSync(join(dir, KIT_SOURCE)) && sha256(await bundleSource(dir, KIT_SOURCE, { platform: "neutral", external: KIT_EXTERNALS, jsx: true })) !== read.release.bundle.hash) {
    warnings.push({ code: "rebuild-differs", message: `${KIT_SOURCE} no longer builds to ${KIT_BUNDLE}: its source, or the studio code it inlines, changed since sealing; the sealed bundle is what runs` });
  }
  for (const example of read.kit.examples ?? []) {
    const parsed = read.kit.props.safeParse(example.props);
    examples.push(parsed.success ? { id: example.id, ok: true } : { id: example.id, ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  return { ok: problems.length === 0 && examples.every((e) => e.ok), problems, warnings, examples };
}

/**
 * A sealed kit release, read and checked: kit.json is a KitRelease of its
 * folder's name@version, kit.cjs is the bundle it names, and that bundle
 * exports the kit. What the loader and verifyKit share.
 */
export function readKitRelease(dir: string, place: { name: string; version: string }):
  | { ok: true; manifestText: string; release: { bundle: { path: string; hash: string } }; file: string; bytes: Buffer; kit: import("@av/remotion-composer").KitVersion }
  | { ok: false; code: "missing-kit" | "bad-kit" | "kit-mismatch"; message: string } {
  const label = `${place.name}@${place.version}`;
  const manifestFile = join(dir, KIT_RELEASE_FILE);
  if (!existsSync(manifestFile)) return { ok: false, code: "missing-kit", message: `${label} has no ${KIT_RELEASE_FILE}: seal it (vpr kit seal)` };
  const manifestText = readFileSync(manifestFile, "utf-8");
  let release: any;
  try {
    release = JSON.parse(manifestText);
  } catch (error) {
    return { ok: false, code: "bad-kit", message: `${label}'s ${KIT_RELEASE_FILE} is not JSON: ${(error as Error).message}` };
  }
  const shape = validateKitRelease(release);
  if (shape.length > 0) return { ok: false, code: "bad-kit", message: `${label}'s ${KIT_RELEASE_FILE}: ${shape.map((p) => `${p.path} ${p.message}`).join("; ")}` };
  if (release.name !== place.name || release.version !== place.version) return { ok: false, code: "bad-kit", message: `${KIT_RELEASE_FILE} says ${release.name}@${release.version}, not ${label}` };
  const file = join(dir, KIT_BUNDLE);
  if (!existsSync(file)) return { ok: false, code: "missing-kit", message: `${label}'s ${KIT_BUNDLE} is missing` };
  const bytes = readFileSync(file);
  if (sha256(bytes) !== release.bundle.hash) return { ok: false, code: "kit-mismatch", message: `${label}'s ${KIT_BUNDLE} is not the bundle it sealed: a kit never changes, make a new version` };
  const loaded = loadLibraryKit(file, bytes, release.bundle.hash);
  if (!loaded.ok) return { ok: false, code: "bad-kit", message: `${label}: ${loaded.message}` };
  if (loaded.kit.name !== place.name || loaded.kit.version !== place.version) return { ok: false, code: "bad-kit", message: `${label}'s bundle exports ${loaded.kit.name}@${loaded.kit.version}` };
  return { ok: true, manifestText, release, file, bytes, kit: loaded.kit };
}

/** The kit pins a series release's manifest lists, their hashes filled from the sealed kit releases (for `vpr template seal`). */
export function pinnedKitHashes(seriesDir: string, kits: { name: string; version: string; level: "channel" | "series" }[]): { name: string; version: string; level: "channel" | "series"; hash: string }[] {
  const channelDir = dirname(dirname(seriesDir));
  return kits.map((pin) => {
    const place: KitPlace = { channelDir, name: pin.name, version: pin.version, ...(pin.level === "series" ? { series: basename(seriesDir) } : {}) };
    const read = readKitRelease(kitDirOf(place), pin);
    if (!read.ok) return fail("bad-template", `the release pins ${pin.level} kit ${pin.name}@${pin.version}: ${read.message}`);
    if (isApplicationKit(pin.name, pin.version)) fail("bad-template", `${pin.name}@${pin.version} is an application kit: a release pins only library kits`);
    return { name: pin.name, version: pin.version, level: pin.level, hash: sha256((read as { manifestText: string }).manifestText) };
  });
}
````

````diff
diff --git a/studio/episode/src/episode-render.ts b/studio/episode/src/episode-render.ts
index 8c20a37..05a5a1e 100644
--- a/studio/episode/src/episode-render.ts
+++ b/studio/episode/src/episode-render.ts
@@ -24,7 +24,7 @@ import {
   type BuildProblem,
   type EditTimelineDoc,
 } from "./edit-timeline-builder.js";
-import { checkEpisode, compileEpisode, isSpecDriven, sharedRootsOf, type SeriesFinding } from "./series-compile.js";
+import { checkEpisode, compileEpisode, isSpecDriven, libraryKitsOf, sharedRootsOf, type SeriesFinding } from "./series-compile.js";
 import { requireSheetReview } from "./sheet-review.js";
 
 const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
@@ -394,6 +394,7 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
       timeline: current.timeline,
       assetRoot: episodeDir,
       sharedRoots: sharedRootsOf(episodeDir),
+      kits: libraryKitsOf(episodeDir, options),
       cacheDir: join(episodeDir, ".cache", "remotion"),
       outputPath: partialPath,
       ...(options.onProgress ? { onProgress: options.onProgress } : {}),
diff --git a/studio/episode/src/index.ts b/studio/episode/src/index.ts
index 1350309..ea81352 100644
--- a/studio/episode/src/index.ts
+++ b/studio/episode/src/index.ts
@@ -18,3 +18,4 @@ export * from "./take-align.js";
 export * from "./take-register.js";
 export * from "./stage-evidence.js";
 export * from "./template-code.js";
+export * from "./kit-code.js";
diff --git a/studio/episode/src/layout-sheet.ts b/studio/episode/src/layout-sheet.ts
index b337838..0b34f99 100644
--- a/studio/episode/src/layout-sheet.ts
+++ b/studio/episode/src/layout-sheet.ts
@@ -17,7 +17,7 @@ import { drawingCodeHash, renderLayoutSheet, timelineKits, type LockedKit } from
 import { canonicalJson } from "@studio/contracts/src/receipt.mjs";
 import { decideEditTimeline, SeriesRulesError, type TimelineDecision } from "./episode-render.js";
 import { EDIT_TIMELINE_PATH, type BuildOptions } from "./edit-timeline-builder.js";
-import { isSpecDriven, loadEpisode, sharedRootsOf } from "./series-compile.js";
+import { isSpecDriven, libraryKitsOf, loadEpisode, sharedRootsOf } from "./series-compile.js";
 import { sheetInstants, type SheetRules } from "./sheet-instants.js";
 
 export const LAYOUT_SHEET_DIR = "artifacts/layout-sheet";
@@ -80,7 +80,7 @@ function rulesFor(episodeDir: string, options: BuildOptions): SheetRulesSource {
 
 /** What the sheet of this decision would be made from; throws what decideEditTimeline throws. */
 function inputsOf(episodeDir: string, options: BuildOptions, decision: TimelineDecision) {
-  const kits = timelineKits(decision.timeline as never);
+  const kits = timelineKits(decision.timeline as never, libraryKitsOf(episodeDir, options));
   if (kits === null) throw new Error("a kit of this timeline is not one this studio has");
   const rules = rulesFor(episodeDir, options);
   const renderer = drawingCodeHash();
@@ -113,7 +113,7 @@ export async function makeLayoutSheet(episodeDir: string, options: BuildOptions)
   const final = join(episodeDir, LAYOUT_SHEET_DIR);
   let report: LayoutSheetReport;
   try {
-    const result = await renderLayoutSheet({ timeline: decision.timeline, assetRoot: episodeDir, sharedRoots: sharedRootsOf(episodeDir), picks, outDir: temp, scale: SHEET_SCALE });
+    const result = await renderLayoutSheet({ timeline: decision.timeline, assetRoot: episodeDir, sharedRoots: sharedRootsOf(episodeDir), picks, outDir: temp, scale: SHEET_SCALE, kits: libraryKitsOf(episodeDir, options) });
     report = {
       createdAt: new Date().toISOString(),
       timeline: { path: EDIT_TIMELINE_PATH, hash: inputs.timeline },
diff --git a/studio/episode/src/series-compile.ts b/studio/episode/src/series-compile.ts
index eb5bfc4..5994446 100644
--- a/studio/episode/src/series-compile.ts
+++ b/studio/episode/src/series-compile.ts
@@ -20,6 +20,9 @@ import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
 import { THEME_FILE, themeReleasePath, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
 import { PINS_DIR, sourceDir, validateSourcePin } from "@studio/contracts/src/source-pins.mjs";
 import { releaseCodeOf } from "./release-code.js";
+import { kitDirOf, readKitRelease } from "./kit-code.js";
+import { isApplicationKit } from "@av/remotion-composer";
+import { KIT_BUNDLE, KIT_RELEASE_FILE } from "@studio/contracts/src/kit-releases.mjs";
 
 export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
 /** What the loader offers from assets/: every file in each folder, as <prefix>-<name>. */
@@ -101,6 +104,17 @@ export function loadEpisode(
   }
 }
 
+/**
+ * The library kits a spec-driven episode's release pins (avg-d1x), as a
+ * render or a layout sheet receives them; none for an episode without a spec
+ * or one that does not load (its timeline cannot be decided either).
+ */
+export function libraryKitsOf(episodeDir: string, options: { episodeRef: { channel: string; series: string; episode: string } }): { name: string; version: string; file: string; hash: string }[] {
+  if (!isSpecDriven(episodeDir)) return [];
+  const loaded = loadEpisode(episodeDir, options);
+  return loaded.ok ? (loaded.input.kits ?? []).map(({ name, version, file, hash }) => ({ name, version, file, hash })) : [];
+}
+
 /**
  * Folders outside the episode a render may take assets from: the theme
  * release its template release pins (library/<channel>/themes/<id>/<version>,
@@ -261,6 +275,24 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     (code as Record<string, unknown>)[role] = loaded.code;
   }
 
+  // ── The library kits it pins (avg-d1x): the channel's or the series' own ──
+  const kits: NonNullable<CompileInput["kits"]> = [];
+  const channelDir = dirname(dirname(seriesDir));
+  for (const pin of (template.kits ?? []) as { name: string; version: string; level: "channel" | "series"; hash: string }[]) {
+    const place = { channelDir, name: pin.name, version: pin.version, ...(pin.level === "series" ? { series: basename(seriesDir) } : {}) };
+    const dir = kitDirOf(place);
+    const within = pin.level === "series" ? seriesDir : channelDir;
+    const manifestKey = relative(episodeDir, join(dir, KIT_RELEASE_FILE)).split(sep).join("/");
+    const label = `${pin.level} kit ${pin.name}@${pin.version}`;
+    const manifestBytes = read(join(dir, KIT_RELEASE_FILE), within, () => stop("missing-kit", manifestKey, `${manifestKey} is missing: the release pins ${label}`));
+    if (sha256(manifestBytes) !== pin.hash) stop("kit-mismatch", manifestKey, `${manifestKey} is not the kit the release pinned (${pin.hash}): a kit never changes, make a new version`);
+    read(join(dir, KIT_BUNDLE), within, () => stop("missing-kit", `${manifestKey.replace(/kit\.json$/, KIT_BUNDLE)}`, `${label}'s ${KIT_BUNDLE} is missing`));
+    if (isApplicationKit(pin.name, pin.version)) stop("kit-shadows", manifestKey, `${label} takes an application kit's name and version`);
+    const release = readKitRelease(dir, pin);
+    if (!release.ok) return stop(release.code, manifestKey, release.message);
+    kits.push({ name: pin.name, version: pin.version, file: release.file, hash: release.release.bundle.hash, kit: release.kit });
+  }
+
   // ── Narration takes and their timing ──────────────────────────────────────
   const takesBytes = read(join(episodeDir, NARRATION_TAKES_PATH), episodeDir,
     () => stop("missing-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is missing: record and verify the narration takes first`));
@@ -382,7 +414,6 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
   const sources: NonNullable<CompileInput["sources"]> = {};
   const pinsDir = join(episodeDir, PINS_DIR);
   const pinFiles = existsSync(pinsDir) ? readdirSync(pinsDir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort() : [];
-  const channelDir = dirname(dirname(seriesDir));
   for (const name of pinFiles) {
     const pinKey = `${PINS_DIR}/${name}`;
     let pinDoc: any;
@@ -443,7 +474,7 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     }
   }
 
-  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}), ...(Object.keys(sources).length > 0 ? { sources } : {}), ...(Object.keys(code).length > 0 ? { code } : {}) }, releaseKey, warnings };
+  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}), ...(Object.keys(sources).length > 0 ? { sources } : {}), ...(Object.keys(code).length > 0 ? { code } : {}), ...(kits.length > 0 ? { kits } : {}) }, releaseKey, warnings };
 }
 
 const IN_TIMELINE = /^\$\.(tracks|profile|durationInFrames|resolution|assets|sections)\b/;
diff --git a/studio/episode/src/template-code.ts b/studio/episode/src/template-code.ts
index c32df1a..310116d 100644
--- a/studio/episode/src/template-code.ts
+++ b/studio/episode/src/template-code.ts
@@ -20,6 +20,7 @@ import { compileSpec, checkSeries } from "@studio/series";
 import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
 import { SERIES_TEMPLATE_FILES, validateSeriesTemplate, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
 import { releaseCodeOf } from "./release-code.js";
+import { pinnedKitHashes } from "./kit-code.js";
 
 const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
 const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
@@ -128,6 +129,18 @@ function packageKeyOf(file: string, cache: Map<string, string>): string {
  * inside the release.
  */
 async function build(releaseDir: string, role: Role): Promise<string> {
+  return bundleSource(releaseDir, `${role}/index.ts`, { platform: "node" });
+}
+
+/**
+ * Bundle `entry` (relative to `root`) into one CommonJS file: the same
+ * wherever `root` and the app are. `external` packages stay `require`s (a
+ * kit's React, Remotion and zod: the application's own); `jsx` compiles TSX
+ * for React's automatic runtime.
+ */
+export async function bundleSource(root: string, entry: string, options: { platform: "node" | "neutral"; external?: string[]; jsx?: boolean }): Promise<string> {
+  const releaseDir = root;
+  const external = options.external ?? [];
   const require = createRequire(import.meta.url);
   let esbuild: typeof import("esbuild");
   try {
@@ -147,8 +160,9 @@ async function build(releaseDir: string, role: Role): Promise<string> {
     name: "release-code",
     setup(b) {
       b.onResolve({ filter: /.*/ }, (args) => {
-        if (args.kind === "entry-point") return name("release", sourceOf(releaseDir, role));
+        if (args.kind === "entry-point") return name("release", join(releaseDir, entry));
         if (args.path.startsWith("node:") || builtins.has(args.path) || builtins.has(args.path.split("/")[0]!)) return { path: args.path, external: true };
+        if (external.some((e) => args.path === e || args.path.startsWith(`${e}/`))) return { path: args.path, external: true };
         const importer = real.get(`${args.namespace}:${args.importer}`);
         if (!importer) return { errors: [{ text: `cannot place ${args.path}: its importer ${args.importer} is unknown` }] };
         if (args.path.startsWith(".")) {
@@ -177,10 +191,11 @@ async function build(releaseDir: string, role: Role): Promise<string> {
   };
   try {
     const out = await esbuild.build({
-      entryPoints: [`${role}/index.ts`],
+      entryPoints: [entry],
       absWorkingDir: releaseDir,
       bundle: true,
-      platform: "node",
+      platform: options.platform,
+      ...(options.jsx ? { jsx: "automatic" as const } : {}),
       format: "cjs",
       target: "node20",
       write: false,
@@ -194,7 +209,7 @@ async function build(releaseDir: string, role: Role): Promise<string> {
     return out.outputFiles[0]!.text;
   } catch (error) {    const errors = (error as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors ?? [];
     const detail = errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("; ");
-    return fail("build-failed", `${role}/index.ts does not build: ${detail || (error as Error).message}`);
+    return fail("build-failed", `${entry} does not build: ${detail || (error as Error).message}`);
   }
 }
 
@@ -227,7 +242,9 @@ export async function sealTemplateCode(seriesDir: string, id: string, version: s
     if (!loaded.ok) fail("bad-code", `${role}/index.ts: ${loaded.message}`);
     manifest[role] = { id: manifest[role].id, version: manifest[role].version, bundle: { path: bundlePath(role), hash } };
   }
-  if (Object.keys(built).length === 0) fail("no-code", `${label} has neither compiler/index.ts nor validator/index.ts`);
+  // The library kits it pins (avg-d1x): each sealed, its kit.json's hash filled in.
+  if (Array.isArray(manifest.kits)) manifest.kits = pinnedKitHashes(seriesDir, manifest.kits);
+  if (Object.keys(built).length === 0 && !manifest.kits?.length) fail("no-code", `${label} has neither compiler/index.ts nor validator/index.ts, and pins no kits`);
 
   const files: Record<string, string> = {};
   for (const [roleName, name] of Object.entries(SERIES_TEMPLATE_FILES)) {
````

- [ ] **Step 4: Run them, and see them pass.**
  - `cd studio/episode && npx vitest run`: everything passes, including the 7 new tests and phase 1's `release-code.test.ts`.
  - `npx tsc --noEmit -p studio/episode` is clean.

- [ ] **Step 5: Commit.**

```bash
git add studio/episode/src/kit-code.ts studio/series/fixtures/release-code/sample-card studio/episode/tests/library-kits.test.ts studio/episode/src/template-code.ts studio/episode/src/series-compile.ts studio/episode/src/episode-render.ts studio/episode/src/layout-sheet.ts studio/episode/src/index.ts
git commit -m "Kits a channel or a series carries: sealed and verified, pinned by a release, loaded with it, handed to the render and the layout sheet (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: `vpr kit seal` and `vpr kit verify`, and the decision record

**Files:**
- Create:
  - `studio/runtime/test/integration/cli-kit.test.ts`;
  - `docs/adr/0042-kits-a-channel-or-series-carries.md`.
- Modify:
  - `studio/runtime/src/cli.ts`;
  - `docs/running.md`;
  - `docs/index.md`.

**Interfaces:**
- Consumes: Task 3's `sealKit`, `verifyKit` and `TemplateCodeError`, through a run-time import of `@studio/episode`.

- [ ] **Step 1: Write the failing test.**

Create `studio/runtime/test/integration/cli-kit.test.ts`:

````ts
// ---------------------------------------------------------------------------
// `vpr kit seal` and `vpr kit verify` (avg-d1x): a kit the channel carries,
// built and checked. Spawns the compiled CLI, like cli.test.ts.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const require = createRequire(import.meta.url);
const KIT = path.dirname(require.resolve("@studio/series/fixtures/release-code/sample-card/kit/index.tsx"));

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function vpr(root: string, args: string[]) {
  const result = spawnSync("node", [cliPath, "kit", ...args, "--library", root, "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

// Each test spawns the CLI and builds with esbuild: seconds, not milliseconds.
describe("vpr kit seal / verify", { timeout: 60_000 }, () => {
  it("seals the channel's kit, then verifies it and its examples", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-kit-"));
    roots.push(root);
    const kitDir = path.join(root, "sample", "kits", "sample-card", "1.0.0");
    cpSync(KIT, path.join(kitDir, "kit"), { recursive: true });

    const dry = vpr(root, ["seal", "sample", "sample-card", "1.0.0", "--dry-run"]);
    expect([dry.status, existsSync(path.join(kitDir, "kit.json"))]).toEqual([0, false]);
    const sealed = vpr(root, ["seal", "sample", "sample-card", "1.0.0"]);
    expect(sealed.status, sealed.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(kitDir, "kit.json"), "utf-8")).bundle.hash).toBe(sealed.json.bundle.hash);

    const verified = vpr(root, ["verify", "sample", "sample-card", "1.0.0"]);
    expect([verified.status, verified.json.ok, verified.json.examples]).toEqual([0, true, [{ id: "navy", ok: true }]]);
    appendFileSync(path.join(kitDir, "kit.cjs"), "\n// changed");
    const changed = vpr(root, ["verify", "sample", "sample-card", "1.0.0"]);
    expect([changed.status, changed.json.problems[0].code]).toEqual([2, "kit-mismatch"]);
  });

  it("refuses a kit that is not there as a runtime error, and a bad path as a usage one", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-kit-"));
    roots.push(root);
    expect(vpr(root, ["seal", "sample", "nowhere", "1.0.0"]).status).toBe(2);
    expect(vpr(root, ["seal", "a/b/c", "sample-card", "1.0.0"]).status).toBe(1);
  });
});
````

- [ ] **Step 2: Run it, and see it fail.**
  - `npm run build --workspace @studio/episode` and `--workspace @studio/runtime`.
  - Then `cd studio/runtime && npx vitest run test/integration/cli-kit.test.ts`.
  - Expect failures: `kit` is not a command yet.

- [ ] **Step 3: Implement, and document.**

````diff
diff --git a/docs/index.md b/docs/index.md
index 9e42184..b1aa018 100644
--- a/docs/index.md
+++ b/docs/index.md
@@ -56,7 +56,7 @@ synced into the site at build time from where they live next to the code.
 
 ## Decision records
 
-[`adr/`](./adr/0041-a-series-release-carries-its-own-code) holds 41 accepted
+[`adr/`](./adr/0042-kits-a-channel-or-series-carries) holds 42 accepted
 decisions. The ones that most shape the code:
 
 | ADR | Decision |
@@ -75,6 +75,7 @@ decisions. The ones that most shape the code:
 | [0039](./adr/0039-format-kits-share-frozen-libraries) | Format kits share frozen libraries, locked with them |
 | [0040](./adr/0040-channel-themes-carry-the-look-as-data) | Channel themes carry the look as data |
 | [0041](./adr/0041-a-series-release-carries-its-own-code) | A series release carries its own code |
+| [0042](./adr/0042-kits-a-channel-or-series-carries) | Kits a channel or a series carries |
 
 ADR-0022 (independent repositories per module) is superseded by 0032.
 ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.
diff --git a/docs/running.md b/docs/running.md
index e6edeea..7242a65 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -472,6 +472,23 @@ node studio/runtime/dist/src/cli.js template seal my-channel/my-series my-templa
 node studio/runtime/dist/src/cli.js template verify my-channel/my-series my-template 1.1.0 --library "$PWD/library"
 ```
 
+**`vpr kit seal`** and **`vpr kit verify`** handle a kit a channel or a
+series carries (ADR-0042). The kit lives in `library/<channel>/kits/<name>/<version>/`
+(or the series' own `kits/`). Its source is `kit/index.tsx`, exporting
+`kit`, the same shape as the composer's kits.
+- **`kit seal`** builds `kit.cjs`, with React, Remotion and zod left to the
+  studio, and writes `kit.json`.
+- **A series release draws with the kit** once its `series-template.json`
+  lists it, as `"kits": [{"name": "…", "version": "…", "level": "channel"}]`,
+  and `template seal` fills in the hash.
+- **`kit verify`** checks the bundle, warns if the source no longer builds to
+  it, and checks the examples' props.
+
+```bash
+node studio/runtime/dist/src/cli.js kit seal my-channel my-card 1.0.0 --library "$PWD/library"
+node studio/runtime/dist/src/cli.js kit verify my-channel/my-series my-hall 1.0.0 --library "$PWD/library"
+```
+
 **`vpr select`** puts an earlier candidate back in place. The gateway offers
 the same thing as `POST …/stages/:stage/select`, and `GET …/episodes/:episode/takes`
 lists the candidates.
diff --git a/studio/runtime/src/cli.ts b/studio/runtime/src/cli.ts
index 48d6165..44de8c9 100644
--- a/studio/runtime/src/cli.ts
+++ b/studio/runtime/src/cli.ts
@@ -996,6 +996,56 @@ async function cmdTheme(ctx: CliContext, args: string[]): Promise<number> {
  * validator, built and checked by @studio/episode, loaded at run time as
  * `vpr status` loads the studio's reader: that package depends on this one.
  */
+/**
+ * `vpr kit seal|verify <channel>[/<series>] <name> <version>` (avg-d1x): a kit
+ * the channel or one of its series carries, built and checked by
+ * @studio/episode, loaded at run time as `vpr template seal` loads it.
+ */
+async function cmdKit(ctx: CliContext, args: string[]): Promise<number> {
+  const usage = "Usage: vpr kit seal <channel>[/<series>] <name> <version> [--dry-run] | vpr kit verify <channel>[/<series>] <name> <version> [--library <path>]";
+  const libraryRoot = libraryFrom(args);
+  const [sub, target, name, version] = positionalArgs(args);
+  const parts = target?.split("/") ?? [];
+  if (!libraryRoot || (sub !== "seal" && sub !== "verify") || parts.length < 1 || parts.length > 2 || !parts.every(isNamePart) || !name || !version) {
+    emit(ctx, { error: libraryRoot ? usage : "--library <path> is required (or set AVG_LIBRARY_ROOT)" });
+    return EX_USAGE;
+  }
+  const place = { channelDir: channelPath(libraryRoot, parts[0]!), ...(parts[1] ? { series: parts[1] } : {}), name, version };
+  const episode = "@studio/episode";
+  let mod: {
+    sealKit: (p: typeof place, o: { dryRun?: boolean }) => Promise<{ hash: string; bundle: { path: string; hash: string } }>;
+    verifyKit: (p: typeof place) => Promise<{ ok: boolean; problems: { code: string; message: string }[]; warnings: { code: string; message: string }[]; examples: { id: string; ok: boolean; message?: string }[] }>;
+    TemplateCodeError: new (...a: never[]) => Error & { code: string };
+  };
+  try {
+    mod = await import(episode);
+  } catch (error) {
+    emit(ctx, { error: `the studio's episode package could not be loaded: ${error instanceof Error ? error.message : String(error)}` });
+    return EX_RUNTIME;
+  }
+  const label = `${parts.join("/")} kit ${name}@${version}`;
+  try {
+    if (sub === "seal") {
+      const sealed = await mod.sealKit(place, { dryRun: ctx.dryRun });
+      emit(ctx, { message: `${ctx.dryRun ? "[DRY RUN] " : ""}${label} ${ctx.dryRun ? "would be sealed" : "sealed"}: pin it in a series release (kits: [{name, version, level}]) and vpr template seal it`, ...sealed, dryRun: ctx.dryRun });
+      return EX_OK;
+    }
+    const verified = await mod.verifyKit(place);
+    const examples = verified.examples.map((e) => `${e.ok ? "✓" : "✗"} ${e.id}${e.message ? `: ${e.message}` : ""}`).join("; ");
+    const said = `${label}: ${verified.ok ? "verified" : "NOT verified"}${verified.problems.length ? `; ${verified.problems.map((p) => p.message).join("; ")}` : ""}${examples ? `; examples: ${examples}` : "; no examples"}`;
+    emit(ctx, {
+      ...(verified.ok ? { message: said } : { error: said }),
+      ...(verified.warnings.length ? { warning: verified.warnings.map((w) => w.message).join("; ") } : {}),
+      ...verified,
+    });
+    return verified.ok ? EX_OK : EX_RUNTIME;
+  } catch (error) {
+    if (!(error instanceof mod.TemplateCodeError)) throw error;
+    emit(ctx, { error: error.message, code: error.code });
+    return EX_RUNTIME;
+  }
+}
+
 async function cmdTemplateCode(ctx: CliContext, sub: "seal" | "verify", seriesDir: string, id: string, version: string, update: boolean): Promise<number> {
   type Verified = { ok: boolean; problems: { code: string; message: string }[]; warnings: { code: string; message: string }[]; fixtures: { name: string; ok: boolean; message?: string }[] };
   const episode = "@studio/episode";
@@ -1769,6 +1819,7 @@ const COMMANDS: Record<string, CliCommand> = {
   sheet: { name: "sheet", description: "Review an episode's layout sheet: approve it, reject it with a note, or see its review; a spec-driven episode renders only with an approval of its current sheet", usage: "vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode>", examples: ["vpr sheet approve dentro-i-versi/short/san-martino", "vpr sheet reject dentro-i-versi/short/san-martino --note 'the verse bar covers the hand at 0:12'", "vpr sheet status dentro-i-versi/short/san-martino"], run: cmdSheet },
   reference: { name: "reference", description: "Golden references of a series: approve a proposed one, withdraw, verify, list", usage: "vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--json]", examples: ["vpr reference approve dentro-i-versi/short/san-martino san-martino-v1 --dry-run", "vpr reference verify dentro-i-versi/short short-room san-martino-v1", "vpr reference withdraw dentro-i-versi/short short-room san-martino-v1 --reason 'the recital was re-recorded'"], run: cmdReference },
   theme: { name: "theme", description: "Seal a theme release: its files and their hashes in theme.json, so a changed room never passes for the released one", usage: "vpr theme seal <channel>/<theme>/<version> [--library <path>]", examples: ["vpr theme seal dentro-i-versi/dentro-i-versi/1.1.0"], run: cmdTheme },
+  kit: { name: "kit", description: "Seal a kit the channel or a series carries in the library (kit/index.tsx → kit.cjs, kit.json), or verify it", usage: "vpr kit seal <channel>[/<series>] <name> <version> [--dry-run] | vpr kit verify <channel>[/<series>] <name> <version> [--library <path>]", examples: ["vpr kit seal sample sample-card 1.0.0", "vpr kit verify sample/poetry hall 1.0.0"], run: cmdKit },
   template: { name: "template", description: "Release a series template (a copy of an earlier release, optionally pinned to a sealed theme), seal its own compiler and validator, or verify them against its fixtures", usage: "vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] | vpr template seal <channel>/<series> <template-id> <version> [--dry-run] | vpr template verify <channel>/<series> <template-id> <version> [--update] [--library <path>]", examples: ["vpr template seal sample/poetry poetry-short 1.1.0", "vpr template verify sample/poetry poetry-short 1.1.0", "vpr template release dentro-i-versi/long dentro-i-versi-long 1.1.0 --from 1.0.0 --theme dentro-i-versi@1.1.0", "vpr template release dentro-i-versi/long dentro-i-versi-long 1.2.0 --from 1.1.0 --compiler 1.1.0"], run: cmdTemplate },
   takes: { name: "takes", description: "List each stage's kept candidates and its selected take", usage: "vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>] [--json]", examples: ["vpr takes my-channel/my-series/ep001 illustrations"], run: cmdTakes },
   select: { name: "select", description: "Make an earlier candidate a stage's take; an operator's selection locks it", usage: "vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>] [--json] [--dry-run]", examples: ["vpr select my-channel/my-series/ep001 illustrations 2 --expect 3"], run: cmdSelect },
````

Create `docs/adr/0042-kits-a-channel-or-series-carries.md`:

````markdown
# ADR-0042: Kits a channel or a series carries

## Status

Accepted (`avg-d1x`, phase 2). Implemented:
- the `KitRelease` contract (`kit.json`) and `kits` pins in `SeriesTemplate`;
- the composer drawing library kits beside its own;
- the loader;
- `vpr kit seal` and `vpr kit verify`.

## Context

ADR-0041 put a series' compiler and validator in its release. What they draw with was still the composer's code: dentro-i-versi's hall, interpreter, verse plates and titles are kits in `packages/remotion-composer`. A phase 0 spike showed that a kit built outside the package, with React, Remotion and zod left external, can be bundled by Remotion and drawn with the application's own React.

## Decision

**A channel or a series may carry kits in the library.**
- **The kit release.** A kit release is `library/<channel>/kits/<name>/<version>/`, or the series' own `kits/`. It holds `kit/index.tsx`, exporting `kit` (a `KitVersion`: name, version, description, zod `props`, `component`, examples).
- **Sealing.** `vpr kit seal` builds it into one CommonJS file, `kit.cjs`:
  - React, Remotion and zod are left to the application, so the kit draws with the same React and Remotion as everything else;
  - modules are named by place, never by machine path, as in ADR-0041.

  It checks that the bundle exports the kit its folder names and takes no application kit's `name@version`. Then it writes `kit.json` with the bundle's hash.
- **Pinning.** A series release lists the kits it may draw with: `kits: [{name, version, level: "channel" | "series", hash}]`, where `hash` is `kit.json`'s, filled in by `vpr template seal`. A pinned kit is never resealed.
- **The loader.**
  - It reads the kits the release pins, inside the channel or the series, and records both files among the timeline's inputs.
  - It refuses a `kit.json` or `kit.cjs` that is not the pinned or sealed one (`kit-mismatch`), and a kit that takes an application kit's name (`kit-shadows`).
  - It loads each kit in Node, resolving its external packages from the composer.
- **Compiling.** Kit props are validated as an application kit's.
- **Rendering and the layout sheet.**
  - They receive the kits as files plus hashes.
  - The composer generates the Remotion bundle's entry: the library kits are registered, then the root renders.
  - The sheet's kit lock holds a library kit's bundle hash, so a kit change makes the sheet stale.
  - The render cache already hashes the whole bundle.
- **`vpr kit verify`** checks the bundle is the sealed one, warns when the source no longer builds to it, and holds each example's props to the kit's schema.

## Consequences

- **Moving out.** A format's look and drawing can live with the channel, versioned in its repository. Phase 4 moves dentro-i-versi's kits out.
- **Lookup.** A timeline names a kit `name@version`. The application's kit wins, and a library kit can't take its name. The release's pins list exactly which library kits exist for it.
- **Sharing.** Library kits share the application's React, Remotion and zod. A kit that needs another package bundles it.
````

- [ ] **Step 4: Run them, and see them pass.**
  - `npm run build --workspace @studio/runtime`.
  - `cd studio/runtime && npx vitest run`: everything passes, including the 2 new tests.
  - At the root, `npm run check`.

- [ ] **Step 5: Commit.**

```bash
git add studio/runtime/src/cli.ts studio/runtime/test/integration/cli-kit.test.ts docs/running.md docs/index.md docs/adr/0042-kits-a-channel-or-series-carries.md
git commit -m "vpr kit seal and verify; ADR-0042: kits a channel or a series carries (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
