# Remotion Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@av/remotion-composer`, which renders a `studio.video/v1alpha2` edit timeline with Remotion (kits `still`, `clip`, `captions`; audio with fades and ducking) and normalises loudness with a two-pass FFmpeg `loudnorm`, registered as a second `video.compose` provider without becoming the default.

**Architecture:** A standalone package modelled on `packages/infographics`: a zod mirror of the timeline (structure only), a minimal kit registry, a root composition (`Timeline.tsx`), asset verification and staging into a temporary public directory, `bundle → selectComposition → renderMedia`, then `loudnorm`. Studio-side wiring is limited to `compose.config.json`, the bun workspace and generated docs.

**Tech Stack:** TypeScript (NodeNext, `tsc` to `dist/`), React 19.2.4, Remotion 4.0.505 (`@remotion/bundler`, `@remotion/renderer`), zod 3.25.76, `node --import tsx --test`, FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-06-remotion-composer-design.md`

## Global Constraints

- Remotion **4.0.505**, React **19.2.4**, zod **3.25.76** — exactly `packages/infographics`' versions, so one Remotion resolves.
- The package imports nothing from `studio/` (`node tools/check-boundaries.mjs` must stay green). Contract fixtures are read as files in tests, never imported.
- Kits `still`, `clip`, `captions`, all `1.0.0`. Error codes exactly: `invalid-timeline`, `unknown-kit`, `bad-props`, `missing-asset`, `hash-mismatch`, `render-failed`, `loudness-failed`.
- Loudness default `I=-15:TP=-1:LRA=11`, two passes, video stream copied, AAC 192k at 48 kHz. A timeline without audio items skips loudness and keeps Remotion's enforced silent track (`loudness: null`).
- `video-composer` stays the default `video.compose` provider in every profile.
- End-to-end renders run only with `REMOTION_E2E=1` against `dist/` (they need headless Chrome, downloaded by Remotion on first use).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A crossfade on the same track: the incoming item must draw above the outgoing one — items render in array order inside a track, and the migration and fixtures list the later item later. A timeline listing them the other way round would crossfade under; check `Timeline.tsx`.
- `clip` freezing: `assetFrames` is keyed by staged file name and converted to URLs inside the bundle (`staticFile`); a clip asset whose ffprobe fails gets `Infinity` (never freezes) rather than a crash.
- Ducking with no `under` items at all (a music track ducked under an empty voice track) must leave the music at full gain.
- Assets with the same extension but different ids never collide (`assets/<id><ext>`); asset ids with dots (`scene-01.a`) still produce a unique name.
- The temporary public directory and render directory are removed on success and on failure (`finally`).

## File map

| File | Responsibility | Task |
|---|---|---|
| `packages/remotion-composer/package.json`, `tsconfig.json`; root `package.json`, `bun.lock` | The workspace | 1 |
| `src/schema.ts` | zod mirror of the v1alpha2 timeline | 1 |
| `src/kits/registry.ts`, `Still.tsx`, `Clip.tsx`, `Captions.tsx` | Minimal registry and three kits | 1 |
| `src/errors.ts`, `src/validate.ts` | `ComposerError`, `validateTimeline` | 1 |
| `test/helpers.ts`, `test/schema.test.ts`, `test/validate.test.ts` | Mirror conformance, validation | 1 |
| `src/volume.ts`, `src/assets.ts`, `test/volume.test.ts`, `test/assets.test.ts` | Volume curve, asset verification and staging | 2 |
| `src/Timeline.tsx`, `src/Root.tsx`, `src/remotion-entry.ts`, `src/loudness.ts`, `src/render.ts`, `src/index.ts`, `src/cli.ts`, `test/render.e2e.test.ts` | Composition, render, loudness, CLI | 3 |
| `compose.config.json`, `packages/remotion-composer/README.md`, `docs/packages/remotion-composer.md` (generated) | Registration and docs | 4 |

Paths under `src/` and `test/` are relative to `packages/remotion-composer/`. Commands run from the repository root unless a step says otherwise. Work on branch `feat/remotion-composer` (already created; the spec is committed there).

---

### Task 1: The workspace, the timeline mirror, kits and validation

**Files:**
- Create: `packages/remotion-composer/package.json`, `packages/remotion-composer/tsconfig.json`
- Modify: root `package.json` (workspaces), `bun.lock` (via `bun install`)
- Create: `src/schema.ts`, `src/errors.ts`, `src/validate.ts`, `src/kits/registry.ts`, `src/kits/Still.tsx`, `src/kits/Clip.tsx`, `src/kits/Captions.tsx`
- Create: `test/helpers.ts`, `test/schema.test.ts`, `test/validate.test.ts`

**Interfaces:**
- Produces: `EditTimelineSchema`, types `EditTimeline`, `Track`, `VisualItem`, `AudioItem`, `isAudioItem` (`schema.ts`); `KITS`, `listKits()`, `KitContext`, `AssetRef` (`kits/registry.ts`); `ComposerError`, `ComposerErrorCode`, `ComposerProblem` (`errors.ts`); `validateTimeline(doc) → { ok: true, timeline } | { ok: false, problems }` (`validate.ts`). Kit components take `{ props, context: { assetFrames } }` with `$asset` already resolved to a URL. Tasks 2 and 3 rely on these names.

- [ ] **Step 1: The workspace**

Create `packages/remotion-composer/package.json`:

```json
{
  "name": "@av/remotion-composer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Renders a layered, kit-based edit timeline (studio.video/v1alpha2) with Remotion, then normalises loudness with FFmpeg",
  "engines": {
    "node": ">=20"
  },
  "bin": {
    "render-timeline": "./dist/cli.js"
  },
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test \"test/**/*.test.ts\"",
    "check": "npm run typecheck && npm test"
  },
  "dependencies": {
    "@remotion/bundler": "4.0.505",
    "@remotion/renderer": "4.0.505",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "remotion": "4.0.505",
    "zod": "3.25.76"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.0"
  }
}
```

Create `packages/remotion-composer/tsconfig.json` — identical to `packages/infographics/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

In the root `package.json`, in `workspaces`, below `"packages/video-composer",` add `"packages/remotion-composer",`. Then run `bun install`.
Expected: it completes; `ls packages/remotion-composer/node_modules` lists `remotion`, `zod`, `react`, `@remotion`; `git diff --stat bun.lock` shows the new workspace entry. If `bun.lock` does not gain a `"packages/remotion-composer"` workspace entry, record a ruling and add it by hand mirroring the `packages/infographics` entry (name, version, dependencies, devDependencies as in this package.json), then confirm `bun install --frozen-lockfile` reports no changes.

- [ ] **Step 2: Write the failing tests**

Create `test/helpers.ts`:

```ts
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The contracts' own v1alpha2 fixtures, read as files: this package may not import studio/. */
export const CONTRACT_FIXTURES = path.resolve(here, '../../../studio/contracts/fixtures/timeline/v1alpha2');

export const fixture = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(path.join(CONTRACT_FIXTURES, 'valid', name), 'utf8')) as Record<string, any>;

export const clone = <T>(value: T): T => structuredClone(value);
```

Create `test/schema.test.ts`:

```ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {EditTimelineSchema} from '../src/schema.js';
import {CONTRACT_FIXTURES, clone, fixture} from './helpers.js';

describe('the zod mirror of the v1alpha2 timeline', () => {
  it('accepts every valid fixture of the contracts', () => {
    const files = readdirSync(path.join(CONTRACT_FIXTURES, 'valid'));
    assert.ok(files.length >= 2);
    for (const file of files) {
      const result = EditTimelineSchema.safeParse(fixture(file));
      assert.ok(result.success, `${file}: ${result.success ? '' : result.error.message}`);
    }
  });

  it('rejects what the JSON Schema rejects', () => {
    const fractional = clone(fixture('lesson-excerpt.json'));
    fractional.tracks[2].items[0].from = 0.5;
    assert.equal(EditTimelineSchema.safeParse(fractional).success, false);

    const oldVersion = {...clone(fixture('lesson-excerpt.json')), apiVersion: 'studio.video/v1alpha1'};
    assert.equal(EditTimelineSchema.safeParse(oldVersion).success, false);

    const both = clone(fixture('lesson-excerpt.json'));
    both.tracks[1].items[0].asset = 'room';
    assert.equal(EditTimelineSchema.safeParse(both).success, false);

    const extra = {...clone(fixture('explainer.json')), unexpected: true};
    assert.equal(EditTimelineSchema.safeParse(extra).success, false);
  });
});
```

Create `test/validate.test.ts`:

```ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {listKits} from '../src/kits/registry.js';
import {validateTimeline} from '../src/validate.js';
import {clone, fixture} from './helpers.js';

const problems = (doc: unknown) => {
  const result = validateTimeline(doc);
  return result.ok ? [] : result.problems.map((p) => [p.code, p.path]);
};

describe('validateTimeline', () => {
  it('accepts the migrated explainer, which uses only still and captions', () => {
    assert.deepEqual(problems(fixture('explainer.json')), []);
  });

  it('refuses kits it does not have, by name or by version', () => {
    // The lesson excerpt uses sala, interprete and verse-bar, which avg-tk7.3 and later issues add.
    const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
    assert.deepEqual([...codes], ['unknown-kit']);
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit.version = '2.0.0';
    assert.deepEqual(problems(doc), [['unknown-kit', '$.tracks[0].items[0].kit']]);
  });

  it('refuses props a kit does not accept, at the offending field', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[1].props.fit = 'stretch';
    assert.deepEqual(problems(doc), [['bad-props', '$.tracks[0].items[1].props.fit']]);
    const unknown = clone(fixture('explainer.json'));
    unknown.tracks[1].items[0].props.colour = 'red';
    assert.deepEqual(problems(unknown).map(([code]) => code), ['bad-props']);
  });

  it('reports a malformed timeline as invalid-timeline', () => {
    assert.deepEqual(problems({kind: 'EditTimeline'}).map(([code]) => code)[0], 'invalid-timeline');
  });

  it('lists its three kits', () => {
    assert.deepEqual(listKits(), [
      {name: 'still', version: '1.0.0'},
      {name: 'clip', version: '1.0.0'},
      {name: 'captions', version: '1.0.0'},
    ]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd packages/remotion-composer && node --import tsx --test "test/**/*.test.ts" 2>&1 | grep -E "Cannot find module|ERR_MODULE_NOT_FOUND|^# fail" | head -3`
Expected: `ERR_MODULE_NOT_FOUND` for `../src/schema.js` / `../src/validate.js`.

- [ ] **Step 4: Implement**

Create `src/schema.ts`:

```ts
// A structural zod mirror of studio.video/v1alpha2 EditTimeline
// (studio/contracts/schemas/v1alpha2/edit-timeline.schema.json, ADR-0034).
//
// This package may not import studio/contracts, so it keeps its own mirror.
// Mirrors drift: test/schema.test.ts checks that this schema accepts and
// rejects the contracts' own fixtures the way the JSON Schema does.
// Structure only — overlaps, crossfades and references are checked by the
// contracts' validateEditTimeline, which the caller runs first.

import {z} from 'zod';

const contentHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const frame = z.number().int().min(0);
const frameCount = z.number().int().min(1);
const localId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
const specPath = z.string().min(1);

const transitionIn = z.object({type: z.enum(['fade', 'crossfade']), duration: frameCount}).strict();
const transitionOut = z.object({type: z.literal('fade'), duration: frameCount}).strict();

export const VisualItemSchema = z.object({
  id: localId,
  from: frame,
  duration: frameCount,
  kit: z.object({name: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/), version: semver}).strict(),
  props: z.record(z.unknown()),
  source: specPath.optional(),
  transitionIn: transitionIn.optional(),
  transitionOut: transitionOut.optional(),
}).strict();

export const AudioItemSchema = z.object({
  id: localId,
  from: frame,
  duration: frameCount,
  asset: localId,
  trimStart: frame.optional(),
  gain: z.number().min(0).optional(),
  fadeIn: frame.optional(),
  fadeOut: frame.optional(),
  source: specPath.optional(),
  transitionIn: transitionIn.optional(),
  transitionOut: transitionOut.optional(),
}).strict();

export const DuckSchema = z.object({
  under: z.array(localId).min(1).refine((ids) => new Set(ids).size === ids.length, 'must be unique'),
  gain: z.number().min(0).max(1),
  attack: frame.optional(),
  release: frame.optional(),
}).strict();

export const TrackSchema = z.object({
  id: localId,
  name: z.string().min(1).optional(),
  type: z.enum(['visual', 'audio']),
  z: z.number().int().optional(),
  duck: DuckSchema.optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  items: z.array(z.union([VisualItemSchema, AudioItemSchema])),
}).strict();

export const AssetSchema = z.object({
  path: z.string().min(1),
  hash: contentHash,
  kind: z.enum(['markdown', 'json', 'yaml', 'audio', 'video', 'image', 'captions', 'tape']),
}).strict();

export const EditTimelineSchema = z.object({
  apiVersion: z.literal('studio.video/v1alpha2'),
  kind: z.literal('EditTimeline'),
  episodeRef: z.object({channel: z.string().min(1), series: z.string().min(1), episode: z.string().min(1)}).strict(),
  revision: z.number().int().min(1),
  derivedFrom: z.object({
    spec: z.object({path: z.string().min(1), hash: contentHash, revision: z.number().int().min(1).optional()}).strict(),
    compiler: z.object({id: z.string().min(1), version: semver}).strict(),
  }).strict().optional(),
  fps: z.number().int().min(1),
  durationInFrames: frameCount,
  resolution: z.object({width: z.number().int().min(1).max(7680), height: z.number().int().min(1).max(4320)}).strict(),
  assets: z.record(localId, AssetSchema),
  tracks: z.array(TrackSchema).min(1),
  sections: z.array(z.object({
    id: localId,
    from: frame,
    duration: frameCount,
    source: specPath.optional(),
    chapter: z.object({number: z.number().int().min(1).optional(), title: z.string().min(1)}).strict().optional(),
  }).strict()).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type EditTimeline = z.infer<typeof EditTimelineSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type VisualItem = z.infer<typeof VisualItemSchema>;
export type AudioItem = z.infer<typeof AudioItemSchema>;

export const isAudioItem = (item: VisualItem | AudioItem): item is AudioItem => 'asset' in item;
```

