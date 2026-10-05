# Edit Timeline v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `studio.video/v1alpha2` edit timeline — NLE tracks, versioned kit instances, audio tracks with ducking, sections with provenance, integer frames — with one shared validator, a v1alpha1 migration, generated TypeScript bindings and ADR-0034.

**Architecture:** The JSON Schema in `studio/contracts/schemas/v1alpha2/` owns record shapes. A pure module, `studio/contracts/src/edit-timeline.mjs`, compiles that schema with Ajv and adds every rule a schema cannot express (overlaps, references, ranges), returning all problems as `{ code, message, path }`. Fixtures prove each rule: one valid lesson excerpt, plus invalid fixtures that are that excerpt with a one-line JSON patch. v1alpha1 stays frozen; nothing outside `studio/contracts` changes.

**Tech Stack:** Node 22 ESM (`.mjs`, JSON import attributes), JSON Schema 2020-12, Ajv 8 (`ajv/dist/2020.js`, strict mode), `node:test`, the repo's own bindings generator, bun workspaces.

**Spec:** `docs/superpowers/specs/2026-10-05-edit-timeline-v2-design.md`

## Global Constraints

- `apiVersion` is exactly `studio.video/v1alpha2`; `$id` is exactly `https://video.studio/schemas/v1alpha2/edit-timeline.schema.json`.
- All times are integer frames: `from`, `duration`, fades, transitions, `trimStart`, duck `attack`/`release`.
- `ContentHash` is `^sha256:[a-f0-9]{64}$`; every asset requires `path`, `hash`, `kind`.
- Problem codes are exactly: `schema`, `duplicate-id`, `out-of-range`, `missing-z`, `z-on-audio`, `bad-duck`, `item-type`, `unknown-asset`, `asset-kind`, `overlap`, `bad-crossfade`, `section-overlap`, `fade-too-long`.
- JSON paths look like `$.tracks[2].items[5].from`; non-identifier keys use `["key"]`.
- v1alpha1 files (`schemas/v1alpha1/edit-timeline.schema.json`, `fixtures/timeline/valid|invalid/`, `bindings/ts/edit-timeline.ts`) are not modified.
- Do not touch `packages/video-composer` (stays on v1alpha1 until `avg-tk7.6`).
- `@studio/contracts` version goes from `0.1.0` to `0.2.0`; `ajv` and `ajv-formats` move from `devDependencies` to `dependencies` (the validator now runs at runtime).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Items listed out of time order within a track (a compiler may emit them unsorted) must be checked in time order, not array order — pinned in Task 2 ("checks overlaps in time order…").
- A crossfade whose overlap is right but whose item ends inside the previous item is not a crossfade — pinned in Task 2 ("rejects a crossfade item that ends inside the previous item").
- `$asset` references nested inside arrays, or sitting next to other keys (`{ "$asset": "x", "fit": "cover" }`), must still be resolved; a kit author will write both. This deliberately widens the spec's "exact form" wording to "any object with a string `$asset` key" — pinned in Task 2 ("finds asset references nested in arrays and next to other keys").
- Props keys that are not identifiers (`timing-curve`) must produce a usable JSON path (`props["timing-curve"]`) — same Task 2 test, plus the `jsonPath` test.
- An empty track and a timeline with no `sections` are valid — pinned in Task 2 ("accepts an empty track and a timeline without sections").

## File map

| File | Responsibility | Task |
|---|---|---|
| `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json` | Record shapes for v1alpha2 | 1 |
| `studio/contracts/fixtures/timeline/v1alpha2/valid/lesson-excerpt.json` | The reference layered timeline | 1 |
| `studio/contracts/scripts/generate-ts-bindings.mjs` | Generate bindings per resource version; fix array-of-union and map typing | 1 |
| `studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts` | Generated | 1 |
| `studio/contracts/bindings/ts/provider-job.ts` | Regenerated: `sourceRevisions` becomes `Record<string, string>` (map typing fix; no consumer) | 1 |
| `studio/contracts/test/bindings.test.mjs`, `test/edit-timeline-schema.test.mjs` | Binding and schema tests | 1 |
| `studio/contracts/src/edit-timeline.mjs` + `.d.mts` | `validateEditTimeline`, `jsonPath`, later the migration | 2, 3 |
| `studio/contracts/scripts/lib/json-patch.mjs` | Apply the patch of an invalid fixture | 2 |
| `studio/contracts/fixtures/timeline/v1alpha2/invalid/*.json` | One broken rule each | 2 |
| `studio/contracts/test/edit-timeline.test.mjs` | Validator and migration tests | 2, 3 |
| `studio/contracts/fixtures/timeline/v1alpha2/valid/explainer.json` | Expected migration of v1alpha1 `basic.json` | 3 |
| `studio/contracts/scripts/check-timeline-fixtures.mjs` | `check:schemas` covers v1alpha2 | 4 |
| `docs/adr/0034-a-layered-kit-based-edit-timeline.md`, `docs/adr/0009-…`, docs | Decision record and docs | 5 |

All commands below run from the repository root unless a step says otherwise. Work on branch `feat/edit-timeline-v2` (already created; the spec is committed there).

---

### Task 1: v1alpha2 schema, reference fixture and bindings

**Files:**
- Create: `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json`
- Create: `studio/contracts/fixtures/timeline/v1alpha2/valid/lesson-excerpt.json`
- Create: `studio/contracts/test/edit-timeline-schema.test.mjs`
- Modify: `studio/contracts/scripts/generate-ts-bindings.mjs` (schema loading at lines 18–55, array typing in `toTsType`, the run block at the end)
- Modify: `studio/contracts/test/bindings.test.mjs`
- Generated: `studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts`, `studio/contracts/bindings/ts/provider-job.ts`

