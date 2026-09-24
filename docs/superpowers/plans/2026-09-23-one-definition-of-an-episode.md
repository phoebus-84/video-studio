# One Definition of an Episode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one declaration of what an episode is, shared by both creators, validated by the doctor, and applied to the existing library on a best-effort basis.

**Architecture:** `@studio/contracts` gains the episode manifest contract and the episode tree. Both creators — the runtime's `initEpisode` and the agent's `createEpisode` — build from that one list instead of their own, and a test pins that they agree. `doctor` validates the manifest's contents rather than its mere presence. A migration tool runs the canonical creator over existing episodes and reports what it skipped.

**Tech Stack:** Node ESM, TypeScript, vitest (runtime/gateway/agent), `node --test` (contracts), Ajv 2020, js-yaml.

**Spec:** `docs/superpowers/specs/2026-09-23-one-definition-of-an-episode-design.md`

## Global Constraints

- **`studio/contracts` has no build step.** It ships ESM `.mjs` with hand-written `.d.mts` beside each module. Any new export must be added to BOTH files.
- **After editing any schema, regenerate the bindings:** `npm run bindings:generate -w studio/contracts`. CI runs `bindings:check` and fails if they drift.
- **`EpisodeMetadata` in `workspace.schema.json` must not be modified.** It is id-addressed and used by `WorkspaceExample`. The new on-disk contract is `EpisodeManifest`.
- **Never fabricate a fact to satisfy a contract.** No invented `createdAt`, no invented ULIDs. A value that is not known is omitted.
- **Nothing under `library/` is ever deleted.** `library/` is gitignored, so there is no git history to recover a deleted file from. Retirement means rename.
- **`packages/*` must not depend on `studio/*`** (`tools/check-boundaries.mjs`). This plan touches only `studio/*` and `tools/`.
- **VitePress compiles every `docs/` markdown as a Vue component.** A bare angle-bracket word in prose outside backticks or a fenced block breaks `npm run docs:build`.
- Test commands: contracts `npm test -w studio/contracts`; runtime `npm test -w studio/runtime` (has a `pretest` build); agent `npm test -w studio/agent`; gateway `npm test -w studio/gateway`.
- Runtime has no `typecheck` script — use `npx tsc --noEmit -p studio/runtime/tsconfig.json`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `studio/contracts/schemas/v1alpha1/workspace.schema.json` | gains `$defs.EpisodeManifest` |
| `studio/contracts/src/episode-manifest.mjs` (new) | renders the manifest to YAML; owns the field list |
| `studio/contracts/src/episode-manifest.d.mts` (new) | its types |
| `studio/contracts/src/layout.mjs` | gains `EPISODE_SCRATCH`, `EPISODE_DIRECTORIES`, `EPISODE_FILES`, `EPISODE_TREE` |
| `studio/runtime/src/workspace/tree.ts` | re-exports the episode tree from contracts |
| `studio/runtime/src/workspace/init.ts` | builds the skeleton from the shared lists |
| `studio/runtime/src/workspace/doctor.ts` | validates `episode.yaml` contents |
| `studio/agent/src/workspace-authoring.ts` | builds from the shared lists; stops writing the top-level `episode.json` |
| `studio/agent/src/workspace-tools.ts` | mutation-queue lock path moves to `episode.yaml` |
| `tools/migrate-episode-manifests.mjs` (new) | best-effort migration |
| `docs/workspace.md` | documents the manifest and the scratch area |

---

## Task 1: The `EpisodeManifest` contract

**Files:**
- Modify: `studio/contracts/schemas/v1alpha1/workspace.schema.json`
- Modify: `studio/contracts/bindings/ts/workspace.ts` (generated — do not hand-edit)
- Test: `studio/contracts/test/workspace-schema.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `$defs.EpisodeManifest` in `workspace.schema.json`, and the generated TypeScript interface `EpisodeManifest` in `bindings/ts/workspace.ts`.

- [ ] **Step 1: Write the failing test**

Append to `studio/contracts/test/workspace-schema.test.mjs`:

```js
test("an episode manifest needs only its apiVersion, kind and slug", () => {
  const { ajv } = createValidator();
  const validate = ajv.getSchema(`${workspace.$id}#/$defs/EpisodeManifest`);
  assert.ok(validate, "EpisodeManifest schema definition is registered");
  assert.equal(validate({
    apiVersion: "studio.video/v1alpha1",
    kind: "Episode",
    slug: "cinderella",
  }), true, ajv.errorsText(validate.errors));
});

test("an episode manifest carries the editorial fields when they are known", () => {
  const { ajv } = createValidator();
  const validate = ajv.getSchema(`${workspace.$id}#/$defs/EpisodeManifest`);
  assert.equal(validate({
    apiVersion: "studio.video/v1alpha1",
    kind: "Episode",
    slug: "giulio-cesare",
    channel: "video-storici",
    series: "roma-pills",
    title: "Julius Caesar: The Man Who Changed Rome",
    description: "Pilot episode validating the complete Roma Pills pipeline.",
    createdAt: "2026-08-22T22:53:12.278Z",
  }), true, ajv.errorsText(validate.errors));
});

test("an episode manifest without a slug is refused", () => {
  const { ajv } = createValidator();
  const validate = ajv.getSchema(`${workspace.$id}#/$defs/EpisodeManifest`);
  assert.equal(validate({ apiVersion: "studio.video/v1alpha1", kind: "Episode" }), false);
});

