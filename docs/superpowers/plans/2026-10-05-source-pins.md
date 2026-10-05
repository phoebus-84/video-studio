# Channel Sources and Source Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an episode pin shared material — a channel source `library/<channel>/sources/<name>/` or another episode of the same channel — with an inventory, so that a changed source makes the stages that read it (and their downstream) stale, and accepting the new version is an explicit, journaled renewal.

**Architecture:** `studio/contracts` gains the `SourcePin` kind, `sourcePath`, a `sources` channel folder, and pure-ish functions (`inventory`, `verifyPin` — stat first, hash only what moved). `studio/runtime` gains `src/execution/pins.ts`: `pinStaleness` (read-only, called by `ExecutionService.status`), `addPin`, `verifyPins`, `renewPin` (journals `staleness-marked`, trigger `pin:<id>`), exposed as service methods and as `vpr pin add|verify|renew`.

**Tech Stack:** Node 22, contracts in ESM `.mjs` with `.d.mts`, runtime in TypeScript (NodeNext) with vitest, Ajv 8 strict.

**Spec:** `docs/superpowers/specs/2026-10-05-source-pins-design.md`

## Global Constraints

- `$id` exactly `https://video.studio/schemas/v1alpha1/source-pin.schema.json`; pins live at `<episode>/source/pins/<id>.json` (`PINS_DIR = "source/pins"`).
- Same channel only. An episode's runtime state (`journal/`, `attempts/`, `reviews/`, `output/` at the top of a source) and any name starting with `.` or `_` are never inventoried. Symlinks are refused.
- `status()` writes nothing. Verification stats every file and hashes only those whose size or mtime moved.
- Stale reasons, exactly: `"<stage>" is stale: source "<name>" changed since it was pinned: <changes> — renew the pin to accept the new version` (`episode "<series>/<episode>"` for an episode source; at most five changes then `and N more`); `"<stage>" is stale: source "<name>" pinned as "<id>" no longer exists`; `"<stage>" is stale: pin "<file>" is not valid: <path> <message>`; after renewal `"<stage>" is stale: source pin "<id>" was renewed after it ran`.
- Renewal journals `staleness-marked` with `data: { stageId: "pin:<id>", trigger: "pin:<id>", affected: [{ stageId, path }], changed }` only when something changed; any actor may renew (CLI: operator → `human`, otherwise `pi`).
- Refusal codes: `unknown-source`, `unknown-stage`, `self-pin`, `pin-exists`, `unknown-pin`, `invalid-pin`. CLI exit: `unknown-stage` and usage errors → 1 (`EX_USAGE`), other refusals → 2 (`EX_RUNTIME`).
- `@studio/contracts` 0.5.0 → 0.6.0. The runtime's `npm run lint` already reports 45 errors on `main`; new and changed code must add none.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A source that is itself an episode with runtime state (journal, reviews) must not report those as changes — only the top-level runtime folders are excluded; a `journal/` deeper inside a source is content. Checked by reading `inventory`/`currentPaths` (the `top` flag).
- Two pins whose readers overlap: the first reason wins per stage (`reasons.has(id)`); a stage must still be reported stale.
- A pin whose `usedBy` names a stage the pipeline no longer has: `affectedBy` silently drops unknown readers — check that a pin with only unknown readers does not hide anything else.
- `mtimeMs` precision: filesystems that report fractional mtimes must compare equal to the stored value (the stored value is the same `lstat` number).
- `renewPin` on a source with no change journals nothing and still rewrites `pinnedAt` — acceptable, but confirm no stage is affected.

## File map

| File | Responsibility | Task |
|---|---|---|
| `studio/contracts/src/layout.mjs`, `layout.d.mts` | `sources` channel folder, `sourcePath` | 1 |
| `studio/contracts/schemas/v1alpha1/source-pin.schema.json` | Shape | 1 |
| `studio/contracts/src/source-pins.mjs`, `source-pins.d.mts` | `inventory`, `verifyPin`, `sourceDir`, `validateSourcePin`, `describeChanges` | 1 |
| `studio/contracts/test/source-pins.test.mjs` | Contract tests | 1 |
| `studio/contracts/fixtures/source-pin/*.json`, `scripts/check-source-pin-fixtures.mjs` | Schema fixtures | 1 |
| `studio/contracts/bindings/ts/source-pin.ts` | Generated | 1 |
| `studio/runtime/src/execution/pins.ts` | Pin staleness, add, verify, renew | 2 |
| `studio/runtime/src/execution/service.ts` | Hook into `status`, service methods | 2 |
| `studio/runtime/test/unit/execution/pins.test.ts` | Runtime tests | 2 |
| `studio/runtime/src/cli.ts`, `test/integration/cli-pin.test.ts` | `vpr pin` | 3 |
| `studio/contracts/package.json`, `bun.lock`, docs, ADR-0035 | Wiring, version, docs | 4 |

Commands run from the repository root unless a step says otherwise. Work on branch `feat/source-pins` (already created; the spec is committed there). Runtime tests run against `dist/`: always `npm run build` in `studio/runtime` (or `npx tsc -p .`) before `npx vitest run …`.

---

### Task 1: Contract — `SourcePin`, inventory and verification

**Files:**
- Modify: `studio/contracts/src/layout.mjs`, `studio/contracts/src/layout.d.mts`
- Create: `studio/contracts/schemas/v1alpha1/source-pin.schema.json`
- Create: `studio/contracts/src/source-pins.mjs`, `studio/contracts/src/source-pins.d.mts`
- Create: `studio/contracts/test/source-pins.test.mjs`
- Create: `studio/contracts/fixtures/source-pin/valid.json`, `invalid.json`, `studio/contracts/scripts/check-source-pin-fixtures.mjs`
- Generated: `studio/contracts/bindings/ts/source-pin.ts`

**Interfaces:**
- Produces (from `@studio/contracts/src/source-pins.mjs`): `PINS_DIR`, `validateSourcePin(doc)`, `sourceDir(root, channel, source)`, `hashFile(file)`, `inventory(dir, paths?, { hash? })`, `verifyPin(pin, dir, { hash? }) → { changed: { path, change }[] }`, `describeChanges(changed, limit = 5)`; types `SourceRef`, `SourcePin`, `InventoryEntry`, `PinChange` in the self-contained `.d.mts` (the runtime cannot import the `.ts` bindings). From `layout.mjs`: `sourcePath(root, channel, name)`; `CHANNEL_KNOWLEDGE` includes `"sources"`.

- [ ] **Step 1: Write the failing tests**

