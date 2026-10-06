# Versioned Kit Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `@av/remotion-composer`'s minimal registry into a versioned one: released kit versions frozen in their own files and locked by hash, exact-match resolution, metadata and examples per version, a real one-frame render of every example in `npm test` and CI, and committed previews. No new kits.

**Architecture:** One self-contained file per version (`src/kits/<name>/<version>.tsx`, exporting `kit: KitVersion`), listed explicitly in `src/kits/index.ts`. `kits.lock.json` records each file's sha256 and a test enforces it. A second Remotion entry (`src/preview-entry.ts` → `PreviewRoot.tsx`) registers one composition per example, rendered with sample assets from `kits/samples/` both by the render test and by `npm run kits:previews`.

**Tech Stack:** TypeScript (NodeNext), React 19.2.4, Remotion 4.0.505 (`@remotion/bundler`, `@remotion/renderer`), zod 3.25.76, `node --import tsx --test`, FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-06-kit-registry-design.md`

## Global Constraints

- The three kits move **unchanged in behaviour** to `still/1.0.0.tsx`, `clip/1.0.0.tsx`, `captions/1.0.0.tsx`. The existing tests (schema, validation, assets, layers, volume, probe, and the `REMOTION_E2E=1` renders) keep passing.
- A version file imports only `react`, `remotion`, `zod` and `../types.js`.
- Resolution is exact: `resolveKit(name, version)` or `undefined`; no ranges.
- `kits:lock` adds missing versions and **throws** if a locked file's hash changed; it never rewrites an entry.
- Temporary directories must not start with `remotion-composer-` (the e2e test's leak check watches that prefix and the test files run in parallel): the render test uses `kit-render-test-`, the previews script `kit-previews-`.
- The package imports nothing from `studio/` (`node tools/check-boundaries.mjs`).
- Package version `0.1.0` → `0.2.0` in `package.json` **and** in `bun.lock` (bun 1.2.0 does not update workspace version lines; edit by hand, then `bun install --frozen-lockfile` must pass).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (decided while prototyping)

- `scripts/kits.ts` instead of `scripts/kits.mjs`: it imports the TypeScript registry, so it runs with `node --import tsx` like the tests.
- `src/preview-bundle.ts` holds the one `bundle()` call shared by the render test and the previews script. It needs a `webpackOverride` with `resolve.extensionAlias` (`.js` → `.tsx`/`.ts`/`.js`): Remotion bundles the TypeScript sources here, not `dist/`, and NodeNext imports end in `.js`.
- `docs/packages/remotion-composer.md` is generated from `compose.config.json`, not from the README, so `node tools/gen-docs.mjs` leaves it unchanged; the guide lives in the package README.

## Review Focus

- The 1.0.0 files must draw exactly what the old `Still.tsx`, `Clip.tsx`, `Captions.tsx` drew — compare with `git show HEAD:packages/remotion-composer/src/kits/<Old>.tsx`.
- `validateTimeline` still reports `unknown-kit` at `$.tracks[i].items[j].kit` and stops checking props of that item.
- The lock test fails on an edited locked file with a message telling the author to add a new version (checked by hand in Task 2).
- The render test's blank check (`YMAX − YMIN > 16`) would catch an all-black frame — the PreviewRoot background is black.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/kits/types.ts` | `AssetRef`, `KitContext`, `KitExample`, `KitVersion` | 1 |
| `src/kits/still/1.0.0.tsx`, `clip/1.0.0.tsx`, `captions/1.0.0.tsx` | The three released versions | 1 |
| `src/kits/index.ts` | `KIT_VERSIONS`, `resolveKit`, `kitVersions`, `listKits`, `previewCompositionId` | 1 |
| `src/validate.ts`, `src/Timeline.tsx`, `src/index.ts`, `test/validate.test.ts` | Use the new registry | 1 |
| `src/kits/registry.ts`, `Still.tsx`, `Clip.tsx`, `Captions.tsx` | Deleted | 1 |
| `kits/samples/sample.png`, `sample.mp4` | Sample assets for examples | 2 |
| `src/PreviewRoot.tsx`, `src/preview-entry.ts`, `src/preview-bundle.ts` | One composition per example | 2 |
| `scripts/kits.ts`, `package.json`, `bun.lock` | `kits:lock`, `kits:previews`, version 0.2.0 | 2 |
| `kits.lock.json`, `previews/*.png` | Generated, committed | 2 |
| `test/kits.test.ts` | Metadata, imports, lock, previews | 2 |
| `test/kits-render.test.ts` | One real frame per example | 3 |
| `.github/workflows/ci.yml`, `README.md` | CI matrix, guide | 4 |