**Interfaces:**
- Produces: the schema with `$defs` `ContentHash`, `Frame`, `FrameCount`, `LocalId`, `SpecPath`, `EpisodeRef`, `Resolution`, `DerivedFrom`, `Asset`, `KitRef`, `TransitionIn`, `TransitionOut`, `VisualItem`, `AudioItem`, `Duck`, `Track`, `Chapter`, `Section`, `EditTimeline`; the TS binding `bindings/ts/v1alpha2/edit-timeline.ts` exporting those names (Task 2's `.d.mts` imports `EditTimeline` from it); the fixture `lesson-excerpt.json` whose track order is `background`(0), `panel`(1), `guide`(2), `verses`(3), `voice`(4), `music`(5) and whose sections are `titolo`, `epoca` — Task 2's invalid fixtures patch it by these indices.

- [ ] **Step 1: Write the failing tests**

Create `studio/contracts/test/edit-timeline-schema.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));

describe("edit-timeline v1alpha2 schema", () => {
  const schema = read("schemas/v1alpha2/edit-timeline.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}#/$defs/EditTimeline`);

  it("compiles in strict mode under its v1alpha2 $id", () => {
    assert.equal(schema.$id, "https://video.studio/schemas/v1alpha2/edit-timeline.schema.json");
    assert.ok(validate, "EditTimeline definition was not registered");
  });

  it("accepts the reference lesson excerpt", () => {
    const ok = validate(read("fixtures/timeline/v1alpha2/valid/lesson-excerpt.json"));
    assert.ok(ok, ajv.errorsText(validate.errors));
  });

  it("rejects fractional frames and a v1alpha1 apiVersion", () => {
    const doc = read("fixtures/timeline/v1alpha2/valid/lesson-excerpt.json");
    assert.equal(validate({ ...doc, durationInFrames: 900.5 }), false);
    assert.equal(validate({ ...doc, apiVersion: "studio.video/v1alpha1" }), false);
  });
});
```

Append to the `describe("TypeScript bindings", …)` block in `studio/contracts/test/bindings.test.mjs` (before its closing `});`):

```js
  it("generates the v1alpha2 edit timeline in its own directory", () => {
    const path = resolve(bindingsDir, "v1alpha2/edit-timeline.ts");
    assert.ok(existsSync(path), "Missing binding: v1alpha2/edit-timeline.ts");
    const content = readFileSync(path, "utf-8");
    assert.ok(content.includes('apiVersion: "studio.video/v1alpha2";'));
    assert.ok(content.includes("items: (VisualItem | AudioItem)[];"), "array of a union needs parentheses");
    assert.ok(content.includes("assets: Record<string, Asset>;"), "maps carry their value type");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/edit-timeline-schema.test.mjs test/bindings.test.mjs`
Expected: FAIL — `ENOENT … schemas/v1alpha2/edit-timeline.schema.json` and `Missing binding: v1alpha2/edit-timeline.ts`.

- [ ] **Step 3: Create the schema**

Create `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://video.studio/schemas/v1alpha2/edit-timeline.schema.json",
  "title": "Video Studio edit timeline schema (v1alpha2)",
  "description": "A layered, kit-based edit timeline (ADR-0034). Derived from an episode spec by a series compiler; never edited by hand. All times are integer frames at fps. Structural rules a schema cannot express (overlaps, references, ranges) are checked by validateEditTimeline in src/edit-timeline.mjs.",
  "$defs": {
    "ContentHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "Frame": {
      "type": "integer",
      "minimum": 0
    },
    "FrameCount": {
      "type": "integer",
      "minimum": 1
    },
    "LocalId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$"
    },
    "SpecPath": {
      "type": "string",
      "minLength": 1,
      "description": "JSON path into the spec the timeline was derived from, e.g. blocks[3].story.phases[1]."
    },
    "EpisodeRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["channel", "series", "episode"],
      "properties": {
        "channel": { "type": "string", "minLength": 1 },
        "series": { "type": "string", "minLength": 1 },
        "episode": { "type": "string", "minLength": 1 }
      }
    },
    "Resolution": {
      "type": "object",
      "additionalProperties": false,
      "required": ["width", "height"],
      "properties": {
        "width": { "type": "integer", "minimum": 1, "maximum": 7680 },
        "height": { "type": "integer", "minimum": 1, "maximum": 4320 }
      }
    },
    "DerivedFrom": {
      "type": "object",
      "additionalProperties": false,
      "required": ["spec", "compiler"],
      "properties": {
        "spec": {
          "type": "object",
          "additionalProperties": false,
          "required": ["path", "hash"],
          "properties": {
            "path": { "type": "string", "minLength": 1 },
            "hash": { "$ref": "#/$defs/ContentHash" },
            "revision": { "type": "integer", "minimum": 1 }
          }
        },
        "compiler": {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "version"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" }
          }
        }
      }
    },
    "Asset": {
      "type": "object",
      "additionalProperties": false,
      "required": ["path", "hash", "kind"],
      "properties": {
        "path": { "type": "string", "minLength": 1 },
        "hash": { "$ref": "#/$defs/ContentHash" },
        "kind": { "type": "string", "enum": ["markdown", "json", "yaml", "audio", "video", "image", "captions", "tape"] }
      }
    },
    "KitRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "version"],
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" },
        "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" }
      }
    },
    "TransitionIn": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "duration"],
      "properties": {
        "type": { "type": "string", "enum": ["fade", "crossfade"] },
        "duration": { "$ref": "#/$defs/FrameCount" }
      }
    },
    "TransitionOut": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "duration"],
      "properties": {
        "type": { "type": "string", "enum": ["fade"] },
        "duration": { "$ref": "#/$defs/FrameCount" }
      }
    },
    "VisualItem": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "from", "duration", "kit", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "from": { "$ref": "#/$defs/Frame" },
        "duration": { "$ref": "#/$defs/FrameCount" },
        "kit": { "$ref": "#/$defs/KitRef" },
        "props": {
          "type": "object",
          "description": "Kit props, validated by the composer against the kit's own schema. An object with a string $asset key references an entry of the timeline's assets map."
        },
        "source": { "$ref": "#/$defs/SpecPath" },
        "transitionIn": { "$ref": "#/$defs/TransitionIn" },
        "transitionOut": { "$ref": "#/$defs/TransitionOut" }
      }
    },
    "AudioItem": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "from", "duration", "asset"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "from": { "$ref": "#/$defs/Frame" },
        "duration": { "$ref": "#/$defs/FrameCount" },
        "asset": { "$ref": "#/$defs/LocalId" },
        "trimStart": { "$ref": "#/$defs/Frame" },
        "gain": { "type": "number", "minimum": 0 },
        "fadeIn": { "$ref": "#/$defs/Frame" },
        "fadeOut": { "$ref": "#/$defs/Frame" },
        "source": { "$ref": "#/$defs/SpecPath" },
        "transitionIn": { "$ref": "#/$defs/TransitionIn" },
        "transitionOut": { "$ref": "#/$defs/TransitionOut" }
      }
    },
    "Duck": {
      "type": "object",
      "additionalProperties": false,
      "required": ["under", "gain"],
      "properties": {
        "under": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "$ref": "#/$defs/LocalId" }
        },
        "gain": { "type": "number", "minimum": 0, "maximum": 1 },
        "attack": { "$ref": "#/$defs/Frame" },
        "release": { "$ref": "#/$defs/Frame" }
      }
    },
    "Track": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "type", "items"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "name": { "type": "string", "minLength": 1 },
        "type": { "type": "string", "enum": ["visual", "audio"] },
        "z": { "type": "integer", "description": "Stacking order of a visual track; higher draws on top. Required on visual tracks, forbidden on audio tracks." },
        "duck": { "$ref": "#/$defs/Duck" },
        "muted": { "type": "boolean" },
        "hidden": { "type": "boolean" },
        "items": {
          "type": "array",
          "items": { "anyOf": [{ "$ref": "#/$defs/VisualItem" }, { "$ref": "#/$defs/AudioItem" }] }
        }
      }
    },
    "Chapter": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title"],
      "properties": {
        "number": { "type": "integer", "minimum": 1 },
        "title": { "type": "string", "minLength": 1 }
      }
    },
    "Section": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "from", "duration"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "from": { "$ref": "#/$defs/Frame" },
        "duration": { "$ref": "#/$defs/FrameCount" },
        "source": { "$ref": "#/$defs/SpecPath" },
        "chapter": { "$ref": "#/$defs/Chapter" }
      }
    },
    "EditTimeline": {
      "type": "object",
      "additionalProperties": false,
      "required": ["apiVersion", "kind", "episodeRef", "revision", "fps", "durationInFrames", "resolution", "assets", "tracks"],
      "properties": {
        "apiVersion": { "type": "string", "const": "studio.video/v1alpha2" },
        "kind": { "type": "string", "const": "EditTimeline" },
        "episodeRef": { "$ref": "#/$defs/EpisodeRef" },
        "revision": { "type": "integer", "minimum": 1 },
        "derivedFrom": { "$ref": "#/$defs/DerivedFrom" },
        "fps": { "type": "integer", "minimum": 1 },
        "durationInFrames": { "$ref": "#/$defs/FrameCount" },
        "resolution": { "$ref": "#/$defs/Resolution" },
        "assets": {
          "type": "object",
          "propertyNames": { "$ref": "#/$defs/LocalId" },
          "additionalProperties": { "$ref": "#/$defs/Asset" }
        },
        "tracks": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/Track" }
        },
        "sections": {
          "type": "array",
          "items": { "$ref": "#/$defs/Section" }
        },
        "metadata": { "type": "object" }
      }
    }
  }
}
```

- [ ] **Step 4: Create the reference fixture**

Create `studio/contracts/fixtures/timeline/v1alpha2/valid/lesson-excerpt.json` (30 s at 30 fps: a room, two paintings with a fade in and an 8-frame crossfade, a guide, a verse bar, two voice takes, music ducked under the voice, two sections):

```json
{
  "apiVersion": "studio.video/v1alpha2",
  "kind": "EditTimeline",
  "episodeRef": {
    "channel": "dentro-i-versi",
    "series": "long",
    "episode": "il-lampo"
  },
  "revision": 1,
  "derivedFrom": {
    "spec": {
      "path": "artifacts/lesson.json",
      "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "revision": 3
    },
    "compiler": { "id": "dentro-i-versi/long", "version": "1.0.0" }
  },
  "fps": 30,
  "durationInFrames": 900,
  "resolution": { "width": 1920, "height": 1080 },
  "assets": {
    "room": { "path": "assets/images/room.png", "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "kind": "image" },
    "painting-1": { "path": "assets/images/painting-1.png", "hash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "kind": "image" },
    "painting-2": { "path": "assets/images/painting-2.png", "hash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "kind": "image" },
    "take-titolo": { "path": "assets/takes/titolo.wav", "hash": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "kind": "audio" },
    "take-epoca": { "path": "assets/takes/epoca.wav", "hash": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "kind": "audio" },
    "timing-epoca": { "path": "artifacts/timing/epoca.json", "hash": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "kind": "json" },
    "music": { "path": "assets/music/arpa.mp3", "hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111", "kind": "audio" }
  },
  "tracks": [
    {
      "id": "background",
      "type": "visual",
      "z": 0,
      "items": [
        { "id": "room", "from": 0, "duration": 900, "kit": { "name": "sala", "version": "1.0.0" }, "props": { "background": { "$asset": "room" } } }
      ]
    },
    {
      "id": "panel",
      "type": "visual",
      "z": 10,
      "items": [
        {
          "id": "painting-1", "from": 120, "duration": 300,
          "kit": { "name": "still", "version": "1.0.0" },
          "props": { "src": { "$asset": "painting-1" }, "fit": "cover" },
          "source": "blocks[3].story.phases[0]",
          "transitionIn": { "type": "fade", "duration": 8 }
        },
        {
          "id": "painting-2", "from": 412, "duration": 300,
          "kit": { "name": "still", "version": "1.0.0" },
          "props": { "src": { "$asset": "painting-2" }, "fit": "cover" },
          "source": "blocks[3].story.phases[1]",
          "transitionIn": { "type": "crossfade", "duration": 8 }
        }
      ]
    },
    {
      "id": "guide",
      "type": "visual",
      "z": 30,
      "items": [
        { "id": "guide", "from": 0, "duration": 900, "kit": { "name": "interprete", "version": "1.0.0" }, "props": { "look": "attrice-dante", "energy": { "$asset": "timing-epoca" } } }
      ]
    },
    {
      "id": "verses",
      "type": "visual",
      "z": 40,
      "items": [
        {
          "id": "verses-epoca", "from": 120, "duration": 600,
          "kit": { "name": "verse-bar", "version": "1.0.0" },
          "props": { "lines": ["E cielo e terra si mostrò qual era"], "timing": { "$asset": "timing-epoca" } },
          "source": "blocks[3]"
        }
      ]
    },
    {
      "id": "voice",
      "type": "audio",
      "items": [
        { "id": "voice-titolo", "from": 15, "duration": 90, "asset": "take-titolo", "gain": 1, "fadeIn": 4, "fadeOut": 4, "source": "blocks[1]" },
        { "id": "voice-epoca", "from": 120, "duration": 600, "asset": "take-epoca", "gain": 1, "source": "blocks[3]" }
      ]
    },
    {
      "id": "music",
      "type": "audio",
      "duck": { "under": ["voice"], "gain": 0.4, "attack": 6, "release": 9 },
      "items": [
        { "id": "music", "from": 0, "duration": 900, "asset": "music", "gain": 0.6, "fadeIn": 30, "fadeOut": 45 }
      ]
    }
  ],
  "sections": [
    { "id": "titolo", "from": 0, "duration": 110, "source": "blocks[1]" },
    { "id": "epoca", "from": 120, "duration": 600, "source": "blocks[3]", "chapter": { "number": 1, "title": "L'epoca" } }
  ]
}
```

- [ ] **Step 5: Teach the bindings generator about versions**

In `studio/contracts/scripts/generate-ts-bindings.mjs`, replace everything from `const schemasDir = resolve(root, "schemas/v1alpha1");` down to (not including) the line `/** Resolve a $ref to { schemaName, defName } or null if external/unresolvable. */` with:

```js
const outDir = resolve(root, "bindings/ts");

// Each resource version is generated on its own: refs resolve only within a
// version, and v1alpha1 keeps its historical place at the top of bindings/ts.
const VERSIONS = [
  { dir: "schemas/v1alpha1", out: "." },
  { dir: "schemas/v1alpha2", out: "v1alpha2" },
];

const checkMode = process.argv.includes("--check");

// ── Load all schemas of one version ─────────────────────────────────────────

let schemas = {};
let idToSchema = {}; // $id → { name, defs }
let baseToName = {}; // filename → name, for short refs like "identity.schema.json"

function loadSchemas(schemasDir) {
  schemas = {};
  for (const file of readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))) {
    const schema = JSON.parse(readFileSync(resolve(schemasDir, file), "utf-8"));
    const name = file.replace(".schema.json", "");
    schemas[name] = { file, schema, name };
  }
  idToSchema = {};
  baseToName = {};
  for (const [name, entry] of Object.entries(schemas)) {
    if (entry.schema.$id) {
      idToSchema[entry.schema.$id] = { name, defs: new Set(Object.keys(entry.schema.$defs ?? {})) };
    }
    baseToName[entry.file] = name;
  }
}

```

In `toTsType`, replace

```js
      const itemType = toTsType(schema.items, context, true);
      return `${itemType}[]`;
```

with

```js
      const itemType = toTsType(schema.items, context, true);
      return itemType.includes(" | ") ? `(${itemType})[]` : `${itemType}[]`;
```

and replace

```js
  // Fallback for objects without properties
  if (type === "object") return "Record<string, unknown>";
```

with

```js
  // Maps: objects whose values all share one schema
  if (type === "object" && schema.additionalProperties && typeof schema.additionalProperties === "object") {
    return `Record<string, ${toTsType(schema.additionalProperties, context, true)}>`;
  }

  // Fallback for objects without properties
  if (type === "object") return "Record<string, unknown>";
```

At the end of the file, replace

```js
if (checkMode) {
  const tmpOut = resolve(tmpdir(), `contracts-bindings-${Date.now()}`);
  generateBindings(tmpOut);
```

with

```js
function generateAll(base) {
  for (const version of VERSIONS) {
    loadSchemas(resolve(root, version.dir));
    generateBindings(resolve(base, version.out));
  }
}

if (checkMode) {
  const tmpOut = resolve(tmpdir(), `contracts-bindings-${Date.now()}`);
  generateAll(tmpOut);
```

and in the `else` branch replace `generateBindings(outDir);` with `generateAll(outDir);`. (`diff -rq` in check mode already recurses into `v1alpha2/`.)

- [ ] **Step 6: Generate and inspect the bindings**

Run: `cd studio/contracts && npm run bindings:generate && git status --short bindings`
Expected: `?? bindings/ts/v1alpha2/` and ` M bindings/ts/provider-job.ts`, nothing else. `git diff bindings/ts/provider-job.ts` must show only `sourceRevisions?: Record<string, unknown>;` → `sourceRevisions?: Record<string, string>;` (the map fix; `rg sourceRevisions -g '!studio/contracts/**'` finds no consumer).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd studio/contracts && node --test test/edit-timeline-schema.test.mjs test/bindings.test.mjs && npm run bindings:check`
Expected: all tests pass; `PASS TypeScript bindings are up to date`.

- [ ] **Step 8: Commit**

```bash
git add studio/contracts/schemas/v1alpha2 studio/contracts/fixtures/timeline/v1alpha2 \
  studio/contracts/scripts/generate-ts-bindings.mjs studio/contracts/bindings \
  studio/contracts/test/edit-timeline-schema.test.mjs studio/contracts/test/bindings.test.mjs
git commit -m "feat(contracts): edit timeline v1alpha2 schema and bindings (avg-7zp.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `validateEditTimeline` and the invalid fixtures

**Files:**
- Create: `studio/contracts/src/edit-timeline.mjs` (validation part; Task 3 appends the migration)
- Create: `studio/contracts/src/edit-timeline.d.mts`
- Create: `studio/contracts/scripts/lib/json-patch.mjs`
- Create: 16 files in `studio/contracts/fixtures/timeline/v1alpha2/invalid/`
- Create: `studio/contracts/test/edit-timeline.test.mjs`
- Modify: `studio/contracts/package.json` (dependencies, version), `bun.lock` (via `bun install`)

**Interfaces:**
- Consumes: the schema and `lesson-excerpt.json` from Task 1 (track indices 0–5 as listed there).
- Produces: `validateEditTimeline(doc: unknown): { code, message, path }[]`, `jsonPath(pointer: string): string`, `EDIT_TIMELINE_API_VERSION`, all exported from `@studio/contracts/src/edit-timeline.mjs`; `applyPatch(doc, patch)` from `scripts/lib/json-patch.mjs`; invalid fixture format `{ "expect": "<code>", "base": "<valid fixture file name>", "patch": [RFC 6902 add/remove/replace ops] }`. Task 3 adds `migrateEditTimelineV1alpha1` to the same module; Task 4 reuses `applyPatch` and the fixture format.

- [ ] **Step 1: Make Ajv a runtime dependency**

In `studio/contracts/package.json`, set `"version": "0.2.0"` and move both Ajv packages from `devDependencies` to a new `dependencies` block, keeping their ranges:

```json
  "dependencies": {
    "ajv": "^8.18.0",
    "ajv-formats": "^3.0.1"
  }
```

Remove the now-empty `devDependencies` block. Then run `bun install` from the repository root.
Expected: `bun.lock` changes only in the `studio/contracts` workspace entry; `git status --short` shows `M bun.lock` and `M studio/contracts/package.json`.

- [ ] **Step 2: Add the patch helper**

Create `studio/contracts/scripts/lib/json-patch.mjs`:

```js
// A small RFC 6902 subset (add, remove, replace) for invalid-fixture patches.
// Each invalid edit-timeline fixture is a valid base plus the one change that
// breaks one rule, so the fixture says exactly what it tests.

function parse(pointer) {
  return pointer.split("/").slice(1).map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function applyPatch(doc, patch) {
  const out = structuredClone(doc);
  for (const op of patch) {
    const keys = parse(op.path);
    const last = keys.pop();
    let parent = out;
    for (const k of keys) {
      if (parent === null || typeof parent !== "object" || !(k in parent)) {
        throw new Error(`patch path ${op.path} does not exist`);
      }
      parent = parent[k];
    }
    const index = Array.isArray(parent) ? (last === "-" ? parent.length : Number(last)) : last;
    if (op.op === "remove") {
      if (!(index in parent)) throw new Error(`patch path ${op.path} does not exist`);
      if (Array.isArray(parent)) parent.splice(index, 1);
      else delete parent[index];
    } else if (op.op === "replace") {
      if (!(index in parent)) throw new Error(`patch path ${op.path} does not exist`);
      parent[index] = op.value;
    } else if (op.op === "add") {
      if (Array.isArray(parent)) parent.splice(index, 0, op.value);
      else parent[index] = op.value;
    } else {
      throw new Error(`unsupported patch op ${op.op}`);
    }
  }
  return out;
}
```

- [ ] **Step 3: Create the invalid fixtures**

Each is the lesson excerpt with one change. Create these 16 files in `studio/contracts/fixtures/timeline/v1alpha2/invalid/`:

`audio-item-on-visual-track.json`:

```json
{
  "expect": "item-type",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/3/items/0",
      "value": {
        "id": "verses-epoca",
        "from": 120,
        "duration": 600,
        "asset": "take-epoca"
      }
    }
  ]
}
```

`audio-item-plays-image.json`:

```json
{
  "expect": "asset-kind",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/4/items/0/asset",
      "value": "painting-1"
    }
  ]
}
```

`crossfade-first-item.json`:

```json
{
  "expect": "bad-crossfade",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/1/items/0/transitionIn",
      "value": {
        "type": "crossfade",
        "duration": 8
      }
    }
  ]
}
```

`crossfade-wrong-overlap.json`:

```json
{
  "expect": "bad-crossfade",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/1/items/1/from",
      "value": 410
    }
  ]
}
```

`duck-on-visual-track.json`:

```json
{
  "expect": "bad-duck",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "add",
      "path": "/tracks/3/duck",
      "value": {
        "under": [
          "voice"
        ],
        "gain": 0.5
      }
    }
  ]
}
```

`duck-under-missing-track.json`:

```json
{
  "expect": "bad-duck",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/5/duck/under",
      "value": [
        "narration"
      ]
    }
  ]
}
```

`duck-under-visual-track.json`:

```json
{
  "expect": "bad-duck",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/5/duck/under",
      "value": [
        "verses"
      ]
    }
  ]
}
```

`duplicate-item-id.json`:

```json
{
  "expect": "duplicate-id",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/1/items/1/id",
      "value": "painting-1"
    }
  ]
}
```

`fade-longer-than-item.json`:

```json
{
  "expect": "fade-too-long",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/4/items/0/fadeIn",
      "value": 120
    }
  ]
}
```

`item-past-end.json`:

```json
{
  "expect": "out-of-range",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/5/items/0/duration",
      "value": 901
    }
  ]
}
```

`non-integer-frame.json`:

```json
{
  "expect": "schema",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/2/items/0/from",
      "value": 0.5
    }
  ]
}
```

`overlap.json`:

```json
{
  "expect": "overlap",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "remove",
      "path": "/tracks/1/items/1/transitionIn"
    }
  ]
}
```

`section-overlap.json`:

```json
{
  "expect": "section-overlap",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/sections/1/from",
      "value": 100
    }
  ]
}
```

`unknown-asset.json`:

```json
{
  "expect": "unknown-asset",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "replace",
      "path": "/tracks/3/items/0/props/timing",
      "value": {
        "$asset": "timing-missing"
      }
    }
  ]
}
```

`visual-track-without-z.json`:

```json
{
  "expect": "missing-z",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "remove",
      "path": "/tracks/2/z"
    }
  ]
}
```

`z-on-audio-track.json`:

```json
{
  "expect": "z-on-audio",
  "base": "lesson-excerpt.json",
  "patch": [
    {
      "op": "add",
      "path": "/tracks/4/z",
      "value": 5
    }
  ]
}
```

- [ ] **Step 4: Write the failing tests**

Create `studio/contracts/test/edit-timeline.test.mjs` with the validator and `jsonPath` suites (Task 3 appends the migration suite):

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDIT_TIMELINE_API_VERSION,
  jsonPath,
  validateEditTimeline,
} from "../src/edit-timeline.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v2 = resolve(root, "fixtures/timeline/v1alpha2");
const read = (path) => JSON.parse(readFileSync(path, "utf-8"));
const lesson = () => read(resolve(v2, "valid/lesson-excerpt.json"));
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

describe("validateEditTimeline", () => {
  it("accepts every valid v1alpha2 fixture", () => {
    for (const file of readdirSync(resolve(v2, "valid"))) {
      assert.deepEqual(validateEditTimeline(read(resolve(v2, "valid", file))), [], file);
    }
  });

  it("rejects every invalid fixture with exactly its expected code", () => {
    for (const file of readdirSync(resolve(v2, "invalid"))) {
      const fixture = read(resolve(v2, "invalid", file));
      const doc = applyPatch(read(resolve(v2, "valid", fixture.base)), fixture.patch);
      assert.deepEqual(codes(validateEditTimeline(doc)), [fixture.expect], file);
    }
  });

  it("reports schema problems with a JSON path and nothing else", () => {
    const doc = lesson();
    doc.tracks[2].items[0].from = 0.5;
    const problems = validateEditTimeline(doc);
    assert.ok(problems.length > 0);
    assert.ok(problems.every((p) => p.code === "schema"));
    assert.ok(problems.some((p) => p.path === "$.tracks[2].items[0].from"));
  });

  it("collects every semantic problem, not just the first", () => {
    const doc = lesson();
    doc.tracks[4].z = 5;
    doc.sections[1].from = 100;
    assert.deepEqual(codes(validateEditTimeline(doc)), ["section-overlap", "z-on-audio"]);
  });

  it("points at the offending field", () => {
    const doc = lesson();
    delete doc.tracks[1].items[1].transitionIn;
    assert.deepEqual(validateEditTimeline(doc).map((p) => p.path), ["$.tracks[1].items[1].from"]);
  });

  it("checks overlaps in time order even when items are listed out of order", () => {
    const doc = lesson();
    doc.tracks[1].items.reverse();
    assert.deepEqual(validateEditTimeline(doc), []);
  });

  it("rejects a crossfade item that ends inside the previous item", () => {
    const doc = lesson();
    doc.tracks[1].items[1].duration = 8; // ends at 420, exactly where painting-1 ends
    assert.deepEqual(codes(validateEditTimeline(doc)), ["bad-crossfade"]);
  });

  it("finds asset references nested in arrays and next to other keys", () => {
    const doc = lesson();
    doc.tracks[3].items[0].props.layers = [{ image: { $asset: "nowhere", fit: "cover" } }];
    doc.tracks[3].items[0].props["timing-curve"] = { $asset: "also-nowhere" };
    assert.deepEqual(validateEditTimeline(doc).map((p) => p.path).sort(), [
      "$.tracks[3].items[0].props.layers[0].image.$asset",
      '$.tracks[3].items[0].props["timing-curve"].$asset',
    ]);
  });

  it("accepts an empty track and a timeline without sections", () => {
    const doc = lesson();
    doc.tracks.push({ id: "overlay", type: "visual", z: 50, items: [] });
    delete doc.sections;
    assert.deepEqual(validateEditTimeline(doc), []);
  });
});

describe("jsonPath", () => {
  it("turns JSON pointers into JSON paths", () => {
    assert.equal(jsonPath(""), "$");
    assert.equal(jsonPath("/tracks/2/items/0/from"), "$.tracks[2].items[0].from");
    assert.equal(jsonPath("/assets/take-epoca/hash"), '$.assets["take-epoca"].hash');
    assert.equal(jsonPath("/a~1b/c~0d"), '$["a/b"]["c~d"]');
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs`
Expected: FAIL — `Cannot find module '…/src/edit-timeline.mjs'`.