Create `src/errors.ts`:

```ts
export type ComposerErrorCode =
  | 'invalid-timeline'
  | 'unknown-kit'
  | 'bad-props'
  | 'missing-asset'
  | 'hash-mismatch'
  | 'render-failed'
  | 'loudness-failed';

export interface ComposerProblem {
  code: ComposerErrorCode;
  message: string;
  /** JSON path into the timeline, e.g. $.tracks[1].items[0].props.fit */
  path: string;
}

export class ComposerError extends Error {
  constructor(
    readonly code: ComposerErrorCode,
    message: string,
    readonly problems: ComposerProblem[] = [],
  ) {
    super(message);
    this.name = 'ComposerError';
  }
}
```

Create `src/kits/registry.ts`:

```ts
// The minimal kit registry (avg-tk7.1). A kit is a named, versioned React
// component with a zod schema for its props. A timeline asks for a kit by
// name and version; an unknown one is refused before rendering starts.
// Versioning policy, previews and per-kit test conventions are avg-tk7.3.

import type React from 'react';
import {z} from 'zod';
import {Still} from './Still.js';
import {Clip} from './Clip.js';
import {Captions} from './Captions.js';

/** A `{ "$asset": "<id>" }` reference, as the timeline writes it. */
export const AssetRef = z.object({$asset: z.string().min(1)}).strict();

const fit = z.enum(['cover', 'contain']);

export const StillProps = z.object({src: AssetRef, fit: fit.optional(), scale: z.number().positive().optional()}).strict();
export const ClipProps = z.object({src: AssetRef, fit: fit.optional()}).strict();
export const CaptionsProps = z.object({
  text: z.string().min(1),
  position: z.enum(['top', 'bottom', 'center']).optional(),
  fontSize: z.number().positive().optional(),
  color: z.string().min(1).optional(),
  backgroundColor: z.string().min(1).optional(),
  font: z.string().min(1).optional(),
}).strict();

/** What a kit component receives: props with every asset reference resolved. */
export interface KitContext {
  /** Frames a clip asset lasts, for kits that must freeze at its end. */
  assetFrames: Record<string, number>;
}

export interface KitDefinition {
  version: string;
  props: z.ZodTypeAny;
  // Props arrive resolved: `src` is a URL, not an asset reference.
  component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
}

export const KITS: Readonly<Record<string, KitDefinition>> = Object.freeze({
  still: {version: '1.0.0', props: StillProps, component: Still},
  clip: {version: '1.0.0', props: ClipProps, component: Clip},
  captions: {version: '1.0.0', props: CaptionsProps, component: Captions},
});

export const listKits = (): {name: string; version: string}[] =>
  Object.entries(KITS).map(([name, kit]) => ({name, version: kit.version}));
```

Create `src/kits/Still.tsx`:

```tsx
import React from 'react';
import {AbsoluteFill, Img} from 'remotion';
import type {KitContext} from './registry.js';

/** An image filling the frame. */
export const Still: React.FC<{props: Record<string, unknown>; context: KitContext}> = ({props}) => {
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const scale = (props.scale as number | undefined) ?? 1;
  return (
    <AbsoluteFill>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: fit, transform: `scale(${scale})`}} />
    </AbsoluteFill>
  );
};
```

Create `src/kits/Clip.tsx`:

```tsx
import React from 'react';
import {AbsoluteFill, Freeze, OffthreadVideo, useCurrentFrame} from 'remotion';
import type {KitContext} from './registry.js';

/**
 * A video filling the frame, muted: its sound belongs on an audio track.
 * When the item outlasts the clip, its last frame holds.
 */
export const Clip: React.FC<{props: Record<string, unknown>; context: KitContext}> = ({props, context}) => {
  const frame = useCurrentFrame();
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const last = (context.assetFrames[src] ?? Number.POSITIVE_INFINITY) - 1;
  const video = <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: fit}} />;
  return <AbsoluteFill>{frame > last ? <Freeze frame={last}>{video}</Freeze> : video}</AbsoluteFill>;
};
```

Create `src/kits/Captions.tsx`:

```tsx
import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {KitContext} from './registry.js';

/** A block of text in the frame's safe area. */
export const Captions: React.FC<{props: Record<string, unknown>; context: KitContext}> = ({props}) => {
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
```

Create `src/validate.ts`:

```ts
// Composer-level validation: the timeline's structure (zod mirror) and, for
// every visual item, a registered kit at that version with valid props.
// Semantic rules (overlaps, references) belong to the contracts'
// validateEditTimeline, which the caller runs first (ADR-0034).

import type {ZodIssue} from 'zod';
import {KITS} from './kits/registry.js';
import {EditTimelineSchema, isAudioItem, type EditTimeline} from './schema.js';
import type {ComposerProblem} from './errors.js';

const member = (key: string | number) =>
  typeof key === 'number' ? `[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
const pathOf = (base: string, issue: ZodIssue) => base + issue.path.map(member).join('');

export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimeline} | {ok: false; problems: ComposerProblem[]} {
  const parsed = EditTimelineSchema.safeParse(doc);
  if (!parsed.success) {
    return {ok: false, problems: parsed.error.issues.map((i) => ({code: 'invalid-timeline' as const, message: i.message, path: pathOf('$', i)}))};
  }
  const timeline = parsed.data;
  const problems: ComposerProblem[] = [];
  timeline.tracks.forEach((track, ti) =>
    track.items.forEach((item, ii) => {
      if (isAudioItem(item)) return;
      const p = `$.tracks[${ti}].items[${ii}]`;
      const kit = KITS[item.kit.name];
      if (!kit || kit.version !== item.kit.version) {
        const known = kit ? `${item.kit.name} is ${kit.version} here` : `no kit "${item.kit.name}"`;
        problems.push({code: 'unknown-kit', message: `${item.kit.name}@${item.kit.version}: ${known}`, path: `${p}.kit`});
        return;
      }
      const props = kit.props.safeParse(item.props);
      if (!props.success) {
        for (const issue of props.error.issues) {
          problems.push({code: 'bad-props', message: `${item.kit.name}: ${issue.message}`, path: pathOf(`${p}.props`, issue)});
        }
      }
    }),
  );
  return problems.length > 0 ? {ok: false, problems} : {ok: true, timeline};
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd packages/remotion-composer && node --import tsx --test "test/**/*.test.ts" 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck`
Expected: `# tests 7`, `# fail 0`; typecheck prints no error.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock packages/remotion-composer/package.json packages/remotion-composer/tsconfig.json \
  packages/remotion-composer/src packages/remotion-composer/test
git commit -m "feat(remotion-composer): timeline mirror, minimal kit registry and validation (avg-tk7.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Volume curve and asset staging

**Files:**
- Create: `src/volume.ts`, `src/assets.ts`
- Create: `test/volume.test.ts`, `test/assets.test.ts`

**Interfaces:**
- Consumes: `EditTimeline`, `Track`, `AudioItem`, `isAudioItem` (`schema.ts`); `ComposerProblem` (`errors.ts`); the contracts' `explainer.json` fixture via `test/helpers.ts`.
- Produces: `duckWeight(frame, sounding, attack, release)`, `itemVolume(item, track, timeline) → (localFrame) => number` (`volume.ts`); `sha256(file)`, `stageAssets(timeline, assetRoot) → { ok: true, staged: { publicDir, files, sources, cleanup } } | { ok: false, problems }` (`assets.ts`). Task 3's render and composition use them.

- [ ] **Step 1: Write the failing tests**

Create `test/volume.test.ts`:

```ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {duckWeight, itemVolume} from '../src/volume.js';
import type {EditTimeline} from '../src/schema.js';

const timeline = (music: Record<string, unknown>, voice: {from: number; duration: number}[]): EditTimeline => ({
  apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
  episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1, fps: 30, durationInFrames: 300,
  resolution: {width: 1920, height: 1080}, assets: {},
  tracks: [
    {id: 'voice', type: 'audio', items: voice.map((v, i) => ({id: `v${i}`, asset: 'take', ...v}))},
    {id: 'music', type: 'audio', ...music, items: [{id: 'm', from: 0, duration: 300, asset: 'music', gain: 0.5}]},
  ],
}) as EditTimeline;

const musicVolume = (t: EditTimeline) => itemVolume(t.tracks[1]!.items[0] as never, t.tracks[1]!, t);

describe('itemVolume', () => {
  it('applies gain, fade-in and fade-out', () => {
    const t = timeline({}, []);
    const item = {id: 'x', from: 10, duration: 100, asset: 'a', gain: 0.8, fadeIn: 10, fadeOut: 20};
    const v = itemVolume(item, {id: 'fx', type: 'audio', items: [item]}, t);
    assert.equal(v(0), 0);
    assert.equal(v(5), 0.4);
    assert.equal(v(50), 0.8);
    assert.equal(v(90), 0.4);
    assert.equal(v(100), 0);
    assert.equal(v(-1), 0);
  });

  it('leaves a track without duck alone', () => {
    assert.equal(musicVolume(timeline({}, [{from: 50, duration: 50}]))(60), 0.5);
  });

  it('ducks under the voice, with attack and release ramps', () => {
    const v = musicVolume(timeline({duck: {under: ['voice'], gain: 0.4, attack: 10, release: 20}}, [{from: 100, duration: 50}]));
    assert.equal(v(50), 0.5); // far from the voice
    assert.equal(v(95), 0.5 * (1 - 0.6 * 0.5)); // halfway through the attack
    assert.equal(v(120), 0.5 * 0.4); // under the voice
    assert.equal(v(160), 0.5 * (1 - 0.6 * 0.5)); // halfway through the release
    assert.equal(v(200), 0.5);
  });
});

describe('duckWeight', () => {
  it('takes the strongest of overlapping spans and has no ramp when attack is zero', () => {
    const spans = [{from: 10, duration: 5}, {from: 12, duration: 10}];
    assert.equal(duckWeight(9, spans, 0, 0), 0);
    assert.equal(duckWeight(20, spans, 0, 0), 1);
    assert.equal(duckWeight(22, spans, 0, 4), 1);
    assert.equal(duckWeight(24, spans, 0, 4), 0.5);
  });
});
```

Create `test/assets.test.ts`:

```ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256, stageAssets} from '../src/assets.js';
import {clone, fixture} from './helpers.js';
import type {EditTimeline} from '../src/schema.js';

async function episodeWith(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'composer-assets-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), {recursive: true});
    await writeFile(path.join(root, rel), content);
  }
  return root;
}

/** The explainer, with its three images present and hashed. */
async function explainer() {
  const doc = clone(fixture('explainer.json')) as EditTimeline;
  const root = await episodeWith(Object.fromEntries(Object.values(doc.assets).map((a, i) => [a.path, `image ${i}`])));
  for (const asset of Object.values(doc.assets)) asset.hash = await sha256(path.join(root, asset.path));
  return {doc, root};
}

describe('stageAssets', () => {
  it('stages every verified asset under its id', async () => {
    const {doc, root} = await explainer();
    const out = await stageAssets(doc, root);
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.deepEqual(out.staged.files, {
      'scene-01-woods': 'assets/scene-01-woods.png',
      'scene-02-grandma': 'assets/scene-02-grandma.png',
      'scene-03-ending': 'assets/scene-03-ending.png',
    });
    assert.equal(await readFile(path.join(out.staged.publicDir, 'assets/scene-02-grandma.png'), 'utf8'), 'image 1');
    await out.staged.cleanup();
    await rm(root, {recursive: true, force: true});
  });

  it('refuses a missing file, a different file, and a path outside the episode', async () => {
    const {doc, root} = await explainer();
    await rm(path.join(root, doc.assets['scene-01-woods']!.path));
    await writeFile(path.join(root, doc.assets['scene-02-grandma']!.path), 'edited');
    doc.assets['scene-03-ending']!.path = '../../etc/hosts';
    const out = await stageAssets(doc, root);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.problems.map((p) => [p.code, p.path]), [
      ['missing-asset', '$.assets["scene-01-woods"].path'],
      ['hash-mismatch', '$.assets["scene-02-grandma"].hash'],
      ['missing-asset', '$.assets["scene-03-ending"].path'],
    ]);
    await rm(root, {recursive: true, force: true});
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/remotion-composer && node --import tsx --test test/volume.test.ts test/assets.test.ts 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|^# fail" | head -2`
Expected: `ERR_MODULE_NOT_FOUND` for `../src/volume.js` / `../src/assets.js`.

- [ ] **Step 3: Implement**

Create `src/volume.ts`:

```ts
// Per-frame audio volume (pure): gain × fade-in × fade-out × ducking.
//
// Ducking lowers a track to `duck.gain` while any item on its `under` tracks
// is sounding, ramping in over `attack` frames before that item starts and
// back out over `release` frames after it ends — a volume ramp, not a
// compressor, which is what voice over music needs.

import type {AudioItem, EditTimeline, Track} from './schema.js';
import {isAudioItem} from './schema.js';

const ramp = (x: number) => Math.max(0, Math.min(1, x));

/** How much of the ducking applies at a timeline frame: 0 none, 1 fully ducked. */
export function duckWeight(frame: number, sounding: {from: number; duration: number}[], attack: number, release: number): number {
  let weight = 0;
  for (const span of sounding) {
    const end = span.from + span.duration;
    let w = 0;
    if (frame >= span.from && frame < end) w = 1;
    else if (frame < span.from && frame >= span.from - attack) w = attack === 0 ? 0 : ramp((frame - (span.from - attack)) / attack);
    else if (frame >= end && frame < end + release) w = release === 0 ? 0 : ramp(1 - (frame - end) / release);
    weight = Math.max(weight, w);
  }
  return weight;
}

/**
 * The volume function of one audio item, taking the frame relative to the
 * item's start (as Remotion passes it) and returning a gain ≥ 0.
 */
export function itemVolume(item: AudioItem, track: Track, timeline: EditTimeline): (localFrame: number) => number {
  const gain = item.gain ?? 1;
  const fadeIn = Math.max(item.fadeIn ?? 0, item.transitionIn?.duration ?? 0);
  const fadeOut = Math.max(item.fadeOut ?? 0, item.transitionOut?.duration ?? 0);
  const under = track.duck
    ? timeline.tracks
        .filter((t) => track.duck!.under.includes(t.id) && t.type === 'audio' && !t.muted)
        .flatMap((t) => t.items.filter(isAudioItem).map((i) => ({from: i.from, duration: i.duration})))
    : [];
  return (localFrame: number) => {
    if (localFrame < 0 || localFrame >= item.duration) return 0;
    const inRamp = fadeIn > 0 ? ramp(localFrame / fadeIn) : 1;
    const outRamp = fadeOut > 0 ? ramp((item.duration - localFrame) / fadeOut) : 1;
    let duck = 1;
    if (track.duck) {
      const w = duckWeight(item.from + localFrame, under, track.duck.attack ?? 0, track.duck.release ?? 0);
      duck = 1 - (1 - track.duck.gain) * w;
    }
    return gain * inRamp * outRamp * duck;
  };
}
```

Create `src/assets.ts`:

```ts
// Verify every declared asset and stage it for Remotion: files are checked
// against their hash (a different file is an error, never a silent
// re-render), then hard-linked (copied when linking fails) into a temporary
// public directory, named by asset id, that the bundle serves.

import {createHash} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {copyFile, link, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {EditTimeline} from './schema.js';
import type {ComposerProblem} from './errors.js';

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

export interface StagedAssets {
  publicDir: string;
  /** Asset id → file name inside publicDir, for staticFile(). */
  files: Record<string, string>;
  /** Asset id → absolute source path. */
  sources: Record<string, string>;
  cleanup: () => Promise<void>;
}

export async function stageAssets(
  timeline: EditTimeline, assetRoot: string,
): Promise<{ok: true; staged: StagedAssets} | {ok: false; problems: ComposerProblem[]}> {
  const root = path.resolve(assetRoot);
  const problems: ComposerProblem[] = [];
  const sources: Record<string, string> = {};
  for (const [id, asset] of Object.entries(timeline.assets)) {
    const p = `$.assets[${JSON.stringify(id)}]`;
    const abs = path.resolve(root, asset.path);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(abs)) {
      problems.push({code: 'missing-asset', message: `asset "${id}": ${asset.path} is not a file under ${root}`, path: `${p}.path`});
      continue;
    }
    const actual = await sha256(abs);
    if (actual !== asset.hash) {
      problems.push({code: 'hash-mismatch', message: `asset "${id}": ${asset.path} is ${actual}, the timeline says ${asset.hash}`, path: `${p}.hash`});
      continue;
    }
    sources[id] = abs;
  }
  if (problems.length > 0) return {ok: false, problems};

  const publicDir = await mkdtemp(path.join(tmpdir(), 'remotion-composer-'));
  await mkdir(path.join(publicDir, 'assets'));
  const files: Record<string, string> = {};
  for (const [id, abs] of Object.entries(sources)) {
    const name = `assets/${id}${path.extname(abs)}`;
    const target = path.join(publicDir, name);
    try {
      await link(abs, target);
    } catch {
      await copyFile(abs, target);
    }
    files[id] = name;
  }
  return {ok: true, staged: {publicDir, files, sources, cleanup: () => rm(publicDir, {recursive: true, force: true})}};
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/remotion-composer && node --import tsx --test "test/**/*.test.ts" 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck`
Expected: `# tests 13`, `# fail 0`; no type error.

- [ ] **Step 5: Commit**

```bash
git add packages/remotion-composer/src/volume.ts packages/remotion-composer/src/assets.ts \
  packages/remotion-composer/test/volume.test.ts packages/remotion-composer/test/assets.test.ts
git commit -m "feat(remotion-composer): per-frame audio volume and verified asset staging (avg-tk7.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Composition, render, loudness, CLI

**Files:**
- Create: `src/Timeline.tsx`, `src/Root.tsx`, `src/remotion-entry.ts`, `src/loudness.ts`, `src/render.ts`, `src/index.ts`, `src/cli.ts`
- Create: `test/render.e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: the package's public API (`index.ts`): `renderTimeline(options) → RenderResult`, `validateTimeline`, `listKits`, `ComposerError`, `DEFAULT_LOUDNESS`, `EditTimelineSchema`; composition id `Timeline`; the `render-timeline` CLI.

- [ ] **Step 1: Write the failing end-to-end test**

Create `test/render.e2e.test.ts`:

```ts
// Real renders through Remotion and FFmpeg. Slow, and they need headless
// Chrome (Remotion downloads it the first time): only with REMOTION_E2E=1,
// against the build in dist/ (run `npm run build` first).

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
const probe = (file: string) =>
  JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'}).stdout) as {
    streams: {codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string}[];
  };
const measure = (file: string) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {encoding: 'utf8'});
  const text = r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1);
  return JSON.parse(text) as {input_i: string; input_tp: string};
};

describe('renderTimeline end to end', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
  it('renders the migrated explainer at 1920x1080, 30 fps, 765 frames, with an audio track', async () => {
    const {renderTimeline} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-'));
    const doc = clone(fixture('explainer.json'));
    const colors = ['0x2e7d32', '0x6a1b9a', '0xef6c00'];
    let i = 0;
    for (const asset of Object.values(doc.assets) as {path: string; hash: string}[]) {
      await mkdir(path.dirname(path.join(root, asset.path)), {recursive: true});
      ffmpeg(['-f', 'lavfi', '-i', `color=c=${colors[i++]}:s=1920x1080`, '-frames:v', '1', path.join(root, asset.path)]);
      asset.hash = await sha256(path.join(root, asset.path));
    }
    const out = path.join(root, 'out.mp4');
    const result = await renderTimeline({timeline: doc, assetRoot: root, outputPath: out});
    const info = probe(out);
    const video = info.streams.find((s) => s.codec_type === 'video')!;
    assert.equal(video.codec_name, 'h264');
    assert.deepEqual([video.width, video.height, video.r_frame_rate], [1920, 1080, '30/1']);
    assert.equal(Number(video.nb_frames), 765);
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'));
    assert.equal(result.durationSeconds, 25.5);
    assert.equal(result.loudness, null);
    assert.deepEqual(result.kits, [{name: 'still', version: '1.0.0'}, {name: 'captions', version: '1.0.0'}]);
    assert.match(result.hash, /^sha256:[a-f0-9]{64}$/);
    await rm(root, {recursive: true, force: true});
  });

  it('mixes a voice and ducked music, then normalises to -15 LUFS', async () => {
    const {renderTimeline} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-audio-'));
    await mkdir(path.join(root, 'assets'), {recursive: true});
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x123456:s=640x360', '-frames:v', '1', path.join(root, 'assets/bg.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '48000', path.join(root, 'assets/voice.wav')]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-ar', '48000', path.join(root, 'assets/music.wav')]);
    const timeline = {
      apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
      episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1,
      fps: 30, durationInFrames: 120, resolution: {width: 640, height: 360},
      assets: {
        bg: {path: 'assets/bg.png', hash: await sha256(path.join(root, 'assets/bg.png')), kind: 'image'},
        voice: {path: 'assets/voice.wav', hash: await sha256(path.join(root, 'assets/voice.wav')), kind: 'audio'},
        music: {path: 'assets/music.wav', hash: await sha256(path.join(root, 'assets/music.wav')), kind: 'audio'},
      },
      tracks: [
        {id: 'main', type: 'visual', z: 0, items: [{id: 'bg', from: 0, duration: 120, kit: {name: 'still', version: '1.0.0'}, props: {src: {$asset: 'bg'}}}]},
        {id: 'voice', type: 'audio', items: [{id: 'v', from: 30, duration: 60, asset: 'voice'}]},
        {id: 'music', type: 'audio', duck: {under: ['voice'], gain: 0.4, attack: 6, release: 9}, items: [{id: 'm', from: 0, duration: 120, asset: 'music', gain: 0.6, fadeOut: 15}]},
      ],
    };
    const out = path.join(root, 'out.mp4');
    const result = await renderTimeline({timeline, assetRoot: root, outputPath: out});
    assert.ok(result.loudness);
    const measured = measure(out);
    assert.ok(Math.abs(Number(measured.input_i) + 15) <= 1, `integrated ${measured.input_i}`);
    assert.ok(Number(measured.input_tp) <= -1, `true peak ${measured.input_tp}`);
    await rm(root, {recursive: true, force: true});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/remotion-composer && npm run build && REMOTION_E2E=1 node --import tsx --test test/render.e2e.test.ts 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find|^# fail" | head -2`
Expected: the import of `../dist/index.js` fails (`ERR_MODULE_NOT_FOUND`): there is no `index.ts` yet.

- [ ] **Step 3: Implement**

Create `src/Timeline.tsx`:

```tsx
// The root composition: visual tracks in z order, one Sequence per item with
// its kit; fades and crossfades as opacity; audio items as <Audio> with a
// per-frame volume.

import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {KITS} from './kits/registry.js';
import type {AudioItem, EditTimeline, Track, VisualItem} from './schema.js';
import {isAudioItem} from './schema.js';
import {itemVolume} from './volume.js';

export interface TimelineProps {
  timeline: EditTimeline;
  /** Asset id → file name in the staged public directory. */
  files: Record<string, string>;
  /** Staged file name → how many frames that video lasts (for kits that freeze at its end). */
  assetFrames: Record<string, number>;
  /** Index signature Remotion's Composition requires of its props. */
  [key: string]: unknown;
}

/** Replace every `{ "$asset": id }` with the staged file's URL. */
export function resolveAssets(value: unknown, files: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveAssets(v, files));
  if (value && typeof value === 'object') {
    const asset = (value as {$asset?: unknown}).$asset;
    if (typeof asset === 'string' && Object.keys(value).length === 1) return staticFile(files[asset] ?? asset);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveAssets(v, files)]));
  }
  return value;
}

const ItemLayer: React.FC<{item: VisualItem; files: Record<string, string>; assetFrames: Record<string, number>}> = ({item, files, assetFrames}) => {
  const frame = useCurrentFrame();
  let opacity = 1;
  if (item.transitionIn) opacity = Math.min(opacity, Math.min(1, frame / item.transitionIn.duration));
  if (item.transitionOut) opacity = Math.min(opacity, Math.min(1, (item.duration - frame) / item.transitionOut.duration));
  const kit = KITS[item.kit.name]!;
  const Kit = kit.component;
  // Kits see URLs, so the frame counts are keyed by URL too.
  const byUrl = Object.fromEntries(Object.entries(assetFrames).map(([file, frames]) => [staticFile(file), frames]));
  return (
    <AbsoluteFill style={{opacity}}>
      <Kit props={resolveAssets(item.props, files) as Record<string, unknown>} context={{assetFrames: byUrl}} />
    </AbsoluteFill>
  );
};

const byZ = (tracks: Track[]) =>
  tracks
    .map((track, index) => ({track, index}))
    .filter(({track}) => track.type === 'visual' && !track.hidden)
    .sort((a, b) => (a.track.z ?? 0) - (b.track.z ?? 0) || a.index - b.index)
    .map(({track}) => track);

export const Timeline: React.FC<TimelineProps> = ({timeline, files, assetFrames}) => (
  <AbsoluteFill style={{backgroundColor: '#000000'}}>
    {byZ(timeline.tracks).map((track) =>
      track.items.map((item) =>
        isAudioItem(item) ? null : (
          <Sequence key={`${track.id}/${item.id}`} from={item.from} durationInFrames={item.duration}>
            <ItemLayer item={item} files={files} assetFrames={assetFrames} />
          </Sequence>
        ),
      ),
    )}
    {timeline.tracks
      .filter((track) => track.type === 'audio' && !track.muted)
      .map((track) =>
        track.items.filter(isAudioItem).map((item: AudioItem) => (
          <Sequence key={`${track.id}/${item.id}`} from={item.from} durationInFrames={item.duration}>
            <Audio src={staticFile(files[item.asset] ?? item.asset)} startFrom={item.trimStart ?? 0} volume={itemVolume(item, track, timeline)} />
          </Sequence>
        )),
      )}
  </AbsoluteFill>
);
```

Create `src/Root.tsx`:

```tsx
import React from 'react';
import {Composition} from 'remotion';
import {Timeline, type TimelineProps} from './Timeline.js';

const preview: TimelineProps = {
  timeline: {
    apiVersion: 'studio.video/v1alpha2',
    kind: 'EditTimeline',
    episodeRef: {channel: 'preview', series: 'preview', episode: 'preview'},
    revision: 1,
    fps: 30,
    durationInFrames: 30,
    resolution: {width: 1920, height: 1080},
    assets: {},
    tracks: [{id: 'main', type: 'visual', z: 0, items: []}],
  },
  files: {},
  assetFrames: {},
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Timeline"
    component={Timeline}
    durationInFrames={preview.timeline.durationInFrames}
    fps={preview.timeline.fps}
    width={preview.timeline.resolution.width}
    height={preview.timeline.resolution.height}
    defaultProps={preview}
    calculateMetadata={({props}) => ({
      durationInFrames: props.timeline.durationInFrames,
      fps: props.timeline.fps,
      width: props.timeline.resolution.width,
      height: props.timeline.resolution.height,
    })}
  />
);
```

Create `src/remotion-entry.ts`:

```ts
import {registerRoot} from 'remotion';
import {RemotionRoot} from './Root.js';

registerRoot(RemotionRoot);
```

Create `src/loudness.ts`:

```ts
// Two-pass EBU R128 loudness with FFmpeg's loudnorm: measure, then apply with
// the measured values (linear), copying the video stream.

import {spawn} from 'node:child_process';

export interface LoudnessTarget {
  integrated: number;
  truePeak: number;
  range: number;
}

export const DEFAULT_LOUDNESS: LoudnessTarget = {integrated: -15, truePeak: -1, range: 11};

export interface LoudnessResult {
  inputI: number;
  outputI: number;
  truePeak: number;
}

function run(ffmpeg: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))));
  });
}

/** The last {...} block loudnorm prints. */
function report(stderr: string): Record<string, string> {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('loudnorm printed no report');
  return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
}

export async function normalizeLoudness(
  input: string, output: string, target: LoudnessTarget = DEFAULT_LOUDNESS, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
): Promise<LoudnessResult> {
  const base = `I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
  const measured = report(await run(ffmpeg, ['-hide_banner', '-i', input, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']));
  const second = [
    `loudnorm=${base}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=json',
  ].join(':');
  const applied = report(await run(ffmpeg, [
    '-hide_banner', '-y', '-i', input, '-c:v', 'copy', '-af', second, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output,
  ]));
  return {inputI: Number(measured.input_i), outputI: Number(applied.output_i), truePeak: Number(applied.output_tp)};
}
```

Create `src/render.ts`:

```ts
// renderTimeline: validate → verify and stage assets → bundle → render →
// two-pass loudness → result record. The caller gives an output path; where
// renders live in an episode is the studio's business, not this package's.

import {spawnSync} from 'node:child_process';
import {mkdtemp, rename, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {stageAssets, sha256} from './assets.js';
import {ComposerError} from './errors.js';
import {DEFAULT_LOUDNESS, normalizeLoudness, type LoudnessResult, type LoudnessTarget} from './loudness.js';
import {isAudioItem} from './schema.js';
import {validateTimeline} from './validate.js';

export interface RenderTimelineOptions {
  /** A studio.video/v1alpha2 EditTimeline that already passed validateEditTimeline. */
  timeline: unknown;
  /** The directory asset paths are relative to (the episode). */
  assetRoot: string;
  outputPath: string;
  concurrency?: number;
  onProgress?: (progress: number) => void;
  loudness?: LoudnessTarget;
}

export interface RenderResult {
  path: string;
  durationSeconds: number;
  sizeBytes: number;
  hash: string;
  kits: {name: string; version: string}[];
  loudness: LoudnessResult | null;
}

/** How many frames a video file lasts, from ffprobe. */
function videoFrames(file: string, fps: number): number {
  const out = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  const seconds = Number(out.stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.floor(seconds * fps)) : Number.POSITIVE_INFINITY;
}

export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderResult> {
  const checked = validateTimeline(options.timeline);
  if (!checked.ok) {
    const code = checked.problems[0]!.code;
    throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
  }
  const timeline = checked.timeline;
  const staging = await stageAssets(timeline, options.assetRoot);
  if (!staging.ok) {
    throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
  }
  const {staged} = staging;
  const work = await mkdtemp(path.join(tmpdir(), 'remotion-composer-render-'));
  try {
    const assetFrames: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
    }
    const inputProps = {timeline, files: staged.files, assetFrames};
    const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remotion-entry.js');
    const hasAudio = timeline.tracks.some((t) => t.type === 'audio' && !t.muted && t.items.some(isAudioItem));
    const rendered = path.join(work, 'render.mp4');
    try {
      const serveUrl = await bundle({entryPoint, publicDir: staged.publicDir});
      const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
      await renderMedia({
        composition, serveUrl, inputProps,
        codec: 'h264', audioCodec: 'aac', enforceAudioTrack: true,
        outputLocation: rendered,
        concurrency: options.concurrency ?? null,
        imageFormat: 'jpeg', jpegQuality: 92, pixelFormat: 'yuv420p', colorSpace: 'bt709',
        onProgress: ({progress}) => options.onProgress?.(progress),
      });
    } catch (e) {
      throw new ComposerError('render-failed', `Remotion could not render the timeline: ${e instanceof Error ? e.message : String(e)}`);
    }

    const output = path.resolve(options.outputPath);
    let loudness: LoudnessResult | null = null;
    if (hasAudio) {
      try {
        loudness = await normalizeLoudness(rendered, output, options.loudness ?? DEFAULT_LOUDNESS);
      } catch (e) {
        throw new ComposerError('loudness-failed', `loudness could not be normalised: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      // Nothing to normalise: the silent track Remotion enforced is the audio.
      await rename(rendered, output);
    }

    const kits = [...new Map(timeline.tracks.flatMap((t) => t.items).filter((i) => !isAudioItem(i))
      .map((i) => [`${(i as {kit: {name: string}}).kit.name}@${(i as {kit: {version: string}}).kit.version}`, (i as {kit: {name: string; version: string}}).kit])).values()]
      .map((k) => ({name: k.name, version: k.version}));
    return {
      path: output,
      durationSeconds: timeline.durationInFrames / timeline.fps,
      sizeBytes: (await stat(output)).size,
      hash: await sha256(output),
      kits,
      loudness,
    };
  } finally {
    await staged.cleanup();
    await rm(work, {recursive: true, force: true});
  }
}
```

Create `src/index.ts`:

```ts
export {renderTimeline, type RenderTimelineOptions, type RenderResult} from './render.js';
export {validateTimeline} from './validate.js';
export {listKits} from './kits/registry.js';
export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
export {DEFAULT_LOUDNESS, type LoudnessTarget, type LoudnessResult} from './loudness.js';
export {EditTimelineSchema, type EditTimeline} from './schema.js';
```

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
// render-timeline <timeline.json> <out.mp4> --assets <dir> [--concurrency <n>]

import {readFile} from 'node:fs/promises';
import {ComposerError, renderTimeline} from './index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--assets', '--concurrency'].includes(args[i - 1] ?? ''));
const [timelinePath, outputPath] = positional;
const assetRoot = flag('--assets');
if (!timelinePath || !outputPath || !assetRoot) {
  console.error('Usage: render-timeline <timeline.json> <out.mp4> --assets <dir> [--concurrency <n>]');
  process.exit(1);
}

try {
  const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as unknown;
  const concurrency = flag('--concurrency');
  const result = await renderTimeline({
    timeline, assetRoot, outputPath,
    ...(concurrency ? {concurrency: Number(concurrency)} : {}),
    onProgress: (p) => process.stderr.write(`\rrendering ${Math.round(p * 100)}%`),
  });
  process.stderr.write('\n');
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  process.stderr.write('\n');
  if (e instanceof ComposerError) {
    console.error(`${e.code}: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
```

- [ ] **Step 4: Build and render**

Run: `cd packages/remotion-composer && npm run build && REMOTION_E2E=1 node --import tsx --test test/render.e2e.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 2`, `# fail 0` (about half a minute; the first run also downloads headless Chrome).

Run: `cd packages/remotion-composer && npm test 2>&1 | grep -E "^# (tests|fail)|# SKIP"`
Expected: `# tests 13`, `# fail 0`, and `renderTimeline end to end # SKIP set REMOTION_E2E=1 to render` (a skipped suite counts no tests).

- [ ] **Step 5: Commit**

```bash
git add packages/remotion-composer/src packages/remotion-composer/test/render.e2e.test.ts
git commit -m "feat(remotion-composer): render layered timelines with Remotion and normalise loudness (avg-tk7.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Registration and docs

**Files:**
- Modify: `compose.config.json`
- Create: `packages/remotion-composer/README.md`
- Generated: `docs/packages/remotion-composer.md` (`node tools/gen-docs.mjs`)

**Interfaces:**
- Consumes: the package (Task 3).
- Produces: component `remotion-composer` providing `video.compose` in profiles `full`, `studio`, `headless`, `render`, each defaulting `video.compose` to `video-composer`.

- [ ] **Step 1: Register the component**

In `compose.config.json`, immediately after the `video-composer` component's block (which ends with `"docs": "docs/packages/video-composer.md"` and `},`), add:

```json
    "remotion-composer": {
      "path": "packages/remotion-composer",
      "kind": "node",
      "standalone": true,
      "summary": "Renders a layered, kit-based edit timeline (studio.video/v1alpha2) with Remotion, then normalises loudness with FFmpeg. A second provider for video.compose.",
      "capabilities": [
        "video.compose"
      ],
      "requires": {
        "system": [
          "ffmpeg"
        ]
      },
      "docs": "docs/packages/remotion-composer.md"
    },
```

In the `full`, `studio` and `headless` profiles, in each `components` list, below `"video-composer",` add `"remotion-composer",`, and in each `defaultProviders` replace `"image.edit": "fal-media"` with `"image.edit": "fal-media",` followed by a new line `"video.compose": "video-composer"`. In the `render` profile, replace

```json
        "infographics",
        "video-composer"
      ],
      "skills": [
        "shared"
      ]
    }
