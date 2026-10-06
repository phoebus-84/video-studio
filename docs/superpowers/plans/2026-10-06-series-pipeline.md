# Series-Production Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `series-production` pipeline family (avg-jao.4): a new workspace `@studio/episode` holding the episode-production code moved from the agent, `initEpisodeSpec` + `pva_init_spec`, the base manifest with its series-local example, three stage adapters (`series-timeline`, `series-check`, `series-render`), the `fill-episode-spec` skill and the docs.

**Architecture:** The episode-on-disk modules move unchanged from `studio/agent/src` into `studio/episode` (consumed through `dist/`), so the agent's tools and the gateway's stage adapters call one implementation. The manifest's derivation stages match the adapters by their contracts (ADR-0025); `spec`, `pictures` and `takes` stay editorial stages for a person or Pi. The runtime's artifact discovery learns where the series contracts live.

**Tech Stack:** TypeScript (NodeNext, `tsc` to `dist/`), vitest, YAML pipeline manifests (ADR-0024), bun 1.2.0 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-06-series-pipeline-design.md`

## Global Constraints

- Branch `feat/series-pipeline` (holds the spec commit). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit paths only; never stage `.beads/`; never run `bd`.
- `@studio/episode` imports nothing from `studio/agent`, `studio/runtime` or `studio/adapters`.
- Moved modules move **unchanged** (`git mv`); only import specifiers change.
- Lockfile: bun **1.2.0**; update only with `bun install --lockfile-only --ignore-scripts`, then `bun install --frozen-lockfile`, in the main checkout.
- After changing `studio/episode/src`, rebuild it (`npm run build --workspace @studio/episode`); after changing `studio/adapters/src`, rebuild it (`npm run build --workspace @studio/adapters`): consumers import their `dist/`.
- An existing `episode-spec.json` is never replaced.
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.
- Correction to the spec: the studio skills in `skills/studio/` are checked by discovery (`studio/agent/tests/skill-discovery.test.ts`), not by `studio/pipelines/lint/validate-skill.js` (which validates another format and which no studio skill passes).

## Review Focus

- `pva_init_spec` while a spec appears concurrently → the existing spec survives (`initEpisodeSpec` links into place; `link` never replaces) — Task 2's "never replaces an existing spec" pins the sequential case.
- The `check` stage on a hand edit that breaks a rule → the report is written for the reviewer *and* the stage fails (Task 3: "writes the report and fails on a hand edit that breaks a rule").
- A pipeline stage run on an episode without a spec → every series adapter refuses with "run the spec stage" (Task 3: "is refused by every series adapter").
- The series adapters on the existing pipelines → they perform none of their stages (Task 3: "its adapters perform no stage of another built-in pipeline"); the default pipeline still performs exactly its four stages (existing conformance test).
- `takes.json` and `episode-spec.json` checked by the runtime before a stage starts → found where the series stages put them (Task 3: discovery test).

---

### Task 1: `@studio/episode` — the episode-production code moves out of the agent

**Files:**
- Move (`git mv`, unchanged): `studio/agent/src/{narration-manifest,scene-images,edit-timeline-builder,series-compile,episode-render}.ts` → `studio/episode/src/`; `studio/agent/tests/{narration-manifest,scene-images,edit-timeline-builder,series-compile}.test.ts` → `studio/episode/tests/`; `studio/agent/tests/spec-episode.ts` → `studio/episode/src/testing.ts`
- Create: `studio/episode/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,README.md}`, `studio/episode/src/index.ts`
- Modify: `studio/episode/tests/series-compile.test.ts` (one import), `studio/agent/src/capability-tools.ts` (imports), `studio/agent/package.json`, `studio/agent/tests/compose-spec.test.ts`, `studio/agent/tests/compose-spec.e2e.test.ts`, `package.json`, `bun.lock`, `tools/build-required.mjs`, `.github/workflows/ci.yml`, `compose.config.json`, `README.md`, `docs/index.md`; generated `docs/studio/episode.md`

**Interfaces:**
- Produces: package `@studio/episode` exporting everything the five modules export (`buildEditTimeline`, `EDIT_TIMELINE_PATH`, `loadEpisode`, `compileEpisode`, `checkEpisode`, `isSpecDriven`, `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode`, `SeriesRulesError`, `TimelineBuildError`, the narration-manifest and scene-image functions, their types); `@studio/episode/testing` exporting `specEpisode`, `editSpec`, `sha256`.

- [ ] **Step 1: Move the modules and their tests**

```bash
mkdir -p studio/episode/src studio/episode/tests
for f in narration-manifest scene-images edit-timeline-builder series-compile episode-render; do git mv studio/agent/src/$f.ts studio/episode/src/$f.ts; done
for f in narration-manifest scene-images edit-timeline-builder series-compile; do git mv studio/agent/tests/$f.test.ts studio/episode/tests/$f.test.ts; done
git mv studio/agent/tests/spec-episode.ts studio/episode/src/testing.ts
```

In `studio/episode/tests/series-compile.test.ts` change
`import { editSpec, sha256, specEpisode } from "./spec-episode.js";` to
`import { editSpec, sha256, specEpisode } from "../src/testing.js";`.

- [ ] **Step 2: The package**

`studio/episode/package.json`:

```json
{
  "name": "@studio/episode",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "An episode on disk, produced: its narration manifest and scene images, its edit timeline built or compiled from its spec, checked against its series' rules, rendered",
  "engines": {
    "node": ">=20"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./testing": {
      "import": "./dist/testing.js",
      "types": "./dist/testing.d.ts"
    }
  },
  "files": [
    "dist/",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run typecheck && npm test"
  },
  "dependencies": {
    "@av/remotion-composer": "workspace:*",
    "@studio/contracts": "workspace:*",
    "@studio/series": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

`studio/episode/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`studio/episode/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`studio/episode/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

`studio/episode/src/index.ts` (Task 2 adds the `spec-init.js` export):

```ts
// An episode on disk, produced (ADR-0036, ADR-0037). Used by the agent's
// tools and by the stage adapters, so that each step has one implementation.

export * from "./narration-manifest.js";
export * from "./scene-images.js";
export * from "./edit-timeline-builder.js";
export * from "./series-compile.js";
export * from "./episode-render.js";
```

`studio/episode/README.md`:

````markdown
# @studio/episode

An episode on disk, produced (ADR-0036, ADR-0037): its narration manifest and
scene images, its edit timeline — built from its material, or compiled from
its `episode-spec.json` by its series template's compiler — checked against its
series' rules, and rendered with `@av/remotion-composer`.

The agent's tools (`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`,
`pva_compose_video`, the narration tools) and the `series-production` stage
adapters both call this package, so a tool and a stage never disagree.

## What it offers

| Module | |
|---|---|
| `narration-manifest.ts` | The canonical `artifacts/narration/narration-manifest.json`: build, measure, validate, write |
| `scene-images.ts` | Scene images in reading order and their lengths (legacy episodes) |
| `edit-timeline-builder.ts` | `buildEditTimeline`: the timeline of an episode without a spec |
| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules |
| `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
| `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |

`@studio/episode/testing` exports `specEpisode`, `editSpec` and `sha256`: a
complete poetry-short episode on disk, from `@studio/series`'s golden fixture,
for tests.

## Commands

```
npm run build       # tsc to dist/ (the agent and the adapters import it from there)
npm run typecheck
npm test            # vitest
```
````

- [ ] **Step 3: The agent imports the package**

In `studio/agent/src/capability-tools.ts`, replace

```ts
  type NarrationSegmentInput,
} from "./narration-manifest.js";
import { EDIT_TIMELINE_PATH } from "./edit-timeline-builder.js";
import { decideEditTimeline, renderEpisode, writeEditTimeline, type Validation } from "./episode-render.js";
```

with

```ts
  type NarrationSegmentInput,
  decideEditTimeline,
  EDIT_TIMELINE_PATH,
  renderEpisode,
  writeEditTimeline,
  type Validation,
} from "@studio/episode";
```

In `studio/agent/tests/compose-spec.test.ts` and `studio/agent/tests/compose-spec.e2e.test.ts`, `from "./spec-episode.js";` → `from "@studio/episode/testing";`.

In `studio/agent/package.json` dependencies, `"@studio/series": "workspace:*"` → `"@studio/episode": "workspace:*"` (the agent no longer imports `@studio/series`).

- [ ] **Step 4: Wire the workspace**

1. `package.json` workspaces: add `"studio/episode",` right after `"studio/series",` (text edit).
2. `tools/build-required.mjs`: `REQUIRED` becomes `["packages/fal-media", "packages/video-composer", "packages/remotion-composer", "studio/series", "studio/episode", "studio/runtime", "studio/adapters"]`.
3. `.github/workflows/ci.yml` modules matrix: `- studio/episode` after `- studio/series`.
4. `compose.config.json` (text edits): after the `series` component's closing `},` insert

   ```json
       "episode": {
         "path": "studio/episode",
         "kind": "node",
         "standalone": false,
         "summary": "An episode on disk, produced: its edit timeline built or compiled from its spec, checked against its series' rules, rendered.",
         "capabilities": [],
         "requires": {},
         "docs": "docs/studio/episode.md"
       },
   ```

   and add `"episode"` right after `"series"` in the components of `full`, `studio`, `headless` and `blender`.
5. `README.md` studio table, after the `studio/series` row: `| \`studio/episode\` | An episode on disk, produced: timeline built or compiled, checked, rendered |`.
6. `docs/index.md` studio table, after the `series` row: `| [episode](./studio/episode) | An episode on disk, produced: timeline built or compiled, checked, rendered |`.
7. Lockfile and install (main checkout):

   ```bash
   bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile
   ```

   Expected `bun.lock` changes: a `"studio/episode"` workspace entry (deps `@av/remotion-composer`, `@studio/contracts`, `@studio/series`; dev `@types/node ^20.0.0`, `typescript ^5.0.0`, `vitest ^3.0.0`); `"@studio/episode": ["@studio/episode@workspace:studio/episode"]`; in `studio/agent` dependencies `@studio/series` replaced by `@studio/episode`; nested `@studio/episode/@types/node` and `@studio/episode/vitest/…` entries. (Task 3 adds one more line, for the adapters.)