- [ ] **Step 6: Implement the validator**

Create `studio/contracts/src/edit-timeline.mjs`:

```js
// ---------------------------------------------------------------------------
// The edit timeline, v1alpha2 (ADR-0034)
// ---------------------------------------------------------------------------
// A layered, kit-based account of an episode: tracks as in an NLE, visual
// items that are versioned kit instances, audio items that name an asset,
// sections that map spans back to the spec they were compiled from. Every
// time is an integer frame.
//
// The JSON Schema says what each record looks like. What a schema cannot say
// — overlaps on a track, references that must resolve, spans that must fit —
// is checked here, so the series compiler, the composer and the web all run
// the same rules through one function. Kit props are NOT checked here: only
// the composer knows a kit's schema.
//
// Every problem is reported, not just the first, as { code, message, path }
// with a JSON path such as $.tracks[2].items[5].from.
// ---------------------------------------------------------------------------

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/v1alpha2/edit-timeline.schema.json" with { type: "json" };

export const EDIT_TIMELINE_API_VERSION = "studio.video/v1alpha2";

/** Asset kinds an audio item may play: audio files, and the sound of a video. */
const AUDIBLE_KINDS = new Set(["audio", "video"]);

let compiled = null;

function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/EditTimeline`);
  }
  return compiled;
}