Paths not starting with `.github/` or `docs/` are relative to `packages/remotion-composer/`. Commands run from the repository root unless a step says otherwise. Work on branch `feat/kit-registry` (already created; the spec is committed there).

---

### Task 1: Version files and the registry

**Files:**
- Create: `src/kits/types.ts`, `src/kits/still/1.0.0.tsx`, `src/kits/clip/1.0.0.tsx`, `src/kits/captions/1.0.0.tsx`, `src/kits/index.ts`
- Modify: `src/validate.ts`, `src/Timeline.tsx`, `src/index.ts`, `test/validate.test.ts`
- Delete: `src/kits/registry.ts`, `src/kits/Still.tsx`, `src/kits/Clip.tsx`, `src/kits/Captions.tsx`

- [ ] **Step 1: Update the validation test first**

In `test/validate.test.ts`, apply this change (import from the new registry; the unknown-kit test also checks the message; the listing test expects the new shape):

```diff
@@ -1,6 +1,6 @@
 import {describe, it} from 'node:test';
 import assert from 'node:assert/strict';
-import {listKits} from '../src/kits/registry.js';
+import {listKits} from '../src/kits/index.js';
 import {validateTimeline} from '../src/validate.js';
 import {clone, fixture} from './helpers.js';
 
@@ -21,6 +21,8 @@ describe('validateTimeline', () => {
     const doc = clone(fixture('explainer.json'));
     doc.tracks[0].items[0].kit.version = '2.0.0';
     assert.deepEqual(problems(doc), [['unknown-kit', '$.tracks[0].items[0].kit']]);
+    const result = validateTimeline(doc);
+    assert.match(result.ok ? '' : result.problems[0]!.message, /still@2\.0\.0: available still@1\.0\.0/);
   });
 
   it('refuses props a kit does not accept, at the offending field', () => {
@@ -36,11 +38,12 @@ describe('validateTimeline', () => {
     assert.deepEqual(problems({kind: 'EditTimeline'}).map(([code]) => code)[0], 'invalid-timeline');
   });
 
-  it('lists its three kits', () => {
-    assert.deepEqual(listKits(), [
-      {name: 'still', version: '1.0.0'},
-      {name: 'clip', version: '1.0.0'},
-      {name: 'captions', version: '1.0.0'},
+  it('lists every kit version with what the catalog needs', () => {
+    assert.deepEqual(listKits().map((k) => [k.name, k.version, k.examples, k.preview]), [
+      ['captions', '1.0.0', ['bottom', 'top'], 'previews/captions@1.0.0.png'],
+      ['clip', '1.0.0', ['plays'], 'previews/clip@1.0.0.png'],
+      ['still', '1.0.0', ['cover', 'contain'], 'previews/still@1.0.0.png'],
     ]);
+    assert.ok(listKits().every((k) => k.description.length > 0));
   });
 });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL — `Cannot find module '../src/kits/index.js'`.

- [ ] **Step 3: Write `src/kits/types.ts`**

```ts
// What a kit version is (avg-tk7.3). A kit is a named, versioned React
// component with a zod schema for its props, a description, and examples
// that the one-frame tests and the previews render.

import type React from 'react';
import type {ZodTypeAny} from 'zod';
import {z} from 'zod';

/** A `{ "$asset": "<id>" }` reference, as a timeline writes it. */
export const AssetRef = z.object({$asset: z.string().min(1)}).strict();

/** What a kit component receives besides its props (which arrive with $asset resolved to URLs). */
export interface KitContext {
  /** Asset URL → how many frames that video lasts, for kits that freeze at its end. */
  assetFrames: Record<string, number>;
}

export interface KitExample {
  /** ^[a-z0-9]+(-[a-z0-9]+)*$ */
  id: string;
  /** As a timeline writes them; $asset ids name entries of `samples`. */
  props: Record<string, unknown>;
  durationInFrames: number;
  /** The frame rendered by the one-frame test and the preview. */
  frame: number;
  /** $asset id → file in kits/samples/. */
  samples?: Record<string, string>;
}

export interface KitVersion {
  name: string;
  version: string;
  description: string;
  /** Validates props as a timeline writes them. */
  props: ZodTypeAny;
  component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
  examples: KitExample[];
}
```

- [ ] **Step 4: Write the three version files**

Their components are the old `Still.tsx`, `Clip.tsx`, `Captions.tsx` unchanged; what is new is the header, the `kit` export, the description and the examples.

`src/kits/still/1.0.0.tsx`:

```tsx
// still@1.0.0 — released: never edit this file; add still/<next>.tsx instead.
import React from 'react';
import {AbsoluteFill, Img} from 'remotion';
import {z} from 'zod';
import {AssetRef, type KitVersion} from '../types.js';