```

with

```json
        "infographics",
        "video-composer",
        "remotion-composer"
      ],
      "skills": [
        "shared"
      ],
      "defaultProviders": {
        "video.compose": "video-composer"
      }
    }
```

Edit the text in place — do not re-serialise the JSON (that reformats unrelated arrays). Then run `node -e 'JSON.parse(require("fs").readFileSync("compose.config.json","utf8"))' && npm run compose -- --list`.
Expected: no parse error; the listing shows `remotion-composer` in `full`, `studio`, `headless` and `render`.

- [ ] **Step 2: README and generated docs**

Create `packages/remotion-composer/README.md`:

```markdown
# Remotion composer

Renders a layered, kit-based edit timeline (`studio.video/v1alpha2`, ADR-0034)
with Remotion, then normalises loudness with a two-pass FFmpeg `loudnorm`. It
knows timelines, kits and files — not episodes, pipelines or the studio.

## Scope

- **Validates** the timeline's structure (a zod mirror of the canonical
  schema), every kit's name, version and props, and every asset file against
  its hash, before anything renders. Semantic rules — overlaps, crossfades,
  references — are the contracts' `validateEditTimeline`, which the caller
  runs first.
- **Renders** visual tracks in `z` order, one kit instance per item, with
  fades and crossfades; audio items as `<Audio>` with a per-frame volume
  (gain × fades × ducking under other tracks).