Create `studio/contracts/test/source-pins.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, utimes, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeChanges,
  hashFile,
  inventory,
  sourceDir,
  validateSourcePin,
  verifyPin,
} from "../src/source-pins.mjs";
import { CHANNEL_KNOWLEDGE, sourcePath } from "../src/layout.mjs";

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "source-pins-"));
  await mkdir(join(dir, "timing"), { recursive: true });
  await mkdir(join(dir, "assets", "takes"), { recursive: true });
  await writeFile(join(dir, "takes.json"), "{}");
  await writeFile(join(dir, "timing", "recitazione.json"), '{"words":[]}');
  await writeFile(join(dir, "assets", "takes", "recitazione.mp3"), "audio");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const pinOf = async (paths) => ({
  apiVersion: "studio.video/v1alpha1",
  kind: "SourcePin",
  id: "poesia",
  source: { kind: "channel-source", name: "il-lampo" },
  ...(paths ? { paths } : {}),
  usedBy: ["compile"],
  pinnedAt: "2026-10-05T18:00:00Z",
  files: await inventory(dir, paths),
});

/** A hash function that counts how many files it reads. */
function countingHash() {
  const counter = { reads: 0 };
  counter.hash = async (file) => {
    counter.reads += 1;
    return hashFile(file);
  };
  return counter;
}

describe("layout", () => {
  it("gives channels a sources folder and a path to each source", () => {
    assert.ok(CHANNEL_KNOWLEDGE.includes("sources"));
    assert.equal(sourcePath("/lib", "dentro-i-versi", "il-lampo"), join("/lib", "dentro-i-versi", "sources", "il-lampo"));
    assert.equal(sourceDir("/lib", "c", { kind: "channel-source", name: "x" }), join("/lib", "c", "sources", "x"));
    assert.equal(sourceDir("/lib", "c", { kind: "episode", series: "short", episode: "e" }), join("/lib", "c", "series", "short", "episodes", "e"));
  });
});

describe("inventory", () => {
  it("lists every file with its hash, size and mtime, sorted", async () => {
    const files = await inventory(dir);
    assert.deepEqual(Object.keys(files), ["assets/takes/recitazione.mp3", "takes.json", "timing/recitazione.json"]);
    assert.equal(files["takes.json"].hash, `sha256:${"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}`);
    assert.equal(files["takes.json"].size, 2);
    assert.equal(typeof files["takes.json"].mtimeMs, "number");
  });

  it("keeps an episode's runtime state and hidden files out", async () => {
    for (const d of ["journal", "attempts", "reviews", "output", ".workspace", "_media"]) {
      await mkdir(join(dir, d), { recursive: true });
      await writeFile(join(dir, d, "x"), "state");
    }
    await writeFile(join(dir, ".DS_Store"), "");
    assert.deepEqual(Object.keys(await inventory(dir)), ["assets/takes/recitazione.mp3", "takes.json", "timing/recitazione.json"]);
  });

  it("restricts itself to the pinned paths", async () => {
    assert.deepEqual(Object.keys(await inventory(dir, ["timing", "takes.json"])), ["takes.json", "timing/recitazione.json"]);
  });

  it("refuses a symlink", async () => {
    await symlink("/etc/hosts", join(dir, "outside"));
    await assert.rejects(() => inventory(dir), /outside is a symlink/);
  });
});

describe("verifyPin", () => {
  it("finds nothing when nothing changed, and reads no file", async () => {
    const pin = await pinOf();
    const counter = countingHash();
    assert.deepEqual(await verifyPin(pin, dir, { hash: counter.hash }), { changed: [] });
    assert.equal(counter.reads, 0);
  });

  it("reports modified, added and removed files", async () => {
    const pin = await pinOf();
    await writeFile(join(dir, "assets", "takes", "recitazione.mp3"), "a new take");
    await writeFile(join(dir, "timing", "new.json"), "{}");
    await rm(join(dir, "takes.json"));
    assert.deepEqual((await verifyPin(pin, dir)).changed, [
      { path: "assets/takes/recitazione.mp3", change: "modified" },
      { path: "takes.json", change: "removed" },
      { path: "timing/new.json", change: "added" },
    ]);
  });

  it("treats a file touched but not edited as unchanged, after reading only that file", async () => {
    const pin = await pinOf();
    const later = new Date(Date.now() + 60_000);
    await utimes(join(dir, "takes.json"), later, later);
    const counter = countingHash();
    assert.deepEqual(await verifyPin(pin, dir, { hash: counter.hash }), { changed: [] });
    assert.equal(counter.reads, 1);
  });

  it("only looks inside the pinned paths", async () => {
    const pin = await pinOf(["timing"]);
    await writeFile(join(dir, "takes.json"), "edited outside the pin");
    await writeFile(join(dir, "timing", "new.json"), "{}");
    assert.deepEqual((await verifyPin(pin, dir)).changed, [{ path: "timing/new.json", change: "added" }]);
  });

  it("reports every file of a source that disappeared", async () => {
    const pin = await pinOf();
    await rm(dir, { recursive: true, force: true });
    assert.equal((await verifyPin(pin, dir)).changed.length, 3);
  });
});

describe("validateSourcePin and describeChanges", () => {
  it("accepts a pin it made and refuses broken ones", async () => {
    const pin = await pinOf(["timing"]);
    assert.deepEqual(validateSourcePin(pin), []);
    assert.deepEqual(validateSourcePin({ ...pin, usedBy: [] }).map((p) => p.code), ["schema"]);
    assert.ok(validateSourcePin({ ...pin, paths: ["../elsewhere"] }).length > 0);
    assert.ok(validateSourcePin({ ...pin, source: { kind: "channel-source" } }).length > 0);
  });

  it("names at most five changes", () => {
    const changed = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}`, change: "added" }));
    assert.equal(describeChanges(changed), "f0 (added), f1 (added), f2 (added), f3 (added), f4 (added) and 2 more");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/source-pins.test.mjs 2>&1 | grep -E "Cannot find module|does not provide|^# fail"`
Expected: `Cannot find module '…/src/source-pins.mjs'`.

- [ ] **Step 3: Layout**

In `studio/contracts/src/layout.mjs`, in `CHANNEL_KNOWLEDGE`, replace

```js
  "references",
  "skills",
  "voices",
]);
```

with

```js
  "references",
  "skills",
  "sources",
  "voices",
]);
```

and below the `episodePath` function add:

```js

/** Path to a channel source: shared material episodes pin, never copy (ADR-0035). */
export function sourcePath(root, channel, name) {
  return join(channelPath(root, channel), "sources", name);
}
```

In `studio/contracts/src/layout.d.mts`, below the `episodePath` declaration add:

```ts
export declare function sourcePath(root: string, channel: string, name: string): string;
```

- [ ] **Step 4: Schema, module and declarations**

Create `studio/contracts/schemas/v1alpha1/source-pin.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://video.studio/schemas/v1alpha1/source-pin.schema.json",
  "title": "Video Studio source pin schema",
  "description": "An episode's read-only pin on shared material: a channel source (library/<channel>/sources/<name>) or another episode of the same channel, with an inventory of its files. Status re-checks the inventory; a changed source makes the stages that read it stale (ADR-0035). Checked and verified by src/source-pins.mjs.",
  "$defs": {
    "ContentHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "LocalId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$"
    },
    "ChannelSource": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "name"],
      "properties": {
        "kind": { "const": "channel-source" },
        "name": { "$ref": "#/$defs/LocalId" }
      }
    },
    "EpisodeSource": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "series", "episode"],
      "properties": {
        "kind": { "const": "episode" },
        "series": { "$ref": "#/$defs/LocalId" },
        "episode": { "$ref": "#/$defs/LocalId" }
      }
    },
    "SourceRef": {
      "oneOf": [{ "$ref": "#/$defs/ChannelSource" }, { "$ref": "#/$defs/EpisodeSource" }]
    },
    "RelativePath": {
      "type": "string",
      "pattern": "^(?!/)(?!.*(^|/)\\.\\.(/|$))[^\\\\]+$",
      "description": "A source-relative POSIX path, no leading slash, no .. segment."
    },
    "InventoryEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["hash", "size", "mtimeMs"],
      "properties": {
        "hash": { "$ref": "#/$defs/ContentHash" },
        "size": { "type": "integer", "minimum": 0 },
        "mtimeMs": { "type": "number", "minimum": 0 }
      }
    },
    "SourcePin": {
      "type": "object",
      "additionalProperties": false,
      "required": ["apiVersion", "kind", "id", "source", "usedBy", "pinnedAt", "files"],
      "properties": {
        "apiVersion": { "type": "string", "const": "studio.video/v1alpha1" },
        "kind": { "type": "string", "const": "SourcePin" },
        "id": { "$ref": "#/$defs/LocalId" },
        "source": { "$ref": "#/$defs/SourceRef" },
        "paths": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/RelativePath" } },
        "usedBy": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
        "pinnedAt": { "type": "string", "format": "date-time" },
        "files": {
          "type": "object",
          "propertyNames": { "$ref": "#/$defs/RelativePath" },
          "additionalProperties": { "$ref": "#/$defs/InventoryEntry" }
        }
      }
    }
  }
}
```

Create `studio/contracts/src/source-pins.mjs`:

```js
// ---------------------------------------------------------------------------
// Channel sources and source pins (ADR-0035)
// ---------------------------------------------------------------------------
// Shared material — a poem's text, illustrations, recital take, word timing —
// is made once and used by several series. It lives in a channel source,
// library/<channel>/sources/<name>/, or in another episode of the channel.
// It is never copied: an episode PINS it, recording an inventory of its files.
//
// The inventory keeps hash, size and mtime per file. The hash is the truth;
// size and mtime only spare re-hashing on a poll: verifyPin stats every file
// and hashes only those whose size or mtime moved. A file touched but not
// edited is unchanged.
//
// An episode's runtime state is never part of a source: journal/, attempts/,
// reviews/, output/, and any name starting with "." or "_".
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/v1alpha1/source-pin.schema.json" with { type: "json" };
import { jsonPath } from "./edit-timeline.mjs";
import { episodePath, sourcePath } from "./layout.mjs";

/** Where an episode keeps its pins, relative to the episode directory. */
export const PINS_DIR = "source/pins";

/** Runtime state of an episode, never inventoried when the source is an episode. */
const EPISODE_STATE = new Set(["journal", "attempts", "reviews", "output"]);

let compiled = null;

function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/SourcePin`);
  }
  return compiled;
}