const Still: KitVersion['component'] = ({props}) => {
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const scale = (props.scale as number | undefined) ?? 1;
  return (
    <AbsoluteFill>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: fit, transform: `scale(${scale})`}} />
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'still',
  version: '1.0.0',
  description: 'An image filling the frame, covering it or contained in it, optionally scaled.',
  props: z.object({src: AssetRef, fit: z.enum(['cover', 'contain']).optional(), scale: z.number().positive().optional()}).strict(),
  component: Still,
  examples: [
    {id: 'cover', props: {src: {$asset: 'image'}, fit: 'cover'}, durationInFrames: 30, frame: 0, samples: {image: 'sample.png'}},
    {id: 'contain', props: {src: {$asset: 'image'}, fit: 'contain', scale: 0.8}, durationInFrames: 30, frame: 0, samples: {image: 'sample.png'}},
  ],
};
```

`src/kits/clip/1.0.0.tsx`:

```tsx
// clip@1.0.0 — released: never edit this file; add clip/<next>.tsx instead.
import React from 'react';
import {AbsoluteFill, Freeze, OffthreadVideo, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {AssetRef, type KitVersion} from '../types.js';

/** A video filling the frame, muted (its sound belongs on an audio track); its last frame holds when the item outlasts it. */
const Clip: KitVersion['component'] = ({props, context}) => {
  const frame = useCurrentFrame();
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const last = (context.assetFrames[src] ?? Number.POSITIVE_INFINITY) - 1;
  const video = <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: fit}} />;
  return <AbsoluteFill>{frame > last ? <Freeze frame={last}>{video}</Freeze> : video}</AbsoluteFill>;
};

export const kit: KitVersion = {
  name: 'clip',
  version: '1.0.0',
  description: 'A muted video filling the frame; its last frame holds when the item outlasts the clip.',
  props: z.object({src: AssetRef, fit: z.enum(['cover', 'contain']).optional()}).strict(),
  component: Clip,
  examples: [{id: 'plays', props: {src: {$asset: 'video'}}, durationInFrames: 30, frame: 15, samples: {video: 'sample.mp4'}}],
};
```

`src/kits/captions/1.0.0.tsx`:

```tsx
// captions@1.0.0 — released: never edit this file; add captions/<next>.tsx instead.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';

const Captions: KitVersion['component'] = ({props}) => {
  const position = (props.position as 'top' | 'bottom' | 'center' | undefined) ?? 'bottom';
  const justify = position === 'top' ? 'flex-start' : position === 'center' ? 'center' : 'flex-end';
  return (
    <AbsoluteFill style={{justifyContent: justify, alignItems: 'center', padding: '6% 8%'}}>
      <div
        style={{
          fontFamily: (props.font as string | undefined) ?? 'Inter, Helvetica, Arial, sans-serif',
          fontSize: (props.fontSize as number | undefined) ?? 56,
          lineHeight: 1.25,
          color: (props.color as string | undefined) ?? '#ffffff',
          backgroundColor: (props.backgroundColor as string | undefined) ?? 'rgba(0, 0, 0, 0.55)',
          padding: '0.35em 0.6em',
          borderRadius: '0.25em',
          textAlign: 'center',
          maxWidth: '100%',
        }}
      >
        {props.text as string}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'captions',
  version: '1.0.0',
  description: 'A block of text in the safe area, at the top, centre or bottom, on a translucent plate.',
  props: z.object({
    text: z.string().min(1),
    position: z.enum(['top', 'bottom', 'center']).optional(),
    fontSize: z.number().positive().optional(),
    color: z.string().min(1).optional(),
    backgroundColor: z.string().min(1).optional(),
    font: z.string().min(1).optional(),
  }).strict(),
  component: Captions,
  examples: [
    {id: 'bottom', props: {text: 'Once upon a time, in a village by the woods…'}, durationInFrames: 30, frame: 0},
    {id: 'top', props: {text: 'Chapter one', position: 'top', fontSize: 72, backgroundColor: '#1b1f3b'}, durationInFrames: 30, frame: 0},
  ],
};
```

- [ ] **Step 5: Write the registry `src/kits/index.ts`**

```ts
// The kit registry (avg-tk7.3). Released versions are frozen and coexist; a
// timeline gets exactly the version it names. Every version is imported
// explicitly — no filesystem scanning — so the Remotion bundle has them all.

import type {KitVersion} from './types.js';
import {kit as still100} from './still/1.0.0.js';
import {kit as clip100} from './clip/1.0.0.js';
import {kit as captions100} from './captions/1.0.0.js';

export type {KitContext, KitExample, KitVersion} from './types.js';
export {AssetRef} from './types.js';

/** Every released kit version. Adding a version: import it here, then `npm run kits:lock`. */
export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([still100, clip100, captions100]);

const key = (name: string, version: string) => `${name}@${version}`;
const byKey = new Map(KIT_VERSIONS.map((k) => [key(k.name, k.version), k]));

/** The exact version a timeline names, or undefined. */
export const resolveKit = (name: string, version: string): KitVersion | undefined => byKey.get(key(name, version));

/** The versions available for a kit name, e.g. ["1.0.0", "1.1.0"]. */
export const kitVersions = (name: string): string[] =>
  KIT_VERSIONS.filter((k) => k.name === name).map((k) => k.version).sort(compareSemver);

/** The Remotion composition id of a kit example in the preview entry, e.g. still-1-0-0-cover. */
export const previewCompositionId = (name: string, version: string, exampleId: string): string =>
  `${name}-${version.replace(/[.+]/g, '-')}-${exampleId}`;

export interface KitListing {
  name: string;
  version: string;
  description: string;
  examples: string[];
  preview: string;
}

/** Every version, sorted by name then version: what the catalog and the agent read. */
export const listKits = (): KitListing[] =>
  [...KIT_VERSIONS]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : compareSemver(a.version, b.version)))
    .map((k) => ({
      name: k.name,
      version: k.version,
      description: k.description,
      examples: k.examples.map((e) => e.id),
      preview: `previews/${k.name}@${k.version}.png`,
    }));

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number(x));
  const pb = b.split(/[.-]/).map((x) => Number(x));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