- **Normalises** loudness (default −15 LUFS integrated, −1 dBTP true peak) and
  returns a result record: path, duration, size, sha256, kits used, loudness.

Kits in this version: `still`, `clip`, `captions` (all `1.0.0`).

## API

```ts
import {renderTimeline, validateTimeline, listKits} from '@av/remotion-composer';

const result = await renderTimeline({
  timeline,            // a studio.video/v1alpha2 EditTimeline
  assetRoot,           // the directory asset paths are relative to
  outputPath: 'out.mp4',
});
```

Failures throw `ComposerError` with a `code` (`invalid-timeline`,
`unknown-kit`, `bad-props`, `missing-asset`, `hash-mismatch`,
`render-failed`, `loudness-failed`) and, for validation, `problems` with JSON
paths.

## CLI

```bash
npm run build --workspace @av/remotion-composer
node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <episode-dir>
```

## Tests

```bash
npm test --workspace @av/remotion-composer                     # fast: schema, kits, volume, assets
npm run build --workspace @av/remotion-composer && \
  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also two real renders
```

The first render downloads Remotion's headless Chrome.
```

Run: `node tools/gen-docs.mjs && git status --short docs && node tools/gen-docs.mjs --check`
Expected: only `?? docs/packages/remotion-composer.md` is new; `✓ Generated docs are up to date.`

- [ ] **Step 3: Run every check**

Run: `node tools/check-boundaries.mjs` — Expected: `✓ packages/ does not depend on studio/ …`.
Run: `npm run docs:build` — Expected: build succeeds.
Run: `npm run check` from the repository root — Expected: passes (one more module than before: 15 passed, 0 failed).

- [ ] **Step 4: Commit**

```bash
git add compose.config.json packages/remotion-composer/README.md docs/packages/remotion-composer.md
git commit -m "chore: register remotion-composer as a second video.compose provider (avg-tk7.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

