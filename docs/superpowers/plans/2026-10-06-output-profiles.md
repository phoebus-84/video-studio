# Output Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every v1alpha2 timeline a whole copy of its output profile (size, safe zone, loudness) from a contracts catalog with `youtube-1920x1080` and `vertical-1080x1920`; render to it with the Remotion composer; and hold overlay kits to the safe zone with a real-render check, shipping `captions@1.1.0` as the first safe-zone-aware kit.

**Architecture:** The catalog is a JSON file in `studio/contracts/src/`, exposed by `output-profiles.mjs`; the timeline schema requires `profile`, `validateEditTimeline` checks it against `resolution`, the v1alpha1 migration picks it by size, and workspace settings name a catalog id. The composer reads only the timeline: it re-checks the size, normalises to `profile.loudness`, and passes the profile to kits. The kit render test reads the catalog by path and renders every example in every profile; overlay kits are drawn on transparent and their drawn box (FFmpeg `alphaextract,cropdetect`) must lie inside the safe zone.

**Tech Stack:** Node ESM + Ajv 2020 (contracts, `node --test`), TypeScript/React 19.2.4/Remotion 4.0.505/zod 3.25.76 (composer, `node --import tsx --test`), FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-06-output-profiles-design.md`

## Global Constraints

- Catalog values exactly: `youtube-1920x1080` 1920×1080, safe zone top 54 / right 96 / bottom 54 / left 96, loudness −15 / −1 / 11; `vertical-1080x1920` 1080×1920, safe zone 120 / 140 / 380 / 60, loudness −14 / −1 / 11.
- `profile` is **required** in v1alpha2; problem codes `profile-resolution-mismatch` (path `$.profile`) and `profile-safe-zone` (path `$.profile.safeZone`).
- Workspace settings code: `output-profile.mismatch` (the module's dotted style). The id `youtube-1080p-30` disappears from the contracts. **Do not touch `studio/runtime`** — its own `OutputProfileRef` is a separate bug.
- `packages/remotion-composer` imports nothing from `studio/`; its tests and `scripts/kits.ts` read `studio/contracts/src/output-profiles.json` **by path** (`test/helpers.ts`), as they read contract fixtures.
- Released kit files never change: `still/1.0.0.tsx`, `clip/1.0.0.tsx`, `captions/1.0.0.tsx` stay byte-identical (the lock test enforces it). `captions@1.1.0` is a new file.
- Versions: `@studio/contracts` 0.6.0 → 0.7.0, `@av/remotion-composer` 0.2.0 → 0.3.0, in each `package.json` **and** in `bun.lock` (edit the `"version"` line under `"studio/contracts": {` and `"packages/remotion-composer": {` by hand; bun 1.2.0 does not), then `bun install --frozen-lockfile`.
- No double opening curly braces outside fenced code blocks in any Markdown under `docs/` or package READMEs, not even in inline code: the VitePress docs build reads them as Vue interpolation and fails.
- Temporary directories in composer tests and scripts must not start with `remotion-composer-` (the e2e leak check).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A timeline whose `resolution` and `profile` disagree must be refused by both the contracts and the composer — never rendered at one size with the other's safe zone.
- The migrated timeline's `profile` must be a copy: mutating it must not change the frozen catalog (tested in Task 2).
- An overlay kit that draws **nothing** must fail ("drew nothing"), not pass because an empty box has no overflow (`drawnBox` returns `null`).
- `cropdetect` needs `skip=0`, or a one-frame PNG yields no box at all (verified while prototyping with FFmpeg 9.0.1).
- `kits:previews` must work when `previews/` does not exist (it is emptied by the rename in Task 4).

## File map

| File | Responsibility | Task |
|---|---|---|
| `studio/contracts/src/output-profiles.json`, `.mjs`, `.d.mts`, `test/output-profiles.test.mjs` | Catalog, lookup, profile rules | 1 |
| `studio/contracts/package.json`, `bun.lock` | 0.7.0 | 1 |
| `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json`, `src/edit-timeline.mjs`, `src/edit-timeline.d.mts`, `test/edit-timeline.test.mjs` | `profile` in the timeline, its checks, migration | 2 |
| `studio/contracts/fixtures/timeline/v1alpha2/…` | Fixtures with profiles; `vertical-short.json`; three invalid | 2 |
| `studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts` | Regenerated | 2 |
| `docs/adr/0034-…`, `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md` | Docs | 2 |
| `studio/contracts/schemas/v1alpha1/workspace.schema.json`, `src/workspace-semantics.mjs`, `fixtures/workspace/*.json`, `test/workspace-schema.test.mjs`, `bindings/ts/workspace.ts` | Settings name a catalog profile | 3 |
| `packages/remotion-composer/src/…`, `test/…`, `scripts/kits.ts`, `kits.lock.json`, `previews/`, `README.md`, `package.json`, `bun.lock` | Composer and kits | 4 |

Work on branch `feat/output-profiles` (the spec is committed there). Commands run from the repository root unless a step says otherwise.

---

### Task 1: The output profile catalog

**Files:**
- Create: `studio/contracts/src/output-profiles.json`, `studio/contracts/src/output-profiles.mjs`, `studio/contracts/src/output-profiles.d.mts`, `studio/contracts/test/output-profiles.test.mjs`
- Modify: `studio/contracts/package.json`, `bun.lock`

**Interfaces:**
- Produces: `OUTPUT_PROFILES` (deep-frozen array), `outputProfile(id) → profile | undefined`, `validateOutputProfile(profile, base = "$") → {code: "profile-safe-zone", message, path: base + ".safeZone"}[]`. Profile shape: `{id, width, height, safeZone: {top, right, bottom, left}, loudness: {integrated, truePeak, range}}`.

- [ ] **Step 1: Write the test** — `studio/contracts/test/output-profiles.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_PROFILES, outputProfile, validateOutputProfile } from "../src/output-profiles.mjs";

describe("output profiles", () => {
  it("has the 16:9 and 9:16 profiles", () => {
    assert.deepEqual(OUTPUT_PROFILES.map((p) => [p.id, p.width, p.height]), [
      ["youtube-1920x1080", 1920, 1080],
      ["vertical-1080x1920", 1080, 1920],
    ]);
  });

  it("keeps every profile valid, with a unique id", () => {
    for (const p of OUTPUT_PROFILES) assert.deepEqual(validateOutputProfile(p), [], p.id);
    assert.equal(new Set(OUTPUT_PROFILES.map((p) => p.id)).size, OUTPUT_PROFILES.length);
  });

  it("keeps the 9:16 safe zone clear of the platforms' interface", () => {
    assert.deepEqual(outputProfile("vertical-1080x1920").safeZone, { top: 120, right: 140, bottom: 380, left: 60 });
    assert.equal(outputProfile("vertical-1080x1920").loudness.integrated, -14);
    assert.equal(outputProfile("youtube-1920x1080").loudness.integrated, -15);
  });

  it("finds nothing for an unknown id", () => {
    assert.equal(outputProfile("square-1080"), undefined);
  });

  it("cannot be changed through the catalog", () => {
    assert.throws(() => {
      OUTPUT_PROFILES[0].safeZone.top = 0;
    }, TypeError);
  });

  it("refuses a safe zone that leaves no usable area, on either axis", () => {
    const p = structuredClone(outputProfile("vertical-1080x1920"));
    p.safeZone.top = 1600;
    p.safeZone.left = 1000;
    const problems = validateOutputProfile(p, "$.profile");
    assert.deepEqual(problems.map((x) => [x.code, x.path]), [
      ["profile-safe-zone", "$.profile.safeZone"],
      ["profile-safe-zone", "$.profile.safeZone"],
    ]);
    assert.match(problems[0].message, /top 1600 \+ bottom 380 leaves nothing of height 1920/);
    assert.match(problems[1].message, /left 1000 \+ right 140 leaves nothing of width 1080/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd studio/contracts && node --test test/output-profiles.test.mjs`
Expected: FAIL — `Cannot find module '…/src/output-profiles.mjs'`.

- [ ] **Step 3: Write the catalog** — `studio/contracts/src/output-profiles.json`:

```json
[
  {
    "id": "youtube-1920x1080",
    "width": 1920,
    "height": 1080,
    "safeZone": { "top": 54, "right": 96, "bottom": 54, "left": 96 },
    "loudness": { "integrated": -15, "truePeak": -1, "range": 11 }
  },
  {
    "id": "vertical-1080x1920",
    "width": 1080,
    "height": 1920,
    "safeZone": { "top": 120, "right": 140, "bottom": 380, "left": 60 },
    "loudness": { "integrated": -14, "truePeak": -1, "range": 11 }
  }
]
```

- [ ] **Step 4: Write the module and its types**

`studio/contracts/src/output-profiles.mjs`:

```js
// ---------------------------------------------------------------------------
// Output profiles (avg-tk7.4)
// ---------------------------------------------------------------------------
// What a rendered episode is: its size, the safe zone kits keep their text and
// graphics in, and the loudness the finished file is normalised to. The
// catalog is data (output-profiles.json) so packages' tests can read it by
// path; a timeline carries a whole copy of its profile, so a delivered episode
// re-renders as it was even if the catalog changes later.
// ---------------------------------------------------------------------------

import catalog from "./output-profiles.json" with { type: "json" };

const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

/** Every profile a series can choose. */
export const OUTPUT_PROFILES = deepFreeze(structuredClone(catalog));

/** The catalog profile with this id, or undefined. */
export function outputProfile(id) {
  return OUTPUT_PROFILES.find((p) => p.id === id);
}

/**
 * Rules a profile must keep beyond its shape: the safe zone must leave a
 * usable area.
 * @param {object} profile a profile of the shape the schemas describe
 * @param {string} [base] the JSON path of the profile, for the problems' paths
 * @returns {{code: string, message: string, path: string}[]}
 */
export function validateOutputProfile(profile, base = "$") {
  const { width, height, safeZone: z } = profile;
  const out = [];
  if (z.top + z.bottom >= height) {
    out.push({
      code: "profile-safe-zone",
      path: `${base}.safeZone`,
      message: `profile "${profile.id}": safe zone top ${z.top} + bottom ${z.bottom} leaves nothing of height ${height}`,
    });
  }
  if (z.left + z.right >= width) {
    out.push({
      code: "profile-safe-zone",
      path: `${base}.safeZone`,
      message: `profile "${profile.id}": safe zone left ${z.left} + right ${z.right} leaves nothing of width ${width}`,
    });
  }
  return out;
}
```

`studio/contracts/src/output-profiles.d.mts`:

```ts
// Type declarations for output profiles (avg-tk7.4). Self-contained so runtime
// packages can use them; the timeline's copy of a profile has the same shape
// (schemas/v1alpha2/edit-timeline.schema.json, $defs/OutputProfile).

export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LoudnessTarget {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
  /** Loudness range, LU. */
  range: number;
}

export interface OutputProfile {
  id: string;
  width: number;
  height: number;
  /** Pixels inset from each edge where kits keep text and graphics. */
  safeZone: SafeZone;
  loudness: LoudnessTarget;
}

export interface OutputProfileProblem {
  code: "profile-safe-zone";
  message: string;
  path: string;
}

export declare const OUTPUT_PROFILES: readonly OutputProfile[];
export declare function outputProfile(id: string): OutputProfile | undefined;
export declare function validateOutputProfile(profile: OutputProfile, base?: string): OutputProfileProblem[];
```

- [ ] **Step 5: Run the test**

Run: `cd studio/contracts && node --test test/output-profiles.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Version 0.7.0**

In `studio/contracts/package.json` change `"version": "0.6.0"` to `"version": "0.7.0"`. In the root `bun.lock`, under `"studio/contracts": {`, change `"version": "0.6.0"` to `"version": "0.7.0"`. Run `bun install --frozen-lockfile` from the repository root: it must succeed.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts/src/output-profiles.json studio/contracts/src/output-profiles.mjs studio/contracts/src/output-profiles.d.mts studio/contracts/test/output-profiles.test.mjs studio/contracts/package.json bun.lock
git commit -m "feat(contracts): output profile catalog, 16:9 and 9:16 with safe zones (avg-tk7.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The timeline carries its profile

**Files:**
- Modify: `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json`, `studio/contracts/src/edit-timeline.mjs`, `studio/contracts/src/edit-timeline.d.mts`, `studio/contracts/test/edit-timeline.test.mjs`, `studio/contracts/fixtures/timeline/v1alpha2/valid/explainer.json`, `studio/contracts/fixtures/timeline/v1alpha2/valid/lesson-excerpt.json`, `studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts` (generated), `docs/adr/0034-a-layered-kit-based-edit-timeline.md`, `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md`
- Create: `studio/contracts/fixtures/timeline/v1alpha2/valid/vertical-short.json`, `…/invalid/profile-resolution-mismatch.json`, `…/invalid/profile-safe-zone.json`, `…/invalid/missing-profile.json`

**Interfaces:**
- Consumes: `OUTPUT_PROFILES`, `validateOutputProfile`, `outputProfile` (Task 1).
- Produces: `EditTimeline.profile` (required); `migrateEditTimelineV1alpha1(doc, {assetHashes, profile?})`; fixture `valid/vertical-short.json` (1080×1920, uses `still@1.0.0` and `captions@1.1.0`, one audio item), which Task 4 renders.

- [ ] **Step 1: Write the tests**

Apply to `studio/contracts/test/edit-timeline.test.mjs`:

```diff
@@ -10,6 +10,7 @@ import {
   validateEditTimeline,
 } from "../src/edit-timeline.mjs";
 import { applyPatch } from "../scripts/lib/json-patch.mjs";
+import { outputProfile } from "../src/output-profiles.mjs";
 
 const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
 const v2 = resolve(root, "fixtures/timeline/v1alpha2");
@@ -41,6 +42,25 @@ describe("validateEditTimeline", () => {
     assert.ok(problems.some((p) => p.path === "$.tracks[2].items[0].from"));
   });
 
+  it("reports a resolution that is not its profile's, and a safe zone that leaves nothing", () => {
+    const doc = lesson();
+    doc.resolution = { width: 1280, height: 720 };
+    doc.profile.safeZone.left = 1900;
+    const problems = validateEditTimeline(doc);
+    assert.deepEqual(problems.map((p) => [p.code, p.path]), [
+      ["profile-resolution-mismatch", "$.profile"],
+      ["profile-safe-zone", "$.profile.safeZone"],
+    ]);
+    assert.match(problems[0].message, /resolution 1280x720 is not profile "youtube-1920x1080" \(1920x1080\)/);
+  });
+
+  it("accepts a profile that is not in the catalog", () => {
+    const doc = lesson();
+    doc.profile.id = "house-style";
+    doc.profile.loudness.integrated = -16;
+    assert.deepEqual(validateEditTimeline(doc), []);
+  });
+
   it("collects every semantic problem, not just the first", () => {
     const doc = lesson();
     doc.tracks[4].z = 5;
@@ -139,6 +159,30 @@ describe("migrateEditTimelineV1alpha1", () => {
     assert.throws(() => migrateEditTimelineV1alpha1({ ...basic(), fps: 29.97 }, { assetHashes: hashes }), /not an integer/);
   });
 
+  it("gives a 1920x1080 timeline the 16:9 profile and a 1080x1920 one the 9:16 profile", () => {
+    assert.deepEqual(migrateEditTimelineV1alpha1(basic(), { assetHashes: hashes }).profile, outputProfile("youtube-1920x1080"));
+    const vertical = { ...basic(), resolution: { width: 1080, height: 1920 } };
+    const migrated = migrateEditTimelineV1alpha1(vertical, { assetHashes: hashes });
+    assert.deepEqual(migrated.profile, outputProfile("vertical-1080x1920"));
+    assert.deepEqual(validateEditTimeline(migrated), []);
+  });
+
+  it("uses the profile it is given, and refuses a size no profile has", () => {
+    const square = { ...basic(), resolution: { width: 1080, height: 1080 } };
+    assert.throws(
+      () => migrateEditTimelineV1alpha1(square, { assetHashes: hashes }),
+      /no output profile is 1080x1080 \(youtube-1920x1080 1920x1080, vertical-1080x1920 1080x1920\)/,
+    );
+    const profile = { id: "square-1080", width: 1080, height: 1080, safeZone: { top: 54, right: 54, bottom: 54, left: 54 }, loudness: { integrated: -14, truePeak: -1, range: 11 } };
+    assert.deepEqual(migrateEditTimelineV1alpha1(square, { assetHashes: hashes, profile }).profile, profile);
+  });
+
+  it("copies the catalog profile, so the timeline is free of the catalog", () => {
+    const migrated = migrateEditTimelineV1alpha1(basic(), { assetHashes: hashes });
+    migrated.profile.safeZone.top = 0;
+    assert.equal(outputProfile("youtube-1920x1080").safeZone.top, 54);
+  });
+
   it("refuses anything but a v1alpha1 timeline", () => {
     assert.throws(() => migrateEditTimelineV1alpha1(lesson(), { assetHashes: hashes }), /v1alpha1 EditTimeline/);
   });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs`
Expected: FAIL — among others, `reports a resolution that is not its profile's` (no problems reported) and `gives a 1920x1080 timeline the 16:9 profile…` (`profile` is undefined).

- [ ] **Step 3: Add `profile` to the schema**

```diff
@@ -44,6 +44,41 @@
         "height": { "type": "integer", "minimum": 1, "maximum": 4320 }
       }
     },
+    "SafeZone": {
+      "type": "object",
+      "additionalProperties": false,
+      "description": "Pixels inset from each edge of the frame where kits keep text and graphics.",
+      "required": ["top", "right", "bottom", "left"],
+      "properties": {
+        "top": { "type": "integer", "minimum": 0 },
+        "right": { "type": "integer", "minimum": 0 },
+        "bottom": { "type": "integer", "minimum": 0 },
+        "left": { "type": "integer", "minimum": 0 }
+      }
+    },
+    "LoudnessTarget": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["integrated", "truePeak", "range"],
+      "properties": {
+        "integrated": { "type": "number", "minimum": -70, "maximum": -5, "description": "Integrated loudness, LUFS." },
+        "truePeak": { "type": "number", "minimum": -9, "maximum": 0, "description": "True peak, dBTP." },
+        "range": { "type": "number", "minimum": 1, "maximum": 20, "description": "Loudness range, LU." }
+      }
+    },
+    "OutputProfile": {
+      "type": "object",
+      "additionalProperties": false,
+      "description": "A whole copy of the output profile the timeline renders to (avg-tk7.4): its size, safe zone and loudness. The catalog is src/output-profiles.json; the timeline does not depend on it.",
+      "required": ["id", "width", "height", "safeZone", "loudness"],
+      "properties": {
+        "id": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
+        "width": { "type": "integer", "minimum": 1, "maximum": 7680 },
+        "height": { "type": "integer", "minimum": 1, "maximum": 4320 },
+        "safeZone": { "$ref": "#/$defs/SafeZone" },
+        "loudness": { "$ref": "#/$defs/LoudnessTarget" }
+      }
+    },
     "DerivedFrom": {
       "type": "object",
       "additionalProperties": false,
@@ -201,7 +236,7 @@
     "EditTimeline": {
       "type": "object",
       "additionalProperties": false,
-      "required": ["apiVersion", "kind", "episodeRef", "revision", "fps", "durationInFrames", "resolution", "assets", "tracks"],
+      "required": ["apiVersion", "kind", "episodeRef", "revision", "fps", "durationInFrames", "resolution", "profile", "assets", "tracks"],
       "properties": {
         "apiVersion": { "type": "string", "const": "studio.video/v1alpha2" },
         "kind": { "type": "string", "const": "EditTimeline" },
@@ -211,6 +246,7 @@
         "fps": { "type": "integer", "minimum": 1 },
         "durationInFrames": { "$ref": "#/$defs/FrameCount" },
         "resolution": { "$ref": "#/$defs/Resolution" },
+        "profile": { "$ref": "#/$defs/OutputProfile" },
         "assets": {
           "type": "object",
           "propertyNames": { "$ref": "#/$defs/LocalId" },
```

- [ ] **Step 4: Check the profile and choose it in the migration**

```diff
@@ -19,6 +19,7 @@
 import Ajv2020 from "ajv/dist/2020.js";
 import addFormats from "ajv-formats";
 import schema from "../schemas/v1alpha2/edit-timeline.schema.json" with { type: "json" };
+import { OUTPUT_PROFILES, validateOutputProfile } from "./output-profiles.mjs";
 
 export const EDIT_TIMELINE_API_VERSION = "studio.video/v1alpha2";
 
@@ -72,6 +73,7 @@ export function validateEditTimeline(doc) {
     );
   }
   return [
+    ...checkProfile(doc),
     ...checkIds(doc),
     ...checkRanges(doc),
     ...checkTracks(doc),
@@ -82,6 +84,16 @@ export function validateEditTimeline(doc) {
   ];
 }
 
+function checkProfile(doc) {
+  const { profile, resolution } = doc;
+  const out = [];
+  if (profile.width !== resolution.width || profile.height !== resolution.height) {
+    out.push(issue("profile-resolution-mismatch", "$.profile",
+      `resolution ${resolution.width}x${resolution.height} is not profile "${profile.id}" (${profile.width}x${profile.height})`));
+  }
+  return [...out, ...validateOutputProfile(profile, "$.profile")];
+}
+
 function checkIds(doc) {
   const out = [];
   const registry = (kind) => {
@@ -279,16 +291,23 @@ const CAPTION_PROPS = ["position", "font", "fontSize", "color", "backgroundColor
 
 /**
  * @param {object} doc a studio.video/v1alpha1 EditTimeline
- * @param {{assetHashes?: Record<string, string>}} options content hash per sourceAsset path
+ * @param {{assetHashes?: Record<string, string>, profile?: object}} options content hash per
+ *   sourceAsset path; the output profile, otherwise the catalog one of the timeline's size
  * @returns {object} a studio.video/v1alpha2 EditTimeline
  */
-export function migrateEditTimelineV1alpha1(doc, { assetHashes = {} } = {}) {
+export function migrateEditTimelineV1alpha1(doc, { assetHashes = {}, profile } = {}) {
   if (doc?.apiVersion !== "studio.video/v1alpha1" || doc?.kind !== "EditTimeline") {
     throw new TypeError("expected a studio.video/v1alpha1 EditTimeline");
   }
   if (!Number.isInteger(doc.fps)) {
     throw new RangeError(`fps ${doc.fps} is not an integer; v1alpha2 counts whole frames`);
   }
+  const { width, height } = doc.resolution;
+  const chosen = profile ?? OUTPUT_PROFILES.find((p) => p.width === width && p.height === height);
+  if (!chosen) {
+    const sizes = OUTPUT_PROFILES.map((p) => `${p.id} ${p.width}x${p.height}`).join(", ");
+    throw new RangeError(`no output profile is ${width}x${height} (${sizes}); pass one in options.profile`);
+  }
   const frames = (seconds) => Math.round(seconds * doc.fps);
   // Round absolute times, never a start and a length separately: two
   // segments that touch in seconds must still touch in frames.
@@ -364,6 +383,7 @@ export function migrateEditTimelineV1alpha1(doc, { assetHashes = {} } = {}) {
     fps: doc.fps,
     durationInFrames,
     resolution: doc.resolution,
+    profile: structuredClone(chosen),
     assets,
     tracks,
     metadata: { migratedFrom: "studio.video/v1alpha1" },
```

```diff
@@ -3,11 +3,14 @@
 // bindings/ts/v1alpha2/edit-timeline.ts.
 
 import type { EditTimeline } from "../bindings/ts/v1alpha2/edit-timeline.ts";
+import type { OutputProfile } from "./output-profiles.d.mts";
 
 export declare const EDIT_TIMELINE_API_VERSION: "studio.video/v1alpha2";
 
 export type EditTimelineProblemCode =
   | "schema"
+  | "profile-resolution-mismatch"
+  | "profile-safe-zone"
   | "duplicate-id"
   | "out-of-range"
   | "missing-z"
@@ -35,11 +38,13 @@ export declare function validateEditTimeline(doc: unknown): EditTimelineProblem[
 export declare function jsonPath(pointer: string): string;
 
 /**
- * Convert a `studio.video/v1alpha1` timeline. Throws when a source asset has no
- * hash in `assetHashes`, when fps is not an integer, when `doc` is not v1alpha1,
- * or when the result would not pass `validateEditTimeline`.
+ * Convert a `studio.video/v1alpha1` timeline. Its profile is `options.profile`,
+ * otherwise the catalog profile of the timeline's resolution. Throws when a
+ * source asset has no hash in `assetHashes`, when fps is not an integer, when
+ * no profile fits, when `doc` is not v1alpha1, or when the result would not
+ * pass `validateEditTimeline`.
  */
 export declare function migrateEditTimelineV1alpha1(
   doc: unknown,
-  options?: { assetHashes?: Record<string, string> },
+  options?: { assetHashes?: Record<string, string>; profile?: OutputProfile },
 ): EditTimeline;
```

- [ ] **Step 5: Give the valid fixtures their profile**

```diff
@@ -13,6 +13,22 @@
     "width": 1920,
     "height": 1080
   },
+  "profile": {
+    "id": "youtube-1920x1080",
+    "width": 1920,
+    "height": 1080,
+    "safeZone": {
+      "top": 54,
+      "right": 96,
+      "bottom": 54,
+      "left": 96
+    },
+    "loudness": {
+      "integrated": -15,
+      "truePeak": -1,
+      "range": 11
+    }
+  },
   "assets": {
     "scene-01-woods": {
       "path": "assets/images/scene-01-woods.png",
```

```diff
@@ -18,6 +18,11 @@
   "fps": 30,
   "durationInFrames": 900,
   "resolution": { "width": 1920, "height": 1080 },
+  "profile": {
+    "id": "youtube-1920x1080", "width": 1920, "height": 1080,
+    "safeZone": { "top": 54, "right": 96, "bottom": 54, "left": 96 },
+    "loudness": { "integrated": -15, "truePeak": -1, "range": 11 }
+  },
   "assets": {
     "room": { "path": "assets/images/room.png", "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "kind": "image" },
     "painting-1": { "path": "assets/images/painting-1.png", "hash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "kind": "image" },
```

- [ ] **Step 6: Add the new fixtures**

`studio/contracts/fixtures/timeline/v1alpha2/valid/vertical-short.json`:

```json
{
  "apiVersion": "studio.video/v1alpha2",
  "kind": "EditTimeline",
  "episodeRef": {
    "channel": "dentro-i-versi",
    "series": "short",
    "episode": "il-lampo"
  },
  "revision": 1,
  "fps": 30,
  "durationInFrames": 150,
  "resolution": { "width": 1080, "height": 1920 },
  "profile": {
    "id": "vertical-1080x1920", "width": 1080, "height": 1920,
    "safeZone": { "top": 120, "right": 140, "bottom": 380, "left": 60 },
    "loudness": { "integrated": -14, "truePeak": -1, "range": 11 }
  },
  "assets": {
    "sky": { "path": "assets/images/sky.png", "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "kind": "image" },
    "verse": { "path": "assets/takes/verse.wav", "hash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "kind": "audio" }
  },
  "tracks": [
    {
      "id": "background",
      "type": "visual",
      "z": 0,
      "items": [
        { "id": "sky", "from": 0, "duration": 150, "kit": { "name": "still", "version": "1.0.0" }, "props": { "src": { "$asset": "sky" } } }
      ]
    },
    {
      "id": "text",
      "type": "visual",
      "z": 10,
      "items": [
        {
          "id": "verse-1", "from": 15, "duration": 120,
          "kit": { "name": "captions", "version": "1.1.0" },
          "props": { "text": "Il lampo, che candisce alberi e muri", "position": "bottom" }
        }
      ]
    },
    {
      "id": "voice",
      "type": "audio",
      "items": [
        { "id": "verse", "from": 15, "duration": 120, "asset": "verse" }
      ]
    }
  ]
}
```

`studio/contracts/fixtures/timeline/v1alpha2/invalid/profile-resolution-mismatch.json`:

```json
{
  "expect": "profile-resolution-mismatch",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/resolution",
      "value": { "width": 1080, "height": 1920 }
    }
  ]
}
```

`studio/contracts/fixtures/timeline/v1alpha2/invalid/profile-safe-zone.json`:

```json
{
  "expect": "profile-safe-zone",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/profile/safeZone/top",
      "value": 1026
    }
  ]
}
```

`studio/contracts/fixtures/timeline/v1alpha2/invalid/missing-profile.json`:

```json
{
  "expect": "schema",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "remove",
      "path": "/profile"
    }
  ]
}
```

- [ ] **Step 7: Regenerate the bindings**

Run: `cd studio/contracts && npm run bindings:generate`
Expected: `bindings/ts/v1alpha2/edit-timeline.ts` gains `SafeZone`, `LoudnessTarget`, `OutputProfile` and `profile: OutputProfile` on `EditTimeline`; `bindings/ts/workspace.ts` does not change yet.

- [ ] **Step 8: Run the tests and the fixture check**

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs && node scripts/check-timeline-fixtures.mjs | tail -1`
Expected: 24 tests pass; the last line reads `v1alpha1: 1 valid and 2 invalid fixtures passed; v1alpha2: 3 valid and 19 invalid fixtures passed`.

- [ ] **Step 9: Document it**

```diff
@@ -50,3 +50,13 @@ a compiler writes the timeline, a reviewed kit library renders it. A new
 visual needs a new kit through the normal review path. v1alpha1 stays frozen
 for migration (`migrateEditTimelineV1alpha1`), and `packages/video-composer`
 keeps reading it until the cutover (`avg-tk7.6`).
+
+## Amendment — output profiles (avg-tk7.4, 2026-10-06)
+
+The output profile now travels inside the timeline: `profile` (required) is a
+whole copy of the profile the timeline renders to — id, size, safe zone and
+loudness target — taken from the catalog in
+`studio/contracts/src/output-profiles.json` by the series compiler. Loudness
+is still not a property of tracks or items; the post-render FFmpeg pass
+reads it from `profile.loudness`. A copy, not a reference, so a delivered
+episode re-renders as it was if the catalog changes.
```

```diff
@@ -23,7 +23,7 @@ Filesystem mutation, pipeline execution, creative skills, provider calls, render
 | `pipeline-manifest.schema.json` | Pipeline definition with editorial/capability stage types |
 | `vocabulary.schema.json` | Canonical capability names and artifact kinds |
 | `journal-event.schema.json` | Append-only execution journal events |
-| `edit-timeline.schema.json` | Edit timeline. `v1alpha2/`: NLE tracks of kit instances and audio, sections with spec provenance, integer frames (ADR-0034), checked by `src/edit-timeline.mjs`. `v1alpha1/`: deprecated segment list |
+| `edit-timeline.schema.json` | Edit timeline. `v1alpha2/`: NLE tracks of kit instances and audio, sections with spec provenance, integer frames, and a copy of its output profile (size, safe zone, loudness; catalog in `src/output-profiles.json`) (ADR-0034), checked by `src/edit-timeline.mjs`. `v1alpha1/`: deprecated segment list |
 | `word-timing.schema.json` | When each word of one audio take is spoken, in seconds of that audio: written words with their spoken form where it differs, lines as word ranges, speech spans, lip-sync energy; provider-neutral; checked by `src/word-timing.mjs` |
 | `cue.schema.json` | When something happens in terms of the voice: a whole word (or `*` prefix), seconds, or a word / line / take / mark object with `at` and `offset`; resolved to an absolute frame, never by fallback, by `src/cues.mjs` |
 | `narration-takes.schema.json` | Every accepted voice take of an episode, from any tool (text as written, `spokenText` exactly as the tool received it, voice provenance, its word timing), and what each unit plays: takes in order with pauses and declared scene pauses; laid out and mapped from the Qwen narration manifest by `src/narration-takes.mjs` |
```

```diff
@@ -14,7 +14,8 @@ This catalog assigns every durable wire or workspace concept to one contract fam
 | `asset` | Asset Attempt, Asset Manifest, Selected Asset, VideoAttempt, media probe summary | provider adapters and renderers | runtime, Pi, composer, gateway, web | `vwc-5q0.5`, `vwc-5q0.15` |
 | `provider-job` | Capability request, persisted provider job, progress, cancellation, normalized result | provider adapters and TTS worker | Pi, runtime, gateway, web | `vwc-5q0.7` |
 | `narration` | Source-mapped Segment, immutable Synthesis Attempt, Signal Quality Report, ordered accepted-attempt Manifest, measured WAV/mastering metadata, caption cues, legacy read sidecar | Pi and TTS worker | runtime, composer, gateway, web | `qtw-48r.6.2` |
-| `timeline` | v1alpha2: tracks of versioned kit instances and audio items, ducking, sections with spec provenance, integer frames (ADR-0034) | Pi and editors | FFmpeg composer, runtime, web | `vwc-5q0.6` |
+| `timeline` | v1alpha2: tracks of versioned kit instances and audio items, ducking, sections with spec provenance, integer frames, its output profile (size, safe zone, loudness) (ADR-0034) | Pi and editors | Remotion composer, runtime, web | `vwc-5q0.6`, `avg-tk7.4` |
+| `output-profile` | Output profile catalog (`src/output-profiles.json`): size, safe zone in pixels, loudness target; `youtube-1920x1080`, `vertical-1080x1920` | contracts | series compilers, workspace settings, Remotion composer tests | `avg-tk7.4` |
 | `word-timing` | Word Timing per take: words (written and spoken), lines as word ranges, speech spans, energy envelope, audio hash binding, aligner provenance | `speech.align` adapters | series compilers, cue resolver, kits, narration QA | `avg-7zp.1` |
 | `cue` | Cue grammar for series specs (word, prefix, seconds, word/line/take/mark objects) and its resolution to frames against a take's Word Timing | series spec authors (Pi, editors) | series compilers | `avg-7zp.2` |
 | `narration-takes` | Narration Takes: provider-neutral take registry (text, spoken text as sent, voice provenance, word timing ref, narration-manifest source) and unit sequences with pauses and scene pauses; unit layout; Qwen manifest mapping | TTS provider adapters, Qwen worker via mapping | series compilers, cue resolver, composer | `avg-7zp.4` |
```

Expected and temporary: from here until Task 4, `packages/remotion-composer`'s `schema.test.ts` and `validate.test.ts` fail, because its strict zod mirror does not know `profile` yet and reads these fixtures. Task 4 fixes it; do not change the composer in this task.

- [ ] **Step 10: Commit**

```bash
git add studio/contracts docs/adr/0034-a-layered-kit-based-edit-timeline.md
git commit -m "feat(contracts): the v1alpha2 timeline carries its output profile (avg-tk7.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Workspace settings name a catalog profile

**Files:**
- Modify: `studio/contracts/schemas/v1alpha1/workspace.schema.json`, `studio/contracts/src/workspace-semantics.mjs`, `studio/contracts/fixtures/workspace/fairy-tale.json`, `studio/contracts/fixtures/workspace/repository.json`, `studio/contracts/test/workspace-schema.test.mjs`, `studio/contracts/bindings/ts/workspace.ts` (generated)

**Interfaces:**
- Consumes: `outputProfile`, `OUTPUT_PROFILES` (Task 1).
- Produces: `OutputProfileRef.id` ∈ catalog ids; semantic error `{path: "/<scope>/outputProfile", code: "output-profile.mismatch"}`.

- [ ] **Step 1: Write the tests**

```diff
@@ -4,6 +4,7 @@ import { readFile } from "node:fs/promises";
 import Ajv2020 from "ajv/dist/2020.js";
 import addFormats from "ajv-formats";
 import { policyActionFields, validateWorkspaceSemantics } from "../src/workspace-semantics.mjs";
+import { OUTPUT_PROFILES } from "../src/output-profiles.mjs";
 
 const load = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
 const [identity, workspace, fairyTale, repository] = await Promise.all([
@@ -49,6 +50,28 @@ test("semantics reject cross-resource and budget inconsistencies", () => {
   assert.ok(validateWorkspaceSemantics(invalidBudget).some((error) => error.code === "budget.warning-exceeds-limit"));
 });
 
+test("settings choose an output profile of the catalog, at its size", () => {
+  const { validate } = createValidator();
+  const vertical = structuredClone(fairyTale);
+  vertical.seriesSettings.values.outputProfile = { id: "vertical-1080x1920", width: 1080, height: 1920, frameRate: 30 };
+  assert.equal(validate(vertical), true);
+  assert.deepEqual(validateWorkspaceSemantics(vertical), []);
+
+  const mismatched = structuredClone(vertical);
+  mismatched.seriesSettings.values.outputProfile.width = 1920;
+  assert.deepEqual(validateWorkspaceSemantics(mismatched).map((e) => [e.path, e.code]), [
+    ["/seriesSettings/outputProfile", "output-profile.mismatch"],
+  ]);
+
+  const unknown = structuredClone(fairyTale);
+  unknown.seriesSettings.values.outputProfile.id = "youtube-1080p-30";
+  assert.equal(validate(unknown), false);
+});
+
+test("the settings' profile ids are exactly the catalog's", () => {
+  assert.deepEqual(workspace.$defs.OutputProfileRef.properties.id.enum, OUTPUT_PROFILES.map((p) => p.id));
+});
+
 test("repository snapshots pin a full commit and prohibit repository execution", () => {
   assert.match(repository.sourceSnapshot.commit, /^[0-9a-f]{40}$/);
   assert.deepEqual(repository.sourceSnapshot.analysisPolicy, { readOnly: true, allowRepositoryExecution: false });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd studio/contracts && node --test test/workspace-schema.test.mjs`
Expected: FAIL — `settings choose an output profile…` (the schema refuses `vertical-1080x1920`) and `the settings' profile ids are exactly the catalog's`.

- [ ] **Step 3: Change the schema and the semantics**

```diff
@@ -105,9 +105,9 @@
       "additionalProperties": false,
       "required": ["id", "width", "height", "frameRate"],
       "properties": {
-        "id": { "type": "string", "enum": ["youtube-1080p-30"] },
-        "width": { "type": "integer", "const": 1920 },
-        "height": { "type": "integer", "const": 1080 },
+        "id": { "type": "string", "enum": ["youtube-1920x1080", "vertical-1080x1920"], "description": "An id of the output profile catalog, src/output-profiles.json; width and height must be that profile's." },
+        "width": { "type": "integer", "minimum": 1, "maximum": 7680 },
+        "height": { "type": "integer", "minimum": 1, "maximum": 4320 },
         "frameRate": { "type": "integer", "const": 30 }
       }
     },
```

```diff
@@ -1,3 +1,5 @@
+import { outputProfile } from "./output-profiles.mjs";
+
 const POLICY_ACTION_FIELDS = Object.freeze([
   "onPaidAction",
   "onBudgetExceeded",
@@ -55,6 +57,11 @@ export function validateWorkspaceSemantics(workspace) {
     if (Number.isInteger(budget?.warnAtMicros) && Number.isInteger(budget?.limitMicros) && budget.warnAtMicros > budget.limitMicros) {
       add(`/${scope}/budget/warnAtMicros`, "budget.warning-exceeds-limit", "warnAtMicros must not exceed limitMicros");
     }
+    const ref = settings?.outputProfile;
+    const profile = ref && outputProfile(ref.id);
+    if (profile && (ref.width !== profile.width || ref.height !== profile.height)) {
+      add(`/${scope}/outputProfile`, "output-profile.mismatch", `${ref.id} is ${profile.width}x${profile.height}, not ${ref.width}x${ref.height}`);
+    }
   }
 
   const sourceId = sourceSnapshot?.artifactId;
```

- [ ] **Step 4: Rename the id in the fixtures**

In `studio/contracts/fixtures/workspace/fairy-tale.json` and `studio/contracts/fixtures/workspace/repository.json`, replace each of the three `"id": "youtube-1080p-30"` with `"id": "youtube-1920x1080"`. Then `grep -rn "youtube-1080p-30" studio/contracts` must print nothing once Step 5 is done.

- [ ] **Step 5: Regenerate the bindings**

Run: `cd studio/contracts && npm run bindings:generate`
Expected: `bindings/ts/workspace.ts`: `OutputProfileRef.id` becomes `"youtube-1920x1080" | "vertical-1080x1920"`, `width`/`height` become `number`.

- [ ] **Step 6: Run the whole contracts check**

Run: `cd studio/contracts && npm run check`
Expected: exit 0; `node --test` reports 332 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts
git commit -m "feat(contracts): settings choose a catalog output profile (avg-tk7.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The composer renders the profile; kits keep to its safe zone

**Files (all under `packages/remotion-composer/`):**
- Modify: `src/schema.ts`, `src/validate.ts`, `src/loudness.ts`, `src/render.ts`, `src/Root.tsx`, `src/Timeline.tsx`, `src/kits/types.ts`, `src/kits/index.ts`, `src/index.ts`, `src/PreviewRoot.tsx` (rewritten), `scripts/kits.ts`, `test/helpers.ts`, `test/validate.test.ts`, `test/kits.test.ts`, `test/kits-render.test.ts` (rewritten), `test/render.e2e.test.ts`, `README.md`, `package.json`, root `bun.lock`
- Create: `src/kits/captions/1.1.0.tsx`
- Generate: `kits.lock.json` (adds `captions@1.1.0`), `previews/<name>@<version>.<profile>.png` (8 files)
- Delete: `previews/captions@1.0.0.png`, `previews/clip@1.0.0.png`, `previews/still@1.0.0.png`

**Interfaces:**
- Consumes: the catalog file `studio/contracts/src/output-profiles.json` (by path) and the fixture `valid/vertical-short.json` (Task 2).
- Produces: `OutputProfileSchema`, `OutputProfile` (zod); `RenderResult.profile: string`; `KitContext.profile: KitProfile` (`{id, width, height, safeZone}`); `KitVersion.layer?: 'overlay'`; `previewPath(name, version, profileId)`; `listKits(profileIds = []) → {name, version, description, layer: 'overlay' | 'fill', examples, previews: Record<profileId, path>}[]`; `DEFAULT_LOUDNESS` removed.

- [ ] **Step 1: Read the catalog in the test helpers**

```diff
@@ -10,3 +10,16 @@ export const fixture = (name: string): Record<string, any> =>
   JSON.parse(readFileSync(path.join(CONTRACT_FIXTURES, 'valid', name), 'utf8')) as Record<string, any>;
 
 export const clone = <T>(value: T): T => structuredClone(value);
+
+/** The contracts' output profile catalog, read as a file for the same reason. */
+export const OUTPUT_PROFILES_FILE = path.resolve(here, '../../../studio/contracts/src/output-profiles.json');
+
+export interface CatalogProfile {
+  id: string;
+  width: number;
+  height: number;
+  safeZone: {top: number; right: number; bottom: number; left: number};
+  loudness: {integrated: number; truePeak: number; range: number};
+}
+
+export const outputProfiles = (): CatalogProfile[] => JSON.parse(readFileSync(OUTPUT_PROFILES_FILE, 'utf8')) as CatalogProfile[];
```

- [ ] **Step 2: Write the validation and listing tests**

```diff
@@ -2,7 +2,7 @@ import {describe, it} from 'node:test';
 import assert from 'node:assert/strict';
 import {listKits} from '../src/kits/index.js';
 import {validateTimeline} from '../src/validate.js';
-import {clone, fixture} from './helpers.js';
+import {clone, fixture, outputProfiles} from './helpers.js';
 
 const problems = (doc: unknown) => {
   const result = validateTimeline(doc);
@@ -14,6 +14,24 @@ describe('validateTimeline', () => {
     assert.deepEqual(problems(fixture('explainer.json')), []);
   });
 
+  it('accepts the 9:16 fixture, which uses captions@1.1.0', () => {
+    assert.deepEqual(problems(fixture('vertical-short.json')), []);
+  });
+
+  it('refuses a resolution that is not its profile\'s', () => {
+    const doc = clone(fixture('explainer.json'));
+    doc.resolution = {width: 1080, height: 1920};
+    assert.deepEqual(problems(doc), [['invalid-timeline', '$.profile']]);
+    const result = validateTimeline(doc);
+    assert.match(result.ok ? '' : result.problems[0]!.message, /resolution 1080x1920 is not profile "youtube-1920x1080" \(1920x1080\)/);
+  });
+
+  it('refuses a timeline without a profile', () => {
+    const doc = clone(fixture('explainer.json'));
+    delete doc.profile;
+    assert.deepEqual(problems(doc), [['invalid-timeline', '$.profile']]);
+  });
+
   it('refuses kits it does not have, by name or by version', () => {
     // The lesson excerpt uses sala, interprete and verse-bar, which avg-tk7.3 and later issues add.
     const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
@@ -39,11 +57,18 @@ describe('validateTimeline', () => {
   });
 
   it('lists every kit version with what the catalog needs', () => {
-    assert.deepEqual(listKits().map((k) => [k.name, k.version, k.examples, k.preview]), [
-      ['captions', '1.0.0', ['bottom', 'top'], 'previews/captions@1.0.0.png'],
-      ['clip', '1.0.0', ['plays'], 'previews/clip@1.0.0.png'],
-      ['still', '1.0.0', ['cover', 'contain'], 'previews/still@1.0.0.png'],
+    const ids = outputProfiles().map((p) => p.id);
+    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer, k.examples]), [
+      ['captions', '1.0.0', 'fill', ['bottom', 'top']],
+      ['captions', '1.1.0', 'overlay', ['bottom', 'top', 'center', 'long']],
+      ['clip', '1.0.0', 'fill', ['plays']],
+      ['still', '1.0.0', 'fill', ['cover', 'contain']],
     ]);
+    assert.deepEqual(listKits(ids)[1]!.previews, {
+      'youtube-1920x1080': 'previews/captions@1.1.0.youtube-1920x1080.png',
+      'vertical-1080x1920': 'previews/captions@1.1.0.vertical-1080x1920.png',
+    });
+    assert.deepEqual(listKits()[0]!.previews, {});
     assert.ok(listKits().every((k) => k.description.length > 0));
   });
 });
```

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL — `accepts the 9:16 fixture` (`unknown-kit` for `captions@1.1.0`, and `invalid-timeline` because the mirror has no `profile`), `refuses a resolution that is not its profile's`, and the listing test.

- [ ] **Step 3: Mirror the profile and check it**

```diff
@@ -68,6 +68,24 @@ export const AssetSchema = z.object({
   kind: z.enum(['markdown', 'json', 'yaml', 'audio', 'video', 'image', 'captions', 'tape']),
 }).strict();
 
+/** A whole copy of the output profile the timeline renders to (avg-tk7.4). */
+export const OutputProfileSchema = z.object({
+  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
+  width: z.number().int().min(1).max(7680),
+  height: z.number().int().min(1).max(4320),
+  safeZone: z.object({
+    top: z.number().int().min(0),
+    right: z.number().int().min(0),
+    bottom: z.number().int().min(0),
+    left: z.number().int().min(0),
+  }).strict(),
+  loudness: z.object({
+    integrated: z.number().min(-70).max(-5),
+    truePeak: z.number().min(-9).max(0),
+    range: z.number().min(1).max(20),
+  }).strict(),
+}).strict();
+
 export const EditTimelineSchema = z.object({
   apiVersion: z.literal('studio.video/v1alpha2'),
   kind: z.literal('EditTimeline'),
@@ -80,6 +98,7 @@ export const EditTimelineSchema = z.object({
   fps: z.number().int().min(1),
   durationInFrames: frameCount,
   resolution: z.object({width: z.number().int().min(1).max(7680), height: z.number().int().min(1).max(4320)}).strict(),
+  profile: OutputProfileSchema,
   assets: z.record(localId, AssetSchema),
   tracks: z.array(TrackSchema).min(1),
   sections: z.array(z.object({
@@ -94,6 +113,7 @@ export const EditTimelineSchema = z.object({
 
 export type EditTimeline = z.infer<typeof EditTimelineSchema>;
 export type Track = z.infer<typeof TrackSchema>;
+export type OutputProfile = z.infer<typeof OutputProfileSchema>;
 export type VisualItem = z.infer<typeof VisualItemSchema>;
 export type AudioItem = z.infer<typeof AudioItemSchema>;
 
```

```diff
@@ -19,6 +19,14 @@ export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimelin
   }
   const timeline = parsed.data;
   const problems: ComposerProblem[] = [];
+  const {profile, resolution} = timeline;
+  if (profile.width !== resolution.width || profile.height !== resolution.height) {
+    problems.push({
+      code: 'invalid-timeline',
+      message: `resolution ${resolution.width}x${resolution.height} is not profile "${profile.id}" (${profile.width}x${profile.height})`,
+      path: '$.profile',
+    });
+  }
   timeline.tracks.forEach((track, ti) =>
     track.items.forEach((item, ii) => {
       if (isAudioItem(item)) return;
```

- [ ] **Step 4: Loudness from the profile; the result names it**

```diff
@@ -9,8 +9,6 @@ export interface LoudnessTarget {
   range: number;
 }
 
-export const DEFAULT_LOUDNESS: LoudnessTarget = {integrated: -15, truePeak: -1, range: 11};
-
 export interface LoudnessResult {
   inputI: number;
   outputI: number;
@@ -36,7 +34,7 @@ function report(stderr: string): Record<string, string> {
 }
 
 export async function normalizeLoudness(
-  input: string, output: string, target: LoudnessTarget = DEFAULT_LOUDNESS, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
+  input: string, output: string, target: LoudnessTarget, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
 ): Promise<LoudnessResult> {
   const base = `I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
   const measured = report(await run(ffmpeg, ['-hide_banner', '-i', input, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']));
```

```diff
@@ -10,7 +10,7 @@ import {bundle} from '@remotion/bundler';
 import {renderMedia, selectComposition} from '@remotion/renderer';
 import {stageAssets, sha256} from './assets.js';
 import {ComposerError} from './errors.js';
-import {DEFAULT_LOUDNESS, normalizeLoudness, type LoudnessResult, type LoudnessTarget} from './loudness.js';
+import {normalizeLoudness, type LoudnessResult, type LoudnessTarget} from './loudness.js';
 import {isAudioItem} from './schema.js';
 import {validateTimeline} from './validate.js';
 import {videoFrames} from './probe.js';
@@ -23,6 +23,7 @@ export interface RenderTimelineOptions {
   outputPath: string;
   concurrency?: number;
   onProgress?: (progress: number) => void;
+  /** Overrides the timeline's `profile.loudness`. */
   loudness?: LoudnessTarget;
 }
 
@@ -32,6 +33,8 @@ export interface RenderResult {
   sizeBytes: number;
   hash: string;
   kits: {name: string; version: string}[];
+  /** The id of the output profile the timeline rendered to. */
+  profile: string;
   loudness: LoudnessResult | null;
 }
 
@@ -81,7 +84,7 @@ export async function renderTimeline(options: RenderTimelineOptions): Promise<Re
     let loudness: LoudnessResult | null = null;
     if (hasAudio) {
       try {
-        loudness = await normalizeLoudness(rendered, output, options.loudness ?? DEFAULT_LOUDNESS);
+        loudness = await normalizeLoudness(rendered, output, options.loudness ?? timeline.profile.loudness);
       } catch (e) {
         throw new ComposerError('loudness-failed', `loudness could not be normalised: ${e instanceof Error ? e.message : String(e)}`);
       }
@@ -96,6 +99,7 @@ export async function renderTimeline(options: RenderTimelineOptions): Promise<Re
       sizeBytes: (await stat(output)).size,
       hash: await sha256(output),
       kits,
+      profile: timeline.profile.id,
       loudness,
     };
   } finally {
```

```diff
@@ -11,6 +11,11 @@ const preview: TimelineProps = {
     fps: 30,
     durationInFrames: 30,
     resolution: {width: 1920, height: 1080},
+    profile: {
+      id: 'preview', width: 1920, height: 1080,
+      safeZone: {top: 0, right: 0, bottom: 0, left: 0},
+      loudness: {integrated: -15, truePeak: -1, range: 11},
+    },
     assets: {},
     tracks: [{id: 'main', type: 'visual', z: 0, items: []}],
   },
```

- [ ] **Step 5: Kits receive the profile; overlay kits; the listing**

```diff
@@ -6,10 +6,20 @@
 import type React from 'react';
 import type {ZodTypeAny} from 'zod';
 
+/** The frame a kit draws into: the output profile's size and safe zone (avg-tk7.4). */
+export interface KitProfile {
+  id: string;
+  width: number;
+  height: number;
+  /** Pixels inset from each edge where overlay kits keep their text and graphics. */
+  safeZone: {top: number; right: number; bottom: number; left: number};
+}
+
 /** What a kit component receives besides its props (which arrive with $asset resolved to URLs). */
 export interface KitContext {
   /** Asset URL → how many frames that video lasts, for kits that freeze at its end. */
   assetFrames: Record<string, number>;
+  profile: KitProfile;
 }
 
 export interface KitExample {
@@ -28,6 +38,11 @@ export interface KitVersion {
   name: string;
   version: string;
   description: string;
+  /**
+   * "overlay": draws text or graphics over the picture, and must stay inside
+   * the profile's safe zone (checked on every example). Absent: fills the frame.
+   */
+  layer?: 'overlay';
   /** Validates props as a timeline writes them. */
   props: ZodTypeAny;
   component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
```

```diff
@@ -4,7 +4,7 @@
 
 import React from 'react';
 import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
-import {resolveKit} from './kits/index.js';
+import {resolveKit, type KitProfile} from './kits/index.js';
 import type {AudioItem, EditTimeline, VisualItem} from './schema.js';
 import {isAudioItem} from './schema.js';
 import {itemVolume} from './volume.js';
@@ -31,7 +31,7 @@ export function resolveAssets(value: unknown, files: Record<string, string>): un
   return value;
 }
 
-const ItemLayer: React.FC<{item: VisualItem; files: Record<string, string>; assetFrames: Record<string, number>}> = ({item, files, assetFrames}) => {
+const ItemLayer: React.FC<{item: VisualItem; files: Record<string, string>; assetFrames: Record<string, number>; profile: KitProfile}> = ({item, files, assetFrames, profile}) => {
   const frame = useCurrentFrame();
   let opacity = 1;
   if (item.transitionIn) opacity = Math.min(opacity, Math.min(1, frame / item.transitionIn.duration));
@@ -42,7 +42,7 @@ const ItemLayer: React.FC<{item: VisualItem; files: Record<string, string>; asse
   const byUrl = Object.fromEntries(Object.entries(assetFrames).map(([file, frames]) => [staticFile(file), frames]));
   return (
     <AbsoluteFill style={{opacity}}>
-      <Kit props={resolveAssets(item.props, files) as Record<string, unknown>} context={{assetFrames: byUrl}} />
+      <Kit props={resolveAssets(item.props, files) as Record<string, unknown>} context={{assetFrames: byUrl, profile}} />
     </AbsoluteFill>
   );
 };
@@ -51,7 +51,7 @@ export const Timeline: React.FC<TimelineProps> = ({timeline, files, assetFrames}
   <AbsoluteFill style={{backgroundColor: '#000000'}}>
     {visualLayers(timeline).map(({track, item}) => (
       <Sequence key={`${track.id}/${item.id}`} from={item.from} durationInFrames={item.duration}>
-        <ItemLayer item={item} files={files} assetFrames={assetFrames} />
+        <ItemLayer item={item} files={files} assetFrames={assetFrames} profile={timeline.profile} />
       </Sequence>
     ))}
     {timeline.tracks
```

```diff
@@ -6,11 +6,12 @@ import type {KitVersion} from './types.js';
 import {kit as still100} from './still/1.0.0.js';
 import {kit as clip100} from './clip/1.0.0.js';
 import {kit as captions100} from './captions/1.0.0.js';
+import {kit as captions110} from './captions/1.1.0.js';
 
-export type {KitContext, KitExample, KitVersion} from './types.js';
+export type {KitContext, KitExample, KitProfile, KitVersion} from './types.js';
 
 /** Every released kit version. Adding a version: import it here, then `npm run kits:lock`. */
-export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([still100, clip100, captions100]);
+export const KIT_VERSIONS: readonly KitVersion[] = Object.freeze([still100, clip100, captions100, captions110]);
 
 const key = (name: string, version: string) => `${name}@${version}`;
 const byKey = new Map(KIT_VERSIONS.map((k) => [key(k.name, k.version), k]));
@@ -26,24 +27,35 @@ export const kitVersions = (name: string): string[] =>
 export const previewCompositionId = (name: string, version: string, exampleId: string): string =>
   `${name}-${version.replace(/[.+]/g, '-')}-${exampleId}`;
 
+/** Where `npm run kits:previews` writes a version's preview in one output profile. */
+export const previewPath = (name: string, version: string, profileId: string): string =>
+  `previews/${name}@${version}.${profileId}.png`;
+
 export interface KitListing {
   name: string;
   version: string;
   description: string;
+  layer: 'overlay' | 'fill';
   examples: string[];
-  preview: string;
+  /** Output profile id → preview path, for the profiles asked for. */
+  previews: Record<string, string>;
 }
 
-/** Every version, sorted by name then version: what the catalog and the agent read. */
-export const listKits = (): KitListing[] =>
+/**
+ * Every version, sorted by name then version: what the catalog and the agent
+ * read. The caller names the output profiles (the catalog is the contracts',
+ * which this package does not import).
+ */
+export const listKits = (profileIds: readonly string[] = []): KitListing[] =>
   [...KIT_VERSIONS]
     .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : compareSemver(a.version, b.version)))
     .map((k) => ({
       name: k.name,
       version: k.version,
       description: k.description,
+      layer: k.layer ?? 'fill',
       examples: k.examples.map((e) => e.id),
-      preview: `previews/${k.name}@${k.version}.png`,
+      previews: Object.fromEntries(profileIds.map((id) => [id, previewPath(k.name, k.version, id)])),
     }));
 
 function compareSemver(a: string, b: string): number {
```

```diff
@@ -1,6 +1,6 @@
 export {renderTimeline, type RenderTimelineOptions, type RenderResult} from './render.js';
 export {validateTimeline} from './validate.js';
-export {listKits, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample} from './kits/index.js';
+export {listKits, previewPath, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample, type KitProfile} from './kits/index.js';
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
-export {DEFAULT_LOUDNESS, type LoudnessTarget, type LoudnessResult} from './loudness.js';
-export {EditTimelineSchema, type EditTimeline} from './schema.js';
+export {type LoudnessTarget, type LoudnessResult} from './loudness.js';
+export {EditTimelineSchema, OutputProfileSchema, type EditTimeline, type OutputProfile} from './schema.js';
```

- [ ] **Step 6: Write `captions@1.1.0`** — `src/kits/captions/1.1.0.tsx`:

```tsx
// captions@1.1.0 — released: never edit this file; add captions/<next>.tsx instead.
// Same props as 1.0.0; the text block now stays inside the profile's safe zone.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';

const Captions: KitVersion['component'] = ({props, context}) => {
  const position = (props.position as 'top' | 'bottom' | 'center' | undefined) ?? 'bottom';
  const justify = position === 'top' ? 'flex-start' : position === 'center' ? 'center' : 'flex-end';
  const {top, right, bottom, left} = context.profile.safeZone;
  return (
    <AbsoluteFill style={{justifyContent: justify, alignItems: 'center', padding: `${top}px ${right}px ${bottom}px ${left}px`}}>
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
          boxSizing: 'border-box',
          overflowWrap: 'break-word',
        }}
      >
        {props.text as string}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'captions',
  version: '1.1.0',
  description: "A block of text inside the output profile's safe zone, at its top, centre or bottom, on a translucent plate.",
  layer: 'overlay',
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
    {id: 'center', props: {text: 'Il lampo', position: 'center', fontSize: 96}, durationInFrames: 30, frame: 0},
    {
      id: 'long',
      props: {text: 'E cielo e terra si mostrò qual era: la terra ansante, livida, in sussulto; il cielo ingombro, tragico, disfatto.'},
      durationInFrames: 30,
      frame: 0,
    },
  ],
};
```

- [ ] **Step 7: Preview compositions sized by the profile** — replace `src/PreviewRoot.tsx` with:

```tsx
// One composition per example of every kit version: what the one-frame tests
// and the previews render. Example $asset ids resolve to files in kits/samples/.
// The output profile arrives in inputProps (the catalog is the contracts', read
// by the tests and the previews script), and sets the composition's size; with
// `transparent` the example is drawn on nothing, so its drawn pixels can be
// measured against the safe zone.

import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {KIT_VERSIONS, previewCompositionId, type KitExample, type KitProfile, type KitVersion} from './kits/index.js';
import {resolveAssets} from './Timeline.js';

export interface ExampleProps {
  name: string;
  version: string;
  example: string;
  profile: KitProfile;
  transparent?: boolean;
  /** Index signature Remotion's Composition requires of its props. */
  [key: string]: unknown;
}

/** Used only when no profile is given: a plain 16:9 frame with no safe zone. */
const FALLBACK_PROFILE: KitProfile = {id: 'preview', width: 1920, height: 1080, safeZone: {top: 0, right: 0, bottom: 0, left: 0}};

const Example: React.FC<ExampleProps> = ({name, version, example, profile, transparent}) => {
  const kit = KIT_VERSIONS.find((k) => k.name === name && k.version === version)!;
  const ex = kit.examples.find((e) => e.id === example)!;
  const Kit = kit.component;
  return (
    <AbsoluteFill style={transparent ? {} : {backgroundColor: '#000000'}}>
      <Kit props={resolveAssets(ex.props, ex.samples ?? {}) as Record<string, unknown>} context={{assetFrames: {}, profile}} />
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
    width={FALLBACK_PROFILE.width}
    height={FALLBACK_PROFILE.height}
    defaultProps={{name: kit.name, version: kit.version, example: example.id, profile: FALLBACK_PROFILE} as ExampleProps}
    calculateMetadata={({props}) => ({width: props.profile.width, height: props.profile.height})}
  />
);

export const PreviewRoot: React.FC = () => <>{KIT_VERSIONS.flatMap((kit) => kit.examples.map((example) => compositions(kit, example)))}</>;
```

- [ ] **Step 8: Typecheck and run the validation tests**

Run: `cd packages/remotion-composer && npm run typecheck && node --import tsx --test test/validate.test.ts test/schema.test.ts`
Expected: typecheck clean; all pass.

- [ ] **Step 9: Every example in every profile; the safe-zone check** — replace `test/kits-render.test.ts` with:

```ts
// One real frame per example of every kit version, in every output profile
// (avg-tk7.3, avg-tk7.4): rendered with Remotion's headless Chrome. Fill kits
// must have the profile's size and not be blank; overlay kits are drawn on a
// transparent background and the box of what they drew must lie inside the
// profile's safe zone. Runs in `npm test` and CI; Remotion downloads Chrome on
// first use.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';
import {outputProfiles, type CatalogProfile} from './helpers.js';

/** Luma range of an image: max − min, from ffmpeg's signalstats. */
function lumaRange(file: string): number {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], {encoding: 'utf8'});
  const value = (key: string) => Number(new RegExp(`lavfi\\.signalstats\\.${key}=(\\d+)`).exec(r.stdout)?.[1]);
  const range = value('YMAX') - value('YMIN');
  assert.ok(r.status === 0 && Number.isFinite(range), `signalstats failed on ${file}: ${r.stderr}`);
  return range;
}

function size(file: string): [number, number] {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  assert.equal(r.status, 0, `ffprobe failed on ${file}: ${r.stderr}`);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return [w!, h!];
}

interface Box {left: number; top: number; right: number; bottom: number}

/** The box of every pixel with any opacity, from the alpha plane and cropdetect; null when nothing was drawn. */
function drawnBox(file: string): Box | null {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'alphaextract,cropdetect=limit=0:round=1:reset=0:skip=0', '-f', 'null', '-'], {encoding: 'utf8'});
  assert.equal(r.status, 0, `cropdetect failed on ${file}: ${r.stderr.slice(-400)}`);
  const m = /x1:(-?\d+) x2:(-?\d+) y1:(-?\d+) y2:(-?\d+)/.exec(r.stderr);
  assert.ok(m, `cropdetect printed no box for ${file}`);
  const [x1, x2, y1, y2] = m.slice(1).map(Number) as [number, number, number, number];
  return x2 < x1 || y2 < y1 ? null : {left: x1, top: y1, right: x2, bottom: y2};
}

/** How far a drawn box crosses each edge of the safe zone, in pixels; empty when inside. */
export function overflow(box: Box, profile: CatalogProfile): string[] {
  const {top, right, bottom, left} = profile.safeZone;
  const out: string[] = [];
  if (box.top < top) out.push(`${top - box.top} px above`);
  if (box.bottom > profile.height - 1 - bottom) out.push(`${box.bottom - (profile.height - 1 - bottom)} px below`);
  if (box.left < left) out.push(`${left - box.left} px left of`);
  if (box.right > profile.width - 1 - right) out.push(`${box.right - (profile.width - 1 - right)} px right of`);
  return out;
}

describe('every kit example renders a real frame in every output profile', () => {
  let work = '';
  let serveUrl = '';
  before(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'kit-render-test-'));
    serveUrl = await bundlePreviews(path.join(work, 'bundle'));
  });
  after(async () => {
    if (work) await rm(work, {recursive: true, force: true});
  });

  for (const profile of outputProfiles()) {
    for (const kit of KIT_VERSIONS) {
      for (const example of kit.examples) {
        const id = previewCompositionId(kit.name, kit.version, example.id);
        const name = `${kit.name}@${kit.version} ${example.id} in ${profile.id}`;
        it(name, async () => {
          const overlay = kit.layer === 'overlay';
          const inputProps = {profile, transparent: overlay};
          const composition = await selectComposition({serveUrl, id, inputProps});
          const output = path.join(work, `${id}.${profile.id}.png`);
          await renderStill({composition, serveUrl, output, inputProps, frame: example.frame, imageFormat: 'png'});
          assert.deepEqual(size(output), [profile.width, profile.height]);
          if (overlay) {
            const box = drawnBox(output);
            assert.ok(box, `${name} drew nothing`);
            const out = overflow(box, profile);
            assert.deepEqual(out, [], `${name}: ${out.join(', ')} the safe zone`);
          } else {
            assert.ok(lumaRange(output) > 16, `${name} rendered a blank frame`);
          }
        });
      }
    }
  }
});
```

Run: `cd packages/remotion-composer && node --import tsx --test test/kits-render.test.ts`
Expected: PASS, 18 tests (9 examples × 2 profiles): fill kits not blank at the profile's size; every `captions@1.1.0` example inside the safe zone.

- [ ] **Step 10: Show the check catches overflow**

Temporarily add `layer: 'overlay',` after `version: '1.0.0',` in `src/kits/captions/1.0.0.tsx` and re-run the render test. Expected: exactly two failures, `captions@1.0.0 bottom in vertical-1080x1920: 315 px below, 54 px right of the safe zone` and `captions@1.0.0 top in vertical-1080x1920: 55 px above the safe zone` (pixel counts may differ by a few with fonts). Then `git checkout src/kits/captions/1.0.0.tsx` and confirm `git diff --stat src/kits/captions/1.0.0.tsx` prints nothing.

- [ ] **Step 11: Previews per profile, and the metadata test**

```diff
@@ -1,6 +1,6 @@
 // Every kit version keeps the registry's rules (avg-tk7.3): well-formed
 // metadata, examples its own schema accepts, self-contained source, a file
-// frozen by kits.lock.json, and a committed preview.
+// frozen by kits.lock.json, and a committed preview in every output profile.
 
 import {describe, it} from 'node:test';
 import assert from 'node:assert/strict';
@@ -10,7 +10,8 @@ import path from 'node:path';
 import {spawnSync} from 'node:child_process';
 import {fileURLToPath} from 'node:url';
 import ts from 'typescript';
-import {KIT_VERSIONS} from '../src/kits/index.js';
+import {KIT_VERSIONS, previewPath} from '../src/kits/index.js';
+import {outputProfiles} from './helpers.js';
 
 const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
 const source = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
@@ -87,12 +88,20 @@ describe('kit versions', () => {
         assert.equal(actual, lock[id], `${id} is released: restore its file and add ${kit.name}/<next version>.tsx instead`);
       });
 
-      it('has a committed preview', () => {
-        assert.ok(existsSync(path.join(root, 'previews', `${id}.png`)), `run npm run kits:previews`);
+      it('has a committed preview in every output profile', () => {
+        for (const profile of outputProfiles()) {
+          const file = previewPath(kit.name, kit.version, profile.id);
+          assert.ok(existsSync(path.join(root, file)), `${file} is missing: run npm run kits:previews`);
+        }
       });
     });
   }
 