/**
 * Validate a SourcePin's shape.
 * @returns {{code: string, message: string, path: string}[]}
 */
export function validateSourcePin(doc) {
  const validate = schemaValidator();
  if (validate(doc)) return [];
  return validate.errors.map((e) => ({ code: "schema", message: `${e.instancePath || "/"} ${e.message}`, path: jsonPath(e.instancePath) }));
}

/** The directory a pin's source lives in. */
export function sourceDir(root, channel, source) {
  return source.kind === "channel-source"
    ? sourcePath(root, channel, source.name)
    : episodePath(root, channel, source.series, source.episode);
}

/** sha256 of a file, as a ContentHash. */
export async function hashFile(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

const toPosix = (p) => p.split(sep).join("/");
const hidden = (name) => name.startsWith(".") || name.startsWith("_");

/**
 * The files of a source, source-relative POSIX path → { hash, size, mtimeMs },
 * sorted by path. `paths` restricts it to those files or directories.
 * A symlink is an error: a pin never points outside its source.
 */
export async function inventory(dir, paths, { hash = hashFile } = {}) {
  const files = {};
  const visit = async (abs, top) => {
    const info = await lstat(abs);
    if (info.isSymbolicLink()) throw new Error(`${toPosix(relative(dir, abs))} is a symlink: a source cannot point outside itself`);
    if (info.isDirectory()) {
      for (const name of (await readdir(abs)).sort()) {
        if (hidden(name) || (top && EPISODE_STATE.has(name))) continue;
        await visit(join(abs, name), false);
      }
    } else if (info.isFile()) {
      files[toPosix(relative(dir, abs))] = { hash: await hash(abs), size: info.size, mtimeMs: info.mtimeMs };
    }
  };
  if (paths && paths.length > 0) {
    for (const p of [...paths].sort()) await visit(join(dir, p), false);
  } else {
    await visit(dir, true);
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Every file path a pin's scope covers now, without hashing anything. */
async function currentPaths(dir, paths) {
  const found = new Map();
  const visit = async (abs, top) => {
    let info;
    try {
      info = await lstat(abs);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      for (const name of await readdir(abs)) {
        if (hidden(name) || (top && EPISODE_STATE.has(name))) continue;
        await visit(join(abs, name), false);
      }
    } else if (info.isFile() || info.isSymbolicLink()) {
      found.set(toPosix(relative(dir, abs)), info);
    }
  };
  if (paths && paths.length > 0) for (const p of paths) await visit(join(dir, p), false);
  else await visit(dir, true);
  return found;
}

/**
 * Compare a pin's inventory with its source as it is now.
 * Files whose size and mtime match are not read.
 * @returns {Promise<{changed: {path: string, change: "modified" | "added" | "removed"}[]}>}
 */
export async function verifyPin(pin, dir, { hash = hashFile } = {}) {
  const now = await currentPaths(dir, pin.paths);
  const changed = [];
  for (const [path, entry] of Object.entries(pin.files)) {
    const info = now.get(path);
    if (!info) {
      changed.push({ path, change: "removed" });
    } else if (info.isSymbolicLink()) {
      changed.push({ path, change: "modified" });
    } else if (info.size !== entry.size || info.mtimeMs !== entry.mtimeMs) {
      if ((await hash(join(dir, path))) !== entry.hash) changed.push({ path, change: "modified" });
    }
  }
  for (const path of now.keys()) {
    if (!Object.hasOwn(pin.files, path)) changed.push({ path, change: "added" });
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { changed };
}

/** "a (modified), b (added)", at most `limit` of them. */
export function describeChanges(changed, limit = 5) {
  const shown = changed.slice(0, limit).map((c) => `${c.path} (${c.change})`).join(", ");
  return changed.length > limit ? `${shown} and ${changed.length - limit} more` : shown;
}
```

Create `studio/contracts/src/source-pins.d.mts`:

```ts
// Type declarations for channel sources and source pins (avg-7zp.5, ADR-0035).
// Self-contained so runtime packages (NodeNext, no .ts imports) can use them;
// they mirror schemas/v1alpha1/source-pin.schema.json, whose generated binding
// is bindings/ts/source-pin.ts.

export declare const PINS_DIR: "source/pins";

export type SourceRef =
  | { kind: "channel-source"; name: string }
  | { kind: "episode"; series: string; episode: string };

export interface InventoryEntry {
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface SourcePin {
  apiVersion: "studio.video/v1alpha1";
  kind: "SourcePin";
  id: string;
  source: SourceRef;
  paths?: string[];
  usedBy: string[];
  pinnedAt: string;
  files: Record<string, InventoryEntry>;
}

export interface SourcePinProblem {
  code: "schema";
  message: string;
  path: string;
}

export type PinChange = { path: string; change: "modified" | "added" | "removed" };

export declare function validateSourcePin(doc: unknown): SourcePinProblem[];
export declare function sourceDir(root: string, channel: string, source: SourceRef): string;
export declare function hashFile(file: string): Promise<string>;
/** Source-relative POSIX path → entry, sorted. Throws on a symlink. */
export declare function inventory(
  dir: string,
  paths?: string[],
  options?: { hash?: (file: string) => Promise<string> },
): Promise<Record<string, InventoryEntry>>;
/** Only files whose size or mtime moved are hashed. */
export declare function verifyPin(
  pin: SourcePin,
  dir: string,
  options?: { hash?: (file: string) => Promise<string> },
): Promise<{ changed: PinChange[] }>;
export declare function describeChanges(changed: PinChange[], limit?: number): string;
```

- [ ] **Step 5: Fixtures and their check**

Create `studio/contracts/fixtures/source-pin/valid.json`:

```json
[
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "short",
    "source": {
      "kind": "episode",
      "series": "short",
      "episode": "il-lampo"
    },
    "usedBy": [
      "compile",
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {},
    "paths": [
      "artifacts/narration",
      "assets/takes"
    ]
  }
]
```

Create `studio/contracts/fixtures/source-pin/invalid.json`:

```json
[
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "episode",
      "series": "short"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    },
    "paths": [
      "../outside"
    ]
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    },
    "paths": [
      "/etc"
    ]
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "md5:x",
        "size": 2,
        "mtimeMs": 1
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "../x": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "yesterday",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    }
  },
  {
    "apiVersion": "studio.video/v1alpha1",
    "kind": "SourcePin",
    "id": "poesia",
    "source": {
      "kind": "channel-source",
      "name": "il-lampo"
    },
    "usedBy": [
      "narration"
    ],
    "pinnedAt": "2026-10-05T18:00:00Z",
    "files": {
      "takes.json": {
        "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 2,
        "mtimeMs": 1759600000000.5
      }
    },
    "extra": true
  }
]
```

Create `studio/contracts/scripts/check-source-pin-fixtures.mjs`:

```js
#!/usr/bin/env node

/**
 * Validate source-pin fixtures: every pin in fixtures/source-pin/valid.json is
 * accepted, every one in invalid.json refused.
 * Usage: node scripts/check-source-pin-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateSourcePin } from "../src/source-pins.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const valid = read("fixtures/source-pin/valid.json");
const invalid = read("fixtures/source-pin/invalid.json");
let failures = 0;

valid.forEach((pin, i) => {
  const problems = validateSourcePin(pin);
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL valid pin ${i}:`, problems.map((p) => `${p.path} ${p.message}`).join("; "));
  }
});
invalid.forEach((pin, i) => {
  if (validateSourcePin(pin).length === 0) {
    failures += 1;
    console.error(`FAIL invalid pin ${i} was accepted`);
  }
});

if (failures) {
  console.error(`\n${failures} source-pin check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${valid.length} valid and ${invalid.length} invalid source-pin fixtures passed`);
}
```

- [ ] **Step 6: Generate the binding and run everything**

Run: `cd studio/contracts && npm run bindings:generate && git status --short bindings && node --test test/source-pins.test.mjs 2>&1 | grep -E "^# (tests|pass|fail)" && node scripts/check-source-pin-fixtures.mjs && npm run bindings:check`
Expected: only `?? bindings/ts/source-pin.ts`; `# tests 12`, `# fail 0`; `2 valid and 9 invalid source-pin fixtures passed`; `PASS TypeScript bindings are up to date`.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts/src/layout.mjs studio/contracts/src/layout.d.mts studio/contracts/schemas/v1alpha1/source-pin.schema.json \
  studio/contracts/src/source-pins.mjs studio/contracts/src/source-pins.d.mts studio/contracts/test/source-pins.test.mjs \
  studio/contracts/fixtures/source-pin studio/contracts/scripts/check-source-pin-fixtures.mjs studio/contracts/bindings/ts/source-pin.ts
git commit -m "feat(contracts): channel sources and source pins with cheap verification (avg-7zp.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Runtime — pin staleness in `status`, add/verify/renew

**Files:**
- Create: `studio/runtime/src/execution/pins.ts`
- Modify: `studio/runtime/src/execution/service.ts` (imports, `status`, three new methods)
- Create: `studio/runtime/test/unit/execution/pins.test.ts`

**Interfaces:**
- Consumes: Task 1's contract functions and types; `propagate` (`src/staleness/index.js`); `appendJournalEvent` (`@studio/contracts/src/journal.mjs`); the test helper `reviewChainPipeline` (stages `upstream`, `gated`, `skilled`, `attended`, `downstream`; `gated`, `skilled`, `attended` and `downstream` all lie downstream of `upstream`).
- Produces: `ExecutionService.addPin(ref, pipeline, { id, source, usedBy, paths? })`, `verifyPins(ref)`, `renewPin(ref, pipeline, id, actor)`, each returning the refusal union from `pins.ts` inside an `ok` result; `status()` reports pin staleness. Task 3's CLI calls these.

- [ ] **Step 1: Write the failing tests**

Create `studio/runtime/test/unit/execution/pins.test.ts`:

```ts
// ---------------------------------------------------------------------------
// Source pins: a changed source makes the stages that read it stale
// (avg-7zp.5, ADR-0035)
// ---------------------------------------------------------------------------
// The episode pins a channel source, library/<channel>/sources/<name>, used by
// `upstream`. Editing the source makes `upstream` and everything downstream of
// it stale, with a reason naming the files; status writes nothing. Renewing
// the pin journals a `staleness-marked` that keeps them stale until they run
// again.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService } from "../../../src/execution/service.js";
import type { ReviewGate, StageDispatcher } from "../../../src/execution/types.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { ok } from "../../../src/result.js";
import { reviewChainPipeline } from "./helpers/review-chain.js";

const REF = { channel: "dentro-i-versi", series: "long", episode: "il-lampo" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const budget = { maySpend: async () => ok({ reserveId: "r", estimatedCost: 0 }) };
const permissive: ReviewGate = { isOutstanding: async () => ({ state: "approved" as const }) };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "exec-pins-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  const source = join(root, REF.channel, "sources", "il-lampo");
  await mkdir(join(source, "timing"), { recursive: true });
  await writeFile(join(source, "takes.json"), "{}");
  await writeFile(join(source, "timing", "recitazione.json"), '{"words":[]}');
  const dispatcher: StageDispatcher = {
    dispatch: async (stage) => {
      const file = join(dir, "artifacts", `${stage.definition.id}.md`);
      await writeFile(file, "output");
      return [file];
    },
  };
  const svc = new ExecutionService({
    libraryRoot: root, builtinPipelines: await reviewChainPipeline(roots),
    dispatcher, budget, review: permissive, operatorKey: null,
  });
  return { root, dir, source, svc };
}

async function runChain(svc: ExecutionService) {
  for (const stage of ["upstream", "gated", "downstream"]) await svc.run(REF, "review-chain", { stage });
}

async function states(svc: ExecutionService) {
  const st = await svc.status(REF, "review-chain");
  if (!st.ok) throw new Error(st.error.message);
  return Object.fromEntries(st.value.stages.map((s) => [s.stageId, { state: s.state, reason: s.stateReason }]));
}

const channelSource = { kind: "channel-source" as const, name: "il-lampo" };

describe("pinning a source", () => {
  it("writes an inventory and leaves the stages as they were", async () => {
    const { dir, svc } = await setup();
    const added = await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    expect(added.ok && added.value.ok).toBe(true);
    const pin = JSON.parse(await readFile(join(dir, "source", "pins", "poesia.json"), "utf-8"));
    expect(Object.keys(pin.files)).toEqual(["takes.json", "timing/recitazione.json"]);

    await runChain(svc);
    const s = await states(svc);
    expect(s.upstream!.state).toBe("completed");
    expect(s.downstream!.state).toBe("completed");
  });

  it("refuses a missing source, an unknown stage, itself, and a pin that exists", async () => {
    const { svc } = await setup();
    const refusal = async (input: Parameters<ExecutionService["addPin"]>[2]) => {
      const out = await svc.addPin(REF, "review-chain", input);
      return out.ok && !out.value.ok ? out.value.refusal.code : "accepted";
    };
    expect(await refusal({ id: "a", source: { kind: "channel-source", name: "nope" }, usedBy: ["upstream"] })).toBe("unknown-source");
    expect(await refusal({ id: "a", source: channelSource, usedBy: ["compile"] })).toBe("unknown-stage");
    expect(await refusal({ id: "a", source: { kind: "episode", series: "long", episode: "il-lampo" }, usedBy: ["upstream"] })).toBe("self-pin");
    expect(await refusal({ id: "poesia", source: channelSource, usedBy: ["upstream"] })).toBe("accepted");
    expect(await refusal({ id: "poesia", source: channelSource, usedBy: ["upstream"] })).toBe("pin-exists");
  });
});

describe("a changed source", () => {
  it("makes its readers and their downstream stale, naming the files", async () => {
    const { source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);

    await writeFile(join(source, "timing", "recitazione.json"), '{"words":[1]}');
    const s = await states(svc);
    expect(s.upstream!.state).toBe("stale");
    expect(s.upstream!.reason).toBe(
      '"upstream" is stale: source "il-lampo" changed since it was pinned: timing/recitazione.json (modified) — renew the pin to accept the new version',
    );
    expect(s.gated!.state).toBe("stale");
    expect(s.downstream!.state).toBe("stale");
  });

  it("stays stale when the stage is re-run without renewing the pin", async () => {
    const { source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    await writeFile(join(source, "takes.json"), '{"takes":[]}');

    await svc.run(REF, "review-chain", { stage: "upstream" });
    expect((await states(svc)).upstream!.state).toBe("stale");
  });

  it("writes nothing while reporting it", async () => {
    const { dir, source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    const pinBefore = await readFile(join(dir, "source", "pins", "poesia.json"), "utf-8");
    const journalBefore = await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8");
    await writeFile(join(source, "takes.json"), '{"takes":[]}');

    await states(svc);
    expect(await readFile(join(dir, "source", "pins", "poesia.json"), "utf-8")).toBe(pinBefore);
    expect(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).toBe(journalBefore);
  });

  it("reports a source that disappeared and a pin that is not valid", async () => {
    const { dir, source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    await rm(source, { recursive: true, force: true });
    expect((await states(svc)).upstream!.reason).toBe('"upstream" is stale: source "il-lampo" pinned as "poesia" no longer exists');

    await writeFile(join(dir, "source", "pins", "poesia.json"), '{"usedBy":["gated"]}');
    const s = await states(svc);
    expect(s.upstream!.state).toBe("completed");
    expect(s.gated!.state).toBe("stale");
    expect(s.gated!.reason).toMatch(/^"gated" is stale: pin "poesia.json" is not valid/);
  });
});

describe("renewing a pin", () => {
  it("journals what changed and keeps its readers stale until they run again", async () => {
    const { dir, source, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    await writeFile(join(source, "takes.json"), '{"takes":[]}');

    const renewed = await svc.renewPin(REF, "review-chain", "poesia", "pi");
    expect(renewed.ok && renewed.value.ok && renewed.value.changed).toEqual([{ path: "takes.json", change: "modified" }]);
    // upstream and everything downstream of it, in pipeline order (skilled and attended also depend on upstream)
    expect(renewed.ok && renewed.value.ok && renewed.value.affected).toEqual(["upstream", "gated", "skilled", "attended", "downstream"]);

    const events = parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    const marked = events.filter((e) => e.type === "staleness-marked").at(-1)!;
    expect(marked.actor).toBe("pi");
    const data = marked.data as { trigger?: string; changed?: unknown };
    expect(data.trigger).toBe("pin:poesia");
    expect(data.changed).toEqual([{ path: "takes.json", change: "modified" }]);

    const s = await states(svc);
    expect(s.upstream!.state).toBe("stale");
    expect(s.upstream!.reason).toBe('"upstream" is stale: source pin "poesia" was renewed after it ran');

    await runChain(svc);
    const after = await states(svc);
    expect([after.upstream!.state, after.gated!.state, after.downstream!.state]).toEqual(["completed", "completed", "completed"]);
  });

  it("journals nothing when the source did not change", async () => {
    const { dir, svc } = await setup();
    await svc.addPin(REF, "review-chain", { id: "poesia", source: channelSource, usedBy: ["upstream"] });
    await runChain(svc);
    const renewed = await svc.renewPin(REF, "review-chain", "poesia", "human");
    expect(renewed.ok && renewed.value.ok && renewed.value.affected).toEqual([]);
    const events = parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    expect(events.some((e) => e.type === "staleness-marked")).toBe(false);
  });

  it("refuses a pin that does not exist", async () => {
    const { dir, svc } = await setup();
    const out = await svc.renewPin(REF, "review-chain", "nope", "human");
    expect(out.ok && !out.value.ok && out.value.refusal.code).toBe("unknown-pin");
    expect(existsSync(join(dir, "source", "pins"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd studio/runtime && npx tsc -p . 2>&1 | head -3`
Expected: TypeScript errors: `Property 'addPin' does not exist on type 'ExecutionService'` (and `renewPin`).

- [ ] **Step 3: Implement the pin logic**

Create `studio/runtime/src/execution/pins.ts`:

```ts
// ---------------------------------------------------------------------------
// Source pins in the runtime (avg-7zp.5, ADR-0035)
// ---------------------------------------------------------------------------
// An episode pins shared material — a channel source or another episode —
// in source/pins/<id>.json. Status re-checks every pin cheaply (stat first,
// hash only what moved) and reports the stages that read a changed source,
// and everything downstream of them, as stale. Status writes nothing.
//
// Accepting the new version is renewal: the inventory is rewritten and a
// `staleness-marked` event (trigger "pin:<id>") keeps those stages stale
// until they run again — the mechanism the runtime already has. Renewal hides
// nothing, so any actor may do it; the journal records who.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PINS_DIR,
  describeChanges,
  inventory,
  sourceDir,
  validateSourcePin,
  verifyPin,
} from "@studio/contracts/src/source-pins.mjs";
import type { PinChange, SourcePin, SourceRef } from "@studio/contracts/src/source-pins.mjs";
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { propagate } from "../staleness/index.js";
import type { ResolvedPipeline } from "../pipeline/types.js";
import type { EpisodeRef } from "./types.js";

export type PinActor = "human" | "pi";

/** What `addPin` and `renewPin` refuse, by name. */
export type PinRefusal =
  | { code: "unknown-source"; message: string }
  | { code: "unknown-stage"; message: string }
  | { code: "self-pin"; message: string }
  | { code: "pin-exists"; message: string }
  | { code: "unknown-pin"; message: string }
  | { code: "invalid-pin"; message: string };

const slugOf = (ref: EpisodeRef) => `${ref.channel}/${ref.series}/${ref.episode}`;

export function sourceLabel(source: SourceRef): string {
  return source.kind === "channel-source" ? `source "${source.name}"` : `episode "${source.series}/${source.episode}"`;
}

/** The stages a set of readers makes stale: the readers themselves and everything downstream. */
function affectedBy(pipeline: ResolvedPipeline, usedBy: string[], ref: EpisodeRef): string[] {
  const known = new Set(pipeline.stages.map((s) => s.definition.id));
  const readers = usedBy.filter((id) => known.has(id));
  if (readers.length === 0) return [];
  const report = propagate(pipeline, readers, slugOf(ref));
  const stale = new Set([...readers, ...report.stages.filter((s) => s.stale).map((s) => s.stageId)]);
  return pipeline.stages.map((s) => s.definition.id).filter((id) => stale.has(id));
}

async function writeAtomically(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, file);
}