/** "/tracks/2/items/0/from" → "$.tracks[2].items[0].from". */
export function jsonPath(pointer) {
  let out = "$";
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(key) ? `[${key}]` : member(key);
  }
  return out;
}

function member(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function issue(code, path, message) {
  return { code, message, path };
}

const trackPath = (ti) => `$.tracks[${ti}]`;
const itemPath = (ti, ii) => `$.tracks[${ti}].items[${ii}]`;
const isAudioItem = (item) => Object.hasOwn(item, "asset");

/**
 * Validate a v1alpha2 edit timeline.
 * @returns {{code: string, message: string, path: string}[]} every problem; empty when valid.
 */
export function validateEditTimeline(doc) {
  const validate = schemaValidator();
  if (!validate(doc)) {
    // Semantic checks assume the shape the schema guarantees; report shape first.
    return validate.errors.map((e) =>
      issue("schema", jsonPath(e.instancePath), `${e.instancePath || "/"} ${e.message}`),
    );
  }
  return [
    ...checkIds(doc),
    ...checkRanges(doc),
    ...checkTracks(doc),
    ...checkAssets(doc),
    ...checkOverlaps(doc),
    ...checkSections(doc),
    ...checkFades(doc),
  ];
}

function checkIds(doc) {
  const out = [];
  const registry = (kind) => {
    const seen = new Map();
    return (id, path) => {
      if (seen.has(id)) out.push(issue("duplicate-id", path, `${kind} id "${id}" is already used at ${seen.get(id)}`));
      else seen.set(id, path);
    };
  };
  const track = registry("track");
  const item = registry("item");
  const section = registry("section");
  doc.tracks.forEach((t, ti) => {
    track(t.id, `${trackPath(ti)}.id`);
    t.items.forEach((it, ii) => item(it.id, `${itemPath(ti, ii)}.id`));
  });
  (doc.sections ?? []).forEach((s, si) => section(s.id, `$.sections[${si}].id`));
  return out;
}

function checkRanges(doc) {
  const out = [];
  const end = doc.durationInFrames;
  const check = (span, path, what) => {
    if (span.from + span.duration > end) {
      out.push(issue("out-of-range", `${path}.duration`, `${what} ends at frame ${span.from + span.duration}, after the timeline ends at ${end}`));
    }
  };
  doc.tracks.forEach((t, ti) => t.items.forEach((it, ii) => check(it, itemPath(ti, ii), `item "${it.id}"`)));
  (doc.sections ?? []).forEach((s, si) => check(s, `$.sections[${si}]`, `section "${s.id}"`));
  return out;
}

function checkTracks(doc) {
  const out = [];
  const byId = new Map(doc.tracks.map((t) => [t.id, t]));
  doc.tracks.forEach((t, ti) => {
    const p = trackPath(ti);
    if (t.type === "visual" && t.z === undefined) {
      out.push(issue("missing-z", p, `visual track "${t.id}" needs a z`));
    }
    if (t.type === "audio" && t.z !== undefined) {
      out.push(issue("z-on-audio", `${p}.z`, `audio track "${t.id}" cannot have a z`));
    }
    if (t.duck) {
      if (t.type !== "audio") {
        out.push(issue("bad-duck", `${p}.duck`, `only an audio track can duck; "${t.id}" is ${t.type}`));
      }
      t.duck.under.forEach((id, ui) => {
        const target = byId.get(id);
        if (id === t.id || !target || target.type !== "audio") {
          const why = id === t.id ? "itself" : !target ? "a track that does not exist" : `a ${target.type} track`;
          out.push(issue("bad-duck", `${p}.duck.under[${ui}]`, `track "${t.id}" ducks under ${why} ("${id}")`));
        }
      });
    }
    t.items.forEach((it, ii) => {
      const audio = isAudioItem(it);
      if ((t.type === "audio") !== audio) {
        out.push(issue("item-type", itemPath(ti, ii), `${t.type} track "${t.id}" holds ${audio ? "an audio" : "a visual"} item`));
      }
    });
  });
  return out;
}

/** Every object with a string `$asset` key inside `value`, with its JSON path. */
function assetRefs(value, path, out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assetRefs(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    if (typeof value.$asset === "string") out.push({ id: value.$asset, path: `${path}.$asset` });
    for (const [k, v] of Object.entries(value)) {
      if (k !== "$asset") assetRefs(v, `${path}${member(k)}`, out);
    }
  }
  return out;
}

function checkAssets(doc) {
  const out = [];
  doc.tracks.forEach((t, ti) =>
    t.items.forEach((it, ii) => {
      const p = itemPath(ti, ii);
      if (isAudioItem(it)) {
        const asset = Object.hasOwn(doc.assets, it.asset) ? doc.assets[it.asset] : null;
        if (!asset) out.push(issue("unknown-asset", `${p}.asset`, `asset "${it.asset}" is not declared in assets`));
        else if (!AUDIBLE_KINDS.has(asset.kind)) {
          out.push(issue("asset-kind", `${p}.asset`, `audio item "${it.id}" plays asset "${it.asset}" of kind ${asset.kind}`));
        }
      } else {
        for (const ref of assetRefs(it.props, `${p}.props`)) {
          if (!Object.hasOwn(doc.assets, ref.id)) {
            out.push(issue("unknown-asset", ref.path, `asset "${ref.id}" is not declared in assets`));
          }
        }
      }
    }),
  );
  return out;
}

function checkOverlaps(doc) {
  const out = [];
  doc.tracks.forEach((t, ti) => {
    const order = t.items.map((it, ii) => ({ it, ii })).sort((a, b) => a.it.from - b.it.from || a.ii - b.ii);
    let lastEnd = null;
    for (const { it, ii } of order) {
      const p = itemPath(ti, ii);
      const end = it.from + it.duration;
      const crossfade = it.transitionIn?.type === "crossfade" ? it.transitionIn.duration : null;
      if (lastEnd === null || it.from >= lastEnd) {
        if (crossfade !== null) {
          const why = lastEnd === null ? "it is the first item on its track" : "it does not overlap the previous item";
          out.push(issue("bad-crossfade", `${p}.transitionIn`, `item "${it.id}" crossfades but ${why}`));
        }
      } else if (crossfade !== null) {
        const overlap = lastEnd - it.from;
        if (overlap !== crossfade || end <= lastEnd) {
          out.push(issue("bad-crossfade", `${p}.transitionIn`,
            `item "${it.id}" crossfades over ${crossfade} frames but overlaps the previous item by ${overlap}` +
            (end <= lastEnd ? " and ends inside it" : "")));
        }
      } else {
        out.push(issue("overlap", `${p}.from`, `item "${it.id}" starts at ${it.from}, before the previous item on track "${t.id}" ends at ${lastEnd}`));
      }
      lastEnd = lastEnd === null ? end : Math.max(lastEnd, end);
    }
  });
  return out;
}

function checkSections(doc) {
  const out = [];
  let previous = null;
  (doc.sections ?? []).forEach((s, si) => {
    if (previous && s.from < previous.from + previous.duration) {
      out.push(issue("section-overlap", `$.sections[${si}].from`,
        `section "${s.id}" starts at ${s.from}, before section "${previous.id}" ends at ${previous.from + previous.duration}`));
    }
    if (!previous || s.from + s.duration > previous.from + previous.duration) previous = s;
  });
  return out;
}

function checkFades(doc) {
  const out = [];
  doc.tracks.forEach((t, ti) =>
    t.items.forEach((it, ii) => {
      const p = itemPath(ti, ii);
      for (const key of ["fadeIn", "fadeOut"]) {
        if (it[key] !== undefined && it[key] > it.duration) {
          out.push(issue("fade-too-long", `${p}.${key}`, `${key} of ${it[key]} frames is longer than item "${it.id}" (${it.duration})`));
        }
      }
      for (const key of ["transitionIn", "transitionOut"]) {
        if (it[key] && it[key].duration > it.duration) {
          out.push(issue("fade-too-long", `${p}.${key}.duration`, `${key} of ${it[key].duration} frames is longer than item "${it.id}" (${it.duration})`));
        }
      }
    }),
  );
  return out;
}
```

Create `studio/contracts/src/edit-timeline.d.mts` (Task 3 appends the migration declaration):

```ts
// Type declarations for the v1alpha2 edit timeline checks and migration (ADR-0034).
// The document types themselves are generated from the schema into
// bindings/ts/v1alpha2/edit-timeline.ts.

export declare const EDIT_TIMELINE_API_VERSION: "studio.video/v1alpha2";

export type EditTimelineProblemCode =
  | "schema"
  | "duplicate-id"
  | "out-of-range"
  | "missing-z"
  | "z-on-audio"
  | "bad-duck"
  | "item-type"
  | "unknown-asset"
  | "asset-kind"
  | "overlap"
  | "bad-crossfade"
  | "section-overlap"
  | "fade-too-long";

/** One problem, located by a JSON path such as `$.tracks[2].items[5].from`. */
export interface EditTimelineProblem {
  code: EditTimelineProblemCode;
  message: string;
  path: string;
}

/** Every problem in `doc`; an empty array means the timeline is structurally valid. */
export declare function validateEditTimeline(doc: unknown): EditTimelineProblem[];

/** `/tracks/2/items/0/from` → `$.tracks[2].items[0].from`. */
export declare function jsonPath(pointer: string): string;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs`
Expected: PASS, 10 tests in 2 suites, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add bun.lock studio/contracts/package.json studio/contracts/src/edit-timeline.mjs \
  studio/contracts/src/edit-timeline.d.mts studio/contracts/scripts/lib/json-patch.mjs \
  studio/contracts/fixtures/timeline/v1alpha2/invalid studio/contracts/test/edit-timeline.test.mjs
git commit -m "feat(contracts): validate v1alpha2 edit timelines with one shared function (avg-7zp.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration from v1alpha1

**Files:**
- Modify: `studio/contracts/src/edit-timeline.mjs` (append)
- Modify: `studio/contracts/src/edit-timeline.d.mts` (append)
- Modify: `studio/contracts/test/edit-timeline.test.mjs` (import + append a suite)
- Create: `studio/contracts/fixtures/timeline/v1alpha2/valid/explainer.json`

**Interfaces:**
- Consumes: `EDIT_TIMELINE_API_VERSION`, `validateEditTimeline` (Task 2); v1alpha1 `fixtures/timeline/valid/basic.json` (unchanged).
- Produces: `migrateEditTimelineV1alpha1(doc, { assetHashes }): EditTimeline` — throws `TypeError` for a non-v1alpha1 input, `RangeError` for a fractional fps or a caption naming a missing segment, `Error("no content hash for: …")` for missing hashes. `explainer.json` is a second valid fixture, so Task 4's check script picks it up automatically.

- [ ] **Step 1: Write the expected fixture**

Create `studio/contracts/fixtures/timeline/v1alpha2/valid/explainer.json` — `basic.json` by hand at 30 fps: the 0.5 s dissolve becomes a 15-frame crossfade (scene 1 lengthened from 255 to 270 frames so scene 2 keeps its start), the 0.8 s fade becomes a 24-frame `transitionOut`, captions keep their segment-relative start, image segment audio is dropped:

```json
{
  "apiVersion": "studio.video/v1alpha2",
  "kind": "EditTimeline",
  "episodeRef": {
    "channel": "childrens",
    "series": "fairy-tales",
    "episode": "red-riding-hood"
  },
  "revision": 1,
  "fps": 30,
  "durationInFrames": 765,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "assets": {
    "scene-01-woods": {
      "path": "assets/images/scene-01-woods.png",
      "hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "kind": "image"
    },
    "scene-02-grandma": {
      "path": "assets/images/scene-02-grandma.png",
      "hash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "kind": "image"
    },
    "scene-03-ending": {
      "path": "assets/images/scene-03-ending.png",
      "hash": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      "kind": "image"
    }
  },
  "tracks": [
    {
      "id": "main",
      "type": "visual",
      "z": 0,
      "items": [
        {
          "id": "scene-01-woods",
          "from": 0,
          "duration": 270,
          "kit": {
            "name": "still",
            "version": "1.0.0"
          },
          "props": {
            "src": {
              "$asset": "scene-01-woods"
            }
          }
        },
        {
          "id": "scene-02-grandma",
          "from": 255,
          "duration": 300,
          "kit": {
            "name": "still",
            "version": "1.0.0"
          },
          "props": {
            "src": {
              "$asset": "scene-02-grandma"
            },
            "fit": "cover",
            "scale": 1.1
          },
          "transitionIn": {
            "type": "crossfade",
            "duration": 15
          },
          "transitionOut": {
            "type": "fade",
            "duration": 24
          }
        },
        {
          "id": "scene-03-ending",
          "from": 555,
          "duration": 210,
          "kit": {
            "name": "still",
            "version": "1.0.0"
          },
          "props": {
            "src": {
              "$asset": "scene-03-ending"
            }
          }
        }
      ]
    },
    {
      "id": "captions",
      "type": "visual",
      "z": 20,
      "items": [
        {
          "id": "scene-01-woods-caption",
          "from": 15,
          "duration": 225,
          "kit": {
            "name": "captions",
            "version": "1.0.0"
          },
          "props": {
            "text": "Once upon a time, in a village by the woods...",
            "position": "bottom"
          }
        },
        {
          "id": "scene-02-grandma-caption",
          "from": 270,
          "duration": 270,
          "kit": {
            "name": "captions",
            "version": "1.0.0"
          },
          "props": {
            "text": "Little Red Riding Hood knocked at the door.",
            "position": "bottom"
          }
        },
        {
          "id": "scene-03-ending-caption",
          "from": 585,
          "duration": 165,
          "kit": {
            "name": "captions",
            "version": "1.0.0"
          },
          "props": {
            "text": "And they all lived happily ever after.",
            "position": "center",
            "fontSize": 48
          }
        }
      ]
    }
  ],
  "metadata": {
    "migratedFrom": "studio.video/v1alpha1"
  }
}
```

- [ ] **Step 2: Write the failing tests**

In `studio/contracts/test/edit-timeline.test.mjs`, add `migrateEditTimelineV1alpha1` to the import from `../src/edit-timeline.mjs`, then append:

```js
describe("migrateEditTimelineV1alpha1", () => {
  const basic = () => read(resolve(root, "fixtures/timeline/valid/basic.json"));
  const hashes = {
    "assets/images/scene-01-woods.png": `sha256:${"1".repeat(64)}`,
    "assets/images/scene-02-grandma.png": `sha256:${"2".repeat(64)}`,
    "assets/images/scene-03-ending.png": `sha256:${"3".repeat(64)}`,
  };

  it("maps the v1alpha1 basic fixture to the v1alpha2 explainer fixture", () => {
    const migrated = migrateEditTimelineV1alpha1(basic(), { assetHashes: hashes });
    assert.deepEqual(migrated, read(resolve(v2, "valid/explainer.json")));
    assert.equal(migrated.apiVersion, EDIT_TIMELINE_API_VERSION);
    assert.deepEqual(validateEditTimeline(migrated), []);
  });

  it("refuses to invent a content hash", () => {
    const partial = { ...hashes };
    delete partial["assets/images/scene-02-grandma.png"];
    assert.throws(
      () => migrateEditTimelineV1alpha1(basic(), { assetHashes: partial }),
      /no content hash for: assets\/images\/scene-02-grandma\.png/,
    );
  });

  it("refuses a fractional frame rate", () => {
    assert.throws(() => migrateEditTimelineV1alpha1({ ...basic(), fps: 29.97 }, { assetHashes: hashes }), /not an integer/);
  });

  it("refuses anything but a v1alpha1 timeline", () => {
    assert.throws(() => migrateEditTimelineV1alpha1(lesson(), { assetHashes: hashes }), /v1alpha1 EditTimeline/);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs`
Expected: FAIL — `migrateEditTimelineV1alpha1` is not exported (`SyntaxError: The requested module … does not provide an export named 'migrateEditTimelineV1alpha1'`).

- [ ] **Step 4: Implement the migration**

Append to `studio/contracts/src/edit-timeline.mjs`:

```js
// ---------------------------------------------------------------------------
// Migration from v1alpha1
// ---------------------------------------------------------------------------
// v1alpha1 is a sequence of segments in seconds. Each segment becomes a
// `still` (or `clip`, for video) item on one visual track; captions become a
// `captions` track; a dissolve or wipe into the next segment becomes a
// crossfade that keeps every segment's start time (the earlier item is
// lengthened), a fade becomes a transitionOut. The sound of a video segment
// becomes an audio item. Segment audio settings on images are dropped: an
// image has no sound. v1alpha2 requires a content hash for every asset and
// v1alpha1 had none, so the caller supplies them; a missing one is an error.

const CAPTION_PROPS = ["position", "font", "fontSize", "color", "backgroundColor"];

/**
 * @param {object} doc a studio.video/v1alpha1 EditTimeline
 * @param {{assetHashes?: Record<string, string>}} options content hash per sourceAsset path
 * @returns {object} a studio.video/v1alpha2 EditTimeline
 */
export function migrateEditTimelineV1alpha1(doc, { assetHashes = {} } = {}) {
  if (doc?.apiVersion !== "studio.video/v1alpha1" || doc?.kind !== "EditTimeline") {
    throw new TypeError("expected a studio.video/v1alpha1 EditTimeline");
  }
  if (!Number.isInteger(doc.fps)) {
    throw new RangeError(`fps ${doc.fps} is not an integer; v1alpha2 counts whole frames`);
  }
  const frames = (seconds) => Math.round(seconds * doc.fps);

  const missing = [...new Set(doc.segments.map((s) => s.sourceAsset))].filter((p) => !assetHashes[p]);
  if (missing.length > 0) throw new Error(`no content hash for: ${missing.join(", ")}`);

  const assets = {};
  const main = [];
  const captions = [];
  const sound = [];

  doc.segments.forEach((s) => {
    const kind = s.sourceKind === "video" ? "video" : "image";
    const from = frames(s.startSec);
    const duration = frames(s.durationSec);
    assets[s.id] = { path: s.sourceAsset, hash: assetHashes[s.sourceAsset], kind };
    const props = { src: { $asset: s.id } };
    if (s.transform?.fit) props.fit = s.transform.fit;
    if (s.transform?.scale) props.scale = s.transform.scale;
    main.push({ id: s.id, from, duration, kit: { name: kind === "video" ? "clip" : "still", version: "1.0.0" }, props });
    if (s.caption) captions.push(captionItem(`${s.id}-caption`, from + frames(s.caption.start), frames(s.caption.duration), s.caption));
    if (kind === "video" && s.audio && !s.audio.mute) {
      sound.push(compact({
        id: `${s.id}-sound`, from, duration, asset: s.id,
        gain: s.audio.volume,
        fadeIn: s.audio.fadeIn === undefined ? undefined : frames(s.audio.fadeIn),
        fadeOut: s.audio.fadeOut === undefined ? undefined : frames(s.audio.fadeOut),
      }));
    }
  });

  const transitions = new Map(doc.segments.map((s, i) => [i, s.transition]));
  for (const t of doc.transitions ?? []) transitions.set(t.afterSegmentIndex, t);
  for (const [i, t] of transitions) {
    if (!t || t.type === "none" || !main[i]) continue;
    const d = frames(t.duration);
    if (d <= 0) continue;
    const next = main[i + 1];
    if ((t.type === "dissolve" || t.type === "wipe") && next) {
      main[i].duration = next.from + d - main[i].from;
      next.transitionIn = { type: "crossfade", duration: d };
    } else {
      main[i].transitionOut = { type: "fade", duration: d };
    }
  }

  (doc.captions ?? []).forEach((c, ci) => {
    const segment = main[c.segmentIndex];
    if (!segment) throw new RangeError(`captions[${ci}] names segment ${c.segmentIndex}, which does not exist`);
    captions.push(captionItem(`caption-${ci + 1}`, segment.from + frames(c.start), frames(c.duration), c));
  });

  const tracks = [{ id: "main", type: "visual", z: 0, items: main }];
  if (captions.length > 0) tracks.push({ id: "captions", type: "visual", z: 20, items: captions });
  if (sound.length > 0) tracks.push({ id: "sound", type: "audio", items: sound });

  const durationInFrames = Math.max(...tracks.flatMap((t) => t.items.map((it) => it.from + it.duration)));

  return {
    apiVersion: EDIT_TIMELINE_API_VERSION,
    kind: "EditTimeline",
    episodeRef: doc.episodeRef,
    revision: doc.revision,
    fps: doc.fps,
    durationInFrames,
    resolution: doc.resolution,
    assets,
    tracks,
    metadata: { migratedFrom: "studio.video/v1alpha1" },
  };
}

function captionItem(id, from, duration, caption) {
  const props = { text: caption.text };
  for (const key of CAPTION_PROPS) if (caption[key] !== undefined) props[key] = caption[key];
  return { id, from, duration, kit: { name: "captions", version: "1.0.0" }, props };
}

function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
}
```

Append to `studio/contracts/src/edit-timeline.d.mts`:

```ts
/**
 * Convert a `studio.video/v1alpha1` timeline. Throws when a source asset has no
 * hash in `assetHashes`, when fps is not an integer, or when `doc` is not v1alpha1.
 */
export declare function migrateEditTimelineV1alpha1(
  doc: unknown,
  options?: { assetHashes?: Record<string, string> },
): EditTimeline;
```

and add `import type { EditTimeline } from "../bindings/ts/v1alpha2/edit-timeline.ts";` below its header comment.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs`
Expected: PASS, 14 tests in 3 suites. The first suite also re-validates `explainer.json` as a valid fixture.

- [ ] **Step 6: Commit**

```bash
git add studio/contracts/src/edit-timeline.mjs studio/contracts/src/edit-timeline.d.mts \
  studio/contracts/test/edit-timeline.test.mjs studio/contracts/fixtures/timeline/v1alpha2/valid/explainer.json
git commit -m "feat(contracts): migrate v1alpha1 timelines to v1alpha2 (avg-7zp.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `check:schemas` covers v1alpha2

**Files:**
- Modify: `studio/contracts/scripts/check-timeline-fixtures.mjs` (imports at the top; replace the final `// ── Report ──` block)

**Interfaces:**
- Consumes: `validateEditTimeline` (Task 2), `applyPatch` and the invalid-fixture format (Task 2), every file in `fixtures/timeline/v1alpha2/valid|invalid/`.
- Produces: `npm run check:schemas` fails if any v1alpha2 valid fixture has a problem or any invalid fixture fails with anything but exactly its `expect` code.

- [ ] **Step 1: Show the gap**

Temporarily break a fixture to confirm the script does not yet look at v1alpha2: in `fixtures/timeline/v1alpha2/invalid/overlap.json` change `"expect": "overlap"` to `"expect": "schema"`, run `cd studio/contracts && node scripts/check-timeline-fixtures.mjs; echo exit=$?`.
Expected: `exit=0` (the script ignores v1alpha2). Keep the broken value for Step 3.

- [ ] **Step 2: Extend the script**

In `studio/contracts/scripts/check-timeline-fixtures.mjs`, change `import { readFileSync } from "node:fs";` to `import { readFileSync, readdirSync } from "node:fs";`, and below `import addFormats from "ajv-formats";` add:

```js
import { validateEditTimeline } from "../src/edit-timeline.mjs";
import { applyPatch } from "./lib/json-patch.mjs";
```

Replace everything from `// ── Report ──` to the end of the file with:

```js
// ── v1alpha2 fixtures ───────────────────────────────────────────────────────
// Valid fixtures must produce no problem at all. Each invalid fixture is a
// valid base plus a patch, and must fail with exactly the code it names.

const v2Dir = resolve(root, "fixtures/timeline/v1alpha2");
const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));
const v2Valid = readdirSync(resolve(v2Dir, "valid")).filter((f) => f.endsWith(".json"));
const v2Invalid = readdirSync(resolve(v2Dir, "invalid")).filter((f) => f.endsWith(".json"));

for (const file of v2Valid) {
  const problems = validateEditTimeline(readJson(resolve(v2Dir, "valid", file)));
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL v1alpha2 valid ${file}:`, problems.map((p) => `${p.code} ${p.path}`).join("; "));
  } else {
    console.log(`PASS v1alpha2 valid ${file}`);
  }
}

for (const file of v2Invalid) {
  const fixture = readJson(resolve(v2Dir, "invalid", file));
  const doc = applyPatch(readJson(resolve(v2Dir, "valid", fixture.base)), fixture.patch);
  const found = [...new Set(validateEditTimeline(doc).map((p) => p.code))];
  if (found.length !== 1 || found[0] !== fixture.expect) {
    failures += 1;
    console.error(`FAIL v1alpha2 invalid ${file}: expected [${fixture.expect}], got [${found.join(", ")}]`);
  } else {
    console.log(`PASS v1alpha2 invalid ${file} rejected with ${fixture.expect}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures) {
  console.error(`\n${failures} timeline check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(
    `\nv1alpha1: 1 valid and ${invalidFixtures.length} invalid fixtures passed; ` +
      `v1alpha2: ${v2Valid.length} valid and ${v2Invalid.length} invalid fixtures passed`,
  );
}
```

- [ ] **Step 3: Verify it catches the broken fixture, then restore it**

Run: `cd studio/contracts && node scripts/check-timeline-fixtures.mjs; echo exit=$?`
Expected: `FAIL v1alpha2 invalid overlap.json: expected [schema], got [overlap]` and `exit=1`.
Restore `"expect": "overlap"` in `overlap.json`, run again.
Expected: `v1alpha1: 1 valid and 2 invalid fixtures passed; v1alpha2: 2 valid and 16 invalid fixtures passed`, `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add studio/contracts/scripts/check-timeline-fixtures.mjs
git commit -m "test(contracts): check:schemas validates v1alpha2 timeline fixtures (avg-7zp.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ADR-0034, documentation, full check

**Files:**
- Create: `docs/adr/0034-a-layered-kit-based-edit-timeline.md`
- Modify: `docs/adr/0009-ffmpeg-compiles-a-typed-edit-timeline.md`
- Modify: `docs/index.md` (decision records paragraph and table)
- Modify: `studio/contracts/README.md` (schema families table)
- Modify: `studio/contracts/docs/contract-catalog.md` (the `timeline` row)
- Modify: `studio/contracts/schemas/v1alpha1/edit-timeline.schema.json` — **description only**, to mark it deprecated (a documentation change, allowed by the compatibility policy)

**Interfaces:**
- Consumes: everything above.
- Produces: the decision record later tasks (`avg-tk7.*`, `avg-jao.2`) cite.

- [ ] **Step 1: Write ADR-0034**

Create `docs/adr/0034-a-layered-kit-based-edit-timeline.md`:

```markdown
# ADR-0034: A layered, kit-based edit timeline

## Status

Accepted. Supersedes [ADR-0009](0009-ffmpeg-compiles-a-typed-edit-timeline).
Contract: `studio.video/v1alpha2` in `studio/contracts`. The Remotion composer
that renders it is `avg-tk7`; the series compilers that produce it are
`avg-jao`.

## Context

ADR-0009 made the edit timeline the declarative source of a render and kept
agent-authored shell out of production. Its timeline is a sequence of
segments in seconds: one asset each, an optional caption, a transition. Nothing
compiles it, and it cannot describe layered productions: a persistent verse
bar, a character gesturing on a word, an apparition over a panel, sound
effects, music ducked under the voice — all at once.

## Decision

- **The timeline is derived, never edited.** A deterministic series compiler
  produces it from the episode spec, which is what people edit. The timeline
  records what it was derived from (`derivedFrom`: spec hash, compiler and
  version), so a change to either makes it stale.
- **Tracks, as in an NLE.** Visual tracks have a `z`; audio tracks may duck
  under others. Items never overlap within a track, except a declared
  crossfade of exactly its duration. Richer transitions are kits on a higher
  track.
- **Visual items are versioned kit instances** (`kit: {name, version}`,
  `props`). Kits are React components that live in the repository, never in
  `library/`; a timeline references them by name and version.
- **Every file is declared once** in `assets` with a content hash; props
  reference one with `{ "$asset": "<id>" }`.
- **Integer frames everywhere.** Seconds exist only in the spec and the
  compiler.
- **Sections with provenance.** Spans map back to the part of the spec they
  came from (`source`, a JSON path), and so may items. This is what partial
  staleness, partial rendering, version comparison, anchored feedback and
  chapters are built on.
- **Loudness is not in the timeline.** Targets belong to the output profile
  and the post-render FFmpeg pass.
- **Validation is split.** The contract checks structure (`validateEditTimeline`
  in `studio/contracts/src/edit-timeline.mjs`); the composer checks kits, props
  and asset files.

## Consequences

The agent still never emits executable render instructions: it writes a spec,
a compiler writes the timeline, a reviewed kit library renders it. A new
visual needs a new kit through the normal review path. v1alpha1 stays frozen
for migration (`migrateEditTimelineV1alpha1`), and `packages/video-composer`
keeps reading it until the cutover (`avg-tk7.6`).
```

- [ ] **Step 2: Mark ADR-0009 superseded**

Append to `docs/adr/0009-ffmpeg-compiles-a-typed-edit-timeline.md`:

```markdown

**Superseded by [ADR-0034](0034-a-layered-kit-based-edit-timeline).** The principle stands — editorial intent is a declarative, reviewable timeline, never agent-authored render commands — but the timeline is now layered and kit-based, and Remotion renders it.
```

- [ ] **Step 3: Update the docs that list decisions and schemas**

In `docs/index.md`: change the link target `./adr/0033-blender-is-a-reusable-scene-provider` and the text `holds 33 accepted` in the "Decision records" paragraph to `./adr/0034-a-layered-kit-based-edit-timeline` and `holds 34 accepted`; add a table row after the `0032` row:

```markdown
| [0034](./adr/0034-a-layered-kit-based-edit-timeline) | The edit timeline is layered, kit-based and derived from the spec |
```

and under the table, after the ADR-0022 sentence, add: `ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.`

In `studio/contracts/README.md`, replace the row

```markdown
| `edit-timeline.schema.json` | Declarative timeline of visual/audio segments |
```

with

```markdown
| `edit-timeline.schema.json` | Edit timeline. `v1alpha2/`: NLE tracks of kit instances and audio, sections with spec provenance, integer frames (ADR-0034), checked by `src/edit-timeline.mjs`. `v1alpha1/`: deprecated segment list |
```

In `studio/contracts/docs/contract-catalog.md`, in the `timeline` row replace `Canvas, scene placements, visual primitives, overlays, captions, audio mix, output profile` with `v1alpha2: tracks of versioned kit instances and audio items, ducking, sections with spec provenance, integer frames (ADR-0034)`.

In `studio/contracts/schemas/v1alpha1/edit-timeline.schema.json`, prepend `Deprecated: superseded by v1alpha2 (ADR-0034); kept frozen for migration. ` to the top-level `description` string. Change nothing else in that file.

- [ ] **Step 4: Run every check**

Run: `cd studio/contracts && npm run check`
Expected: compatibility, all `check:schemas` scripts (including the new v1alpha2 lines), `PASS TypeScript bindings are up to date`, and `node --test` with 0 failures.

Run: `npm run docs:build` from the repository root.
Expected: build succeeds (it fails on dead internal links, so the ADR links are verified).

Run: `npm run check` from the repository root.
Expected: passes. If the only failure is `studio/agent`'s `vector-animation` test because `rsvg-convert` is not installed, that failure is pre-existing and unrelated (see PR #11's notes); report it, do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0034-a-layered-kit-based-edit-timeline.md docs/adr/0009-ffmpeg-compiles-a-typed-edit-timeline.md \
  docs/index.md studio/contracts/README.md studio/contracts/docs/contract-catalog.md \
  studio/contracts/schemas/v1alpha1/edit-timeline.schema.json
git commit -m "docs: ADR-0034, a layered, kit-based edit timeline supersedes ADR-0009 (avg-7zp.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