+  it('keeps no preview that no version and profile has', () => {
+    const expected = new Set(KIT_VERSIONS.flatMap((k) => outputProfiles().map((p) => path.basename(previewPath(k.name, k.version, p.id)))));
+    assert.deepEqual(readdirSync(path.join(root, 'previews')).filter((f) => !expected.has(f)), []);
+  });
+
   it('registers each version once', () => {
     const ids = KIT_VERSIONS.map((k) => `${k.name}@${k.version}`);
     assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
```

```diff
@@ -1,15 +1,17 @@
 // npm run kits:lock      add new kit versions to kits.lock.json (never rewrites an entry)
-// npm run kits:previews  render previews/<name>@<version>.png (first example, 640x360)
+// npm run kits:previews  render previews/<name>@<version>.<profile>.png: the first
+//                        example in every output profile, at a third of its size
 
 import {createHash} from 'node:crypto';
 import {existsSync, readFileSync, writeFileSync} from 'node:fs';
-import {copyFile, mkdtemp, rm} from 'node:fs/promises';
+import {copyFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
 import {tmpdir} from 'node:os';
 import path from 'node:path';
 import {fileURLToPath} from 'node:url';
 import {renderStill, selectComposition} from '@remotion/renderer';
-import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
+import {KIT_VERSIONS, previewCompositionId, previewPath} from '../src/kits/index.js';
 import {bundlePreviews} from '../src/preview-bundle.js';
+import {outputProfiles} from '../test/helpers.js';
 
 const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
 const lockFile = path.join(root, 'kits.lock.json');
@@ -40,14 +42,19 @@ async function previews() {
     const serveUrl = await bundlePreviews(path.join(work, 'bundle'));
     // Render all first, then copy: a failure halfway leaves previews/ as it was.
     const rendered: [string, string][] = [];
-    for (const kit of KIT_VERSIONS) {
-      const example = kit.examples[0]!;
-      const id = previewCompositionId(kit.name, kit.version, example.id);
-      const composition = await selectComposition({serveUrl, id, inputProps: {}});
-      const file = `${kit.name}@${kit.version}.png`;
-      await renderStill({composition, serveUrl, output: path.join(work, file), frame: example.frame, scale: 1 / 3, imageFormat: 'png'});
-      rendered.push([path.join(work, file), path.join(root, 'previews', file)]);
+    for (const profile of outputProfiles()) {
+      for (const kit of KIT_VERSIONS) {
+        const example = kit.examples[0]!;
+        const id = previewCompositionId(kit.name, kit.version, example.id);
+        const inputProps = {profile};
+        const composition = await selectComposition({serveUrl, id, inputProps});
+        const file = previewPath(kit.name, kit.version, profile.id);
+        const temp = path.join(work, path.basename(file));
+        await renderStill({composition, serveUrl, inputProps, output: temp, frame: example.frame, scale: 1 / 3, imageFormat: 'png'});
+        rendered.push([temp, path.join(root, file)]);
+      }
     }
+    await mkdir(path.join(root, 'previews'), {recursive: true});
     for (const [from, to] of rendered) {
       await copyFile(from, to);
       console.log(`rendered ${path.relative(root, to)}`);
```

Then:

```bash
cd packages/remotion-composer
git rm -q previews/captions@1.0.0.png previews/clip@1.0.0.png previews/still@1.0.0.png
npm run kits:lock        # prints: locked captions@1.1.0
npm run kits:previews    # 8 files
for f in previews/*.png; do echo "$f $(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "$f")"; done
```

Expected: eight previews, `*.youtube-1920x1080.png` at `640,360` and `*.vertical-1080x1920.png` at `360,640`. Open `previews/captions@1.0.0.vertical-1080x1920.png` and `previews/captions@1.1.0.vertical-1080x1920.png`: 1.0.0's text sits near the bottom edge, 1.1.0's sits clearly higher (above the 380 px band) and slightly left of centre. `kits.lock.json` gains only `captions@1.1.0`; the other three entries are unchanged.

- [ ] **Step 12: The 9:16 end-to-end render**

```diff
@@ -54,6 +54,7 @@ describe('renderTimeline end to end', {skip: !enabled && 'set REMOTION_E2E=1 to
     assert.equal(result.durationSeconds, 25.5);
     assert.equal(result.loudness, null);
     assert.deepEqual(result.kits, [{name: 'still', version: '1.0.0'}, {name: 'captions', version: '1.0.0'}]);
+    assert.equal(result.profile, 'youtube-1920x1080');
     assert.match(result.hash, /^sha256:[a-f0-9]{64}$/);
     await rm(root, {recursive: true, force: true});
   });
@@ -69,6 +70,12 @@ describe('renderTimeline end to end', {skip: !enabled && 'set REMOTION_E2E=1 to
       apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
       episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1,
       fps: 30, durationInFrames: 120, resolution: {width: 640, height: 360},
+      // A profile outside the catalog: the timeline carries everything the render needs.
+      profile: {
+        id: 'test-640x360', width: 640, height: 360,
+        safeZone: {top: 18, right: 32, bottom: 18, left: 32},
+        loudness: {integrated: -15, truePeak: -1, range: 11},
+      },
       assets: {
         bg: {path: 'assets/bg.png', hash: await sha256(path.join(root, 'assets/bg.png')), kind: 'image'},
         voice: {path: 'assets/voice.wav', hash: await sha256(path.join(root, 'assets/voice.wav')), kind: 'audio'},
@@ -88,4 +95,26 @@ describe('renderTimeline end to end', {skip: !enabled && 'set REMOTION_E2E=1 to
     assert.ok(Number(measured.input_tp) <= -1, `true peak ${measured.input_tp}`);
     await rm(root, {recursive: true, force: true});
   });
+
+  it('renders the 9:16 fixture at 1080x1920 and normalises to its profile, -14 LUFS', async () => {
+    const {renderTimeline} = await import('../dist/index.js');
+    const root = await mkdtemp(path.join(tmpdir(), 'composer-e2e-vertical-'));
+    const doc = clone(fixture('vertical-short.json'));
+    await mkdir(path.join(root, 'assets/images'), {recursive: true});
+    await mkdir(path.join(root, 'assets/takes'), {recursive: true});
+    ffmpeg(['-f', 'lavfi', '-i', 'gradients=s=1080x1920:c0=0x1b1f3b:c1=0x3b2f5b:seed=7', '-frames:v', '1', path.join(root, doc.assets.sky.path)]);
+    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-af', 'volume=0.3', '-ar', '48000', path.join(root, doc.assets.verse.path)]);
+    for (const asset of Object.values(doc.assets) as {path: string; hash: string}[]) asset.hash = await sha256(path.join(root, asset.path));
+    const out = path.join(root, 'out.mp4');
+    const result = await renderTimeline({timeline: doc, assetRoot: root, outputPath: out});
+    const video = probe(out).streams.find((s) => s.codec_type === 'video')!;
+    assert.deepEqual([video.width, video.height, Number(video.nb_frames)], [1080, 1920, 150]);
+    assert.equal(result.profile, 'vertical-1080x1920');
+    assert.deepEqual(result.kits, [{name: 'still', version: '1.0.0'}, {name: 'captions', version: '1.1.0'}]);
+    assert.ok(result.loudness);
+    const measured = measure(out);
+    assert.ok(Math.abs(Number(measured.input_i) + 14) <= 1, `integrated ${measured.input_i}`);
+    assert.ok(Number(measured.input_tp) <= -1, `true peak ${measured.input_tp}`);
+    await rm(root, {recursive: true, force: true});
+  });
 });
```

- [ ] **Step 13: README and version**

```diff
@@ -14,12 +14,21 @@ knows timelines, kits and files — not episodes, pipelines or the studio.
 - **Renders** visual tracks in `z` order, one kit instance per item, with
   fades and crossfades; audio items as `<Audio>` with a per-frame volume
   (gain × fades × ducking under other tracks).
-- **Normalises** loudness (default −15 LUFS integrated, −1 dBTP true peak) and
-  returns a result record: path, duration, size, sha256, kits used, loudness.
-
-Kits in this version: `still`, `clip`, `captions` (all `1.0.0`). A timeline
-gets exactly the version it names; `listKits()` gives each version's
-description, examples and preview (`previews/<name>@<version>.png`).
+- **Normalises** loudness to the timeline's output profile (`profile.loudness`:
+  −15 LUFS for `youtube-1920x1080`, −14 for `vertical-1080x1920`, −1 dBTP
+  true peak) and returns a result record: path, duration, size, sha256, kits
+  used, profile, loudness.
+
+The timeline carries a whole copy of its output profile — size, safe zone,
+loudness — taken from the contracts' catalog
+(`studio/contracts/src/output-profiles.json`); this package never reads the
+catalog, only the timeline. Kits receive the profile in `context.profile`.
+
+Kits in this version: `still@1.0.0`, `clip@1.0.0`, `captions@1.0.0`, and
+`captions@1.1.0`, which keeps its text inside the profile's safe zone. A
+timeline gets exactly the version it names; `listKits(profileIds)` gives each
+version's description, layer, examples and a preview per profile
+(`previews/<name>@<version>.<profile>.png`).
 
 ## Adding a kit or a version
 
@@ -30,19 +39,24 @@ was. A change — even a fix — is a new version next to the old one.
    version, one-sentence description, zod `props`, `component`, `examples`).
    It may import only `react`, `remotion`, `zod`, and types (`import type`)
    from `../types.js`: shared runtime code changing would silently change old
-   versions. For a new version,
-   copy the previous file and edit the copy.
+   versions. For a new version, copy the previous file and edit the copy.
+   A kit that draws text or graphics over the picture declares
+   `layer: "overlay"` and lays itself out inside `context.profile.safeZone`.
 2. Give it at least one example: props as a timeline writes them, a
    `durationInFrames`, the `frame` to preview, and `samples` mapping its
    `$asset` ids to files in `kits/samples/`.
 3. Add it to `KIT_VERSIONS` in `src/kits/index.ts`.
 4. `npm run kits:lock` records the file's sha256 in `kits.lock.json` (it
    never rewrites an existing entry); `npm run kits:previews` renders the
-   first example to `previews/<name>@<version>.png` (640×360). Commit both.
+   first example in every output profile to
+   `previews/<name>@<version>.<profile>.png` (a third of the size: 640×360,
+   360×640). Commit both.
 5. `npm test` checks the metadata, the self-contained imports and the lock
    — including that every version locked on `origin/main` (or
    `$KITS_LOCK_BASE`) is still there, unchanged — and renders one real frame
-   of every example.
+   of every example in every output profile. An overlay kit is drawn on a
+   transparent background, and the box of what it drew must lie inside the
+   profile's safe zone; the failure says by how many pixels and on which side.
 
 ## API
 
@@ -71,9 +85,9 @@ node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <epis
 ## Tests
 
 ```bash
-npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example
+npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example and profile
 npm run build --workspace @av/remotion-composer && \
-  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also two real renders
+  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also three real renders (16:9, audio, 9:16)
 ```
 
 The first render downloads Remotion's headless Chrome.
```

In `package.json` change `"version": "0.2.0"` to `"version": "0.3.0"`; in the root `bun.lock`, under `"packages/remotion-composer": {`, change `"version": "0.2.0"` to `"version": "0.3.0"`; run `bun install --frozen-lockfile` from the root.

- [ ] **Step 14: Everything, including the real renders**

```bash
cd packages/remotion-composer && npm run typecheck && npm run build && REMOTION_E2E=1 npm test; rm -rf dist
```

Expected: 65 tests, all pass, none skipped (the lock-against-`origin/main` test runs: main has `kits.lock.json`). In particular the 9:16 render is 1080×1920, 150 frames, within ±1 LU of −14, `result.profile === 'vertical-1080x1920'`. Afterwards `ls "${TMPDIR:-/tmp}" | grep -E "^kit-|^remotion-composer-|^composer-e2e"` prints nothing.

- [ ] **Step 15: Root checks**

Run from the root: `node tools/check-boundaries.mjs && node tools/gen-docs.mjs && git status --short docs/packages && npm run check && npm run docs:build`
Expected: boundaries green; no change under `docs/packages`; `npm run check` exits 0; the docs site builds.

- [ ] **Step 16: Commit**

```bash
git add packages/remotion-composer bun.lock
git commit -m "feat(remotion-composer): render to the timeline's output profile; captions@1.1.0 keeps to its safe zone (avg-tk7.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Catalog JSON + module, values | Task 1 |
| `profile` required, checks, codes | Task 2 Steps 1–4, 6 |
| Migration picks by size, explicit profile, refusal, copy | Task 2 Steps 1, 4 |
| Fixtures (two updated, `vertical-short`, three invalid) | Task 2 Steps 5–6 |
| ADR-0034 note, contracts docs | Task 2 Step 9 |
| Workspace settings: catalog ids, size check, rename | Task 3 |
| Runtime left alone (separate bug) | Global Constraints |
| Composer mirror, re-check, loudness from profile, result `profile` | Task 4 Steps 2–4 |
| `KitContext.profile`, `layer: "overlay"`, `captions@1.1.0` | Task 4 Steps 5–6 |
| Every example in every profile; transparent overlay check | Task 4 Steps 7, 9–10 |
| Previews per profile, `listKits(profileIds)` | Task 4 Steps 5, 11 |
| e2e 16:9 unchanged, 9:16 at −14 | Task 4 Steps 12, 14 |
| Root check and docs build | Task 4 Step 15 |