```

- [ ] **Step 6: Rewire validation, the composition and the package exports**

```diff
@@ -4,7 +4,7 @@
 // validateEditTimeline, which the caller runs first (ADR-0034).
 
 import type {ZodIssue} from 'zod';
-import {KITS} from './kits/registry.js';
+import {kitVersions, resolveKit} from './kits/index.js';
 import {EditTimelineSchema, isAudioItem, type EditTimeline} from './schema.js';
 import type {ComposerProblem} from './errors.js';
 
@@ -23,9 +23,10 @@ export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimelin
     track.items.forEach((item, ii) => {
       if (isAudioItem(item)) return;
       const p = `$.tracks[${ti}].items[${ii}]`;
-      const kit = KITS[item.kit.name];
-      if (!kit || kit.version !== item.kit.version) {
-        const known = kit ? `${item.kit.name} is ${kit.version} here` : `no kit "${item.kit.name}"`;
+      const kit = resolveKit(item.kit.name, item.kit.version);
+      if (!kit) {
+        const versions = kitVersions(item.kit.name);
+        const known = versions.length > 0 ? `available ${versions.map((v) => `${item.kit.name}@${v}`).join(', ')}` : `no kit "${item.kit.name}"`;
         problems.push({code: 'unknown-kit', message: `${item.kit.name}@${item.kit.version}: ${known}`, path: `${p}.kit`});
         return;
       }
```

```diff
@@ -4,7 +4,7 @@
 
 import React from 'react';
 import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
-import {KITS} from './kits/registry.js';
+import {resolveKit} from './kits/index.js';
 import type {AudioItem, EditTimeline, VisualItem} from './schema.js';
 import {isAudioItem} from './schema.js';
 import {itemVolume} from './volume.js';
@@ -36,7 +36,7 @@ const ItemLayer: React.FC<{item: VisualItem; files: Record<string, string>; asse
   let opacity = 1;
   if (item.transitionIn) opacity = Math.min(opacity, Math.min(1, frame / item.transitionIn.duration));
   if (item.transitionOut) opacity = Math.min(opacity, Math.min(1, (item.duration - frame) / item.transitionOut.duration));
-  const kit = KITS[item.kit.name]!;
+  const kit = resolveKit(item.kit.name, item.kit.version)!;
   const Kit = kit.component;
   // Kits see URLs, so the frame counts are keyed by URL too.
   const byUrl = Object.fromEntries(Object.entries(assetFrames).map(([file, frames]) => [staticFile(file), frames]));
```

```diff
@@ -1,6 +1,6 @@
 export {renderTimeline, type RenderTimelineOptions, type RenderResult} from './render.js';
 export {validateTimeline} from './validate.js';
-export {listKits} from './kits/registry.js';
+export {listKits, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample} from './kits/index.js';
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
 export {DEFAULT_LOUDNESS, type LoudnessTarget, type LoudnessResult} from './loudness.js';
 export {EditTimelineSchema, type EditTimeline} from './schema.js';
```

- [ ] **Step 7: Delete the old registry and kits**

Run: `git rm packages/remotion-composer/src/kits/registry.ts packages/remotion-composer/src/kits/Still.tsx packages/remotion-composer/src/kits/Clip.tsx packages/remotion-composer/src/kits/Captions.tsx`

Then `grep -rn "kits/registry\|kits/Still\|kits/Clip\|kits/Captions" packages/remotion-composer/src packages/remotion-composer/test` must print nothing.

- [ ] **Step 8: Run typecheck and the whole package suite**

Run: `cd packages/remotion-composer && npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (17 at this point).

- [ ] **Step 9: Commit**

```bash
git add packages/remotion-composer/src packages/remotion-composer/test
git commit -m "feat(remotion-composer): one frozen file per kit version, exact-match registry (avg-tk7.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Samples, preview compositions, lock and previews, metadata test

**Files:**
- Create: `kits/samples/sample.png`, `kits/samples/sample.mp4`, `src/PreviewRoot.tsx`, `src/preview-entry.ts`, `src/preview-bundle.ts`, `scripts/kits.ts`, `test/kits.test.ts`
- Generate: `kits.lock.json`, `previews/captions@1.0.0.png`, `previews/clip@1.0.0.png`, `previews/still@1.0.0.png`
- Modify: `package.json`, root `bun.lock`

- [ ] **Step 1: Write the metadata test**

`test/kits.test.ts`:

```ts
// Every kit version keeps the registry's rules (avg-tk7.3): well-formed
// metadata, examples its own schema accepts, self-contained source, a file
// frozen by kits.lock.json, and a committed preview.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KIT_VERSIONS} from '../src/kits/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
const lock = JSON.parse(readFileSync(path.join(root, 'kits.lock.json'), 'utf8')) as Record<string, string>;
const ALLOWED_IMPORTS = new Set(['react', 'remotion', 'zod', '../types.js']);

describe('kit versions', () => {
  for (const kit of KIT_VERSIONS) {
    const id = `${kit.name}@${kit.version}`;
    describe(id, () => {
      it('has a well-formed name, version and description', () => {
        assert.match(kit.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
        assert.match(kit.version, /^\d+\.\d+\.\d+$/);
        assert.ok(kit.description.trim().length > 0);
      });

      it('has examples its own schema accepts, within their duration, with existing samples', () => {
        assert.ok(kit.examples.length > 0);
        assert.equal(new Set(kit.examples.map((e) => e.id)).size, kit.examples.length);
        for (const example of kit.examples) {
          assert.match(example.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
          const parsed = kit.props.safeParse(example.props);
          assert.ok(parsed.success, `${example.id}: ${parsed.success ? '' : parsed.error.message}`);
          assert.ok(Number.isInteger(example.durationInFrames) && example.durationInFrames >= 1);
          assert.ok(Number.isInteger(example.frame) && example.frame >= 0 && example.frame < example.durationInFrames);
          for (const file of Object.values(example.samples ?? {})) assert.ok(existsSync(path.join(root, 'kits/samples', file)), file);
        }
      });

      it('lives in its own self-contained file', () => {
        const file = source(kit.name, kit.version);
        assert.ok(existsSync(file), `${path.relative(root, file)} must hold ${id}`);
        const imports = [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
        for (const spec of imports) assert.ok(ALLOWED_IMPORTS.has(spec), `${id} imports ${spec}: only ${[...ALLOWED_IMPORTS].join(', ')} are allowed`);
      });

      it('is frozen by kits.lock.json', () => {
        const actual = `sha256:${createHash('sha256').update(readFileSync(source(kit.name, kit.version))).digest('hex')}`;
        assert.ok(lock[id], `${id} is not in kits.lock.json: run npm run kits:lock`);
        assert.equal(actual, lock[id], `${id} is released: restore its file and add ${kit.name}/<next version>.tsx instead`);
      });

      it('has a committed preview', () => {
        assert.ok(existsSync(path.join(root, 'previews', `${id}.png`)), `run npm run kits:previews`);
      });
    });
  }

  it('locks no version the registry does not have, and keeps no version file out of the registry', () => {
    const registered = new Set(KIT_VERSIONS.map((k) => `${k.name}@${k.version}`));
    assert.deepEqual(Object.keys(lock).filter((id) => !registered.has(id)), []);
    const files = readdirSync(path.join(root, 'src/kits'), {withFileTypes: true})
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(path.join(root, 'src/kits', d.name)).filter((f) => f.endsWith('.tsx')).map((f) => `${d.name}@${f.replace(/\.tsx$/, '')}`));
    assert.deepEqual(files.filter((id) => !registered.has(id)), []);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/remotion-composer && node --import tsx --test test/kits.test.ts`
Expected: FAIL — `kits.lock.json` does not exist (ENOENT at module load).

- [ ] **Step 3: Generate the samples**

```bash
cd packages/remotion-composer && mkdir -p kits/samples
ffmpeg -y -v error -f lavfi -i "gradients=s=1280x720:c0=0x2e7d32:c1=0x6a1b9a:seed=3" -frames:v 1 kits/samples/sample.png
ffmpeg -y -v error -f lavfi -i "testsrc2=s=320x180:r=30:d=1" -c:v libx264 -pix_fmt yuv420p kits/samples/sample.mp4
```

Expected: `sample.png` about 100 KB, `sample.mp4` about 15 KB.

- [ ] **Step 4: Write the preview compositions and the shared bundle helper**

`src/PreviewRoot.tsx`:

```tsx
// One composition per example of every kit version: what the one-frame tests
// and the previews render. Example $asset ids resolve to files in kits/samples/.

import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {KIT_VERSIONS, previewCompositionId, type KitExample, type KitVersion} from './kits/index.js';
import {resolveAssets} from './Timeline.js';

const Example: React.FC<{name: string; version: string; example: string}> = ({name, version, example}) => {
  const kit = KIT_VERSIONS.find((k) => k.name === name && k.version === version)!;
  const ex = kit.examples.find((e) => e.id === example)!;
  const Kit = kit.component;
  return (
    <AbsoluteFill style={{backgroundColor: '#000000'}}>
      <Kit props={resolveAssets(ex.props, ex.samples ?? {}) as Record<string, unknown>} context={{assetFrames: {}}} />
    </AbsoluteFill>
  );
};

const compositions = (kit: KitVersion, example: KitExample) => (
  <Composition
    key={previewCompositionId(kit.name, kit.version, example.id)}
    id={previewCompositionId(kit.name, kit.version, example.id)}
    component={Example}
    durationInFrames={example.durationInFrames}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{name: kit.name, version: kit.version, example: example.id}}
  />
);

export const PreviewRoot: React.FC = () => <>{KIT_VERSIONS.flatMap((kit) => kit.examples.map((example) => compositions(kit, example)))}</>;
```

`src/preview-entry.ts`:

```ts
import {registerRoot} from 'remotion';
import {PreviewRoot} from './PreviewRoot.js';

registerRoot(PreviewRoot);
```

`src/preview-bundle.ts`:

```ts
// Bundle the kit preview compositions straight from the TypeScript sources,
// so the one-frame tests need no build. Webpack must be told that the ESM
// `./x.js` specifiers name `./x.ts` / `./x.tsx` files, as TypeScript reads them.

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function bundlePreviews(outDir: string): Promise<string> {
  return bundle({
    entryPoint: path.join(packageRoot, 'src/preview-entry.ts'),
    publicDir: path.join(packageRoot, 'kits/samples'),
    outDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {...config.resolve, extensionAlias: {'.js': ['.tsx', '.ts', '.js']}},
    }),
  });
}
```

- [ ] **Step 5: Write `scripts/kits.ts`**

```ts
// npm run kits:lock      add new kit versions to kits.lock.json (never rewrites an entry)
// npm run kits:previews  render previews/<name>@<version>.png (first example, 640x360)

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockFile = path.join(root, 'kits.lock.json');
const sourceOf = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
const hash = (file: string) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;

async function lock() {
  const current: Record<string, string> = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {};
  const next = {...current};
  for (const kit of KIT_VERSIONS) {
    const id = `${kit.name}@${kit.version}`;
    const actual = hash(sourceOf(kit.name, kit.version));
    if (current[id] && current[id] !== actual) {
      throw new Error(`${id} is released and its file changed: restore it and add a new version instead`);
    }
    if (!current[id]) {
      next[id] = actual;
      console.log(`locked ${id}`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(lockFile, JSON.stringify(sorted, null, 2) + '\n');
}

async function previews() {
  const work = await mkdtemp(path.join(tmpdir(), 'kit-previews-'));
  try {
    const serveUrl = await bundlePreviews(path.join(work, 'bundle'));
    for (const kit of KIT_VERSIONS) {
      const example = kit.examples[0]!;
      const id = previewCompositionId(kit.name, kit.version, example.id);
      const composition = await selectComposition({serveUrl, id, inputProps: {}});
      const output = path.join(root, 'previews', `${kit.name}@${kit.version}.png`);
      await renderStill({composition, serveUrl, output, frame: example.frame, scale: 1 / 3, imageFormat: 'png', overwrite: true});
      console.log(`rendered ${path.relative(root, output)}`);
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

const command = process.argv[2];
if (command === 'lock') await lock();
else if (command === 'previews') await previews();
else {
  console.error('Usage: node --import tsx scripts/kits.ts lock|previews');
  process.exit(1);
}
```

- [ ] **Step 6: Scripts and version in `package.json`, version in `bun.lock`**

```diff
@@ -1,6 +1,6 @@
 {
   "name": "@av/remotion-composer",
-  "version": "0.1.0",
+  "version": "0.2.0",
   "private": true,
   "type": "module",
   "description": "Renders a layered, kit-based edit timeline (studio.video/v1alpha2) with Remotion, then normalises loudness with FFmpeg",
@@ -17,7 +17,9 @@
     "build": "tsc",
     "typecheck": "tsc --noEmit",
     "test": "node --import tsx --test \"test/**/*.test.ts\"",
-    "check": "npm run typecheck && npm test"
+    "check": "npm run typecheck && npm test",
+    "kits:lock": "node --import tsx scripts/kits.ts lock",
+    "kits:previews": "node --import tsx scripts/kits.ts previews"
   },
   "dependencies": {
     "@remotion/bundler": "4.0.505",
```

In the root `bun.lock`, under `"packages/remotion-composer": {`, change `"version": "0.1.0"` to `"version": "0.2.0"`. Then run `bun install --frozen-lockfile` — it must succeed.

- [ ] **Step 7: Lock the versions and render the previews**

```bash
cd packages/remotion-composer && npm run kits:lock && npm run kits:previews
```

Expected: `kits.lock.json` with three keys `captions@1.0.0`, `clip@1.0.0`, `still@1.0.0`, each `sha256:<64 hex>`; three PNGs in `previews/`, each 640×360 (`ffprobe -v error -show_entries stream=width,height -of csv=p=0 previews/still@1.0.0.png` prints `640,360`). Open them: `still` a green-to-purple gradient filling the frame, `clip` the testsrc2 pattern, `captions` "Once upon a time, in a village by the woods…" at the bottom. Running `npm run kits:lock` a second time changes nothing (`git status` shows the same files).

- [ ] **Step 8: Run the metadata test**

Run: `cd packages/remotion-composer && node --import tsx --test test/kits.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 9: Check by hand that a released file is frozen**

```bash
cd packages/remotion-composer && echo "// x" >> src/kits/still/1.0.0.tsx
node --import tsx --test test/kits.test.ts 2>&1 | grep -E "is released|^# fail"
npm run kits:lock; echo "exit $?"
git checkout src/kits/still/1.0.0.tsx
```

Expected: the test fails once with `still@1.0.0 is released: restore its file and add still/<next version>.tsx instead`; `kits:lock` exits non-zero without touching `kits.lock.json`; after the checkout the test passes again.

- [ ] **Step 10: Run the whole package suite and the typecheck**

Run: `cd packages/remotion-composer && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add packages/remotion-composer bun.lock
git commit -m "feat(remotion-composer): kit examples, lock, previews and metadata test (avg-tk7.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One real frame per example

**Files:**
- Create: `test/kits-render.test.ts`

- [ ] **Step 1: Write the render test**

```ts
// One real frame per example of every kit version (avg-tk7.3): rendered with
// Remotion's headless Chrome, checked for size and for not being blank. Runs
// in `npm test` and CI; Remotion downloads Chrome on first use.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';

/** Luma range of an image: max − min, from ffprobe's signalstats. */
function lumaRange(file: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-f', 'lavfi', '-i', `movie=${file},signalstats`,
    '-show_entries', 'frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX', '-of', 'json'], {encoding: 'utf8'});
  const tags = (JSON.parse(r.stdout) as {frames: {tags: Record<string, string>}[]}).frames[0]!.tags;
  return Number(tags['lavfi.signalstats.YMAX']) - Number(tags['lavfi.signalstats.YMIN']);
}

function size(file: string): [number, number] {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return [w!, h!];
}

describe('every kit example renders a real frame', () => {
  let work = '';
  let serveUrl = '';
  before(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'kit-render-test-'));
    serveUrl = await bundlePreviews(path.join(work, 'bundle'));
  });
  after(async () => {
    if (work) await rm(work, {recursive: true, force: true});
  });

  for (const kit of KIT_VERSIONS) {
    for (const example of kit.examples) {
      const id = previewCompositionId(kit.name, kit.version, example.id);
      it(`${kit.name}@${kit.version} ${example.id}`, async () => {
        const composition = await selectComposition({serveUrl, id, inputProps: {}});
        const output = path.join(work, `${id}.png`);
        await renderStill({composition, serveUrl, output, frame: example.frame, imageFormat: 'png'});
        assert.deepEqual(size(output), [1920, 1080]);
        assert.ok(lumaRange(output) > 16, `${id} rendered a blank frame`);
      });
    }
  }
});
```

- [ ] **Step 2: Run it**

Run: `cd packages/remotion-composer && node --import tsx --test test/kits-render.test.ts`
Expected: PASS, 5 tests (`still@1.0.0 cover`, `still@1.0.0 contain`, `clip@1.0.0 plays`, `captions@1.0.0 bottom`, `captions@1.0.0 top`). The first run may download Remotion's headless Chrome.

- [ ] **Step 3: Show it catches a blank frame**

Temporarily change the `Example` component in `src/PreviewRoot.tsx` to return `<AbsoluteFill style={{backgroundColor: 'black'}} />` without the kit, re-run the render test: every example must fail with `rendered a blank frame`. Revert with `git checkout src/PreviewRoot.tsx` and re-run: PASS.

- [ ] **Step 4: Nothing left behind**

Run: `ls "${TMPDIR:-/tmp}" | grep -E "^kit-render-test-|^remotion-composer-"`
Expected: prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/remotion-composer/test/kits-render.test.ts
git commit -m "test(remotion-composer): render one real frame of every kit example (avg-tk7.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CI, guide, full checks

**Files:**
- Modify: `.github/workflows/ci.yml`, `packages/remotion-composer/README.md`

- [ ] **Step 1: Add the package to the CI module matrix**

```diff
@@ -74,6 +74,7 @@ jobs:
           - packages/terminal-recorder
           - packages/infographics
           - packages/video-composer
+          - packages/remotion-composer
           - studio/contracts
           - studio/runtime
           - studio/pipelines
```

- [ ] **Step 2: Add the guide to the README**

```diff
@@ -17,7 +17,29 @@ knows timelines, kits and files — not episodes, pipelines or the studio.
 - **Normalises** loudness (default −15 LUFS integrated, −1 dBTP true peak) and
   returns a result record: path, duration, size, sha256, kits used, loudness.
 
-Kits in this version: `still`, `clip`, `captions` (all `1.0.0`).
+Kits in this version: `still`, `clip`, `captions` (all `1.0.0`). A timeline
+gets exactly the version it names; `listKits()` gives each version's
+description, examples and preview (`previews/<name>@<version>.png`).
+
+## Adding a kit or a version
+
+A released version never changes: a delivered episode must re-render as it
+was. A change — even a fix — is a new version next to the old one.
+
+1. Write `src/kits/<name>/<version>.tsx` exporting `kit: KitVersion` (name,
+   version, one-sentence description, zod `props`, `component`, `examples`).
+   It may import only `react`, `remotion`, `zod` and `../types.js`: a shared
+   helper changing would silently change old versions. For a new version,
+   copy the previous file and edit the copy.
+2. Give it at least one example: props as a timeline writes them, a
+   `durationInFrames`, the `frame` to preview, and `samples` mapping its
+   `$asset` ids to files in `kits/samples/`.
+3. Add it to `KIT_VERSIONS` in `src/kits/index.ts`.
+4. `npm run kits:lock` records the file's sha256 in `kits.lock.json` (it
+   never rewrites an existing entry); `npm run kits:previews` renders the
+   first example to `previews/<name>@<version>.png` (640×360). Commit both.
+5. `npm test` checks the metadata, the self-contained imports and the lock,
+   and renders one real frame of every example.
 
 ## API
 
@@ -46,7 +68,7 @@ node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <epis
 ## Tests
 
 ```bash
-npm test --workspace @av/remotion-composer                     # fast: schema, kits, volume, assets
+npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example
 npm run build --workspace @av/remotion-composer && \
   REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also two real renders
 ```
```

- [ ] **Step 3: Regenerate docs**

Run: `node tools/gen-docs.mjs && git status --short docs/`
Expected: no change under `docs/` (the generated page comes from `compose.config.json`).

- [ ] **Step 4: End-to-end renders still pass alongside the new tests**

```bash
cd packages/remotion-composer && npm run build && REMOTION_E2E=1 npm test; rm -rf dist
```

Expected: 40 tests, all pass — in particular `a render must leave no bundle or staging directory behind`, which would fail if a new temporary directory started with `remotion-composer-`.

- [ ] **Step 5: Root checks**

Run: `node tools/check-boundaries.mjs && npm run check`
Expected: boundaries green; `npm run check` passes.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml packages/remotion-composer/README.md
git commit -m "ci,docs(remotion-composer): test the package in CI; guide to adding a kit version (avg-tk7.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Layout, `KitVersion`, version files, import rule | Task 1 (Steps 3–5), Task 2 Step 1 (import allowlist test) |
| Lock, `kits:lock` never rewrites | Task 2 Steps 5, 7, 9 |
| `resolveKit`, `listKits`, unknown-kit message | Task 1 Steps 1, 5, 6 |
| Samples and the five examples | Task 1 Step 4, Task 2 Step 3 |
| One-frame render test, 1920×1080, not blank, cleanup | Task 3 |
| Metadata test | Task 2 Steps 1, 8 |
| Previews 640×360 | Task 2 Step 7 |
| CI matrix | Task 4 Step 1 |
| README guide, docs, version 0.2.0 | Task 2 Step 6, Task 4 Steps 2–3 |
| Existing tests and e2e unchanged | Task 1 Step 8, Task 4 Step 4 |