test("EpisodeMetadata still demands its identifiers and settings", () => {
  // EpisodeManifest exists precisely so this one does not have to be loosened.
  // A change that relaxes EpisodeMetadata should fail here first.
  const meta = workspace.$defs.EpisodeMetadata;
  assert.deepEqual(
    [...meta.required].sort(),
    ["apiVersion", "episodeId", "kind", "seriesId", "settings", "slug", "title"],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w studio/contracts`
Expected: FAIL — "EpisodeManifest schema definition is registered" assertion fails because the definition does not exist.

- [ ] **Step 3: Add the definition**

In `studio/contracts/schemas/v1alpha1/workspace.schema.json`, inside `$defs`, immediately after the `EpisodeMetadata` definition, add:

```json
"EpisodeManifest": {
  "type": "object",
  "additionalProperties": false,
  "description": "The episode manifest as it exists on disk at episode.yaml. Addressed by path and slug, not by identifier — which is what distinguishes it from EpisodeMetadata, the id-addressed aggregate view. Only slug is required: the directory name already proves it, and every other fact may legitimately be unknown for an episode created before this contract existed.",
  "required": ["apiVersion", "kind", "slug"],
  "properties": {
    "apiVersion": { "$ref": "#/$defs/ResourceVersion" },
    "kind": { "const": "Episode" },
    "slug": { "$ref": "identity.schema.json#/$defs/Slug" },
    "channel": { "$ref": "identity.schema.json#/$defs/Slug" },
    "series": { "$ref": "identity.schema.json#/$defs/Slug" },
    "title": { "type": "string", "minLength": 1, "maxLength": 160 },
    "description": { "type": "string", "maxLength": 2000 },
    "createdAt": { "$ref": "identity.schema.json#/$defs/Timestamp" },
    "settings": {
      "$ref": "#/$defs/SettingsLayer",
      "description": "Episode-level overrides only. Settings resolve system -> channel -> series -> episode, so an episode that overrides nothing omits this key rather than restating what it inherits."
    }
  }
}
```

Add a cross-reference to `EpisodeMetadata` by adding this `description` key to it (adding a description does not change what it accepts):

```json
"description": "The id-addressed view of an episode, used by WorkspaceExample. For the file on disk see EpisodeManifest."
```

- [ ] **Step 4: Regenerate the TypeScript bindings**

Run: `npm run bindings:generate -w studio/contracts`
Expected: `bindings/ts/workspace.ts` gains an `EpisodeManifest` interface. Do not hand-edit that file.

- [ ] **Step 5: Run the tests**

Run: `npm test -w studio/contracts && npm run bindings:check -w studio/contracts && npm run check:schemas -w studio/contracts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/contracts/schemas/v1alpha1/workspace.schema.json studio/contracts/bindings/ts/workspace.ts studio/contracts/test/workspace-schema.test.mjs
git commit -m "feat(contracts): declare the on-disk episode manifest"
```

---

## Task 2: The episode tree and the manifest renderer

**Files:**
- Modify: `studio/contracts/src/layout.mjs`
- Modify: `studio/contracts/src/layout.d.mts`
- Create: `studio/contracts/src/episode-manifest.mjs`
- Create: `studio/contracts/src/episode-manifest.d.mts`
- Test: `studio/contracts/test/layout.test.mjs` (new), `studio/contracts/test/episode-manifest.test.mjs` (new)

**Interfaces:**
- Consumes: Task 1's `EpisodeManifest` schema (only conceptually — this task writes no validator).
- Produces, from `@studio/contracts/src/layout.mjs`:
  - `EPISODE_SCRATCH: string` — the literal `"production"`
  - `EPISODE_DIRECTORIES: readonly string[]` — directories a creator makes
  - `EPISODE_FILES: readonly string[]` — files a creator seeds
  - `EPISODE_SEED_FILES: Readonly<Record<string, string>>` — seed body for every seeded file except `episode.yaml`
  - `EPISODE_TREE: readonly string[]` — everything a valid episode must have
- Produces, from `@studio/contracts/src/episode-manifest.mjs`:
  - `EPISODE_MANIFEST_FILE: string` — the literal `"episode.yaml"`
  - `renderEpisodeManifest(fields: EpisodeManifestFields): string`

- [ ] **Step 1: Write the failing tests**

Create `studio/contracts/test/layout.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  EPISODE_SCRATCH,
  EPISODE_DIRECTORIES,
  EPISODE_FILES,
  EPISODE_SEED_FILES,
  EPISODE_TREE,
} from "../src/layout.mjs";

test("the scratch area is named and is part of the tree", () => {
  assert.equal(EPISODE_SCRATCH, "production");
  assert.ok(EPISODE_DIRECTORIES.includes(EPISODE_SCRATCH));
  assert.ok(EPISODE_TREE.includes(EPISODE_SCRATCH));
});

test("the tree is exactly the directories plus the files plus the workspace marker", () => {
  assert.deepEqual(
    [...EPISODE_TREE].sort(),
    [...EPISODE_DIRECTORIES, ...EPISODE_FILES,
     ".workspace/contract.json", ".workspace/metadata.json"].sort(),
  );
});

test("the tree keeps the directories the artifact resolver already looks in", () => {
  // discovery.ts maps animated-visuals.mp4 to assets/animation/visuals.mp4, so
  // an episode without that directory is missing one the resolver searches.
  for (const dir of ["assets/images", "assets/graphics", "assets/audio", "assets/animation"]) {
    assert.ok(EPISODE_DIRECTORIES.includes(dir), `${dir} is missing`);
  }
});

test("every seeded file except the manifest has a fixed body", () => {
  // episode.yaml is deliberately absent: its body names the episode, so
  // renderEpisodeManifest builds it rather than a constant.
  assert.deepEqual(
    Object.keys(EPISODE_SEED_FILES).sort(),
    EPISODE_FILES.filter((f) => f !== "episode.yaml").slice().sort(),
  );
});

test("the seeded JSON bodies parse and end with a newline", () => {
  for (const [name, body] of Object.entries(EPISODE_SEED_FILES)) {
    if (!name.endsWith(".json")) continue;
    assert.doesNotThrow(() => JSON.parse(body), name);
    assert.ok(body.endsWith("\n"), `${name} should end with a newline`);
  }
});

test("the lists are frozen", () => {
  assert.throws(() => { EPISODE_TREE.push("nope"); });
});
```

Create `studio/contracts/test/episode-manifest.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { EPISODE_MANIFEST_FILE, renderEpisodeManifest } from "../src/episode-manifest.mjs";

test("the manifest file is episode.yaml", () => {
  assert.equal(EPISODE_MANIFEST_FILE, "episode.yaml");
});

test("a manifest with only a slug renders the required keys and nothing else", () => {
  const out = renderEpisodeManifest({ slug: "cinderella" });
  assert.match(out, /^apiVersion: studio\.video\/v1alpha1$/m);
  assert.match(out, /^kind: Episode$/m);
  assert.match(out, /^slug: "cinderella"$/m);
  assert.doesNotMatch(out, /^title:/m);
  assert.doesNotMatch(out, /^createdAt:/m);
  assert.ok(out.endsWith("\n"));
});

test("an unknown field is omitted rather than written empty", () => {
  // The migration has episodes with no recorded creation time. A manifest
  // claiming `createdAt: ""` would be asserting a fact nobody holds.
  const out = renderEpisodeManifest({ slug: "tomb", title: "Tomb", createdAt: undefined });
  assert.doesNotMatch(out, /createdAt/);
});

test("values are quoted, so a colon in a title cannot break the document", () => {
  const out = renderEpisodeManifest({
    slug: "giulio-cesare",
    title: "Julius Caesar: The Man Who Changed Rome",
  });
  assert.match(out, /^title: "Julius Caesar: The Man Who Changed Rome"$/m);
});

test("a quote in a title is escaped", () => {
  const out = renderEpisodeManifest({ slug: "x", title: 'The "Best" Episode' });
  assert.match(out, /^title: "The \\"Best\\" Episode"$/m);
});

test("a manifest without a slug is refused", () => {
  assert.throws(() => renderEpisodeManifest({ title: "No slug" }), /slug/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w studio/contracts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `episode-manifest.mjs`, and `EPISODE_SCRATCH` undefined.

- [ ] **Step 3: Add the lists to `layout.mjs`**

In `studio/contracts/src/layout.mjs`, after the `WORKSPACE_DIR` export, add:

```js
/**
 * The episode's scratch area.
 *
 * Work in progress that no stage may declare as an output and no artifact
 * resolver may treat as an artifact. It exists because it already existed:
 * five episodes hold hand-made experiments here (`animated-scenes`,
 * `cinematic-v2`, `hybrid-v1`, `pipeline-smoke`, `remotion-infographic`) and
 * no journal event in the library references any of them. Declaring it turns
 * an accidental blind spot into a deliberate exclusion.
 */
export const EPISODE_SCRATCH = "production";

/**
 * Directories every episode has.
 *
 * The union of what the two creators made before they were unified, not the
 * intersection: `assets/animation` is here because the artifact resolver
 * already looks in it, and an episode lacking it is missing a directory the
 * resolver searches.
 */
export const EPISODE_DIRECTORIES = Object.freeze([
  "source",
  "artifacts",
  "prompts",
  "assets/images",
  "assets/graphics",
  "assets/audio",
  "assets/animation",
  "attempts",
  "reviews",
  "journal",
  "output",
  EPISODE_SCRATCH,
]);

/** Files every episode is seeded with. */
export const EPISODE_FILES = Object.freeze([
  "episode.yaml",
  "assets/manifest.json",
  "reviews/threads.jsonl",
  "journal/events.jsonl",
  "output/current.json",
]);

/**
 * The seed content for every episode file whose initial body is fixed.
 *
 * `episode.yaml` is absent because its body is not fixed — it names the
 * episode, and `renderEpisodeManifest` builds it.
 *
 * The bodies live here because three separate creators wrote them
 * independently before this module existed: the runtime's `initEpisode`, the
 * agent's `createEpisodeWorkspace`, and the migration tool. Three verbatim
 * copies of one document is the duplication this contract removes.
 */
export const EPISODE_SEED_FILES = Object.freeze({
  "assets/manifest.json":
    `${JSON.stringify({ apiVersion: "v1alpha1", kind: "AssetManifest", assets: [] }, null, 2)}\n`,
  "reviews/threads.jsonl": "",
  "journal/events.jsonl": "",
  "output/current.json":
    `${JSON.stringify({ apiVersion: "v1alpha1", kind: "CurrentDeliverable", renderId: null }, null, 2)}\n`,
});

/**
 * Everything a valid episode must have.
 *
 * One list serves both creation and validation deliberately. Two lists — one
 * for what a creator makes, one for what a checker demands — is how the two
 * creators came to disagree in the first place.
 */
export const EPISODE_TREE = Object.freeze([
  ...EPISODE_DIRECTORIES,
  ...EPISODE_FILES,
  `${WORKSPACE_DIR}/contract.json`,
  `${WORKSPACE_DIR}/metadata.json`,
]);
```

- [ ] **Step 4: Declare them in `layout.d.mts`**

Add to `studio/contracts/src/layout.d.mts`, after `WORKSPACE_DIR`:

```ts
export declare const EPISODE_SCRATCH: string;
export declare const EPISODE_DIRECTORIES: readonly string[];
export declare const EPISODE_FILES: readonly string[];
export declare const EPISODE_SEED_FILES: Readonly<Record<string, string>>;
export declare const EPISODE_TREE: readonly string[];
```

- [ ] **Step 5: Create the manifest renderer**

Create `studio/contracts/src/episode-manifest.mjs`:

```js
/**
 * The episode manifest as it exists on disk.
 *
 * Rendering lives here rather than in either creator because both write this
 * file, and two string templates producing "the same" YAML is exactly the
 * duplication this module exists to remove.
 *
 * Only rendering. Parsing needs a YAML library and this package has no runtime
 * dependencies; whoever reads the file brings their own parser.
 */

/** The manifest's filename, relative to the episode directory. */
export const EPISODE_MANIFEST_FILE = "episode.yaml";

/**
 * Render an episode manifest.
 *
 * A field whose value is absent is omitted from the document entirely. It is
 * never written empty: a manifest claiming `createdAt: ""` asserts a fact
 * nobody holds, and this file's whole purpose is to be authoritative.
 *
 * Scalars are emitted as JSON strings, which are valid double-quoted YAML
 * scalars. That is what keeps a colon in a title from ending the document.
 */
export function renderEpisodeManifest(fields) {
  const { slug, channel, series, title, description, createdAt } = fields ?? {};
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("an episode manifest must name its slug");
  }
  const lines = [
    "# Episode manifest. See docs/workspace.md.",
    "apiVersion: studio.video/v1alpha1",
    "kind: Episode",
    `slug: ${JSON.stringify(slug)}`,
  ];
  const optional = { channel, series, title, description, createdAt };
  for (const [key, value] of Object.entries(optional)) {
    if (typeof value === "string" && value.length > 0) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
```

Create `studio/contracts/src/episode-manifest.d.mts`:

```ts
// Type declarations for the on-disk episode manifest.

export interface EpisodeManifestFields {
  slug: string;
  channel?: string;
  series?: string;
  title?: string;
  description?: string;
  createdAt?: string;
}

export declare const EPISODE_MANIFEST_FILE: string;
export declare function renderEpisodeManifest(fields: EpisodeManifestFields): string;
```

- [ ] **Step 6: Run the tests**

Run: `npm test -w studio/contracts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts/src/layout.mjs studio/contracts/src/layout.d.mts studio/contracts/src/episode-manifest.mjs studio/contracts/src/episode-manifest.d.mts studio/contracts/test/layout.test.mjs studio/contracts/test/episode-manifest.test.mjs
git commit -m "feat(contracts): one episode tree, one manifest renderer"
```

---

## Task 3: The runtime creator builds from the shared lists

**Files:**
- Modify: `studio/runtime/src/workspace/tree.ts`
- Modify: `studio/runtime/src/workspace/init.ts` (`createEpisodeSkeleton`, around line 437)
- Test: `studio/runtime/test/unit/workspace/episode-tree-agreement.test.ts` (new)

**Interfaces:**
- Consumes: `EPISODE_DIRECTORIES`, `EPISODE_SEED_FILES`, `EPISODE_TREE` from `@studio/contracts/src/layout.mjs`; `EPISODE_MANIFEST_FILE`, `renderEpisodeManifest` from `@studio/contracts/src/episode-manifest.mjs`.
- Produces: `EPISODE_TREE` re-exported from `studio/runtime/src/workspace/tree.ts`, unchanged in name so `doctor.ts` and `TREE_BY_KIND` need no edit.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/unit/workspace/episode-tree-agreement.test.ts`:

```ts
// ── One episode tree, one creator's output ──────────────────────────────────
//
// Two creators used to build different episodes: the agent's made
// `episode.json`, `artifacts/episode.json` and `production/`; the runtime's
// made none of them. EPISODE_TREE described only the runtime's, so an episode
// from either creator disagreed with the contract in a different direction.
//
// This pins that what the runtime creates is exactly what the contract
// declares. The agent's half is pinned in studio/agent's own suite.

import { describe, expect, it, beforeEach } from "vitest";
import { EPISODE_TREE as CONTRACT_TREE } from "@studio/contracts/src/layout.mjs";
import { EPISODE_TREE } from "../../../src/workspace/tree.js";
import { FakeFileSystem, FakeClock } from "../../fixtures/index.js";
import { initChannel, initSeries, initEpisode } from "../../../src/workspace/init.js";
import type { InitOptions } from "../../../src/workspace/init.js";

function makeOpts(fs: FakeFileSystem): InitOptions {
  return { fs, clock: new FakeClock() };
}

/** Build a channel, a series and one episode; return the episode's path. */
async function makeEpisode(fs: FakeFileSystem): Promise<string> {
  const opts = makeOpts(fs);
  const chR = await initChannel("/library", "ch", {}, opts);
  if (!chR.ok) throw new Error("channel failed");
  const srR = await initSeries(chR.value.path, "s1", {}, opts);
  if (!srR.ok) throw new Error("series failed");
  const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
  if (!epR.ok) throw new Error("episode failed");
  return epR.value.path;
}

describe("the episode tree", () => {
  let fs: FakeFileSystem;

  beforeEach(() => {
    fs = new FakeFileSystem();
    fs.seed({ "/library/.keep": "" });
  });

  it("is the contract's list, not a second copy", () => {
    expect([...EPISODE_TREE]).toEqual([...CONTRACT_TREE]);
  });

  it("is exactly what initEpisode creates", async () => {
    const episodePath = await makeEpisode(fs);
    for (const relPath of EPISODE_TREE) {
      const existsR = await fs.exists(`${episodePath}/${relPath}`);
      expect(existsR.ok && existsR.value, `missing ${relPath}`).toBe(true);
    }
  });

  it("writes a manifest that names the episode", async () => {
    const episodePath = await makeEpisode(fs);
    const read = await fs.readText(`${episodePath}/episode.yaml`);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toContain("kind: Episode");
    expect(read.value).toContain('slug: "ep-01"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w studio/runtime -- episode-tree-agreement`
Expected: FAIL — `production`, `assets/animation` and the manifest keys are missing.

- [ ] **Step 3: Re-export the tree in `tree.ts`**

Replace the `EPISODE_TREE` block in `studio/runtime/src/workspace/tree.ts` with:

```ts
/**
 * Files and directories created at the episode level.
 *
 * Re-exported from @studio/contracts rather than declared here: the agent has
 * its own episode creator and cannot import this module, so the one place both
 * can read from is contracts. Pinned by
 * test/unit/workspace/episode-tree-agreement.test.ts.
 */
import { EPISODE_TREE } from "@studio/contracts/src/layout.mjs";
export { EPISODE_TREE };
```

A bare `export ... from` does NOT create a local binding, and `TREE_BY_KIND`
below references `EPISODE_TREE` directly — so the re-export alone does not
compile. Import it and re-export the same binding.

Leave `CHANNEL_TREE` and `SERIES_TREE` exactly as they are. `TREE_BY_KIND` needs no change.

- [ ] **Step 4: Build the skeleton from the shared lists**

In `studio/runtime/src/workspace/init.ts`, add to the imports:

```ts
import {
  EPISODE_DIRECTORIES,
  EPISODE_SEED_FILES,
} from "@studio/contracts/src/layout.mjs";
import {
  EPISODE_MANIFEST_FILE,
  renderEpisodeManifest,
} from "@studio/contracts/src/episode-manifest.mjs";
```

Replace the body of `createEpisodeSkeleton` with:

```ts
async function createEpisodeSkeleton(
  wsPath: string,
  slug: string,
  now: string,
  opts: InitOptions,
): Promise<void> {
  // The manifest. Rendered by contracts so the agent's creator writes the
  // same document from the same code.
  await writeIfMissing(
    opts, `${wsPath}/${EPISODE_MANIFEST_FILE}`,
    renderEpisodeManifest({ slug, createdAt: now }),
  );

  // Directories, from the one declared list.
  await makeDirs(opts, wsPath, EPISODE_DIRECTORIES);

  // Seeded files, with the bodies the contract declares. These used to be
  // written out longhand here, in the agent's creator, and in the migration
  // tool — three copies of the same four documents.
  for (const [relative, content] of Object.entries(EPISODE_SEED_FILES)) {
    await writeIfMissing(opts, `${wsPath}/${relative}`, content);
  }
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm test -w studio/runtime`
Expected: PASS. If `test/e2e/canonical-tree.test.ts` fails on the new entries, update its expected list — it asserts the canonical tree and the canonical tree has legitimately grown.

Run: `npx tsc --noEmit -p studio/runtime/tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime/src/workspace/tree.ts studio/runtime/src/workspace/init.ts studio/runtime/test/
git commit -m "feat(runtime): build the episode from the declared tree"
```

---

## Task 4: The agent creator builds from the same lists

**Files:**
- Modify: `studio/agent/src/workspace-authoring.ts` (`createEpisode`, lines 260-300)
- Modify: `studio/agent/src/workspace-tools.ts:134`
- Test: `studio/agent/tests/workspace-authoring.test.ts`

**Interfaces:**
- Consumes: `EPISODE_DIRECTORIES`, `EPISODE_SEED_FILES` from `@studio/contracts/src/layout.mjs`; `EPISODE_MANIFEST_FILE`, `renderEpisodeManifest` from `@studio/contracts/src/episode-manifest.mjs`.
- Produces: `createEpisode` no longer writes `[episode]/episode.json`. It still writes `artifacts/episode.json`, which is the scene spine and a different document.

- [ ] **Step 1: Write the failing test**

In `studio/agent/tests/workspace-authoring.test.ts`, add:

```ts
it("writes one manifest, and it is the yaml one", async () => {
  const { episode } = await seedWorkspace();
  expect(episode.createdFiles).toContain(`${EPISODE_DIR}/episode.yaml`);
  // The top-level episode.json is retired. artifacts/episode.json is the scene
  // spine — a different document that the gateway and the web app read — and
  // must survive.
  expect(episode.createdFiles).not.toContain(`${EPISODE_DIR}/episode.json`);
  expect(episode.createdFiles).toContain(`${EPISODE_DIR}/artifacts/episode.json`);
});

it("records the title and the description in the manifest", async () => {
  await seedWorkspace();
  const text = await readFile(join(libraryRoot, EPISODE_DIR, "episode.yaml"), "utf-8");
  expect(text).toContain("kind: Episode");
  expect(text).toContain('slug: "the-run-up"');
  expect(text).toContain('title: "The Run-Up"');
  expect(text).toContain('description: "Pipeline validation pilot."');
  expect(text).toContain('channel: "wordless-comedy"');
  expect(text).toContain('series: "give-me-time"');
});

it("creates every directory the contract declares", async () => {
  await seedWorkspace();
  for (const dir of EPISODE_DIRECTORIES) {
    expect(
      await isDirectory(join(libraryRoot, EPISODE_DIR, dir)),
      `missing ${dir}`,
    ).toBe(true);
  }
});
```

These reuse what the file already has: the setup helper at line 46 that calls
`createEpisodeWorkspace({ channel: "wordless-comedy", series: "give-me-time",
slug: "the-run-up", title: "The Run-Up", description: "Pipeline validation
pilot.", episodeRequest: ... }, libraryRoot)` and returns `{ channel, series,
episode }`; the `EPISODE_DIR` constant at line 58; and the `isDirectory` helper
at line 24. Name the setup helper call `seedWorkspace()` to match whatever that
function is actually called in the file — read line 40 to line 55 first. Add
`import { EPISODE_DIRECTORIES } from "@studio/contracts/src/layout.mjs";` to the
test's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w studio/agent -- workspace-authoring`
Expected: FAIL — `episode.json` is still created and `episode.yaml` lacks the title.

- [ ] **Step 3: Rewrite the episode half of `createEpisode`**

In `studio/agent/src/workspace-authoring.ts`, add the imports:

```ts
import { EPISODE_DIRECTORIES, EPISODE_SEED_FILES } from "@studio/contracts/src/layout.mjs";
import { EPISODE_MANIFEST_FILE, renderEpisodeManifest } from "@studio/contracts/src/episode-manifest.mjs";
```

Replace the directory loop at line 262:

```ts
for (const relative of EPISODE_DIRECTORIES) {
  await mkdir(path.join(dir, relative), { recursive: true });
}
```

Delete the second directory loop (the one at line 291 creating `source`, `prompts`, `assets/images`, `assets/graphics`, `attempts`, `journal`) — `EPISODE_DIRECTORIES` now covers all of them.

Replace the four `writeExclusive` calls that seed `assets/manifest.json`,
`reviews/threads.jsonl`, `journal/events.jsonl` and `output/current.json`
(lines 294-305) with the contract's bodies:

```ts
for (const [relative, content] of Object.entries(EPISODE_SEED_FILES)) {
  await writeExclusive(root, path.join(dir, relative), content, result);
}
```

Leave the `episodeRequest` and `pipelineYaml` writes that follow them exactly as
they are — those are caller-supplied content, not seed content.

Delete the `writeExclusive` call that writes `path.join(dir, "episode.json")` (line 274). **Keep** the one writing `path.join(dir, "artifacts", "episode.json")`.

Replace the `episode.yaml` write (line 290) with:

```ts
const now = new Date().toISOString();
await writeExclusive(root, path.join(dir, EPISODE_MANIFEST_FILE), renderEpisodeManifest({
  slug: input.slug,
  channel: input.channel,
  series: input.series,
  title: input.title.trim(),
  description: input.description.trim(),
  createdAt: now,
}), result);
```

- [ ] **Step 4: Move the mutation-queue lock path**

In `studio/agent/src/workspace-tools.ts`, at line 134, change the lock path from `"episode.json"` to `"episode.yaml"`. Add above it:

```ts
// The queue keys on a path, not on a file it reads. It follows the manifest so
// two calls creating the same episode still serialise on the same key.
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w studio/agent`
Expected: PASS. A test asserting `existingFiles` contains `episode.json` (around line 138) is asserting retired behaviour — update it to `episode.yaml`.

- [ ] **Step 6: Commit**

```bash
git add studio/agent/src/workspace-authoring.ts studio/agent/src/workspace-tools.ts studio/agent/tests/workspace-authoring.test.ts
git commit -m "feat(agent): one manifest, from the declared tree"
```

---

## Task 5: The doctor validates the manifest's contents

**Files:**
- Modify: `studio/runtime/src/workspace/doctor.ts`
- Test: `studio/runtime/test/unit/workspace/doctor.test.ts`

**Interfaces:**
- Consumes: `EPISODE_MANIFEST_FILE` from contracts; `js-yaml`, `ajv` and `ajv-formats` (all three already runtime dependencies); `workspace.schema.json` and `identity.schema.json` from `@studio/contracts/schemas/v1alpha1/`.
- Produces: a new finding code `E_INVALID_MANIFEST`.

- [ ] **Step 1: Write the failing test**

Add to `studio/runtime/test/unit/workspace/doctor.test.ts`:

```ts
// These extend the existing `describe("doctor")` block, which already builds a
// channel, a series and `ep-01` in `beforeEach`. `EP` is that episode's path.
const EP = "/library/ch/series/s1/episodes/ep-01";

it("reports an episode.yaml that is not valid YAML", async () => {
  // A check that confirms presence while reporting validity is the defect this
  // branch exists to remove: an empty or broken manifest passed before.
  const opts = makeOpts(fs);
  const chR = await initChannel("/library", "ch", {}, opts);
  if (!chR.ok) throw new Error("channel failed");
  const srR = await initSeries(chR.value.path, "s1", {}, opts);
  if (!srR.ok) throw new Error("series failed");
  const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
  if (!epR.ok) throw new Error("episode failed");

  await fs.writeText(`${EP}/episode.yaml`, "kind: [unclosed");
  const report = await doctor({ fs, libraryRoot: "/library" });
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.value.findings.some((f) => f.code === "E_INVALID_MANIFEST")).toBe(true);
});

it("reports an episode.yaml that parses but is not an episode manifest", async () => {
  const opts = makeOpts(fs);
  const chR = await initChannel("/library", "ch", {}, opts);
  if (!chR.ok) throw new Error("channel failed");
  const srR = await initSeries(chR.value.path, "s1", {}, opts);
  if (!srR.ok) throw new Error("series failed");
  const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
  if (!epR.ok) throw new Error("episode failed");

  await fs.writeText(`${EP}/episode.yaml`, "kind: Series\nslug: x\n");
  const report = await doctor({ fs, libraryRoot: "/library" });
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.value.findings.some((f) => f.code === "E_INVALID_MANIFEST")).toBe(true);
});

it("reports a manifest whose title is the wrong type", async () => {
  // The point of validating against the schema rather than by hand: a
  // hand-rolled kind-and-slug check would pass this.
  const opts = makeOpts(fs);
  const chR = await initChannel("/library", "ch", {}, opts);
  if (!chR.ok) throw new Error("channel failed");
  const srR = await initSeries(chR.value.path, "s1", {}, opts);
  if (!srR.ok) throw new Error("series failed");
  const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
  if (!epR.ok) throw new Error("episode failed");

  await fs.writeText(
    `${EP}/episode.yaml`,
    'apiVersion: studio.video/v1alpha1\nkind: Episode\nslug: "ep-01"\ntitle: 7\n',
  );
  const report = await doctor({ fs, libraryRoot: "/library" });
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.value.findings.some((f) => f.code === "E_INVALID_MANIFEST")).toBe(true);
});

it("accepts the manifest initEpisode writes", async () => {
  const opts = makeOpts(fs);
  const chR = await initChannel("/library", "ch", {}, opts);
  if (!chR.ok) throw new Error("channel failed");
  const srR = await initSeries(chR.value.path, "s1", {}, opts);
  if (!srR.ok) throw new Error("series failed");
  const epR = await initEpisode(srR.value.path, "ep-01", {}, opts);
  if (!epR.ok) throw new Error("episode failed");

  const report = await doctor({ fs, libraryRoot: "/library" });
  expect(report.ok).toBe(true);
  if (!report.ok) return;
  expect(report.value.findings.filter((f) => f.code === "E_INVALID_MANIFEST")).toEqual([]);
});
```

`doctor` takes one options object — `doctor({ fs, libraryRoot })` — not a path
and an options pair. `FakeFileSystem`, `FakeClock` and `makeOpts` already exist
at the top of this file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w studio/runtime -- doctor`
Expected: FAIL — no finding has code `E_INVALID_MANIFEST`.

- [ ] **Step 3: Validate the manifest**

In `studio/runtime/src/workspace/doctor.ts`, add after `validateJsonFiles`:

```ts
/**
 * Validate the episode manifest's contents, not just its presence.
 *
 * Presence was the whole check before: an empty `episode.yaml`, or one holding
 * a series document, passed. A check that reports something other than what it
 * verified is the defect this module is being cleaned of.
 *
 * Validated against the schema rather than by hand, because a contract no code
 * reads is how `EpisodeMetadata` came to be inert.
 */
async function validateEpisodeManifest(
  fs: FileSystem,
  wsPath: string,
  findings: DoctorFinding[],
): Promise<void> {
  const fullPath = `${wsPath}/${EPISODE_MANIFEST_FILE}`;
  const existsR = await fs.exists(fullPath);
  if (!existsR.ok || !existsR.value) return; // already reported as missing

  const readR = await fs.readText(fullPath);
  if (!readR.ok) {
    findings.push({
      level: "episode", path: fullPath, code: "E_READ_ERROR",
      message: `Cannot read file: ${readR.error.message}`,
    });
    return;
  }

  let parsed: unknown;
  try {
    parsed = loadYaml(readR.value);
  } catch (error) {
    findings.push({
      level: "episode", path: fullPath, code: "E_INVALID_MANIFEST",
      message: `Not valid YAML: ${(error as Error).message}`,
    });
    return;
  }

  // A YAML document holding only comments parses to undefined, which Ajv would
  // report as a type error rather than as the empty file it is.
  if (parsed === undefined || parsed === null) {
    findings.push({
      level: "episode", path: fullPath, code: "E_INVALID_MANIFEST",
      message: "Episode manifest is empty",
    });
    return;
  }

  if (!validateEpisodeManifestSchema(parsed)) {
    const detail = (validateEpisodeManifestSchema.errors ?? [])
      .map((err: ErrorObject) => `${err.instancePath || "/"} ${err.message}`)
      .join("; ");
    findings.push({
      level: "episode", path: fullPath, code: "E_INVALID_MANIFEST",
      message: `Episode manifest does not match the contract: ${detail}`,
    });
  }
}
```

Add the imports and the validator at the top of the file. This mirrors
`studio/runtime/src/pipeline/fs-loader.ts:10-16` and `:137-145` — the module
that already validates a contract schema in this package. Copy its shape rather
than inventing another:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load as loadYaml } from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { EPISODE_MANIFEST_FILE } from "@studio/contracts/src/episode-manifest.mjs";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => Ajv2020;

// workspace.schema.json $refs identity.schema.json, so both go in.
const workspaceSchema = JSON.parse(readFileSync(
  require.resolve("@studio/contracts/schemas/v1alpha1/workspace.schema.json"), "utf-8"));
const identitySchema = JSON.parse(readFileSync(
  require.resolve("@studio/contracts/schemas/v1alpha1/identity.schema.json"), "utf-8"));

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(identitySchema);
ajv.addSchema(workspaceSchema);
const validateEpisodeManifestSchema =
  ajv.getSchema(`${workspaceSchema.$id}#/$defs/EpisodeManifest`)!;
```

Call it from the episode branch of the tree check, right after `await validateJsonFiles(fs, wsPath, kind, findings);`:

```ts
if (kind === "episode") await validateEpisodeManifest(fs, wsPath, findings);
```

Add `E_INVALID_MANIFEST` to the `DoctorFinding` code union wherever that type is declared — run `grep -n "E_MISSING_REQUIRED" studio/runtime/src/workspace/*.ts` to find it.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -w studio/runtime && npx tsc --noEmit -p studio/runtime/tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add studio/runtime/src/workspace/doctor.ts studio/runtime/test/unit/workspace/doctor.test.ts
git commit -m "feat(runtime): doctor validates the manifest, not just its presence"
```

---

## Task 6: The migration tool

**Files:**
- Create: `tools/migrate-episode-manifests.mjs`
- Test: `studio/runtime/test/e2e/migrate-episode-manifests.test.ts` (new)

**Interfaces:**
- Consumes: `SERIES_CONTAINER`, `EPISODES_CONTAINER`, `EPISODE_DIRECTORIES`, `EPISODE_SEED_FILES` from `../studio/contracts/src/layout.mjs`; `EPISODE_MANIFEST_FILE`, `renderEpisodeManifest` from `../studio/contracts/src/episode-manifest.mjs`.
- Produces: a CLI. `node tools/migrate-episode-manifests.mjs --library <path> [--dry-run]`.

**Read first:** `tools/migrate-library-layout.mjs`. Match its argument parsing, its printing style, and its promise that nothing is deleted.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/e2e/migrate-episode-manifests.test.ts`. It builds a fixture library on a real temp directory (the tool is a script that uses real `fs`), runs the tool with `execFileSync`, and asserts:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = join(process.cwd(), "..", "..", "tools", "migrate-episode-manifests.mjs");

let root: string;

async function episode(channel: string, series: string, slug: string): Promise<string> {
  const dir = join(root, channel, "series", series, "episodes", slug);
  await mkdir(dir, { recursive: true });
  return dir;
}
const exists = async (p: string) => access(p).then(() => true, () => false);
const run = (...args: string[]) =>
  execFileSync("node", [TOOL, "--library", root, ...args], { encoding: "utf-8" });

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "mig-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("migrate-episode-manifests", () => {
  it("writes a manifest for a bare episode and fills the skeleton", async () => {
    const dir = await episode("childrens", "fairy-tales", "cinderella");
    await mkdir(join(dir, "artifacts"), { recursive: true });

    run();

    const yaml = await readFile(join(dir, "episode.yaml"), "utf-8");
    expect(yaml).toContain("kind: Episode");
    expect(yaml).toContain('slug: "cinderella"');
    expect(yaml).toContain('title: "Cinderella"');
    // No creation time is known for this episode, and inventing one would be
    // asserting a fact nobody holds.
    expect(yaml).not.toContain("createdAt");
    expect(await exists(join(dir, "journal/events.jsonl"))).toBe(true);
    expect(await exists(join(dir, "production"))).toBe(true);
  });

  it("folds episode.json into the manifest and retires it by renaming", async () => {
    const dir = await episode("video-storici", "roma-pills", "giulio-cesare");
    await writeFile(join(dir, "episode.json"), JSON.stringify({
      version: 1, channel: "video-storici", series: "roma-pills",
      slug: "giulio-cesare", title: "Julius Caesar", description: "A pilot.",
    }));

    run();

    const yaml = await readFile(join(dir, "episode.yaml"), "utf-8");
    expect(yaml).toContain('title: "Julius Caesar"');
    expect(yaml).toContain('description: "A pilot."');
    // Nothing under library/ is ever deleted: library/ is gitignored, so a
    // deleted file is gone for good.
    expect(await exists(join(dir, "episode.json"))).toBe(false);
    expect(await exists(join(dir, ".episode.json.migrated"))).toBe(true);
  });

  it("leaves artifacts/episode.json alone — it is the scene spine", async () => {
    const dir = await episode("ch", "s", "ep");
    await mkdir(join(dir, "artifacts"), { recursive: true });
    const spine = JSON.stringify({ version: 1, scenes: [{ id: "s1" }] });
    await writeFile(join(dir, "artifacts", "episode.json"), spine);

    run();

    expect(await readFile(join(dir, "artifacts", "episode.json"), "utf-8")).toBe(spine);
  });

  it("skips and reports an episode whose two manifests disagree", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.yaml"), 'kind: Episode\nslug: "ep"\ntitle: "One"\n');
    await writeFile(join(dir, "episode.json"), JSON.stringify({ slug: "ep", title: "Two" }));

    const out = run();

    expect(out).toMatch(/skip/i);
    expect(out).toContain("ep");
    expect(await readFile(join(dir, "episode.yaml"), "utf-8")).toContain('title: "One"');
    expect(await exists(join(dir, "episode.json"))).toBe(true);
  });

  it("skips an episode whose episode.json will not parse", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.json"), "{not json");

    const out = run();

    expect(out).toMatch(/skip/i);
    expect(await exists(join(dir, "episode.yaml"))).toBe(false);
  });

  it("changes nothing under --dry-run", async () => {
    const dir = await episode("ch", "s", "ep");
    const out = run("--dry-run");
    expect(out).toContain("episode.yaml");
    expect(await exists(join(dir, "episode.yaml"))).toBe(false);
  });

  it("is idempotent", async () => {
    const dir = await episode("ch", "s", "ep");
    run();
    const first = await readFile(join(dir, "episode.yaml"), "utf-8");
    const out = run();
    expect(await readFile(join(dir, "episode.yaml"), "utf-8")).toBe(first);
    expect(out).not.toMatch(/error/i);
  });

  it("exits zero even when it skipped episodes", async () => {
    const dir = await episode("ch", "s", "ep");
    await writeFile(join(dir, "episode.json"), "{not json");
    // A skip is a normal outcome, not a failure: execFileSync throws on a
    // non-zero exit, so reaching the assertion is the assertion.
    expect(() => run()).not.toThrow();
  });
});
```

Verify `TOOL` resolves — vitest's `process.cwd()` for this workspace is `studio/runtime`. If the path is wrong the first test fails loudly with ENOENT, which is a fine way to find out.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w studio/runtime -- migrate-episode-manifests`
Expected: FAIL — the tool does not exist.

- [ ] **Step 3: Write the tool**

Create `tools/migrate-episode-manifests.mjs`:

```js
#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Give every episode one manifest, and the declared tree around it.
//
//   node tools/migrate-episode-manifests.mjs --library ./library --dry-run
//   node tools/migrate-episode-manifests.mjs --library ./library
//
// Best effort by design. An episode that migrates cleanly is migrated; one
// whose manifests disagree, or whose episode.json will not parse, is printed
// with its reason and left exactly as it was. A skip is a normal outcome and
// does not change the exit code.
//
// Nothing is deleted. `library/` is gitignored, so a deleted file is gone for
// good — the retired episode.json is renamed, never removed.
// ---------------------------------------------------------------------------

import { readdir, readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  EPISODE_DIRECTORIES,
  EPISODE_SEED_FILES,
} from "../studio/contracts/src/layout.mjs";
import {
  EPISODE_MANIFEST_FILE,
  renderEpisodeManifest,
} from "../studio/contracts/src/episode-manifest.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const libraryArg = args.find((a) => a.startsWith("--library="))?.slice("--library=".length)
  ?? (args.includes("--library") ? args[args.indexOf("--library") + 1] : undefined);
if (!libraryArg) {
  console.error("usage: migrate-episode-manifests.mjs --library <path> [--dry-run]");
  process.exit(2);
}
const LIBRARY = resolve(libraryArg);

const exists = (p) => access(p).then(() => true, () => false);
const listDirs = async (p) =>
  (await readdir(p, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

/** "giulio-cesare" -> "Giulio Cesare". Only ever a starting point for a human. */
function titleFromSlug(slug) {
  return slug.split("-").filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const plan = [];
const skipped = [];

async function migrateEpisode(dir, channel, series, slug) {
  const yamlPath = join(dir, EPISODE_MANIFEST_FILE);
  const jsonPath = join(dir, "episode.json");
  const hasYaml = await exists(yamlPath);
  const hasJson = await exists(jsonPath);

  let json = null;
  if (hasJson) {
    try {
      json = JSON.parse(await readFile(jsonPath, "utf-8"));
    } catch (error) {
      skipped.push([`${channel}/${series}/${slug}`, `episode.json will not parse: ${error.message}`]);
      return;
    }
  }

  // Both present: only safe when they agree. Guessing which title a person
  // meant is the inference this whole change exists to remove.
  if (hasYaml && json) {
    const existing = await readFile(yamlPath, "utf-8");
    const titleLine = existing.match(/^title:\s*(.+)$/m);
    const existingTitle = titleLine ? titleLine[1].trim().replace(/^"|"$/g, "") : undefined;
    if (existingTitle && json.title && existingTitle !== json.title) {
      skipped.push([
        `${channel}/${series}/${slug}`,
        `episode.yaml says title ${JSON.stringify(existingTitle)}, episode.json says ${JSON.stringify(json.title)}`,
      ]);
      return;
    }
  }

  if (!hasYaml) {
    const manifest = renderEpisodeManifest({
      slug,
      channel,
      series,
      title: json?.title || titleFromSlug(slug),
      description: json?.description || undefined,
      // No createdAt: these episodes have no recorded creation time, and a
      // derived one would be a fabricated fact in an authoritative file.
      createdAt: undefined,
    });
    plan.push([`write ${EPISODE_MANIFEST_FILE}`, yamlPath]);
    if (!dryRun) await writeFile(yamlPath, manifest, "utf-8");
  }

  for (const relative of EPISODE_DIRECTORIES) {
    const target = join(dir, relative);
    if (await exists(target)) continue;
    plan.push(["mkdir", target]);
    if (!dryRun) await mkdir(target, { recursive: true });
  }

  for (const [relative, content] of Object.entries(EPISODE_SEED_FILES)) {
    const target = join(dir, relative);
    if (await exists(target)) continue;
    plan.push(["seed", target]);
    if (!dryRun) await writeFile(target, content, "utf-8");
  }

  if (hasJson) {
    const retired = join(dir, ".episode.json.migrated");
    plan.push(["retire episode.json", retired]);
    if (!dryRun) await rename(jsonPath, retired);
  }
}

for (const channel of await listDirs(LIBRARY)) {
  for (const series of await listDirs(join(LIBRARY, channel, SERIES_CONTAINER))) {
    const episodesDir = join(LIBRARY, channel, SERIES_CONTAINER, series, EPISODES_CONTAINER);
    for (const slug of await listDirs(episodesDir)) {
      await migrateEpisode(join(episodesDir, slug), channel, series, slug);
    }
  }
}

for (const [action, target] of plan) {
  console.log(`${dryRun ? "[dry-run] " : ""}${action}: ${target.slice(LIBRARY.length + 1)}`);
}
if (skipped.length > 0) {
  console.log(`\nskipped ${skipped.length} episode(s), left exactly as they were:`);
  for (const [name, why] of skipped) console.log(`  ${name} — ${why}`);
}
console.log(`\n${dryRun ? "would change" : "changed"} ${plan.length} path(s); skipped ${skipped.length} episode(s).`);
```

Note the `.workspace/contract.json` and `.workspace/metadata.json` entries of `EPISODE_TREE` are deliberately NOT created here: writing a workspace contract is `initWorkspace`'s job and its format is owned by the runtime. Episodes without one will still be reported by `doctor`; that is the best-effort boundary.

- [ ] **Step 4: Run the tests**

Run: `npm test -w studio/runtime -- migrate-episode-manifests`
Expected: PASS.

- [ ] **Step 5: Run it against the real library, dry first**

```bash
node tools/migrate-episode-manifests.mjs --library ./library --dry-run
```

Read the plan it prints. Confirm it names the eight bare episodes, retires the eleven `episode.json` files, and skips anything it cannot do cleanly. Then run it for real and check `npx vpr doctor --library ./library` reports fewer findings than before.

Record the before and after finding counts in the commit message.

- [ ] **Step 6: Commit**

```bash
git add tools/migrate-episode-manifests.mjs studio/runtime/test/e2e/migrate-episode-manifests.test.ts
git commit -m "feat(tools): best-effort episode manifest migration"
```

---

## Task 7: Documentation

**Files:**
- Modify: `docs/workspace.md`

- [ ] **Step 1: Document the manifest and the scratch area**

In `docs/workspace.md`, under the layout tree, replace the `episode.yaml` line's surrounding explanation with a section:

```markdown
## The episode manifest

`episode.yaml` is the episode's one manifest. It is validated by `vpr doctor`
against the `EpisodeManifest` contract in
`studio/contracts/schemas/v1alpha1/workspace.schema.json`.

Only `apiVersion`, `kind` and `slug` are required — the directory name already
proves the slug, and every other fact may legitimately be unknown for an episode
created before this contract existed. `channel` and `series` are recorded so a
manifest that gets copied out of its tree still says where it came from; nothing
resolves paths from them.

Settings are the exception to "record what you know": an episode omits
`settings` unless it genuinely overrides something, because settings resolve
`system -> channel -> series -> episode` and restating an inherited value
creates a second source of truth for it.

`artifacts/episode.json` is a different document with a confusingly similar
name. It is the scene spine, read by the gateway and the web app, and it is not
the episode's manifest.

## The scratch area

`production/` is the episode's scratch area: experiments, alternate cuts, work
in progress. **No stage may declare an output inside it, and no artifact
resolver may treat its contents as an artifact.** Anything that is a real
output of a real stage belongs in `artifacts/`.
```

Add `production/` to the episode block of the layout tree diagram, with the comment `# scratch: never a declared output`.

- [ ] **Step 2: Verify the docs build**

Run: `npm run docs:build`
Expected: "build complete". If it fails, look for a bare angle-bracket word in prose — VitePress compiles every page as a Vue component.

- [ ] **Step 3: Commit**

```bash
git add docs/workspace.md
git commit -m "docs: the episode manifest and the scratch area"
```

---

## Final verification

Run every suite and every typecheck:

```bash
npm test -w studio/contracts
npm test -w studio/runtime
npm test -w studio/agent
npm test -w studio/gateway
npx tsc --noEmit -p studio/runtime/tsconfig.json
npm run typecheck -w studio/gateway
npm run bindings:check -w studio/contracts
npm run check:schemas -w studio/contracts
node tools/check-boundaries.mjs
npm run docs:build
```

The web suite uses bun: `cd studio/web && bun x vitest run && bun run check:types && bun run check:svelte`.