8. `npm run docs:generate` (writes `docs/studio/episode.md`).

- [ ] **Step 5: Check nothing changed in behaviour**

Run:
```bash
npm run build --workspace @studio/episode
cd studio/episode && npx tsc --noEmit && npx vitest run && cd ../agent && npx tsc --noEmit && npx vitest run
cd ../.. && npm run check:boundaries && npm run docs:check && npm run compose -- --list
```
Expected: episode `Tests 82 passed`; agent `Test Files 26 passed | 2 skipped`, `Tests 189 passed | 3 skipped` (82 + 189 = the 271 before the move); boundaries ✓; docs up to date; `episode` listed after `series` in four profiles.

- [ ] **Step 6: Commit**

```bash
git add -A studio/episode studio/agent package.json bun.lock tools/build-required.mjs .github/workflows/ci.yml compose.config.json README.md docs/index.md docs/studio/episode.md
git commit -m "refactor(episode): move episode production out of the agent into @studio/episode (avg-jao.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `initEpisodeSpec` and `pva_init_spec`

**Files:**
- Create: `studio/episode/src/spec-init.ts`, `studio/episode/tests/spec-init.test.ts`, `studio/agent/tests/init-spec.test.ts`
- Modify: `studio/episode/src/index.ts`, `studio/agent/src/capability-tools.ts`, `studio/agent/tests/extension.test.ts`, `studio/agent/tests/e2e-scenarios.test.ts`, `docs/running.md`

**Interfaces:**
- Consumes: `instantiateEpisodeSpec`, `placeholderPaths`, `validateTemplateBundle`, `SERIES_TEMPLATE_FILES` (contracts), `seriesTemplatePath`, `EPISODE_SPEC_PATH`, `SERIES_TEMPLATE_MANIFEST` (layout).
- Produces: `initEpisodeSpec(episodeDir, {episodeRef, template: {id, version}}) → {ok: true, path: "episode-spec.json", spec, placeholders: string[]} | {ok: false, problems: {code, message, path}[]}` with codes `spec-exists`, `bad-version`, `missing-template`, `bad-template`, `path-escape`; tool `pva_init_spec {channel, series, episode, template, version}`.

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/spec-init.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileEpisode } from "../src/series-compile.js";
import { initEpisodeSpec } from "../src/spec-init.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * initEpisodeSpec (avg-jao.4): a draft pinned to an exact release, every
 * __FILL__ kept, an existing spec never replaced.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const TEMPLATE = { id: "poetry-short", version: "1.0.0" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const release = () => join(dirname(dirname(dir())), "templates/poetry-short/1.0.0");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spec-init-"));
  // A complete episode, then its spec removed: the release, takes and pictures stay.
  specEpisode(dir(), REF);
  unlinkSync(at("episode-spec.json"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const codes = (result: ReturnType<typeof initEpisodeSpec>) => (result.ok ? [] : result.problems.map((p) => [p.code, p.path]));

describe("initEpisodeSpec", () => {
  it("writes a draft pinned to the exact release, listing every placeholder", () => {
    const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.path).toBe("episode-spec.json");
    const written = JSON.parse(readFileSync(at("episode-spec.json"), "utf-8"));
    expect(written).toEqual(result.spec);
    expect(written.episodeRef).toEqual(REF);
    expect(written.revision).toBe(1);
    expect(written.template).toEqual({ ...TEMPLATE, hash: sha256(readFileSync(join(release(), "series-template.json"))) });
    expect(result.placeholders).toEqual([
      '$.data["title"]',
      '$.data["narration"]',
      '$.data["holdSeconds"]',
      '$.data["panels"][0]["assetId"]',
      '$.data["panels"][0]["cue"]',
    ]);
    expect(written.data.style.outputProfile).toBe("vertical-1080x1920");
  });

  it("never replaces an existing spec", () => {
    writeFileSync(at("episode-spec.json"), "{ a person's work }");
    expect(codes(initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE }))).toEqual([["spec-exists", "episode-spec.json"]]);
    expect(readFileSync(at("episode-spec.json"), "utf-8")).toBe("{ a person's work }");
  });

  it("missing-template: a release the series does not have", () => {
    expect(codes(initEpisodeSpec(dir(), { episodeRef: REF, template: { id: "poetry-short", version: "2.0.0" } })))
      .toEqual([["missing-template", "../../templates/poetry-short/2.0.0"]]);
  });

  it("bad-version: a range or a partial version is not a release", () => {
    for (const version of ["^1.0.0", "1.0", "latest"]) {
      expect(codes(initEpisodeSpec(dir(), { episodeRef: REF, template: { id: "poetry-short", version } }))[0]?.[0]).toBe("bad-version");
    }
  });

  it("bad-template: a release edited in place", () => {
    appendFileSync(join(release(), "FORMAT.md"), "\nA quiet change of style.\n");
    const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
    expect(codes(result)[0]?.[0]).toBe("bad-template");
    expect(() => readFileSync(at("episode-spec.json"))).toThrow();
  });

  it("a draft filled with the golden fixture's data compiles", () => {
    const result = initEpisodeSpec(dir(), { episodeRef: REF, template: TEMPLATE });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    const require = createRequire(import.meta.url);
    const input = JSON.parse(readFileSync(require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json"), "utf-8"));
    writeFileSync(at("episode-spec.json"), JSON.stringify({ ...result.spec, data: input.spec.data }, null, 2));
    const compiled = compileEpisode(dir(), { episodeRef: REF });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect(compiled.revision).toBe(1);
  });
});
```