async function readPinFiles(episodeDir: string): Promise<{ file: string; raw: unknown; error?: string }[]> {
  const dir = join(episodeDir, PINS_DIR);
  if (!existsSync(dir)) return [];
  const out: { file: string; raw: unknown; error?: string }[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    try {
      out.push({ file: name, raw: JSON.parse(await readFile(join(dir, name), "utf-8")) });
    } catch (e) {
      out.push({ file: name, raw: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/**
 * Stage id → why a pin makes it stale. Read-only: nothing is written.
 * A pin that cannot be read or checked makes its readers stale too — never
 * silently ignored; when its readers are unknown, every stage is affected.
 */
export async function pinStaleness(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string, pipeline: ResolvedPipeline,
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  const allStages = pipeline.stages.map((s) => s.definition.id);
  const mark = (usedBy: string[], reason: string) => {
    for (const id of affectedBy(pipeline, usedBy, ref)) if (!reasons.has(id)) reasons.set(id, reason);
  };
  for (const { file, raw, error } of await readPinFiles(episodeDir)) {
    const readers = Array.isArray((raw as { usedBy?: unknown })?.usedBy)
      ? ((raw as { usedBy: unknown[] }).usedBy.filter((x) => typeof x === "string") as string[])
      : allStages;
    if (error) {
      mark(readers, `pin "${file}" cannot be read: ${error}`);
      continue;
    }
    const problems = validateSourcePin(raw);
    if (problems.length > 0) {
      mark(readers, `pin "${file}" is not valid: ${problems[0]!.path} ${problems[0]!.message}`);
      continue;
    }
    const pin = raw as SourcePin;
    const dir = sourceDir(libraryRoot, ref.channel, pin.source);
    if (!existsSync(dir)) {
      mark(pin.usedBy, `${sourceLabel(pin.source)} pinned as "${pin.id}" no longer exists`);
      continue;
    }
    const { changed } = await verifyPin(pin, dir);
    if (changed.length > 0) {
      mark(pin.usedBy, `${sourceLabel(pin.source)} changed since it was pinned: ${describeChanges(changed)} — renew the pin to accept the new version`);
    }
  }
  return reasons;
}

/** Every pin of the episode and what changed in its source. Read-only. */
export async function verifyPins(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string,
): Promise<{ id: string; source?: SourceRef; changed: PinChange[]; problem?: string }[]> {
  const out = [];
  for (const { file, raw, error } of await readPinFiles(episodeDir)) {
    const id = file.replace(/\.json$/, "");
    const problems = error ? [] : validateSourcePin(raw);
    if (error || problems.length > 0) {
      out.push({ id, changed: [], problem: error ?? `${problems[0]!.path} ${problems[0]!.message}` });
      continue;
    }
    const pin = raw as SourcePin;
    const dir = sourceDir(libraryRoot, ref.channel, pin.source);
    if (!existsSync(dir)) {
      out.push({ id, source: pin.source, changed: [], problem: `${sourceLabel(pin.source)} no longer exists` });
      continue;
    }
    out.push({ id, source: pin.source, changed: (await verifyPin(pin, dir)).changed });
  }
  return out;
}

/** Inventory a source and write a new pin. */
export async function addPin(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string, pipeline: ResolvedPipeline,
  input: { id: string; source: SourceRef; usedBy: string[]; paths?: string[]; now: Date },
): Promise<{ ok: true; pin: SourcePin } | { ok: false; refusal: PinRefusal }> {
  if (input.source.kind === "episode" && input.source.series === ref.series && input.source.episode === ref.episode) {
    return { ok: false, refusal: { code: "self-pin", message: `an episode cannot pin itself` } };
  }
  const known = new Set(pipeline.stages.map((s) => s.definition.id));
  const unknown = input.usedBy.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return { ok: false, refusal: { code: "unknown-stage", message: `not stages of this pipeline: ${unknown.join(", ")}` } };
  }
  const dir = sourceDir(libraryRoot, ref.channel, input.source);
  if (!existsSync(dir)) {
    return { ok: false, refusal: { code: "unknown-source", message: `${sourceLabel(input.source)} does not exist at ${dir}` } };
  }
  const file = join(episodeDir, PINS_DIR, `${input.id}.json`);
  if (existsSync(file)) {
    return { ok: false, refusal: { code: "pin-exists", message: `pin "${input.id}" already exists: renew it instead` } };
  }
  const pin = {
    apiVersion: "studio.video/v1alpha1", kind: "SourcePin", id: input.id, source: input.source,
    ...(input.paths && input.paths.length > 0 ? { paths: input.paths } : {}),
    usedBy: input.usedBy, pinnedAt: input.now.toISOString(),
    files: await inventory(dir, input.paths),
  } as SourcePin;
  const problems = validateSourcePin(pin);
  if (problems.length > 0) {
    return { ok: false, refusal: { code: "invalid-pin", message: `${problems[0]!.path} ${problems[0]!.message}` } };
  }
  await mkdir(join(episodeDir, PINS_DIR), { recursive: true });
  await writeAtomically(file, `${JSON.stringify(pin, null, 2)}\n`);
  return { ok: true, pin };
}

/** Accept a source's current version: rewrite the inventory and record which stages must be redone. */
export async function renewPin(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string, pipeline: ResolvedPipeline,
  input: { id: string; actor: PinActor; now: Date },
): Promise<{ ok: true; changed: PinChange[]; affected: string[] } | { ok: false; refusal: PinRefusal }> {
  const file = join(episodeDir, PINS_DIR, `${input.id}.json`);
  if (!existsSync(file)) return { ok: false, refusal: { code: "unknown-pin", message: `no pin "${input.id}"` } };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (e) {
    return { ok: false, refusal: { code: "invalid-pin", message: e instanceof Error ? e.message : String(e) } };
  }
  const problems = validateSourcePin(raw);
  if (problems.length > 0) {
    return { ok: false, refusal: { code: "invalid-pin", message: `${problems[0]!.path} ${problems[0]!.message}` } };
  }
  const pin = raw as SourcePin;
  const dir = sourceDir(libraryRoot, ref.channel, pin.source);
  if (!existsSync(dir)) {
    return { ok: false, refusal: { code: "unknown-source", message: `${sourceLabel(pin.source)} does not exist at ${dir}` } };
  }
  const { changed } = await verifyPin(pin, dir);
  const renewed = { ...pin, pinnedAt: input.now.toISOString(), files: await inventory(dir, pin.paths) };
  await writeAtomically(file, `${JSON.stringify(renewed, null, 2)}\n`);
  const affected = changed.length > 0 ? affectedBy(pipeline, pin.usedBy, ref) : [];
  if (affected.length > 0) {
    const trigger = `pin:${pin.id}`;
    await appendJournalEvent(episodeDir, {
      type: "staleness-marked", actor: input.actor, episode: ref,
      data: { stageId: trigger, trigger, affected: affected.map((stageId) => ({ stageId, path: [trigger, stageId] })), changed },
    });
  }
  return { ok: true, changed, affected };
}
```

- [ ] **Step 4: Hook it into the service**

In `studio/runtime/src/execution/service.ts`, below

```ts
import type { ResolvedPipeline, ResolvedStage } from "../pipeline/types.js";
```

add

```ts
import { addPin, pinStaleness, renewPin, verifyPins } from "./pins.js";
import type { PinActor, PinRefusal } from "./pins.js";
import type { PinChange, SourcePin, SourceRef } from "@studio/contracts/src/source-pins.mjs";
```

In `status()`, immediately after the `const takes = deriveTakes(…);` statement, add:

```ts

    // Shared material this episode pinned (avg-7zp.5): a changed source makes
    // the stages that read it, and their downstream, stale. Read-only — stat
    // first, hash only what moved.
    const pinned = await pinStaleness(this.options.libraryRoot, ref, episodeDir, resolved.value);
```

In the `instance.status === "completed"` branch, replace

```ts
          state = "stale";
          stateReason = `"${stage.definition.id}" is stale: an upstream stage changed after it ran`;
        } else if (stage.definition.gates.review === "none") {
```

with

```ts
          state = "stale";
          const trigger = (events.value[marked]!.data as { trigger?: string } | undefined)?.trigger;
          stateReason = trigger?.startsWith("pin:")
            ? `"${stage.definition.id}" is stale: source pin "${trigger.slice(4)}" was renewed after it ran`
            : `"${stage.definition.id}" is stale: an upstream stage changed after it ran`;
        } else if (pinned.has(stage.definition.id)) {
          state = "stale";
          stateReason = `"${stage.definition.id}" is stale: ${pinned.get(stage.definition.id)}`;
        } else if (stage.definition.gates.review === "none") {
```

Immediately before the doc comment `/**\n   * Bridge replay's stage instance to the engine's.` add the three methods:

```ts
  /** Pin shared material for this episode (avg-7zp.5): inventory it and write source/pins/<id>.json. */
  async addPin(
    ref: EpisodeRef, pipeline: string,
    input: { id: string; source: SourceRef; usedBy: string[]; paths?: string[] },
  ): Promise<Result<{ ok: true; pin: SourcePin } | { ok: false; refusal: PinRefusal }, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    return ok(await addPin(this.options.libraryRoot, ref, this.episodeDir(ref), resolved.value, { ...input, now: this.now() }));
  }

  /** Every pin of the episode and what changed in its source. Writes nothing. */
  async verifyPins(ref: EpisodeRef): Promise<{ id: string; source?: SourceRef; changed: PinChange[]; problem?: string }[]> {
    return verifyPins(this.options.libraryRoot, ref, this.episodeDir(ref));
  }

  /**
   * Accept a pinned source's current version: rewrite the inventory and journal
   * which stages must be redone. Any actor may: renewal hides nothing.
   */
  async renewPin(
    ref: EpisodeRef, pipeline: string, id: string, actor: PinActor,
  ): Promise<Result<{ ok: true; changed: PinChange[]; affected: string[] } | { ok: false; refusal: PinRefusal }, ExecutionError>> {
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    return ok(await renewPin(this.options.libraryRoot, ref, this.episodeDir(ref), resolved.value, { id, actor, now: this.now() }));
  }
```

- [ ] **Step 5: Build and run the tests**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/unit/execution/pins.test.ts 2>&1 | grep -E "Tests "`
Expected: `Tests  9 passed (9)`.

Run: `cd studio/runtime && npx vitest run 2>&1 | grep -E "Test Files|Tests "` and `npx eslint src/execution/pins.ts test/unit/execution/pins.test.ts 2>&1 | grep -c " error "`
Expected: every runtime test passes; `0` lint errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime/src/execution/pins.ts studio/runtime/src/execution/service.ts studio/runtime/test/unit/execution/pins.test.ts
git commit -m "feat(runtime): a changed pinned source makes its readers stale; renew to accept (avg-7zp.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `vpr pin add | verify | renew`

**Files:**
- Modify: `studio/runtime/src/cli.ts` (import, `VALUE_FLAGS`, `cmdPin`, command registry)
- Create: `studio/runtime/test/integration/cli-pin.test.ts`

**Interfaces:**
- Consumes: Task 2's service methods; existing CLI helpers `extractPipeline`, `positionalArgs`, `parsePath`, `flagValue`, `claimTtlMs`, `makeService`, `exitCodeFor`, `resolveCliCredential`, `emit`, `EX_OK` (0), `EX_USAGE` (1), `EX_RUNTIME` (2), `DEFAULT_PIPELINE`.
- Produces: the `pin` command.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/integration/cli-pin.test.ts`:

```ts
// ---------------------------------------------------------------------------
// `vpr pin` end to end (avg-7zp.5): add, verify, renew on a temporary library.
// Spawns the compiled CLI, like cli.test.ts: run through `npm test`, whose
// `pretest` rebuilds dist/ first.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { reviewChainPipeline } from "../unit/execution/helpers/review-chain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");
const EP = "dentro-i-versi/long/il-lampo";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function library() {
  const root = await mkdtemp(path.join(tmpdir(), "cli-pin-"));
  roots.push(root);
  const episode = path.join(root, "dentro-i-versi", "series", "long", "episodes", "il-lampo");
  await mkdir(path.join(episode, "artifacts"), { recursive: true });
  const source = path.join(root, "dentro-i-versi", "sources", "il-lampo");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "takes.json"), "{}");
  return { root, episode, source, pipelines: await reviewChainPipeline(roots) };
}

function vpr(lib: { root: string; pipelines: string }, args: string[]) {
  const result = spawnSync("node", [cliPath, ...args, "--library", lib.root, "--pipeline", "review-chain", "--json"], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
    // Headless, as Pi runs it: the CLI acts as the agent, so a renewal is journaled as "pi".
    env: { ...process.env, AVG_BUILTIN_PIPELINES: lib.pipelines, AVG_HEADLESS: "1" },
  });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr pin", () => {
  it("adds a pin, reports a changed source, and renews it", async () => {
    const lib = await library();

    const added = vpr(lib, ["pin", "add", EP, "poesia", "--source", "channel:il-lampo", "--used-by", "upstream"]);
    expect(added.status).toBe(0);
    expect(Object.keys(added.json.pin.files)).toEqual(["takes.json"]);

    await writeFile(path.join(lib.source, "takes.json"), '{"takes":[]}');
    const verified = vpr(lib, ["pin", "verify", EP]);
    expect(verified.status).toBe(0);
    expect(verified.json.pins).toEqual([
      { id: "poesia", source: { kind: "channel-source", name: "il-lampo" }, changed: [{ path: "takes.json", change: "modified" }] },
    ]);

    const renewed = vpr(lib, ["pin", "renew", EP, "poesia"]);
    expect(renewed.status).toBe(0);
    expect(renewed.json.changed).toEqual([{ path: "takes.json", change: "modified" }]);
    const events = parseJournal(await readFile(path.join(lib.episode, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    expect(events.at(-1)!.type).toBe("staleness-marked");
    expect(events.at(-1)!.actor).toBe("pi");
    expect((events.at(-1)!.data as { trigger?: string }).trigger).toBe("pin:poesia");

    expect(vpr(lib, ["pin", "verify", EP]).json.pins[0].changed).toEqual([]);
  });

  it("refuses an unknown stage as a usage error and a missing source as a runtime one", async () => {
    const lib = await library();
    const stage = vpr(lib, ["pin", "add", EP, "poesia", "--source", "channel:il-lampo", "--used-by", "compile"]);
    expect([stage.status, stage.json.code]).toEqual([1, "unknown-stage"]); // EX_USAGE
    const source = vpr(lib, ["pin", "add", EP, "poesia", "--source", "channel:nope", "--used-by", "upstream"]);
    expect([source.status, source.json.code]).toEqual([2, "unknown-source"]); // EX_RUNTIME
    const malformed = vpr(lib, ["pin", "add", EP, "poesia", "--source", "nope", "--used-by", "upstream"]);
    expect(malformed.status).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/integration/cli-pin.test.ts 2>&1 | grep -E "Tests "`
Expected: `Tests  2 failed (2)` (the CLI has no `pin` command yet).

- [ ] **Step 3: Implement the command**

In `studio/runtime/src/cli.ts`, below `import { releaseSpend } from "@studio/contracts/src/budget.mjs";` add:

```ts
import type { SourceRef } from "@studio/contracts/src/source-pins.mjs";
```

In `VALUE_FLAGS`, replace

```ts
  "--mode", "--stages",
]);
```

with

```ts
  "--mode", "--stages",
  // `pin`'s (avg-7zp.5).
  "--source", "--used-by", "--path",
]);
```

Immediately before the line `// ── budget (avg-91o) ────────────────────────────────────────────────────────` insert:

```ts
// ── pin (avg-7zp.5) ─────────────────────────────────────────────────────────

/** `channel:<name>` or `episode:<series>/<episode>`. */
function parseSourceFlag(value: string | undefined): SourceRef | null {
  if (!value) return null;
  const channel = /^channel:([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(value);
  if (channel) return { kind: "channel-source", name: channel[1]! };
  const episode = /^episode:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(value);
  if (episode) return { kind: "episode", series: episode[1]!, episode: episode[2]! };
  return null;
}

/** Every value of a repeatable value-taking flag. */
function flagValues(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length - 1; i++) if (args[i] === name) out.push(args[i + 1]!);
  return out;
}

/**
 * `vpr pin add|verify|renew`: shared material an episode reads without
 * copying it (ADR-0035). `verify` writes nothing; `renew` accepts a source's
 * current version and journals which stages must be redone — any actor may,
 * because renewal hides nothing.
 */
async function cmdPin(ctx: CliContext, args: string[]): Promise<number> {
  const usage =
    "Usage: vpr pin add <channel>/<series>/<episode> <id> --source channel:<name>|episode:<series>/<episode> " +
    "--used-by <stage>[,<stage>...] [--path <p>]... | vpr pin verify <channel>/<series>/<episode> | " +
    "vpr pin renew <channel>/<series>/<episode> <id> [--pipeline <name>]";
  const { pipeline: pipelineName, remaining } = extractPipeline(args);
  const [sub, episodeArg, id] = positionalArgs(remaining);
  const parsed = episodeArg ? parsePath(episodeArg) : null;
  if (!parsed || (sub !== "add" && sub !== "verify" && sub !== "renew")) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }
  const ttl = claimTtlMs();
  if (!ttl.ok) {
    emit(ctx, { error: ttl.error });
    return EX_USAGE;
  }
  const service = makeService(args, ttl.value, null);
  const pipeline = pipelineName ?? DEFAULT_PIPELINE;

  if (sub === "verify") {
    const pins = await service.verifyPins(parsed);
    const changed = pins.filter((p) => p.changed.length > 0 || p.problem).length;
    emit(ctx, { message: `${pins.length} pin(s) for ${episodeArg}, ${changed} with changes or problems`, episode: parsed, pins });
    return EX_OK;
  }
  if (!id) {
    emit(ctx, { error: usage });
    return EX_USAGE;
  }

  if (sub === "add") {
    const source = parseSourceFlag(flagValue(remaining, "--source"));
    const usedBy = (flagValue(remaining, "--used-by") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!source || usedBy.length === 0) {
      emit(ctx, { error: usage });
      return EX_USAGE;
    }
    if (ctx.dryRun) {
      emit(ctx, { message: `[DRY RUN] Would pin ${id} for ${episodeArg}`, dryRun: true });
      return EX_OK;
    }
    const paths = flagValues(remaining, "--path");
    const out = await service.addPin(parsed, pipeline, { id, source, usedBy, ...(paths.length > 0 ? { paths } : {}) });
    if (!out.ok) {
      emit(ctx, { error: `${out.error.code}: ${out.error.message}` });
      return exitCodeFor(out.error);
    }
    if (!out.value.ok) {
      emit(ctx, { error: out.value.refusal.message, code: out.value.refusal.code });
      return out.value.refusal.code === "unknown-stage" ? EX_USAGE : EX_RUNTIME;
    }
    emit(ctx, { message: `Pinned "${id}" for ${episodeArg}: ${Object.keys(out.value.pin.files).length} file(s)`, pin: out.value.pin });
    return EX_OK;
  }

  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would renew pin ${id} for ${episodeArg}`, dryRun: true });
    return EX_OK;
  }
  const actor = resolveCliCredential().principal === "operator" ? "human" : "pi";
  const out = await service.renewPin(parsed, pipeline, id, actor);
  if (!out.ok) {
    emit(ctx, { error: `${out.error.code}: ${out.error.message}` });
    return exitCodeFor(out.error);
  }
  if (!out.value.ok) {
    emit(ctx, { error: out.value.refusal.message, code: out.value.refusal.code });
    return EX_RUNTIME;
  }
  emit(ctx, {
    message: out.value.changed.length === 0
      ? `Pin "${id}" renewed: its source had not changed`
      : `Pin "${id}" renewed: ${out.value.changed.length} change(s); stale until they run again: ${out.value.affected.join(", ")}`,
    changed: out.value.changed, affected: out.value.affected,
  });
  return EX_OK;
}
```

In the `COMMANDS` registry, immediately before the `budget: { name: "budget",` entry, add:

```ts
  pin: { name: "pin", description: "Pin shared material (a channel source or another episode), verify it, or renew it to accept a new version", usage: "vpr pin add <channel>/<series>/<episode> <id> --source channel:<name>|episode:<series>/<episode> --used-by <stage>[,<stage>...] [--path <p>]... | vpr pin verify <channel>/<series>/<episode> | vpr pin renew <channel>/<series>/<episode> <id> [--pipeline <name>] [--json] [--dry-run]", examples: ["vpr pin add dentro-i-versi/long/il-lampo poesia --source channel:il-lampo --used-by narration", "vpr pin verify dentro-i-versi/long/il-lampo", "vpr pin renew dentro-i-versi/long/il-lampo poesia"], run: cmdPin },
```

- [ ] **Step 4: Build and run the tests**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/integration/cli-pin.test.ts 2>&1 | grep -E "Tests "`
Expected: `Tests  2 passed (2)`.

Run: `cd studio/runtime && npx eslint src/cli.ts test/integration/cli-pin.test.ts 2>&1 | grep -c " error "` and `npx vitest run 2>&1 | grep -E "Test Files|Tests "`
Expected: `0`; every runtime test passes.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/cli.ts studio/runtime/test/integration/cli-pin.test.ts
git commit -m "feat(runtime): vpr pin add, verify and renew (avg-7zp.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wiring, version, docs, ADR-0035

**Files:**
- Modify: `studio/contracts/package.json`, `bun.lock`
- Modify: `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md`, `docs/workspace.md`, `docs/index.md`
- Create: `docs/adr/0035-shared-material-is-pinned-never-copied.md`

**Interfaces:**
- Consumes: `scripts/check-source-pin-fixtures.mjs` (Task 1).
- Produces: `check:schemas` covers pins; contracts 0.6.0; the decision record.

- [ ] **Step 1: Wire the check, bump the version**

In `studio/contracts/package.json`: `"version": "0.6.0"`; append ` && node scripts/check-source-pin-fixtures.mjs` to the end of the `check:schemas` string. In `bun.lock`, under `"studio/contracts": {`, change `"version": "0.5.0"` to `"version": "0.6.0"`. Verify: `bun install --frozen-lockfile`.
Expected: `no changes`.

- [ ] **Step 2: ADR-0035**

Create `docs/adr/0035-shared-material-is-pinned-never-copied.md`:

```markdown
# ADR-0035: Shared material is pinned, never copied

## Status

Accepted. Contract: `SourcePin` (`studio.video/v1alpha1`) in `studio/contracts`;
runtime check in `studio/runtime/src/execution/pins.ts`; `vpr pin`.

## Context

Some material is made once and used by several series: a poem's text,
illustrations, recital take and word timing serve both the short and the long
of one channel. Copying it into each episode makes the copies drift; reading
it in place lets a later edit silently change an episode that was already
reviewed. The Source Snapshot idea ("prevents later source changes from
silently altering an episode") existed only for texts and repositories, and
staleness only between stages of one episode.

## Decision

- Shared material lives in a channel source, `library/<channel>/sources/<name>/`,
  a channel knowledge folder. An episode may also use another episode of the
  same channel as a source. Cross-channel pins are not allowed.
- An episode **pins** what it reads: `source/pins/<id>.json` names the source,
  optionally the paths within it, the stages that read it (`usedBy`), and an
  inventory of every file (hash, size, mtime). An episode's runtime state
  (journal, attempts, reviews, output) and hidden names are never part of it.
- Computing status verifies every pin cheaply — stat every file, hash only
  those whose size or mtime moved — and reports the readers and everything
  downstream of them as stale, naming the changed files. Status writes nothing.
- Accepting a new version is **renewal**: the inventory is rewritten and a
  `staleness-marked` event (trigger `pin:<id>`) keeps the affected stages stale
  until they run again. Renewal hides nothing, so any actor may renew; the
  journal records who.

## Consequences

A changed source can never silently alter an episode: it is either reported as
stale or explicitly renewed and redone. Status costs one stat per pinned file
per poll. Pins are created and renewed from the CLI today; web and agent tools
can call the same service methods later.
```

- [ ] **Step 3: Docs**

In `docs/workspace.md`, in the layout tree, replace

```text
    ├── references/
    ├── skills/
    ├── voices/
```

with

```text
    ├── references/
    ├── skills/
    ├── sources/                        # shared material episodes pin (ADR-0035)
    ├── voices/
```

and, in the episode part of the same tree, replace

```text
                    ├── source/
```

with

```text
                    ├── source/                 # source/pins/<id>.json: pinned shared material
```

In `docs/index.md`: change the "Decision records" link target `./adr/0034-a-layered-kit-based-edit-timeline` and `holds 34 accepted` to `./adr/0035-shared-material-is-pinned-never-copied` and `holds 35 accepted`, and add after the `0034` table row:

```markdown
| [0035](./adr/0035-shared-material-is-pinned-never-copied) | Shared material is pinned with an inventory, never copied |
```

In `studio/contracts/README.md`, after the `narration-takes.schema.json` row of the schema families table, add:

```markdown
| `source-pin.schema.json` | An episode's pin on shared material — a channel source (`<channel>/sources/<name>`) or another episode of the channel — with an inventory (hash, size, mtime per file); verified cheaply by `src/source-pins.mjs` (ADR-0035) |
```

In `studio/contracts/docs/contract-catalog.md`, after the `narration-takes` row of the families table, add:

```markdown
| `source-pin` | Source Pin: shared material an episode reads without copying (channel source or episode), its file inventory and the stages that read it | `vpr pin add`, series compilers | runtime status, `vpr pin renew` | `avg-7zp.5` |
```

- [ ] **Step 4: Run every check**

Run: `cd studio/contracts && npm run check`
Expected: `check:schemas` includes `2 valid and 9 invalid source-pin fixtures passed`; bindings up to date; `node --test` 0 failures.

Run: `npm run docs:build` from the repository root.
Expected: build succeeds.

Run: `npm run check` from the repository root.
Expected: passes (14 modules, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/package.json bun.lock studio/contracts/README.md studio/contracts/docs/contract-catalog.md \
  docs/workspace.md docs/index.md docs/adr/0035-shared-material-is-pinned-never-copied.md
git commit -m "docs: ADR-0035, shared material is pinned, never copied; contracts 0.6.0 (avg-7zp.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