`studio/agent/tests/init-spec.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_init_spec (avg-jao.4): the first stage of the series-production
 * pipeline. The draft itself is @studio/episode's initEpisodeSpec; here, what
 * the tool says and that it never replaces a spec.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-init-spec-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  specEpisode(dir(), REF);
  unlinkSync(join(dir(), "episode-spec.json"));
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_init_spec")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_init_spec", () => {
  it("writes a pinned draft and lists what to fill", async () => {
    const result = await tool({ template: "poetry-short", version: "1.0.0" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/^✅ episode-spec\.json: a draft pinned to poetry-short@1\.0\.0 \(sha256:[0-9a-f]{64}\)/);
    expect(text).toMatch(/5 value\(s\) to fill:/);
    expect(text).toContain('  - $.data["narration"]');
    expect(text).toMatch(/fill-episode-spec skill; then pva_check_episode/);
    const spec = JSON.parse(readFileSync(join(dir(), "episode-spec.json"), "utf-8"));
    expect(spec.template.id).toBe("poetry-short");
    expect(spec.data.title).toBe("__FILL__");
  });

  it("refuses to replace an existing spec", async () => {
    await tool({ template: "poetry-short", version: "1.0.0" });
    const before = readFileSync(join(dir(), "episode-spec.json"), "utf-8");
    const result = await tool({ template: "poetry-short", version: "1.0.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/spec-exists at episode-spec\.json/);
    expect(readFileSync(join(dir(), "episode-spec.json"), "utf-8")).toBe(before);
  });

  it("refuses a version that is not an exact release", async () => {
    const result = await tool({ template: "poetry-short", version: "^1.0.0" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/bad-version/);
  });
});
```

In `studio/agent/tests/extension.test.ts`: `expect(mockPi.tools.length).toBe(44);` → `toBe(45)`, and in the sorted list add `"pva_init_spec",` between `"pva_health",` and `"pva_journal",`.
In `studio/agent/tests/e2e-scenarios.test.ts`: `"pva_build_timeline", "pva_check_episode", "pva_compose_video",` → `"pva_init_spec", "pva_build_timeline", "pva_check_episode", "pva_compose_video",`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/spec-init.test.ts`
Expected: FAIL — cannot resolve `../src/spec-init.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/spec-init.ts`:

```ts
// ---------------------------------------------------------------------------
// A new episode's spec, drafted from its series' template release (avg-jao.4)
// ---------------------------------------------------------------------------
// The first stage of the series-production pipeline. The draft is pinned to
// the exact release the caller names (ADR-0037: no "latest", no ranges) and
// keeps every __FILL__ marker for the editor; nothing is invented. An
// existing spec is never replaced.
// ---------------------------------------------------------------------------

import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep, basename } from "node:path";
import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from "@studio/contracts/src/layout.mjs";
import {
  instantiateEpisodeSpec,
  placeholderPaths,
  SERIES_TEMPLATE_FILES,
  validateTemplateBundle,
  type EpisodeSpec,
} from "@studio/contracts/src/series-templates.mjs";

export interface SpecInitProblem {
  code: string;
  message: string;
  path: string;
}

export type SpecInitResult =
  | {
    ok: true;
    /** episode-spec.json, relative to the episode. */
    path: string;
    spec: EpisodeSpec;
    /** JSON paths of every __FILL__ the editor must replace. */
    placeholders: string[];
  }
  | { ok: false; problems: SpecInitProblem[] };

const EXACT = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const fail = (code: string, path: string, message: string): SpecInitResult => ({ ok: false, problems: [{ code, path, message }] });

/** Write a draft episode-spec.json pinned to `template` (exact id and version). */
export function initEpisodeSpec(
  episodeDir: string,
  options: {
    episodeRef: { channel: string; series: string; episode: string };
    template: { id: string; version: string };
  },
): SpecInitResult {
  const dir = resolve(episodeDir);
  const target = join(dir, EPISODE_SPEC_PATH);
  if (existsSync(target)) {
    return fail("spec-exists", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} already exists: edit it, never replace it`);
  }
  const { id, version } = options.template;
  if (!EXACT.test(version)) {
    return fail("bad-version", "template.version", `"${version}" is not an exact x.y.z release: no ranges, no latest`);
  }

  const seriesDir = dirname(dirname(dir));
  let releaseDir: string;
  try {
    releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), id, version);
  } catch (error) {
    return fail("bad-version", "template", (error as Error).message);
  }
  const releaseKey = relative(dir, releaseDir).split(sep).join("/");
  if (!existsSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST))) {
    return fail("missing-template", releaseKey, `the release ${id}@${version} is not in this series (${releaseKey})`);
  }

  // Exact UTF-8 bytes, from files that stay inside the series.
  const root = realpathSync(seriesDir);
  const read = (name: string): string | SpecInitResult => {
    const file = join(releaseDir, name);
    if (!existsSync(file)) return fail("missing-template", `${releaseKey}/${name}`, `${releaseKey}/${name} is missing`);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) {
      return fail("path-escape", `${releaseKey}/${name}`, `${releaseKey}/${name} is not a file inside the series`);
    }
    return readFileSync(real, "utf-8");
  };
  const texts: Record<string, string> = {};
  for (const name of [SERIES_TEMPLATE_MANIFEST, ...Object.values(SERIES_TEMPLATE_FILES)]) {
    const text = read(name);
    if (typeof text !== "string") return text;
    texts[name] = text;
  }
  const { [SERIES_TEMPLATE_MANIFEST]: manifest, ...files } = texts;
  const bundle = { manifest: manifest!, files };
  const problems = validateTemplateBundle(bundle);
  if (problems.length > 0) {
    return { ok: false, problems: problems.map((p) => ({ code: "bad-template", message: `${p.code}: ${p.message}`, path: `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}#${p.path}` })) };
  }

  const spec = instantiateEpisodeSpec(bundle, options.episodeRef);
  // Written whole beside its name, then linked into place: a link never
  // replaces an existing file, so a spec that appeared meanwhile survives.
  const temp = `${target}.${process.pid}.tmp`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(temp, `${JSON.stringify(spec, null, 2)}\n`, "utf-8");
  try {
    linkSync(temp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return fail("spec-exists", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} already exists: edit it, never replace it`);
    }
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
  return { ok: true, path: EPISODE_SPEC_PATH, spec, placeholders: placeholderPaths(spec.data, "$.data") };
}
```

Append to `studio/episode/src/index.ts`: `export * from "./spec-init.js";`

Rebuild: `npm run build --workspace @studio/episode`.

In `studio/agent/src/capability-tools.ts`: add `initEpisodeSpec,` to the `@studio/episode` import (after `EDIT_TIMELINE_PATH,`), and insert this tool right before `pi.registerTool({ name: "pva_build_timeline",`:

```ts
  pi.registerTool({
    name: "pva_init_spec",
    label: "Create Episode Spec",
    description: "Create the episode's episode-spec.json as a draft pinned to an exact release of its series' template (templates/<id>/<version>/): every value the editor must supply is __FILL__, and the reply lists them. Never replaces an existing spec. Fill it with the fill-episode-spec skill, then run pva_check_episode.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      template: Type.String({ description: "Template id, as in the series' templates/ folder" }),
      version: Type.String({ description: "Exact release version, x.y.z (no ranges, no latest)" }),
    }),
    async execute(_toolCallId, params) {
      const dir = episodeDir(params.channel, params.series, params.episode);
      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
      const result = await withFileMutationQueue(join(dir, "episode-spec.json"), async () =>
        initEpisodeSpec(dir, { episodeRef, template: { id: params.template, version: params.version } }));
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: ["❌ No spec written", ...result.problems.map((p) => `  - ${p.code} at ${p.path}: ${p.message}`)].join("\n") }],
          details: { problems: result.problems } as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      }
      const pin = result.spec.template;
      const lines = [
        `✅ ${result.path}: a draft pinned to ${pin.id}@${pin.version} (${pin.hash})`,
        `${result.placeholders.length} value(s) to fill:`,
        ...result.placeholders.map((p) => `  - ${p}`),
        "Read the release's FORMAT.md and fill them with the fill-episode-spec skill; then pva_check_episode.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
    },
  });
```

`docs/running.md`: in the Production tool list, `` `pva_render_terminal`, `pva_render_vector_animation`, `pva_build_timeline`, `` / `` `pva_check_episode`, `` becomes `` `pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`, `` / `` `pva_build_timeline`, `pva_check_episode`, ``.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd studio/episode && npx tsc --noEmit && npx vitest run && cd ../agent && npx tsc --noEmit && npx vitest run tests/init-spec.test.ts tests/extension.test.ts tests/e2e-scenarios.test.ts`
Expected: episode 88 passed; agent 41 passed.

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/spec-init.ts studio/episode/src/index.ts studio/episode/tests/spec-init.test.ts studio/agent/src/capability-tools.ts studio/agent/tests/init-spec.test.ts studio/agent/tests/extension.test.ts studio/agent/tests/e2e-scenarios.test.ts docs/running.md
git commit -m "feat(episode): initEpisodeSpec and pva_init_spec — a draft spec pinned to an exact release (avg-jao.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `series-production` manifest, discovery, the stage adapters

**Files:**
- Create: `studio/pipelines/pipelines/series-production.yaml`, `studio/pipelines/fixtures/valid/series-local/poetry-short.yaml`, `studio/adapters/src/adapters/series.ts`, `studio/adapters/test/series.test.ts`
- Modify: `studio/runtime/src/artifacts/discovery.ts`, `studio/runtime/test/unit/artifacts/discovery.test.ts`, `studio/adapters/src/studio.ts`, `studio/adapters/package.json`, `bun.lock`

**Interfaces:**
- Consumes: `@studio/episode` (`isSpecDriven`, `writeEditTimeline`, `decideEditTimeline`, `renderEpisode`, `EDIT_TIMELINE_PATH`), `@studio/episode/testing`; the adapter descriptor (`StageAdapter`, `AdapterContext {episodeDir, ref: {channel, series, episode}, log}`).
- Produces: adapters `seriesTimeline` (`series-timeline`), `seriesCheck` (`series-check`), `seriesRender` (`series-render`) in `STUDIO_ADAPTERS`; `SERIES_CHECK_PATH = "artifacts/series-check.json"` with `{checkedAt, validator, decision: {rebuilt}, timeline: {path, hash}, findings}`; pipeline `series-production@1.0.0`.

- [ ] **Step 1: The manifests**

`studio/pipelines/pipelines/series-production.yaml`:

```yaml
# The series-production family (avg-jao.4, ADR-0037). One manifest for every
# series with a template: the compiler and the validator are the ones the
# episode's pinned release names, never the pipeline's. Stages that depend on
# work not done yet (source, take synthesis and verification, alignment, the
# layout sheet, the render audit, the delivery package) are inserted by their
# own issues as new versions of this manifest. A series extends it and
# replaces stages by id (ADR-0001).
pipeline:
  id: series-production
  version: "1.0.0"
  description: "A series episode from its template: the spec, its pictures and narration takes, the timeline its template's compiler makes, the series rules checked, the render."
  capabilities:
    - id: video.compose
      version: "1.0.0"
  stages:
    - id: spec
      name: "Episode Spec"
      type: editorial
      description: "Draft the episode's spec from its series' template release (pva_init_spec) and fill every placeholder"
      inputs: []
      outputs:
        - contract: episode-spec.json
          version: "1.0.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 2
      skills:
        - skill: fill-episode-spec
          version: "0.1.0"
      depends_on: []

    - id: pictures
      name: "Pictures"
      type: editorial
      description: "Provide every picture the spec names, as assets/images/<assetId>.<png|jpg|jpeg|webp>"
      inputs:
        - contract: episode-spec.json
          version: "1.0.0"
      outputs:
        - contract: images/
          version: "1.0.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 2
      skills: []
      depends_on:
        - spec

    - id: takes
      name: "Narration Takes"
      type: editorial
      description: "Provide the narration takes (artifacts/narration/takes.json) and each take's word timing; the takes must say the spec's narration"
      inputs:
        - contract: episode-spec.json
          version: "1.0.0"
      outputs:
        - contract: takes.json
          version: "1.0.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 2
      skills: []
      depends_on:
        - spec

    - id: timeline
      name: "Edit Timeline"
      type: editorial
      description: "Compile the edit timeline with the compiler the spec's template release names"
      inputs:
        - contract: episode-spec.json
          version: "1.0.0"
        - contract: images/
          version: "1.0.0"
        - contract: takes.json
          version: "1.0.0"
      outputs:
        - contract: edit-timeline.json
          version: "1.0.0"
      gates:
        autopilot: true
        review: none
        retry_on_failure: 1
      skills: []
      depends_on:
        - spec
        - pictures
        - takes

    - id: check
      name: "Series Check"
      type: editorial
      description: "Check the timeline that would be rendered against the series' rules; a person reviews it before a render is spent"
      inputs:
        - contract: edit-timeline.json
          version: "1.0.0"
      outputs:
        - contract: series-check.json
          version: "1.0.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 1
      skills: []
      depends_on:
        - timeline

    - id: render
      name: "Render"
      type: capability
      description: "Render the checked timeline to output/<render-id>.mp4 and move output/current.json"
      capability: video.compose
      inputs:
        - contract: edit-timeline.json
          version: "1.0.0"
        - contract: series-check.json
          version: "1.0.0"
      outputs:
        - contract: output.mp4
          version: "1.0.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 1
        budget:
          wall_time: "15m"
          tokens: 0
      skills:
        - skill: compose-video
          version: "0.5.0"
      depends_on:
        - check
```

`studio/pipelines/fixtures/valid/series-local/poetry-short.yaml`:

```yaml
# A series-local pipeline (ADR-0001): a poetry-short series inherits the
# series-production family and replaces one stage by id. Real series keep
# theirs in the library, under the series' pipelines/ folder.
pipeline:
  id: poetry-short
  version: "1.0.0"
  description: "A short vertical poem: series-production, with the poem's recital as its one take"
  extends:
    pipeline: series-production
    version: "1.0.0"
  stages:
    - id: takes
      name: "Recital Take"
      type: editorial
      description: "One take of the whole poem, recited, as the unit \"narration\" of takes.json; its word timing by forced alignment"
      inputs:
        - contract: episode-spec.json
          version: "1.0.0"
      outputs:
        - contract: takes.json
          version: "1.0.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 2
      skills: []
      depends_on:
        - spec
```

Run: `node studio/pipelines/lint/validate-pipeline.js studio/pipelines/pipelines/*.yaml`
Expected: `✓ All pipeline manifests pass validation.`

- [ ] **Step 2: Write the failing tests**

Apply to `studio/runtime/test/unit/artifacts/discovery.test.ts`:

```diff
diff --git a/studio/runtime/test/unit/artifacts/discovery.test.ts b/studio/runtime/test/unit/artifacts/discovery.test.ts
index e119c25..8d17449 100644
--- a/studio/runtime/test/unit/artifacts/discovery.test.ts
+++ b/studio/runtime/test/unit/artifacts/discovery.test.ts
@@ -34,6 +34,21 @@ describe("artifact discovery", () => {
     expect(artifactExists(root, "final-video.mp4")).toBe(true);
   });
 
+  it("finds a series episode's spec, takes and pictures where the series stages put them", async () => {
+    const root = await workspace();
+    expect(artifactExists(root, "episode-spec.json")).toBe(false);
+    expect(artifactExists(root, "takes.json")).toBe(false);
+    expect(artifactExists(root, "images/")).toBe(false);
+    await writeFile(path.join(root, "episode-spec.json"), "{}\n");
+    await mkdir(path.join(root, "artifacts", "narration"), { recursive: true });
+    await writeFile(path.join(root, "artifacts", "narration", "takes.json"), "{}\n");
+    await mkdir(path.join(root, "assets", "images"), { recursive: true });
+    await writeFile(path.join(root, "assets", "images", "cat.png"), "image");
+    expect(artifactExists(root, "episode-spec.json")).toBe(true);
+    expect(artifactExists(root, "takes.json")).toBe(true);
+    expect(artifactExists(root, "images/")).toBe(true);
+  });
+
   it("rejects a traversal pointer", async () => {
     const root = await workspace();
     await writeFile(path.join(root, "output", "current.json"), JSON.stringify({ path: "../outside.mp4" }));
```

`studio/adapters/test/series.test.ts`:

```ts
// The series-production family (avg-jao.4): which stages the studio
// performs, and what its three adapters do with a spec-driven episode. The
// render itself is faked, as in the agent's tests: @av/remotion-composer has
// its own.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileSystemPipelineLoader, resolvePipeline } from "@studio/runtime";
import { editSpec, specEpisode } from "@studio/episode/testing";
import { createStudioRegistry } from "../src/index.js";
import { seriesCheck, seriesRender, seriesTimeline } from "../src/adapters/series.js";
import { BUILTIN_NAMES, BUILTIN_PIPELINES, builtin } from "./helpers.js";

const renders: string[] = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      renders.push(options.outputPath);
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: `sha256:${"0".repeat(64)}`,
        kits: [],
        profile: options.timeline.profile.id,
        loudness: null,
        cache: { wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 1, totalSegments: 1, warnings: [] },
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const lines: string[] = [];
const ctx = () => ({ episodeDir: dir(), ref: REF, log: (line: string) => lines.push(line) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-adapters-"));
  specEpisode(dir(), REF);
  renders.length = 0;
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the series-production pipeline", () => {
  it("resolves, every input produced by an earlier stage", async () => {
    const pipeline = await builtin("series-production");
    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "render"]);
  });

  it("is performed by the studio at timeline, check and render; spec, pictures and takes are a person's or Pi's", async () => {
    const pipeline = await builtin("series-production");
    const registry = createStudioRegistry();
    expect(pipeline.stages.map((s) => [s.definition.id, registry.match(s)?.id ?? null])).toEqual([
      ["spec", null],
      ["pictures", null],
      ["takes", null],
      ["timeline", "series-timeline"],
      ["check", "series-check"],
      ["render", "series-render"],
    ]);
  });

  it("its adapters perform no stage of another built-in pipeline", async () => {
    const registry = createStudioRegistry();
    const series = new Set(["series-timeline", "series-check", "series-render"]);
    for (const name of BUILTIN_NAMES.filter((n) => n !== "series-production")) {
      for (const stage of (await builtin(name)).stages) {
        expect(series.has(registry.match(stage)?.id ?? ""), `${name}/${stage.definition.id}`).toBe(false);
      }
    }
  });

  it("a series extends it and replaces a stage by id", async () => {
    // The built-in pipelines, then a folder of series-local ones.
    const local = join(dirname(createRequire(import.meta.url).resolve("@studio/pipelines/package.json")), "fixtures/valid/series-local");
    const pipeline = await resolvePipeline(new FileSystemPipelineLoader([BUILTIN_PIPELINES, local]), "poetry-short");
    expect(pipeline.inheritanceChain).toEqual(["series-production", "poetry-short"]);
    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "render"]);
    expect(pipeline.stages.find((s) => s.definition.id === "takes")!.definition.name).toBe("Recital Take");
  });
});

describe("series-timeline", () => {
  it("compiles the timeline", async () => {
    const written = await seriesTimeline.perform(ctx());
    expect(written).toEqual([at("artifacts/edit-timeline.json")]);
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    expect(timeline.derivedFrom.compiler).toEqual({ id: "poetry-short", version: "1.0.0" });
    expect(lines[0]).toMatch(/timeline: poetry-short@1\.0\.0 from spec revision 2, 324 frames/);
  });

  it("fails on a spec whose video breaks the series' rules, writing nothing", async () => {
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
    await expect(seriesTimeline.perform(ctx())).rejects.toThrow(/series rules \(poetry-short@1\.0\.0\) refuse this timeline/);
    expect(lines.join("\n")).toMatch(/duration-range at artifacts\/edit-timeline\.json#\$\.durationInFrames/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });
});

describe("series-check", () => {
  it("writes the report the reviewer reads", async () => {
    await seriesTimeline.perform(ctx());
    const written = await seriesCheck.perform(ctx());
    expect(written).toEqual([at("artifacts/series-check.json")]);
    const report = JSON.parse(readFileSync(at("artifacts/series-check.json"), "utf-8"));
    expect(report.validator).toBe("poetry-short@1.0.0");
    expect(report.decision).toEqual({ rebuilt: null });
    expect(report.timeline.path).toBe("artifacts/edit-timeline.json");
    expect(report.timeline.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.findings).toEqual([]);
  });

  it("writes the report and fails on a hand edit that breaks a rule", async () => {
    await seriesTimeline.perform(ctx());
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    await expect(seriesCheck.perform(ctx())).rejects.toThrow(/refuse this timeline: see artifacts\/series-check\.json/);
    const report = JSON.parse(readFileSync(at("artifacts/series-check.json"), "utf-8"));
    expect(report.findings.map((f: any) => [f.code, f.severity, f.path])).toEqual([
      ["text-not-voice", "error", "artifacts/edit-timeline.json#$.tracks[1]"],
    ]);
  });
});

describe("series-render", () => {
  it("renders the checked timeline", async () => {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    const written = await seriesRender.perform(ctx());
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/output\/render-\d+-[0-9a-f]{8}\.mp4$/);
    expect(renders).toHaveLength(1);
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).path).toBe(written[0]!.split("/").pop());
  });

  it("refuses a timeline that breaks the series' rules, writing no output", async () => {
    await seriesTimeline.perform(ctx());
    await seriesCheck.perform(ctx());
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    await expect(seriesRender.perform(ctx())).rejects.toThrow(/series rules/);
    expect(renders).toHaveLength(0);
    expect(existsSync(at("output"))).toBe(false);
  });
});

describe("an episode without a spec", () => {
  it("is refused by every series adapter", async () => {
    unlinkSync(at("episode-spec.json"));
    for (const adapter of [seriesTimeline, seriesCheck, seriesRender]) {
      await expect(adapter.perform(ctx()), adapter.id).rejects.toThrow(/this pipeline needs an episode-spec\.json; run the spec stage/);
    }
  });
});
```

In `studio/adapters/package.json` dependencies add `"@studio/episode": "workspace:*",` after `"@studio/contracts": "workspace:*",`; then `bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile` (expected `bun.lock` change: `"@studio/episode": "workspace:*"` in the `studio/adapters` dependencies).

- [ ] **Step 3: Run them to see them fail**

Run: `cd studio/runtime && npx vitest run test/unit/artifacts/discovery.test.ts; cd ../adapters && npx vitest run test/series.test.ts`
Expected: FAIL — discovery does not find `episode-spec.json`/`takes.json`; `../src/adapters/series.js` missing.

- [ ] **Step 4: Implement**

Apply to `studio/runtime/src/artifacts/discovery.ts`:

```diff
diff --git a/studio/runtime/src/artifacts/discovery.ts b/studio/runtime/src/artifacts/discovery.ts
index 3701ddd..1946428 100644
--- a/studio/runtime/src/artifacts/discovery.ts
+++ b/studio/runtime/src/artifacts/discovery.ts
@@ -15,6 +15,13 @@ const LEGACY_PATHS: Record<string, string> = {
   "qa-report.json": "artifacts/qa-report.json",
 };
 
+/** Series-production contracts (avg-jao.4) that do not live under artifacts/. */
+const SERIES_PATHS: Record<string, string> = {
+  "episode-spec.json": "episode-spec.json",
+  "takes.json": "artifacts/narration/takes.json",
+  "images/": "assets/images",
+};
+
 const CAPABILITY_PATHS: Record<string, string[]> = {
   "animated-visuals.mp4": ["assets/animation/visuals.mp4"],
   "final-video.mp4": ["output/current.json"],
@@ -50,6 +57,7 @@ export function artifactExists(episodeDir: string, label: string): boolean {
   const directoryArtifact = label.endsWith("/");
   const candidates = new Set<string>();
   if (LEGACY_PATHS[label]) candidates.add(LEGACY_PATHS[label]);
+  if (SERIES_PATHS[label]) candidates.add(SERIES_PATHS[label]);
   for (const candidate of CAPABILITY_PATHS[label] ?? []) candidates.add(candidate);
   candidates.add(`artifacts/${label}`);
   candidates.add(`assets/${label}`);
```

`studio/adapters/src/adapters/series.ts`:

```ts
// ---------------------------------------------------------------------------
// The series-production stages the studio performs (avg-jao.4)
// ---------------------------------------------------------------------------
// Compile, check and render a spec-driven episode — the same code the agent's
// tools call (@studio/episode), so a stage and a tool never disagree. The
// compiler and the validator are the ones the episode's pinned template
// release names; nothing here chooses them.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideEditTimeline,
  EDIT_TIMELINE_PATH,
  isSpecDriven,
  renderEpisode,
  writeEditTimeline,
} from "@studio/episode";
import type { AdapterContext, StageAdapter } from "../descriptor.js";

export const SERIES_CHECK_PATH = "artifacts/series-check.json";

/** Every series stage needs the episode's spec; an episode without one belongs to another pipeline. */
function requireSpec(ctx: AdapterContext): void {
  if (!isSpecDriven(ctx.episodeDir)) {
    throw new Error("this pipeline needs an episode-spec.json; run the spec stage");
  }
}

/** Log each located problem, then fail the stage with the error. */
function failWith(ctx: AdapterContext, error: unknown): never {
  const problems = (error as { problems?: { code: string; message: string; path?: string }[] }).problems ?? [];
  for (const p of problems) ctx.log(`    ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
  throw error;
}

export const seriesTimeline: StageAdapter = {
  id: "series-timeline",
  summary: "Compiles the edit timeline with the compiler the spec's template release names, refusing a timeline that breaks the series' rules",
  capability: null,
  provider: "studio",
  produces: ["edit-timeline.json"],
  consumes: ["episode-spec.json", "images/", "takes.json"],
  requires: {},
  async perform(ctx) {
    requireSpec(ctx);
    try {
      const written = writeEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref });
      const by = written.compiledBy;
      ctx.log(`  timeline: ${by?.compiler ?? "?"} from spec revision ${by?.revision ?? "?"}, ${written.timeline.durationInFrames} frames`);
      for (const w of written.warnings) ctx.log(`    ⚠️ ${w}`);
      for (const f of written.validation?.findings ?? []) ctx.log(`    ⚠️ ${f.code} at ${f.path}: ${f.message}`);
      return [join(ctx.episodeDir, EDIT_TIMELINE_PATH)];
    } catch (error) {
      return failWith(ctx, error);
    }
  },
};

export const seriesCheck: StageAdapter = {
  id: "series-check",
  summary: "Checks the timeline a render would use against the series' rules and writes the report a person reviews; errors fail the stage",
  capability: null,
  provider: "studio",
  produces: ["series-check.json"],
  consumes: ["edit-timeline.json"],
  requires: {},
  async perform(ctx) {
    requireSpec(ctx);
    let decision;
    try {
      decision = decideEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref });
    } catch (error) {
      return failWith(ctx, error);
    }
    const findings = decision.validation?.findings ?? [];
    const report = {
      checkedAt: new Date().toISOString(),
      validator: decision.validation?.validator ?? null,
      decision: { rebuilt: decision.rebuilt },
      timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${decision.hash}` },
      findings,
    };
    // The report is the reviewer's evidence: written even when it refuses.
    const path = join(ctx.episodeDir, SERIES_CHECK_PATH);
    mkdirSync(join(ctx.episodeDir, "artifacts"), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    renameSync(temp, path);

    const errors = findings.filter((f) => f.severity === "error");
    ctx.log(`  check: ${report.validator ?? "no series rules"} — ${errors.length} error(s), ${findings.length - errors.length} warning(s)`
      + (decision.rebuilt ? `; the timeline would be recompiled: ${decision.rebuilt}` : ""));
    for (const f of findings) ctx.log(`    ${f.severity === "error" ? "❌" : "⚠️"} ${f.code} at ${f.path}: ${f.message}`);
    if (errors.length > 0) {
      throw new Error(`the series rules (${report.validator}) refuse this timeline: see ${SERIES_CHECK_PATH}`);
    }
    return [path];
  },
};

export const seriesRender: StageAdapter = {
  id: "series-render",
  summary: "Renders the checked edit timeline with Remotion to output/<render-id>.mp4, refusing one that breaks the series' rules",
  capability: "video.compose",
  provider: "remotion-composer",
  produces: ["output.mp4"],
  consumes: ["edit-timeline.json", "series-check.json"],
  requires: { system: ["ffmpeg"] },
  async perform(ctx) {
    requireSpec(ctx);
    if (!existsSync(join(ctx.episodeDir, SERIES_CHECK_PATH))) {
      throw new Error(`${SERIES_CHECK_PATH} is missing: run the check stage`);
    }
    try {
      const render = await renderEpisode(ctx.episodeDir, { episodeRef: ctx.ref });
      ctx.log(`  render: output/${render.renderId}.mp4 — ${render.result.durationSeconds.toFixed(1)}s, ${render.result.profile}`
        + (render.rebuilt ? `; timeline rebuilt: ${render.rebuilt}` : ""));
      return [render.outputPath];
    } catch (error) {
      return failWith(ctx, error);
    }
  },
};
```

Apply to `studio/adapters/src/studio.ts`:

```diff
diff --git a/studio/adapters/src/studio.ts b/studio/adapters/src/studio.ts
index 43f5a15..8f6e1fc 100644
--- a/studio/adapters/src/studio.ts
+++ b/studio/adapters/src/studio.ts
@@ -12,12 +12,16 @@ import { illustrationsFromAssets } from "./adapters/illustrations.js";
 import { narrationCaptions } from "./adapters/captions.js";
 import { narrationTiming } from "./adapters/timing.js";
 import { renderQa } from "./adapters/render-qa.js";
+import { seriesCheck, seriesRender, seriesTimeline } from "./adapters/series.js";
 
 export const STUDIO_ADAPTERS: readonly StageAdapter[] = Object.freeze([
   illustrationsFromAssets,
   narrationCaptions,
   narrationTiming,
   renderQa,
+  seriesTimeline,
+  seriesCheck,
+  seriesRender,
 ]);
 
 export function createStudioRegistry(): AdapterRegistry {
```

Rebuild: `npm run build --workspace @studio/runtime && npm run build --workspace @studio/adapters`.

- [ ] **Step 5: Run the tests and the typechecks**

Run:
```bash
cd studio/runtime && npx vitest run && cd ../adapters && npx tsc --noEmit && npx vitest run && cd ../gateway && npx vitest run && cd ../pipelines && npm test
```
Expected: runtime `Tests 625 passed`; adapters `Tests 40 passed` (conformance included: every adapter performs a built-in stage; the default pipeline still performs exactly its four stages); gateway `Tests 355 passed`; pipelines `# pass 37`.

- [ ] **Step 6: Commit**

```bash
git add studio/pipelines/pipelines/series-production.yaml studio/pipelines/fixtures/valid/series-local studio/runtime/src/artifacts/discovery.ts studio/runtime/test/unit/artifacts/discovery.test.ts studio/adapters/src/adapters/series.ts studio/adapters/src/studio.ts studio/adapters/test/series.test.ts studio/adapters/package.json bun.lock
git commit -m "feat(pipelines): the series-production family and its stage adapters (avg-jao.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `fill-episode-spec` skill, docs, full check

**Files:**
- Create: `skills/studio/fill-episode-spec.md`
- Modify: `studio/agent/tests/skill-discovery.test.ts`, `skills/studio/compose-video.md`, `docs/pipelines.md`, `docs/adr/0037-series-templates-pin-editorial-standards.md`

- [ ] **Step 1: Write the failing test**

Apply to `studio/agent/tests/skill-discovery.test.ts`:

```diff
diff --git a/studio/agent/tests/skill-discovery.test.ts b/studio/agent/tests/skill-discovery.test.ts
index 0f0d422..5261bdc 100644
--- a/studio/agent/tests/skill-discovery.test.ts
+++ b/studio/agent/tests/skill-discovery.test.ts
@@ -18,6 +18,19 @@ it("discovers and loads the optional Resolve handoff production skill", async ()
   } finally { await rm(root, { recursive: true, force: true }); }
 });
 
+it("discovers the fill-episode-spec skill the series-production pipeline names", async () => {
+  const root = await mkdtemp(join(tmpdir(), "fill-spec-skill-"));
+  try {
+    const builtInPath = fileURLToPath(new URL("../../../skills/studio/", import.meta.url));
+    const catalog = await discoverSkills({ libraryRoot: root, builtInPath });
+    expect(catalog.list({ source: "built-in" }).find(s => s.id === "fill-episode-spec")?.description).toContain("template release");
+    const skill = await catalog.load("fill-episode-spec");
+    expect(skill).toContain("pva_init_spec");
+    expect(skill).toContain("pva_check_episode");
+    expect(skill).toContain("Never change a value the schema fixes");
+  } finally { await rm(root, { recursive: true, force: true }); }
+});
+
 it("discovers composed flat/folder skills and scopes layout-2 series overrides", async () => {
   const root = await mkdtemp(join(tmpdir(), "skills-discovery-"));
   try {
```

Run: `cd studio/agent && npx vitest run tests/skill-discovery.test.ts`
Expected: FAIL — no `fill-episode-spec` skill.

- [ ] **Step 2: The skill**

`skills/studio/fill-episode-spec.md`:

````markdown
---
name: fill-episode-spec
version: "0.1.0"
description: Create a series episode's spec from its template release and fill every placeholder, keeping the series' fixed standards
inputs:
  - name: release
    type: text/markdown
    description: The template release's FORMAT.md (the standard and the procedure), its episode-spec.schema.json and its episode-spec.template.json
  - name: content
    type: string
    description: What this episode is about — the person's brief, the poem, the source material
outputs:
  - episode-spec.json:
      kind: application/json
      description: The episode's spec, pinned to one exact template release, with no __FILL__ left
capabilities:
  - llm
---

# Fill Episode Spec

A series episode starts from its spec (`episode-spec.json`): the content of
this episode, in the shape its series' template release fixes (ADR-0037). The
release decides the format — style, voice, profile, compiler, rules; the spec
supplies only the content. This is the `spec` stage of the
`series-production` pipeline; a person approves the result at its gate.

## Steps

1. **Create the draft** with `pva_init_spec { channel, series, episode,
   template, version }`. Ask for the exact release (`x.y.z`) if the person
   has not named one — never pick "the latest". It refuses to replace an
   existing spec: if there is one, edit it instead.
2. **Read the release**: `templates/<id>/<version>/FORMAT.md` is the
   standard and the procedure; `episode-spec.schema.json` says the type and
   the limits of every field. Read both before writing anything.
3. **Fill every placeholder** the tool listed (`$.data["title"]`, …) with a
   value of the type the schema asks: a number where it says number, an
   array of objects where it says array. `__FILL__` can stand for any value,
   not only text.
4. **Check** with `pva_check_episode`: `unfilled` and schema problems are
   reported first, with their JSON paths; then the series' rules. Repeat
   until nothing but warnings remains.
5. **Hand it over** at the stage's review gate: say what you filled and why,
   and quote every warning.

## Never

- Never change a value the schema fixes (`const`: the style, the caption
  kit, the voice profile, the output profile) — a different format is a new
  template release, which only a person decides.
- Never edit, copy or "correct" the release: it is immutable, and its hashes
  make every episode pinned to it fail.
- Never invent content the person did not give or approve: a missing fact
  is a question, not a placeholder filled with a guess.
- After the spec is approved, raise `revision` by one for every edit.
````

Run: `cd studio/agent && npx vitest run tests/skill-discovery.test.ts`
Expected: 3 passed.

- [ ] **Step 3: Docs**

Apply:

````diff
diff --git a/docs/pipelines.md b/docs/pipelines.md
index d53ea3e..370adfd 100755
--- a/docs/pipelines.md
+++ b/docs/pipelines.md
@@ -70,6 +70,45 @@ end to end. Do not interpret a declared gate as proof that direct tool calls are
 mechanically blocked. See the [harness review](harness-review.md) for evidence and
 priority fixes before unattended execution.
 
+## The series-production family
+
+`series-production` (`studio/pipelines/pipelines/series-production.yaml`) is
+one pipeline for every series with a template (ADR-0037): the compiler and the
+validator are the ones the episode's pinned release names, never the
+pipeline's.
+
+| Stage | Performed by | Gate |
+|---|---|---|
+| `spec` → `episode-spec.json` | Pi: `pva_init_spec`, then the `fill-episode-spec` skill | human |
+| `pictures` → `images/` | the person or Pi: every picture the spec names, in `assets/images` | human |
+| `takes` → `takes.json` | the person or Pi: the narration takes and their word timing | human |
+| `timeline` → `edit-timeline.json` | adapter `series-timeline` (the release's compiler) | — |
+| `check` → `series-check.json` | adapter `series-check` (the release's validator); errors fail it | human |
+| `render` → `output.mp4` | adapter `series-render` (`video.compose`, Remotion) | human |
+
+A series extends it and replaces stages by id (ADR-0001). The example
+`studio/pipelines/fixtures/valid/series-local/poetry-short.yaml` keeps every
+stage and replaces `takes` with the poem's recital:
+
+```yaml
+pipeline:
+  id: poetry-short
+  version: "1.0.0"
+  extends:
+    pipeline: series-production
+    version: "1.0.0"
+  stages:
+    - id: takes
+      name: "Recital Take"
+      # same contracts as the base stage; the poem's own instructions
+```
+
+Stages that depend on unfinished work arrive as new versions of the base:
+take synthesis, alignment and verification (`avg-8hs.*`) turn `takes` into
+capability stages; the layout sheet (`avg-3th.1`) goes between `check` and
+`render`; the render audit (`avg-3th.3`) and the delivery package
+(`avg-3th.5`) follow `render`.
+
 ## Adding a workflow
 
 1. Reuse provider-neutral capabilities and typed media outputs.
````

```diff
diff --git a/docs/adr/0037-series-templates-pin-editorial-standards.md b/docs/adr/0037-series-templates-pin-editorial-standards.md
index 691a983..bcec616 100644
--- a/docs/adr/0037-series-templates-pin-editorial-standards.md
+++ b/docs/adr/0037-series-templates-pin-editorial-standards.md
@@ -185,7 +185,9 @@ a trusted golden; it cannot infer trust from `validateSeriesReference() === []`.
 - `avg-jao.3` owns the series validators and the check that blocks rendering;
   `avg-jao.6` owns reference trust/promotion integration; blocking the layout
   sheet comes with the sheet (`avg-3th.1`).
-- `avg-jao.4` owns pipeline wiring; `avg-jao.5` owns identical-instant visual
+- `avg-jao.4` owns pipeline wiring: the `series-production` family (spec,
+  pictures, takes, timeline, check, render), its stage adapters and
+  `pva_init_spec`; `avg-jao.5` owns identical-instant visual
   comparisons. Real channel templates and approved reference media belong to
   `avg-dcf`, not contract fixtures. No CreativeStudio runtime or production
   content is copied into this repository.
```

```diff
diff --git a/skills/studio/compose-video.md b/skills/studio/compose-video.md
index 955fdad..c330d53 100644
--- a/skills/studio/compose-video.md
+++ b/skills/studio/compose-video.md
@@ -1,6 +1,6 @@
 ---
 name: compose-video
-version: "0.4.0"
+version: "0.5.0"
 description: Compose the final video through the episode's edit timeline, rendered with Remotion
 inputs:
   - name: illustrations
@@ -59,6 +59,11 @@ Profiles: `youtube-1920x1080` (default, −15 LUFS) and `vertical-1080x1920`
 
 ## Episodes with a spec
 
+A spec is created with `pva_init_spec` (a draft pinned to an exact template
+release, never replacing an existing spec) and filled with the
+`fill-episode-spec` skill. In the `series-production` pipeline the timeline,
+check and render stages run the same code as the tools below.
+
 An episode with an `episode-spec.json` is pinned to a series template release
 (ADR-0037), and its timeline is **compiled** by the compiler that release names
 (`poetry-short@1.0.0`, …) from the spec, `artifacts/narration/takes.json` and
```

(The base manifest's `render` stage names `compose-video` 0.5.0.)

- [ ] **Step 4: Full check**

Run: `npm run check && npm run docs:build`
Then: `cd studio/agent && REMOTION_E2E=1 npx vitest run tests/compose-spec.e2e.test.ts tests/compose-video.e2e.test.ts`
Expected: everything passes (`@studio/episode` included); VitePress builds; 3 e2e tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/studio/fill-episode-spec.md skills/studio/compose-video.md studio/agent/tests/skill-discovery.test.ts docs/pipelines.md docs/adr/0037-series-templates-pin-editorial-standards.md
git commit -m "docs: the series-production family, the fill-episode-spec skill (avg-jao.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After the PR merges: close `avg-jao.4`.
