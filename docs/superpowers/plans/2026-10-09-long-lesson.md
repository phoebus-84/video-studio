# The Long Lesson Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.6.2` and `avg-dcf.6.3`. Il lampo's lesson compiles from its spec into a 16:9 timeline of the lesson kits. It takes the poem's paintings and recital from the short episode it pins.

**Architecture:**
- **The loader reads pinned episodes.** `@studio/episode`'s loader reads the episodes an episode pins (ADR-0035), checked against each pin's inventory. It offers their pictures and takes as `source-<pin>-…` assets, and their takes and timings as `CompileInput.sources`.
- **The release.** `dentro-i-versi-long@1.0.0` holds `FORMAT.md`, the episode-spec schema and template, and pins the theme.
- **The compiler and validator.** `@studio/series` gains both. The compiler lays out blocks with word cues on the guide's takes. A golden Il lampo fixture translates CreativeStudio's `lezione.json`.

**Tech Stack:**
- TypeScript, with `node:test` in series and vitest in episode;
- JSON Schema (draft 2020-12);
- Remotion, for the layout sheet e2e.

**Spec:** `docs/superpowers/specs/2026-10-09-long-lesson-design.md`, on this branch, with the "Settled by the prototype" section.

Prototype: the local commits up to `89f7ed7` on `scratch/long-lesson`. Never push or merge them. They passed:
- series 153;
- episode 233 (4 skipped);
- agent 210;
- adapters 46;
- root `npm run check`;
- the real layout sheet e2e (`REMOTION_E2E=1`): 67 stills of every block and chapter.

## Global Constraints

- Work on branch `feat/long-lesson`, in the main checkout.
- Never push or merge without the user's go.
- Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`. Never run `bd`. Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code and fixtures go in exactly as shown. Large generated fixtures are taken with `git -C "$(git rev-parse --show-toplevel)" checkout 89f7ed7 -- <paths>`, and must equal the prototype.
- No dependency changes.
- `@studio/episode` reads `@studio/series` and the composer from `dist/`: rebuild them before its tests (`npm run build --workspace @studio/series`, `npm run build --workspace @av/remotion-composer`). Agent and adapters read `@studio/episode` from `dist/`: rebuild it before their tests.
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **A pinned source that changed.** A file differing from the pin's inventory, or not in it, must stop the load with `pin-mismatch`, naming the file. Task 1's tests and Task 3's integration test pin this.
- **A cue that finds nothing.** It must stop compilation at its JSON path (`cue-not-found`), never fall back. An elided word must be found. Task 2's tests pin both.
- **The loop.** The first and last frame must be the atrio with the cover, the guide absent, the room still (no drift, quiet at the edges). Task 2's tests and the e2e sheet pin this.
- **A hand edit the series forbids.** A moved voice, a changed look, a lost loop or a removed teleport must be errors. Task 2's validator golden cases pin these.
- **Every kit's props.** Every compiled item must be valid against its kit, because the compiler checks the timeline against the composer. Task 2's golden pins this.

---

### Task 1: Pinned episodes in the series loader

**Files:**
- Create: `studio/episode/tests/series-pins.test.ts`.
- Modify:
  - `studio/series/src/types.ts` (`CompileInput.sources`);
  - `studio/episode/src/series-compile.ts`;
  - `studio/episode/README.md`.

**Interfaces:**
- Produces:
  - `CompileInput.sources?: Record<pin, {narration, timings}>`;
  - the assets `source-<pin>-image-<name>`, `source-<pin>-sound-<name>` and `source-<pin>-narration-<take>`, with paths relative to the episode;
  - `sharedRootsOf` returning the theme release and the pinned episodes.

- [ ] **Step 1: Write the failing test**

Create `studio/episode/tests/series-pins.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventory } from "@studio/contracts/src/source-pins.mjs";
import { loadEpisode, sharedRootsOf } from "../src/series-compile.js";
import { specEpisode } from "../src/testing.js";

/**
 * Material pinned from another episode of the channel (ADR-0035) reaches the
 * compiler: its pictures and takes as source-<pin>-… assets, its takes and
 * timings as CompileInput.sources, held to the pin's inventory.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
const SOURCE = { ...REF, episode: "source" };
let root: string;
const dirOf = (ref: typeof REF) => join(root, ref.channel, "series", ref.series, "episodes", ref.episode);

async function pin(paths?: string[]): Promise<void> {
  const files = await inventory(dirOf(SOURCE), paths);
  mkdirSync(join(dirOf(REF), "source", "pins"), { recursive: true });
  writeFileSync(join(dirOf(REF), "source", "pins", "fonte.json"), JSON.stringify({
    apiVersion: "studio.video/v1alpha1", kind: "SourcePin", id: "fonte",
    source: { kind: "episode", series: SOURCE.series, episode: SOURCE.episode },
    ...(paths ? { paths } : {}), usedBy: ["timeline"], pinnedAt: "2026-10-09T12:00:00.000Z", files,
  }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-pins-"));
  specEpisode(dirOf(SOURCE), SOURCE);
  specEpisode(dirOf(REF), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("pinned episodes in loadEpisode", () => {
  it("offers the pinned episode's pictures and takes, and its takes and timings as sources", async () => {
    await pin();
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    const { assets, sources } = loaded.input;
    const own = Object.keys(assets).filter((id) => id.startsWith("image-"));
    const pinned = Object.keys(assets).filter((id) => id.startsWith("source-fonte-image-"));
    expect(pinned.map((id) => id.replace("source-fonte-", ""))).toEqual(own);
    expect(assets[pinned[0]!]!.path).toMatch(/^\.\.\/source\/assets\/images\//);
    const takes = sources!.fonte!.narration.takes.map((t) => t.id);
    expect(Object.keys(sources!.fonte!.timings).sort()).toEqual([...takes].sort());
    for (const take of takes) expect(assets[`source-fonte-narration-${take}`]!.kind).toBe("audio");
  });

  it("refuses a pinned file changed since the pin, naming it", async () => {
    await pin();
    const takes = JSON.parse(readFileSync(join(dirOf(SOURCE), "artifacts", "narration", "takes.json"), "utf-8"));
    writeFileSync(join(dirOf(SOURCE), takes.takes[0].audio.path), "re-recorded");
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(loaded.ok ? null : loaded.problems[0]).toMatchObject({ code: "pin-mismatch", path: `../source/${takes.takes[0].audio.path}` });
  });

  it("refuses a file the pin did not inventory", async () => {
    await pin(["artifacts/narration/takes.json"]);
    const loaded = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(loaded.ok ? null : loaded.problems[0]!.code).toBe("pin-mismatch");
  });

  it("offers nothing pinned when there is no pin, and puts the pinned episode among the render's roots", async () => {
    const before = loadEpisode(dirOf(REF), { episodeRef: REF });
    expect(before.ok && before.input.sources).toBeUndefined();
    expect(sharedRootsOf(dirOf(REF))).not.toContain(dirOf(SOURCE));
    await pin();
    expect(sharedRootsOf(dirOf(REF))).toContain(dirOf(SOURCE));
  });
});
````

Run: `npm run build --workspace @studio/series && cd studio/episode && npx vitest run tests/series-pins.test.ts`
Expected: FAIL. No `source-fonte-…` assets are offered, and the source is not among the roots.

- [ ] **Step 2: The loader**

````diff
diff --git a/studio/episode/src/series-compile.ts b/studio/episode/src/series-compile.ts
index 7425157..9ef3698 100644
--- a/studio/episode/src/series-compile.ts
+++ b/studio/episode/src/series-compile.ts
@@ -18,6 +18,7 @@ import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mj
 import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
 import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
 import { THEME_FILE, themeReleasePath, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
+import { PINS_DIR, sourceDir, validateSourcePin } from "@studio/contracts/src/source-pins.mjs";
 
 export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
 /** What the loader offers from assets/: every file in each folder, as <prefix>-<name>. */
@@ -112,9 +113,23 @@ export function sharedRootsOf(episodeDir: string): string[] {
     const pin = JSON.parse(readFileSync(join(dir, EPISODE_SPEC_PATH), "utf-8"))?.template;
     const releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), pin?.id, pin?.version);
     const theme = JSON.parse(readFileSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST), "utf-8"))?.theme;
-    if (!theme) return [];
-    const themeDir = join(dirname(dirname(seriesDir)), themeReleasePath(theme.id, theme.version));
-    return existsSync(themeDir) ? [themeDir] : [];
+    const roots: string[] = [];
+    if (theme) {
+      const themeDir = join(dirname(dirname(seriesDir)), themeReleasePath(theme.id, theme.version));
+      if (existsSync(themeDir)) roots.push(themeDir);
+    }
+    // the episodes it pins (ADR-0035): their pictures and takes are its assets too
+    const channelDir = dirname(dirname(seriesDir));
+    const pinsDir = join(dir, PINS_DIR);
+    for (const name of existsSync(pinsDir) ? readdirSync(pinsDir).filter((n) => n.endsWith(".json")).sort() : []) {
+      try {
+        const source = JSON.parse(readFileSync(join(pinsDir, name), "utf-8"))?.source;
+        if (source?.kind !== "episode") continue;
+        const srcDir = sourceDir(dirname(channelDir), basename(channelDir), source);
+        if (existsSync(srcDir)) roots.push(srcDir);
+      } catch { /* loading the episode reports it */ }
+    }
+    return roots;
   } catch {
     return [];
   }
@@ -324,7 +339,72 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     }
   }
 
-  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}) }, releaseKey };
+  // ── Material pinned from other episodes of the channel (ADR-0035) ────────
+  // Each pin names an episode; what this episode reads of it must be what the
+  // pin inventoried, or the pin needs renewing. Its pictures are offered as
+  // source-<pin>-image-<name>, its takes as source-<pin>-narration-<take>, with
+  // paths relative to this episode.
+  const sources: NonNullable<CompileInput["sources"]> = {};
+  const pinsDir = join(episodeDir, PINS_DIR);
+  const pinFiles = existsSync(pinsDir) ? readdirSync(pinsDir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort() : [];
+  const channelDir = dirname(dirname(seriesDir));
+  for (const name of pinFiles) {
+    const pinKey = `${PINS_DIR}/${name}`;
+    let pinDoc: any;
+    try {
+      pinDoc = JSON.parse(read(join(pinsDir, name), episodeDir, () => stop("missing-pin", pinKey, `${pinKey} is missing`)).toString("utf-8"));
+    } catch (error) {
+      if (error instanceof Stop) throw error;
+      return stop("bad-pin", pinKey, `${pinKey} is not JSON: ${(error as Error).message}`);
+    }
+    const pinProblems = validateSourcePin(pinDoc);
+    if (pinProblems.length > 0) throw new Stop(at(pinKey, pinProblems));
+    // Only episodes are compile material; a channel source pins texts and references for people.
+    if (pinDoc.source.kind !== "episode") continue;
+    const id = pinDoc.id as string;
+    const srcDir = sourceDir(dirname(channelDir), basename(channelDir), pinDoc.source);
+    const files = pinDoc.files as Record<string, { hash: string }>;
+    /** A file of the source, held to the pin's inventory. */
+    const fromSource = (path: string, where: string): Buffer => {
+      if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) stop("path-escape", where, `${path} is not a path inside the pinned episode`);
+      const file = join(srcDir, path);
+      const key = relative(episodeDir, file).split(sep).join("/");
+      const entry = files[path];
+      if (!entry) stop("pin-mismatch", where, `${path} of the pinned episode is not in pin "${id}": renew the pin (vpr pin)`);
+      const bytes = read(file, srcDir, () => stop("pin-mismatch", key, `${key} is missing: renew the pin (vpr pin) or restore it`));
+      if (inputs[key] !== entry!.hash) stop("pin-mismatch", key, `${key} changed since pin "${id}" inventoried it: renew the pin (vpr pin)`);
+      return bytes;
+    };
+    const keyOf = (path: string) => relative(episodeDir, join(srcDir, path)).split(sep).join("/");
+    const sourceNarration = files[NARRATION_TAKES_PATH] ? JSON.parse(fromSource(NARRATION_TAKES_PATH, pinKey).toString("utf-8")) : null;
+    const sourceTimings: Record<string, any> = {};
+    if (sourceNarration) {
+      const problems = validateNarrationTakes(sourceNarration);
+      if (problems.length > 0) throw new Stop(at(keyOf(NARRATION_TAKES_PATH), problems));
+      (sourceNarration.takes as any[]).forEach((take, i) => {
+        const where = `${keyOf(NARRATION_TAKES_PATH)}#$.takes[${i}]`;
+        const audio = fromSource(take.audio.path, `${where}.audio.path`);
+        if (sha256(audio) !== take.audio.hash) stop("hash-mismatch", `${where}.audio.hash`, `pinned take "${take.id}": ${take.audio.path} is not the audio the take recorded`);
+        assets[`source-${id}-narration-${take.id}`] = { path: keyOf(take.audio.path), hash: take.audio.hash, kind: "audio" };
+        if (!take.timing) return;
+        const timing = JSON.parse(fromSource(take.timing.path, `${where}.timing.path`).toString("utf-8"));
+        const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
+        if (timingProblems.length > 0) throw new Stop(at(keyOf(take.timing.path), timingProblems));
+        sourceTimings[take.id] = timing;
+      });
+      sources[id] = { narration: sourceNarration, timings: sourceTimings };
+    }
+    for (const { dir, prefix, kind, extensions } of OFFERED) {
+      for (const path of Object.keys(files).filter((p) => p.startsWith(`assets/${dir}/`) && !p.slice(`assets/${dir}/`.length).includes("/")).sort()) {
+        const file = path.slice(`assets/${dir}/`.length);
+        if (file.startsWith(".") || !(extensions as readonly string[]).includes(extname(file).toLowerCase())) continue;
+        fromSource(path, pinKey);
+        assets[`source-${id}-${prefix}-${file.slice(0, -extname(file).length)}`] = { path: keyOf(path), hash: files[path]!.hash, kind };
+      }
+    }
+  }
+
+  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}), ...(Object.keys(sources).length > 0 ? { sources } : {}) }, releaseKey };
 }
 
 const IN_TIMELINE = /^\$\.(tracks|profile|durationInFrames|resolution|assets|sections)\b/;
diff --git a/studio/series/src/types.ts b/studio/series/src/types.ts
index ac26e58..82ba1c9 100644
--- a/studio/series/src/types.ts
+++ b/studio/series/src/types.ts
@@ -43,6 +43,13 @@ export interface CompileInput {
    * the pin and the contract; its rooms' images are assets theme-<room>.
    */
   theme?: ChannelTheme;
+  /**
+   * Material other episodes of the channel made, pinned by this one
+   * (ADR-0035): pin id → that episode's takes and their timings. Their audio
+   * and pictures are assets source-<pin>-narration-<take> and
+   * source-<pin>-image-<name>.
+   */
+  sources?: Record<string, { narration: NarrationTakes; timings: Record<string, WordTiming> }>;
 }
 
 /** Something in the input that stops compilation, located by a JSON path. */
````

- [ ] **Step 3: Run it, then everything**

Run: `npm run build --workspace @studio/series` (types), then `cd studio/episode && npx tsc --noEmit && npx vitest run tests/series-pins.test.ts && npx vitest run`
Expected: PASS. The 4 new tests pass, and the suite passes.

- [ ] **Step 4: Docs and commit**

````diff
diff --git a/studio/episode/README.md b/studio/episode/README.md
index b48ebe1..72115be 100644
--- a/studio/episode/README.md
+++ b/studio/episode/README.md
@@ -16,7 +16,7 @@ adapters both call this package, so a tool and a stage never disagree.
 | `narration-manifest.ts` | The canonical `artifacts/narration/narration-manifest.json`: build, measure, validate, write |
 | `scene-images.ts` | Scene images in reading order and their lengths (legacy episodes) |
 | `edit-timeline-builder.ts` | `buildEditTimeline`: the timeline of an episode without a spec |
-| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules; offers `assets/images/*` as `image-<name>` and `assets/sounds/*` as `sound-<name>`; reads the channel theme the release pins (ADR-0040), every file inside that release, and offers its rooms as `theme-<room>`; `sharedRootsOf`: that theme release, which renders and layout sheets may take assets from (none when the release pins no theme) |
+| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules; offers `assets/images/*` as `image-<name>` and `assets/sounds/*` as `sound-<name>`; reads the channel theme the release pins (ADR-0040), every file inside that release, and offers its rooms as `theme-<room>`; reads the episodes it pins (`source/pins/<id>.json`, ADR-0035), held to each pin's inventory (`pin-mismatch`), and offers their pictures as `source-<pin>-image-<name>`, their takes as `source-<pin>-narration-<take>` and their takes and timings as `sources`; `sharedRootsOf`: that theme release and the pinned episodes, which renders and layout sheets may take assets from |
 | `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
 | `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |
 | `references.ts` | `proposeReference`: freeze an episode as a proposed golden reference |
````

```bash
git add studio/series/src/types.ts studio/episode/src/series-compile.ts studio/episode/tests/series-pins.test.ts studio/episode/README.md
git commit -m "The series loader reads the episodes an episode pins: their pictures and takes as source-<pin>-… assets, held to the pin (avg-dcf.6.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The release, the compiler, the validator, the golden Il lampo

**Files:**
- Create:
  - `studio/series/fixtures/dentro-i-versi-long/1.0.0/release/{series-template.json, FORMAT.md, episode-spec.schema.json, episode-spec.template.json}`;
  - `studio/series/fixtures/dentro-i-versi-long/1.0.0/input.json`;
  - `studio/series/fixtures/dentro-i-versi-long/1.0.0/expected-timeline.json`;
  - `studio/series/fixtures/validators/dentro-i-versi-long/1.0.0/cases.json`;
  - `studio/series/src/compilers/dentro-i-versi-long/1.0.0.ts`;
  - `studio/series/src/validators/dentro-i-versi-long/1.0.0.ts`;
  - `studio/series/test/dentro-i-versi-long.test.ts`.
- Modify:
  - `studio/series/src/registry.ts`;
  - `studio/series/src/validators.ts`;
  - `studio/series/README.md`.

**Interfaces:**
- Consumes: Task 1's `CompileInput.sources`.
- Produces: the compiler and the validator `dentro-i-versi-long@1.0.0`, registered.

- [ ] **Step 1: The release and the fixtures**

The fixture's `input.json` is Il lampo's lesson, translated from CreativeStudio's `lezione.json` with synthetic timings, and the golden is what the compiler makes of it. Take them as the prototype made them:

```bash
git -C "$(git rev-parse --show-toplevel)" checkout 89f7ed7 -- \
  studio/series/fixtures/dentro-i-versi-long \
  studio/series/fixtures/validators/dentro-i-versi-long
```

- [ ] **Step 2: Write the failing tests**

Create `studio/series/test/dentro-i-versi-long.test.ts`:

````ts
// What dentro-i-versi-long@1.0.0 does with a lesson's spec, its guide takes
// and its pinned source. The fixture is Il lampo's lesson translated from
// CreativeStudio's lezione.json, with synthetic timings: each take's words
// spread evenly over it.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "dentro-i-versi-long", "1.0.0", "input.json");
const load = (): CompileInput & { spec: { data: any }; narration: any; timings: any; sources: any } => JSON.parse(readFileSync(FIXTURE, "utf-8"));

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems.map((p) => [p.code, p.path]);
};
const all = (r: ReturnType<typeof compiled>, prefix: string) =>
  r.timeline.tracks.filter((t) => t.id === prefix || t.id.startsWith(`${prefix}-`)).flatMap((t) => t.items as any[]).sort((a, b) => a.from - b.from);
const kit = (r: ReturnType<typeof compiled>, name: string) => r.timeline.tracks.flatMap((t) => t.items as any[]).filter((i) => i.kit?.name === name);

test("blocks follow each other: each lasts its take, then its gap, then a chapter's 4 s card", () => {
  const input = load();
  const r = compiled(input);
  const blocks = (r.timeline.metadata as any).blocks as { id: string; start: number; speech: number; end: number }[];
  assert.deepEqual(blocks.map((b) => b.id), input.spec.data.blocks.map((b: any) => b.id));
  const take = (id: string) => input.narration.takes.find((t: any) => t.id === id).audio.durationSeconds;
  const epoca = blocks.find((b) => b.id === "epoca")!;
  assert.equal(epoca.speech, Math.round((epoca.start + 0.4) * 1000) / 1000);
  assert.equal(epoca.end, Math.round((epoca.start + 0.4 + take("epoca") + 0.6) * 1000) / 1000);
  // ascolto1 is followed by chapter I: its card, then epoca
  const ascolto1 = blocks.find((b) => b.id === "ascolto1")!;
  const gap = input.spec.data.blocks.find((b: any) => b.id === "ascolto1").gapAfter;
  assert.ok(Math.abs(epoca.start - (ascolto1.end + gap + 4)) < 1e-6);
  assert.equal(r.timeline.durationInFrames, Math.round(blocks.at(-1)!.end * 30));
});

test("five chapter cards, the cover at the first and the last frame, and the loop declared", () => {
  const r = compiled(load());
  assert.equal(kit(r, "chapter-opener").length, 5);
  const covers = kit(r, "cover");
  assert.deepEqual(covers.map((c) => c.from), [0, r.timeline.durationInFrames - covers[1].duration]);
  assert.deepEqual(covers[0].props, covers[1].props);
  assert.equal((r.timeline as any).loop, true);
  const rooms = kit(r, "room");
  assert.equal(rooms[0].props.room.image.$asset, "theme-atrio");
  assert.equal(rooms.at(-1).props.room.image.$asset, "theme-atrio");
  assert.equal(rooms[0].props.drift, false);
});

test("the guide speaks her takes; the recitals and the title are the pinned source's", () => {
  const r = compiled(load());
  const voice = all(r, "voice");
  assert.ok(voice.every((v) => v.asset.startsWith("narration-")));
  const recital = all(r, "recital").map((v) => v.asset);
  assert.deepEqual(recital, ["source-fonte-narration-titolo", "source-fonte-narration-recita", "source-fonte-narration-recita"]);
  assert.ok(r.timeline.assets["source-fonte-image-lampo-01-cielo-terra"]);
});

test("a cue finds an elided word, and a cue that finds no word stops compilation at its path", () => {
  const input = load();
  const epoca = input.spec.data.blocks.findIndex((b: any) => b.id === "epoca");
  // «L'Italia» answers "italia"
  assert.ok(compileSpec(input).ok);
  input.spec.data.blocks[epoca].phases[1].at = { word: "teiera" };
  assert.deepEqual(problems(compileSpec(input)), [["cue-not-found", `$.data.blocks[${epoca}].phases[1].at`]]);
});

test("without the pinned source, nothing compiles", () => {
  const input = load();
  delete (input as any).sources;
  assert.deepEqual(problems(compileSpec(input)), [["missing-source", "$.data.source.pin"]]);
});

test("a verse that the recital does not say is located", () => {
  const input = load();
  input.spec.data.verses[6].text += " e poi ancora";
  assert.equal(problems(compileSpec(input))[0]![0], "verse-mismatch");
});

test("each specimen draws its figure tool with its painting, its aspect, the progress and its verses", () => {
  const r = compiled(load());
  for (const name of ["merge", "cards", "stack", "oxymoron", "simile"]) {
    const [tool] = kit(r, name);
    assert.ok(tool, name);
    assert.ok(tool.props.picture.src.$asset.startsWith("source-fonte-image-"), name);
    assert.equal(tool.props.picture.aspect, 0.75, name);
  }
  const progress = kit(r, "progress");
  assert.deepEqual(progress.map((p) => p.props.current), [0, 1, 2, 3, 4]);
});
````

Run: `cd studio/series && node --import tsx --test test/dentro-i-versi-long.test.ts test/golden.test.ts test/validators-golden.test.ts`
Expected: FAIL. No compiler `dentro-i-versi-long`.

- [ ] **Step 3: The compiler and the validator**

Create `studio/series/src/compilers/dentro-i-versi-long/1.0.0.ts`:

````ts
// dentro-i-versi-long@1.0.0 — released: never edit this file; add dentro-i-versi-long/<next>.ts instead.
//
// "Dentro i versi · long": the lesson on a poem (CreativeStudio's
// poesie-museo-long, runtime v10). Blocks follow each other — the opening in
// the atrio, the announcement, the recital, the story, the note on the text,
// one specimen per painting with its figure tool, the metre, the invitation,
// the annotated recital, the summary, the exit — each lasting its guide's take,
// with the chapters' cards between them. Every time inside a block is a cue
// on a word of its take. The look, the rooms and the characters are the
// pinned theme's; the poem's paintings and recital are the pinned source
// episode's (ADR-0035); the kits are the channel-neutral lesson kits
// (ADR-0040). The last frame is the first: the atrio and the cover.
//
// Channel specifics in code: the layout of this format (positions, the
// guide's place, durations of its pauses) and the poses' expressions, as the
// short's compiler — accepted for now; the boundary to restore is avg-d1x.

import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler, WordTiming } from "../../types.js";

const FPS = 30;
const SPEC_PATH = "episode-spec.json";
const PROFILE = "youtube-1920x1080";
/** Silence before and after a block's take, and the default gap between blocks. */
const LEAD = 0.4;
const TAIL = 0.6;
const GAP = 1.0;
/** A chapter's card between two blocks. */
const CHAPTER = 4.0;
/** The cover the video opens and closes on. */
const COVER = 1.6;
/** The exit's default length (the end screens). */
const END = 14;
const GUIDE = { x: 1700, scale: 0.95 };
const PANEL = { x: 440, y: 150, w: 1060, h: 596 };
/** The verse bar between the block's title (bottom left) and the guide (right). */
const VERSE_WIDTH = 760;

const KIT = (name: string, version = "1.0.0") => ({ name, version });
const REST = { lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0 };
type Pose = typeof REST;
const EXPRESSIONS: Record<string, { li: number; lo: number; ri: number; ro: number; sm: number }> = {
  N: { li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25 },
  A: { li: -6, lo: 3, ri: -6, ro: 3, sm: -0.5 },
  W: { li: 7, lo: 6, ri: 7, ro: 6, sm: 0 },
  I: { li: 7, lo: 5, ri: -2, ro: 0, sm: 0.8 },
  M: { li: 6, lo: -3, ri: 6, ro: -3, sm: -0.6 },
  S: { li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9 },
};
const FIGURE_KITS = new Set(["merge", "cards", "stack", "oxymoron", "simile"]);
/** Keys whose values are cues, wherever they sit in a kit's props; `times` holds only cues; `read` and `strikes` lists of them. */
const CUE_KEYS = new Set(["at", "until", "glossAt", "lineFrom", "appear", "lit", "point", "merge"]);

type Cue = number | "end" | { word: string; n?: number; offset?: number };
interface Picture { asset: string; focus?: [number, number]; aspect?: number }
interface Block {
  id: string;
  kind: "opening" | "announcement" | "recital" | "story" | "note" | "specimen" | "meter" | "invite" | "summary" | "end";
  title: string;
  take?: string;
  lower?: { kicker: string; title: string; info?: string };
  chapterAfter?: { n: string; title: string; sub?: string };
  gapAfter?: number;
  gestures?: { at: Cue; pose: string; ex?: string }[];
  [key: string]: unknown;
}
interface Data {
  title: string;
  author: string;
  kicker?: string;
  source: { pin: string; titleTake: string; recitalTake: string };
  verses: { text: string; strong?: string[]; figure?: string }[];
  pictures: (Picture & { verses: number[] })[];
  blocks: Block[];
  sounds?: { theme?: string; sfx?: { asset: string; block: string; at: Cue; gain?: number }[] };
}

const frames = (seconds: number) => Math.round(seconds * FPS);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const norm = (s: string) => s.toLocaleLowerCase("it-IT").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
};
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

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

interface Item {
  id: string;
  from: number;
  duration: number;
  kit: { name: string; version: string };
  props: Record<string, unknown>;
  source: string;
  transitionIn?: { type: "fade"; duration: number };
  transitionOut?: { type: "fade"; duration: number };
}

function compile(input: CompileInput): CompileResult {
  const data = input.spec.data as unknown as Data;
  const problems: CompileProblem[] = [];
  const warnings: string[] = [];
  const profile = outputProfile(PROFILE)!;
  const specHash = input.inputs[SPEC_PATH];
  const theme = input.theme;
  if (!theme?.layout) return { ok: false, problems: [{ code: "missing-theme", path: "$.template", message: "the release pins no theme: the long's look, rooms and characters are the theme's" }] };
  const look = theme.look;
  const source = input.sources?.[data.source.pin];
  if (!source) {
    return { ok: false, problems: [{ code: "missing-source", path: "$.data.source.pin", message: `no pinned episode "${data.source.pin}": pin the poem's source (vpr pin) as source/pins/${data.source.pin}.json` }] };
  }
  const assets: Record<string, { path: string; hash: string; kind: "image" | "audio" | "video" }> = {};
  const use = (id: string) => {
    assets[id] = { ...input.assets[id]! };
    return { $asset: id };
  };

  // ── Takes ─────────────────────────────────────────────────────────────────
  interface Take { id: string; asset: string; duration: number; timing: WordTiming }
  const guideTake = (id: string, path: string): Take | null => {
    const take = input.narration.takes.find((t) => t.id === id);
    const timing = input.timings[id];
    if (!take || !timing || !input.assets[`narration-${id}`]) {
      problems.push({ code: "missing-take", path, message: `no aligned guide take "${id}" in artifacts/narration/takes.json` });
      return null;
    }
    return { id, asset: `narration-${id}`, duration: take.audio.durationSeconds, timing };
  };
  const sourceTake = (id: string, path: string): Take | null => {
    const take = source.narration.takes.find((t) => t.id === id);
    const timing = source.timings[id];
    const asset = `source-${data.source.pin}-narration-${id}`;
    if (!take || !timing || !input.assets[asset]) {
      problems.push({ code: "missing-take", path, message: `the pinned source "${data.source.pin}" has no aligned take "${id}"` });
      return null;
    }
    return { id, asset, duration: take.audio.durationSeconds, timing };
  };
  const titleTake = sourceTake(data.source.titleTake, "$.data.source.titleTake");
  const recitalTake = sourceTake(data.source.recitalTake, "$.data.source.recitalTake");

  // ── Pictures ──────────────────────────────────────────────────────────────
  /** A picture by name: this episode's, else the pinned source's. */
  const pictureAsset = (name: string, path: string): { $asset: string } | null => {
    const own = `image-${name}`;
    const pinned = `source-${data.source.pin}-image-${name}`;
    const id = input.assets[own] ? own : input.assets[pinned] ? pinned : null;
    if (!id) {
      problems.push({ code: "missing-asset", path, message: `no picture "${name}" in assets/images nor in the pinned source` });
      return null;
    }
    return use(id);
  };
  /** A picture as the panel frames it (src, focus); the figure tools also take its aspect. */
  const framed = (p: Picture, path: string, withAspect = false) => {
    const src = pictureAsset(p.asset, path);
    return src ? { src, ...(p.focus ? { focus: p.focus } : {}), ...(withAspect && p.aspect ? { aspect: p.aspect } : {}) } : null;
  };
  const painting = (i: number, path: string, withAspect = false) => {
    const p = data.pictures[i];
    if (!p) {
      problems.push({ code: "no-such-picture", path, message: `there is no picture ${i} (the spec has ${data.pictures.length})` });
      return null;
    }
    return framed(p, `$.data.pictures[${i}].asset`, withAspect);
  };
  const sound = (name: string, path: string): { $asset: string } | null => {
    for (const id of [`sound-${name}`, `source-${data.source.pin}-sound-${name}`]) if (input.assets[id]) return use(id);
    warnings.push(`no sound "${name}" (${path}): it is left out`);
    return null;
  };

  // ── The recital's verses in the source's timing ──────────────────────────
  const verseWords: { text: string; start: number; end: number }[][] = [];
  if (recitalTake) {
    let k = 0;
    const words = recitalTake.timing.words;
    data.verses.forEach((v, i) => {
      const n = tokens(v.text).length;
      const slice = words.slice(k, k + n);
      if (slice.length < n) problems.push({ code: "verse-mismatch", path: `$.data.verses[${i}].text`, message: `the recital's timing has ${words.length} words; verse ${i + 1} needs words ${k + 1}–${k + n}` });
      verseWords.push(slice);
      k += n;
    });
    if (k !== words.length && problems.length === 0) {
      problems.push({ code: "verse-mismatch", path: "$.data.verses", message: `the verses have ${k} words, the recital's timing ${words.length}` });
    }
  }

  // ── Blocks in time ────────────────────────────────────────────────────────
  interface Placed { block: Block; index: number; start: number; speech: number; take: Take | null; end: number; next: number; chapter: [number, number] | null }
  const placed: Placed[] = [];
  let t = 0;
  data.blocks.forEach((block, index) => {
    const path = `$.data.blocks[${index}]`;
    let take: Take | null = null;
    if (block.kind === "announcement") take = titleTake;
    else if (block.kind === "recital") take = recitalTake;
    else if (block.take) take = guideTake(block.take, `${path}.take`);
    const lead = block.kind === "opening" ? COVER : LEAD;
    const start = t;
    const speech = start + lead;
    const length = take ? lead + take.duration + TAIL : (block.minDuration as number | undefined) ?? END;
    const end = start + Math.max(length, block.kind === "end" ? ((block.minDuration as number | undefined) ?? END) : 0);
    const gap = index === data.blocks.length - 1 ? 0 : block.gapAfter ?? GAP;
    const chapter: [number, number] | null = block.chapterAfter ? [end + gap, end + gap + CHAPTER] : null;
    const next = end + gap + (chapter ? CHAPTER : 0);
    placed.push({ block, index, start, speech, take, end, next, chapter });
    t = next;
  });
  const total = placed[placed.length - 1]!.end;
  const durationInFrames = frames(total);

  /** A cue of a block, in seconds from the block's start. */
  const cueOf = (p: Placed, cue: unknown, path: string): number => {
    const lead = p.speech - p.start;
    if (typeof cue === "number") return cue;
    if (cue === "end") return p.take ? lead + p.take.duration : p.end - p.start;
    if (isObject(cue) && typeof cue.word === "string") {
      if (!p.take) {
        problems.push({ code: "cue-not-found", path, message: `"${cue.word}": block "${p.block.id}" has no take to find it in` });
        return 0;
      }
      const want = norm(cue.word);
      const n = typeof cue.n === "number" ? cue.n : 1;
      // Italian elides: "italia" is said in «L'Italia», "assedio" in «d'assedio».
      const hits = p.take.timing.words.filter((w) => norm(w.text) === want || w.text.split(/['’]/).some((part) => norm(part) === want));
      const hit = hits[n - 1];
      if (!hit) {
        problems.push({ code: "cue-not-found", path, message: `"${cue.word}"${n > 1 ? ` (occurrence ${n})` : ""} is not said in take "${p.take.id}" (${hits.length} found)` });
        return 0;
      }
      return round3(lead + hit.start + (typeof cue.offset === "number" ? cue.offset : 0));
    }
    problems.push({ code: "bad-cue", path, message: "a cue is seconds, \"end\" or {word, n?, offset?}" });
    return 0;
  };
  /** Kit props with their cues resolved and their pictures named as assets. */
  const resolve = (p: Placed, value: unknown, path: string, key = ""): unknown => {
    if (CUE_KEYS.has(key) && (typeof value === "number" || value === "end" || (isObject(value) && "word" in value))) return round3(cueOf(p, value, path));
    if ((key === "read" || key === "strikes") && Array.isArray(value)) return value.map((v, i) => round3(cueOf(p, v, `${path}[${i}]`)));
    if (key === "times" && isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round3(cueOf(p, v, `${path}.${k}`))]));
    if (Array.isArray(value)) return value.map((v, i) => resolve(p, v, `${path}[${i}]`));
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "asset" && typeof value.asset === "string") return pictureAsset(value.asset, `${path}.asset`) ?? { $asset: "missing" };
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(p, v, `${path}.${k}`, k)]));
    }
    return value;
  };

  const items: { room: Item[]; stage: Item[]; people: Item[]; overlay: Item[]; cards: Item[] } = { room: [], stage: [], people: [], overlay: [], cards: [] };
  const audio: { voice: Record<string, unknown>[]; recital: Record<string, unknown>[]; music: Record<string, unknown>[]; sfx: Record<string, unknown>[] } = { voice: [], recital: [], music: [], sfx: [] };
  const fade = (seconds: number) => ({ type: "fade" as const, duration: frames(seconds) });
  const span = (from: number, to: number) => ({ from: frames(from), duration: Math.max(1, frames(to) - frames(from)) });

  // ── Rooms: the atrio at the opening and the exit, the hall between ───────
  const roomProps = (name: string) => {
    const room = theme.rooms[name];
    if (!room) {
      problems.push({ code: "missing-room", path: "$.template", message: `the theme has no room "${name}"` });
      return null;
    }
    use(`theme-${name}`);
    if (room.monitor) use(`theme-${name}-monitor`);
    return {
      image: { $asset: `theme-${name}` },
      ...(room.sky ? { sky: room.sky } : {}),
      ...(room.windows ? { windows: room.windows } : {}),
      ...(room.doors ? { doors: room.doors } : {}),
      ...(room.monitor ? { monitor: { box: room.monitor.box, video: { $asset: `theme-${name}-monitor` } } } : {}),
    };
  };
  const hallRuns: [number, number][] = [];
  for (const p of placed) {
    const to = p === placed[placed.length - 1] ? p.end : p.next;
    if (p.block.kind === "opening" || p.block.kind === "end") {
      const room = roomProps("atrio");
      const length = to - p.start;
      // Still at the loop's edges: no drift, no lightning at the first and last frame.
      if (room) items.room.push({ id: `room-${p.block.id}`, ...span(p.start, to), kit: KIT("room"), source: `blocks[${p.index}]`, props: { look, room, drift: false, quiet: p.block.kind === "opening" ? [[-1, 0.6]] : [[round3(length - 0.6), round3(length + 1)]] } });
    } else {
      const last = hallRuns[hallRuns.length - 1];
      if (last && Math.abs(last[1] - p.start) < 1e-9) last[1] = to;
      else hallRuns.push([p.start, to]);
    }
  }
  hallRuns.forEach(([from, to], i) => {
    const room = roomProps("sala");
    if (room) items.room.push({ id: `room-hall-${i + 1}`, ...span(from, to), kit: KIT("room"), source: "blocks", props: { look, room } });
  });

  // ── The guide, and the actor in the recitals ─────────────────────────────
  const character = (id: string) => {
    const c = theme.characters[id];
    if (!c) {
      problems.push({ code: "missing-character", path: "$.template", message: `the theme has no character "${id}"` });
      return null;
    }
    const { poses: _poses, ...rest } = c as unknown as Record<string, unknown>;
    return rest;
  };
  const posesOf = (id: string) => ((theme.characters[id] as { poses?: Record<string, Partial<Pose>> } | undefined)?.poses ?? {});
  const mouthOf = (take: Take, lead: number, to: number) => {
    const energy = (take.timing as unknown as { energy?: { rate: number; values: number[] } }).energy;
    const speech = ((take.timing as unknown as { speech?: [number, number][] }).speech ?? []).map(([a, b]) => [round3(a + lead), round3(b + lead)] as [number, number]);
    if (!energy) warnings.push(`take "${take.id}" carries no energy: the mouth stays closed`);
    return {
      energy: energy ? { rate: energy.rate, values: [...new Array(Math.round(lead * energy.rate)).fill(0), ...energy.values] } : { rate: FPS, values: [] as number[] },
      speech,
      from: round3(lead),
      to: round3(Math.min(to, lead + take.duration)),
    };
  };
  const blinksFor = (length: number, seed: number) => {
    const out: number[] = [];
    for (let b = 1.1, i = seed; b < length; i++) {
      out.push(round3(b));
      b += 2 + 3 * rnd(i + 3);
    }
    return out;
  };
  const guide = character("guida");
  const actor = character("attore-illuminato");
  for (const p of placed) {
    const to = (p === placed[placed.length - 1] ? p.end : p.chapter ? p.chapter[0] : p.next);
    const length = to - p.start;
    const lead = p.speech - p.start;
    if (p.block.kind === "recital") {
      if (!actor || !p.take) continue;
      const annotated = p.block.annotated === true;
      const second = annotated ? { ...actor, palette: { ...(actor.palette as Record<string, string>), vest: look.colors.highlight, vestLight: look.colors.glow } } : actor;
      items.people.push({
        id: `actor-${p.block.id}`, ...span(p.start, to), kit: KIT("interprete", "1.1.0"), source: `blocks[${p.index}]`,
        props: {
          look, character: second, x: GUIDE.x, footY: theme.layout.floorY, scale: GUIDE.scale,
          poses: [{ at: 0, pose: { ...REST, ...(posesOf("attore-illuminato").invoca ?? {}) } }, { at: round3(length - 1), pose: REST }],
          blinks: blinksFor(length, p.index), mouth: mouthOf(p.take, lead, length),
          teleport: { in: { at: 0, dur: 1.0 }, out: { at: round3(length - 1.2), dur: 1.0 } },
        },
        transitionIn: fade(0.3),
      });
      continue;
    }
    if (!guide) continue;
    const poses = [{ at: 0, pose: REST }, ...(p.block.gestures ?? []).map((g, i) => {
      const preset = posesOf("guida")[g.pose];
      if (!preset) problems.push({ code: "unknown-pose", path: `$.data.blocks[${p.index}].gestures[${i}].pose`, message: `the theme's guide has no pose "${g.pose}"` });
      return { at: round3(cueOf(p, g.at, `$.data.blocks[${p.index}].gestures[${i}].at`)), pose: { ...REST, ...(preset ?? {}) } };
    })].sort((a, b) => a.at - b.at);
    const expressions = [{ at: 0, ex: EXPRESSIONS.N! }, ...(p.block.gestures ?? []).filter((g) => g.ex).map((g, i) => ({ at: round3(cueOf(p, g.at, `$.data.blocks[${p.index}].gestures[${i}].at`)), ex: EXPRESSIONS[g.ex!] ?? EXPRESSIONS.N! }))].sort((a, b) => a.at - b.at);
    items.people.push({
      id: `guide-${p.block.id}`, ...span(p.start, to), kit: KIT("interprete", "1.1.0"), source: `blocks[${p.index}]`,
      props: {
        look, character: guide, x: GUIDE.x, footY: theme.layout.floorY, scale: GUIDE.scale, poses, expressions,
        blinks: blinksFor(length, p.index),
        ...(p.take ? { mouth: mouthOf(p.take, lead, length) } : {}),
        // She arrives in the atrio and leaves it: the first and the last frame are empty.
        ...(p.block.kind === "opening" ? { teleport: { in: { at: 0.6, dur: 1.0 }, out: { at: round3(length - 1.2), dur: 1.0 } } } : {}),
        ...(p.block.kind === "end" ? { teleport: { in: { at: 0, dur: 1.0 }, out: { at: round3(Math.max(1.5, length - COVER - 3)), dur: 1.2 } } } : {}),
      },
    });
  }

  // ── Each block's stage and overlays ───────────────────────────────────────
  const specimens = placed.filter((p) => p.block.kind === "specimen");
  const verseLine = (i: number, at0?: number) => tokens(data.verses[i]!.text).map((text, j) => {
    const hot = (data.verses[i]!.strong ?? []).some((s) => norm(s) === norm(text));
    const w = at0 !== undefined ? verseWords[i]?.[j] : undefined;
    return { text, ...(hot ? { hot: true } : {}), ...(w && at0 !== undefined ? { at: Math.max(0, round3(w.start - at0)) } : {}) };
  });
  for (const p of placed) {
    const b = p.block;
    const path = `$.data.blocks[${p.index}]`;
    const src = `blocks[${p.index}]`;
    const to = p.end;
    const length = to - p.start;
    const whole = span(p.start, to);
    // The block's title and its verse bar share the bottom of the frame: where verses are shown, the title
    // stays 3 s and the verses come after it.
    const versed = b.kind === "recital" || b.kind === "meter" || b.kind === "specimen";
    const lowerEnd = b.lower ? p.start + Math.min(length, versed ? 3.3 : 6) : p.start;
    const afterLower = (from: number) => (b.lower ? Math.max(from, lowerEnd + 0.1) : from);
    if (b.lower) {
      items.overlay.push({ id: `lower-${b.id}`, ...span(p.start + 0.3, lowerEnd), kit: KIT("block-title"), source: `${src}.lower`, props: { look, ...b.lower }, transitionIn: fade(0.4), transitionOut: fade(0.5) });
    }
    switch (b.kind) {
      case "opening": {
        const cover = b.cover as { kicker?: string; titleLines: string[]; hookLines?: string[] };
        items.stage.push({ id: "cover-open", ...span(0, COVER), kit: KIT("cover"), source: `${src}.cover`, props: { look, ...cover, icon: "bolt" }, transitionOut: fade(0.6) });
        const enter = cueOf(p, b.enter, `${path}.enter`);
        items.cards.push({ id: "warp-enter", ...span(p.start + enter, p.start + enter + 1.2), kit: KIT("warp"), source: `${src}.enter`, props: { look } });
        break;
      }
      case "announcement": {
        const pic = (b.picture as Picture | undefined) ? framed(b.picture as Picture, `${path}.picture.asset`) : painting(0, `${path}.picture`);
        if (pic) items.stage.push({ id: `panel-${b.id}`, ...whole, kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, phases: [{ at: 0, layers: [{ picture: pic, shade: 0.35 }] }] } });
        items.overlay.push({
          id: `title-${b.id}`, ...span(p.start + 0.5, to), kit: KIT("text-stack"), source: src, transitionOut: fade(0.4),
          props: { look, x: PANEL.x + PANEL.w / 2, y: PANEL.y + 170, width: 900, align: "center", items: [{ kind: "kicker", text: (data.kicker ?? data.author).toUpperCase(), at: 0 }, { kind: "big", text: data.title.toUpperCase(), at: 0.2 }] },
        });
        break;
      }
      case "recital": {
        const at0 = p.speech - p.start;
        const groups = data.pictures.map((pic, i) => ({ i, at: verseWords[pic.verses[0] ?? 0]?.[0]?.start }));
        const phases = groups.map((g, k) => {
          const pic = painting(g.i, `${path}.pictures[${g.i}]`);
          return pic ? { at: k === 0 ? 0 : round3(at0 + (g.at ?? 0) - 0.6), layers: [{ picture: pic }] } : null;
        }).filter(Boolean);
        if (phases.length) items.stage.push({ id: `panel-${b.id}`, ...whole, kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, spin: false, phases } });
        data.verses.forEach((_v, i) => {
          const words = verseWords[i];
          if (!words?.length) return;
          const from = afterLower(p.speech + words[0]!.start - 0.3);
          const until = i < data.verses.length - 1 ? p.speech + (verseWords[i + 1]?.[0]?.start ?? words[words.length - 1]!.end) - 0.3 : p.speech + words[words.length - 1]!.end + 1.2;
          items.overlay.push({ id: `verse-${b.id}-${i + 1}`, ...span(from, until), kit: KIT("verse-bar"), source: `verses[${i}]`, props: { look, width: VERSE_WIDTH, kicker: `${data.title.toUpperCase()} · ${i + 1}/${data.verses.length}`, lines: [verseLine(i, from - p.speech)] } });
          if (b.annotated && data.verses[i]!.figure) {
            items.overlay.push({ id: `figure-${b.id}-${i + 1}`, ...span(from, until), kit: KIT("figure-title"), source: `verses[${i}].figure`, props: { look, kicker: data.title.toUpperCase(), text: data.verses[i]!.figure!.toUpperCase(), x: PANEL.x + PANEL.w / 2, y: PANEL.y + 60 }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
          }
        });
        break;
      }
      case "story": {
        const phases = b.phases as { at: Cue; layers: unknown[]; texts?: Record<string, unknown>[]; fx?: unknown[]; timeline?: Record<string, unknown> }[];
        const ats = phases.map((ph, i) => round3(cueOf(p, ph.at, `${path}.phases[${i}].at`)));
        const panelPhases = phases.map((ph, i) => ({ at: i === 0 ? 0 : Math.max(ats[i]!, 0.01), layers: resolve(p, ph.layers, `${path}.phases[${i}].layers`) }));
        items.stage.push({ id: `panel-${b.id}`, ...whole, kit: KIT("panel", "1.1.0"), source: src, props: { look, appear: { at: 0, dur: 0.8 }, phases: panelPhases } });
        phases.forEach((ph, i) => {
          const until = i < phases.length - 1 ? ats[i + 1]! - 0.3 : undefined;
          (ph.texts ?? []).forEach((stack, j) => {
            const texts = resolve(p, stack, `${path}.phases[${i}].texts[${j}]`) as { items: Record<string, unknown>[] } & Record<string, unknown>;
            // a phase's texts leave when the next phase comes, unless they say otherwise
            const withUntil = (list: Record<string, unknown>[]): Record<string, unknown>[] => list.map((it) => ("row" in it ? { ...it, row: withUntil(it.row as Record<string, unknown>[]) } : "space" in it || it.until !== undefined || until === undefined ? it : { ...it, until: round3(until) }));
            items.overlay.push({ id: `texts-${b.id}-${i + 1}-${j + 1}`, ...whole, kit: KIT("text-stack"), source: `${src}.phases[${i}].texts[${j}]`, props: { look, ...texts, items: withUntil(texts.items) } });
          });
          if (ph.fx) items.stage.push({ id: `fx-${b.id}-${i + 1}`, ...whole, kit: KIT("story-fx"), source: `${src}.phases[${i}].fx`, props: { look, effects: resolve(p, ph.fx, `${path}.phases[${i}].fx`) } });
          if (ph.timeline) items.stage.push({ id: `timeline-${b.id}-${i + 1}`, ...whole, kit: KIT("timeline"), source: `${src}.phases[${i}].timeline`, props: { look, ...(resolve(p, ph.timeline, `${path}.phases[${i}].timeline`) as object) } });
        });
        break;
      }
      case "note": {
        const quote = b.quote as { at: Cue; picture: Picture; interlinear: Record<string, unknown>; title?: Record<string, unknown> } | undefined;
        const quoteAt = quote ? cueOf(p, quote.at, `${path}.quote.at`) : length;
        if (b.tracks) {
          items.stage.push({ id: `tracks-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("word-tracks"), source: `${src}.tracks`, props: { look, lines: data.verses.map((v) => v.text), ...(resolve(p, b.tracks, `${path}.tracks`) as object) }, transitionOut: fade(0.4) });
        }
        if (b.counts) items.overlay.push({ id: `counts-${b.id}`, ...span(p.start, p.start + quoteAt), kit: KIT("text-stack"), source: `${src}.counts`, props: { look, ...(resolve(p, b.counts, `${path}.counts`) as object) }, transitionOut: fade(0.4) });
        if (quote) {
          const pic = framed(quote.picture, `${path}.quote.picture.asset`);
          if (pic) items.stage.push({ id: `quote-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("panel", "1.1.0"), source: `${src}.quote`, props: { look, appear: { at: 0, dur: 0.8 }, phases: [{ at: 0, layers: [{ picture: pic, shade: "quote" }] }] } });
          // the interlinear's times are from the quote's start
          const lin = resolve(p, quote.interlinear, `${path}.quote.interlinear`) as Record<string, unknown>;
          const rebase = (v: unknown): unknown => (Array.isArray(v) ? v.map(rebase) : isObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === "at" || k === "glossAt") && typeof x === "number" ? round3(x - quoteAt) : rebase(x)])) : v);
          items.overlay.push({ id: `interlinear-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("interlinear"), source: `${src}.quote.interlinear`, props: { look, ...(rebase(lin) as object) }, transitionIn: fade(0.4) });
          if (quote.title) items.overlay.push({ id: `quote-title-${b.id}`, ...span(p.start + quoteAt, to), kit: KIT("text-stack"), source: `${src}.quote.title`, props: { look, ...(rebase(resolve(p, quote.title, `${path}.quote.title`)) as object) } });
        }
        break;
      }
      case "specimen": {
        const i = b.picture as number;
        const figure = b.figure as { kind: string; props: Record<string, unknown> };
        if (!FIGURE_KITS.has(figure.kind)) problems.push({ code: "unknown-figure", path: `${path}.figure.kind`, message: `"${figure.kind}" is not a figure tool` });
        const pic = painting(i, `${path}.picture`, true);
        if (pic) {
          items.stage.push({ id: `figure-${b.id}`, ...whole, kit: KIT(figure.kind), source: `${src}.figure`, props: { look, picture: pic, ...(resolve(p, figure.props, `${path}.figure.props`) as object) } });
        }
        const k = specimens.indexOf(p);
        items.overlay.push({ id: `progress-${b.id}`, ...whole, kit: KIT("progress"), source: src, props: { look, steps: specimens.map((s) => ({ label: s.block.keyword as string })), current: k, done: k } });
        const verses = b.verses as number[];
        items.overlay.push({ id: `verses-${b.id}`, ...span(afterLower(p.start), to), kit: KIT("verse-bar"), source: `${src}.verses`, props: { look, width: VERSE_WIDTH, kicker: `${data.title.toUpperCase()} · ${(b.keyword as string).toUpperCase()}`, lines: verses.slice(0, 3).map((v) => verseLine(v)), ...(verses.length > 1 ? { size: 46 } : {}) } });
        const headline = b.headline as { kicker?: string; text: string; at: Cue; until?: Cue } | undefined;
        if (headline) {
          const from = cueOf(p, headline.at, `${path}.headline.at`);
          const until = headline.until !== undefined ? cueOf(p, headline.until, `${path}.headline.until`) : length;
          items.overlay.push({ id: `headline-${b.id}`, ...span(p.start + from, p.start + until), kit: KIT("figure-title"), source: `${src}.headline`, props: { look, kicker: headline.kicker ?? data.title.toUpperCase(), text: headline.text, x: PANEL.x + PANEL.w / 2, y: PANEL.y + PANEL.h / 2 - 60 }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
        }
        break;
      }
      case "meter": {
        const split = cueOf(p, b.rhymesAt, `${path}.rhymesAt`);
        items.stage.push({ id: `syllables-${b.id}`, ...span(p.start, p.start + split), kit: KIT("syllables"), source: `${src}.syllables`, props: { look, ...(resolve(p, b.syllables, `${path}.syllables`) as object) }, transitionOut: fade(0.4) });
        const rhymes = resolve(p, b.rhymes, `${path}.rhymes`) as Record<string, unknown>;
        const rebased = { ...rhymes, times: Object.fromEntries(Object.entries((rhymes.times ?? {}) as Record<string, number>).map(([k, v]) => [k, round3(v - split)])) };
        items.stage.push({ id: `rhymes-${b.id}`, ...span(p.start + split, to), kit: KIT("rhymes"), source: `${src}.rhymes`, props: { look, ...rebased }, transitionIn: fade(0.4) });
        if (typeof b.verse === "number") items.overlay.push({ id: `verses-${b.id}`, ...span(afterLower(p.start), p.start + split), kit: KIT("verse-bar"), source: `${src}.verse`, props: { look, width: VERSE_WIDTH, lines: [verseLine(b.verse)] } });
        break;
      }
      case "invite": {
        const cells = data.pictures.map((_pic, i) => painting(i, `${path}.cells`)).filter(Boolean).map((c) => ({ src: c!.src, ...(c!.focus ? { focus: c!.focus } : {}) }));
        items.stage.push({ id: `wall-${b.id}`, ...whole, kit: KIT("monitor-wall"), source: src, props: { look, cells: cells.slice(0, 8), appear: 0.2, caption: resolve(p, b.caption, `${path}.caption`) } });
        break;
      }
      case "summary": {
        const rows = (b.rows as { picture: number; keyword: string; figure: string; at: Cue }[]).map((r, i) => {
          const pic = painting(r.picture, `${path}.rows[${i}].picture`);
          return { src: pic?.src ?? { $asset: "missing" }, ...(pic?.focus ? { focus: pic.focus } : {}), keyword: r.keyword, figure: r.figure, at: round3(cueOf(p, r.at, `${path}.rows[${i}].at`)) };
        });
        items.stage.push({ id: `summary-${b.id}`, ...whole, kit: KIT("summary"), source: src, props: { look, rows, ...(b.closing ? { closing: resolve(p, b.closing, `${path}.closing`) } : {}), ...(b.lit !== undefined ? { lit: round3(cueOf(p, b.lit, `${path}.lit`)) } : {}) } });
        break;
      }
      case "end": {
        const cover = (data.blocks[0]!.cover ?? { titleLines: [data.title.toUpperCase()] }) as Record<string, unknown>;
        items.stage.push({ id: "cover-close", ...span(total - COVER, total), kit: KIT("cover"), source: "blocks[0].cover", props: { look, ...cover, icon: "bolt" }, transitionIn: fade(0.6) });
        break;
      }
    }
    if (p.chapter) {
      const c = b.chapterAfter!;
      items.cards.push({ id: `chapter-${b.id}`, ...span(p.chapter[0], p.chapter[1]), kit: KIT("chapter-opener"), source: `${src}.chapterAfter`, props: { look, kicker: c.n, title: c.title, ...(c.sub ? { sub: c.sub } : {}) }, transitionIn: fade(0.3), transitionOut: fade(0.3) });
    }
    // ── The block's voice ──
    if (p.take) {
      const track = b.kind === "recital" || b.kind === "announcement" ? audio.recital : audio.voice;
      const from = frames(p.speech);
      track.push({ id: `voice-${b.id}`, from, duration: Math.max(1, Math.min(frames(p.speech + p.take.duration), durationInFrames) - from), asset: use(p.take.asset).$asset, source: b.kind === "recital" || b.kind === "announcement" ? "source" : `blocks[${p.index}].take` });
    }
  }

  // ── Sound ─────────────────────────────────────────────────────────────────
  if (data.sounds?.theme) {
    const theme_ = sound(data.sounds.theme, "$.data.sounds.theme");
    if (theme_) {
      const open = placed[0]!;
      audio.music.push({ id: "theme-open", ...span(0, open.end), asset: theme_.$asset, gain: 0.5, fadeIn: 6, fadeOut: 30, source: "sounds.theme" });
      const close = placed[placed.length - 1]!;
      audio.music.push({ id: "theme-close", ...span(close.start, total), asset: theme_.$asset, gain: 0.5, fadeIn: 30, fadeOut: 6, source: "sounds.theme" });
    }
  }
  (data.sounds?.sfx ?? []).forEach((s, i) => {
    const p = placed.find((x) => x.block.id === s.block);
    if (!p) {
      problems.push({ code: "no-such-block", path: `$.data.sounds.sfx[${i}].block`, message: `there is no block "${s.block}"` });
      return;
    }
    const asset = sound(s.asset, `$.data.sounds.sfx[${i}].asset`);
    if (!asset) return;
    const at = p.start + cueOf(p, s.at, `$.data.sounds.sfx[${i}].at`);
    audio.sfx.push({ id: `sfx-${i + 1}`, ...span(at, Math.min(total, at + 3)), asset: asset.$asset, gain: s.gain ?? 0.4, fadeIn: 3, fadeOut: 12, source: `sounds.sfx[${i}]` });
  });

  if (problems.length > 0) return { ok: false, problems };

  // ── Tracks ────────────────────────────────────────────────────────────────
  const tracks: Record<string, unknown>[] = [];
  let z = 0;
  const visual = (name: string, list: Item[], base: number) => lanes(list).forEach((laneItems, i) => tracks.push({ id: `${name}-${i + 1}`, type: "visual", z: base + i, items: laneItems }));
  visual("room", items.room, z);
  visual("stage", items.stage, (z += 10));
  visual("people", items.people, (z += 10));
  visual("overlay", items.overlay, (z += 10));
  tracks.push({ id: "brand", type: "visual", z: (z += 10), items: [{ id: "brand", from: 0, duration: durationInFrames, kit: KIT("brand-mark", "2.0.0"), source: "theme.brand", props: { look, text: theme.brand.text, icon: theme.brand.icon ?? "bolt" } }] });
  visual("cards", items.cards, (z += 10));
  tracks.push({ id: "voice", type: "audio", items: audio.voice });
  tracks.push({ id: "recital", type: "audio", items: audio.recital });
  if (audio.music.length) tracks.push({ id: "music", type: "audio", duck: { under: ["voice", "recital"], gain: 0.75 }, items: audio.music });
  lanes(audio.sfx as unknown as { from: number; duration: number }[]).forEach((laneItems, i) => tracks.push({ id: `sfx-${i + 1}`, type: "audio", items: laneItems }));

  const sections = [
    ...placed.map((p, i) => ({ id: `block-${p.block.id}`, ...span(p.start, i < placed.length - 1 ? (p.chapter ? p.chapter[0] : p.next) : p.end), source: `blocks[${p.index}]` })),
    ...placed.filter((p) => p.chapter).map((p, k) => ({ id: `chapter-${k + 1}`, ...span(p.chapter![0], p.chapter![1]), source: `blocks[${p.index}].chapterAfter`, chapter: { title: p.block.chapterAfter!.title } })),
  ].sort((a, b) => a.from - b.from);

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
    loop: true,
    metadata: {
      builtBy: `@studio/series ${compiler.id}@${compiler.version}`,
      template: { ...input.spec.template },
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      blocks: placed.map((p) => ({ id: p.block.id, kind: p.block.kind, start: round3(p.start), speech: round3(p.speech), end: round3(p.end) })),
      end: round3(total),
    },
  } as unknown as EditTimeline;
  return { ok: true, timeline, warnings };
}

export const compiler: SeriesCompiler = {
  id: "dentro-i-versi-long",
  version: "1.0.0",
  description: "Dentro i versi · long: the lesson on a poem, block after block — atrio, recital, story, note, one figure tool per painting, metre, invitation, annotated recital, summary, exit — in the channel theme's look, its cues on the guide's words.",
  compile,
};
````

Create `studio/series/src/validators/dentro-i-versi-long/1.0.0.ts`:

````ts
// dentro-i-versi-long@1.0.0 (validator) — released: never edit this file; add dentro-i-versi-long/<next>.ts instead.
//
// The mechanical rules of the Dentro i versi long, checked on the timeline
// about to be rendered — hand edits included — with what the compiler makes
// of the same inputs as the reference. A hand edit may move a text or an
// effect; it may not change the profile, the loop, the kits, the look, the
// voices, or leave the lesson out of 240–600 s.

import type { Finding, SeriesValidator, ValidateInput } from "../../types.js";

/** 240 s and 600 s at 30 fps. */
const MIN_FRAMES = 7200;
const MAX_FRAMES = 18000;
/** The kits this release draws with, at their versions. */
const KITS = new Set([
  "room@1.0.0", "panel@1.1.0", "interprete@1.1.0", "verse-bar@1.0.0", "block-title@1.0.0", "figure-title@1.0.0", "chapter-opener@1.0.0",
  "cover@1.0.0", "warp@1.0.0", "brand-mark@2.0.0", "text-stack@1.0.0", "timeline@1.0.0", "story-fx@1.0.0", "word-tracks@1.0.0",
  "interlinear@1.0.0", "monitor-wall@1.0.0", "summary@1.0.0", "progress@1.0.0", "merge@1.0.0", "cards@1.0.0", "stack@1.0.0",
  "oxymoron@1.0.0", "simile@1.0.0", "syllables@1.0.0", "rhymes@1.0.0",
]);
const CHAPTERS = 5;

type Item = Record<string, any>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validate(input: ValidateInput): Finding[] {
  const { timeline, compiled } = input;
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) => findings.push({ code, severity: "error", path, message });
  const warning = (code: string, path: string, message: string) => findings.push({ code, severity: "warning", path, message });

  const visual: { item: Item; path: string }[] = [];
  const audio: { item: Item; path: string }[] = [];
  timeline.tracks.forEach((track, i) => {
    const list = track.type === "visual" ? visual : audio;
    (track.items as Item[]).forEach((item, j) => list.push({ item, path: `$.tracks[${i}].items[${j}]` }));
  });

  // ── Errors ────────────────────────────────────────────────────────────────
  if (canonical(timeline.profile) !== canonical(compiled.profile)) {
    error("profile-changed", "$.profile", `the profile is ${timeline.profile.id}; this template renders ${compiled.profile.id}`);
  }
  if ((timeline as { loop?: boolean }).loop !== true) {
    error("loop-broken", "$.loop", "the lesson loops: its last frame is its first (loop: true)");
  }
  if (timeline.durationInFrames < MIN_FRAMES || timeline.durationInFrames > MAX_FRAMES) {
    error("duration", "$.durationInFrames", `the lesson lasts ${(timeline.durationInFrames / 30).toFixed(1)} s; the format wants 240–600 s`);
  }
  const look = input.theme ? canonical(input.theme.look) : null;
  for (const { item, path } of visual) {
    const kit = `${item.kit?.name}@${item.kit?.version}`;
    if (!KITS.has(kit)) error("unknown-kit", `${path}.kit`, `"${item.id}" draws with ${kit}, not one of this format's kits`);
    if (look && item.props?.look !== undefined && canonical(item.props.look) !== look) {
      error("look-changed", `${path}.props.look`, `"${item.id}" does not wear the channel's theme`);
    }
  }
  // Every voice the compiler plays is still there, unchanged, at its place.
  const voices = (t: typeof timeline) => t.tracks.filter((tr) => tr.type === "audio" && (tr.id === "voice" || tr.id === "recital")).flatMap((tr) => tr.items as Item[]);
  const now = new Map(voices(timeline).map((v) => [v.id, v]));
  for (const ref of voices(compiled)) {
    const v = now.get(ref.id);
    if (!v) error("voice-missing", "$.tracks", `the voice "${ref.id}" is gone`);
    else if (v.asset !== ref.asset || v.from !== ref.from || v.duration !== ref.duration || (v.trimStart ?? 0) !== (ref.trimStart ?? 0)) {
      error("voice-changed", "$.tracks", `the voice "${ref.id}" was moved, cut or replaced`);
    }
  }
  // The guide arrives at the opening and leaves at the exit: the first and the last frame are the empty atrio.
  const guides = visual.filter(({ item }) => item.kit?.name === "interprete");
  const first = guides.find(({ item }) => item.from === 0);
  if (first && !first.item.props?.teleport?.in) error("missing-teleport", `${first.path}.props.teleport`, "the guide must teleport in at the opening: the first frame is the empty atrio");
  const last = guides.find(({ item }) => item.from + item.duration >= timeline.durationInFrames);
  if (last && !last.item.props?.teleport?.out) error("missing-teleport", `${last.path}.props.teleport`, "the guide must teleport out at the exit: the last frame is the empty atrio");

  // ── Warnings ──────────────────────────────────────────────────────────────
  const chapters = visual.filter(({ item }) => item.kit?.name === "chapter-opener").length;
  if (chapters !== CHAPTERS) warning("chapters", "$.tracks", `${chapters} chapter cards; the format has ${CHAPTERS}`);
  const figures = new Set(["merge", "cards", "stack", "oxymoron", "simile"]);
  const progress = visual.filter(({ item }) => item.kit?.name === "progress");
  const tools = visual.filter(({ item }) => figures.has(item.kit?.name));
  if (progress.length !== tools.length) warning("specimen-without-tool", "$.tracks", `${progress.length} specimens, ${tools.length} figure tools: every painting has its tool`);
  if (!audio.some(({ item }) => String(item.id).startsWith("theme-"))) warning("no-theme-sound", "$.tracks", "no sound theme at the opening and the exit");
  return findings;
}

export const validator: SeriesValidator = {
  id: "dentro-i-versi-long",
  version: "1.0.0",
  description: "The Dentro i versi long's mechanical rules, on the timeline about to be rendered: 240–600 s, looping, its kits in the channel's theme, the voices untouched, the guide teleporting in and out.",
  validate,
};
````

````diff
diff --git a/studio/series/src/registry.ts b/studio/series/src/registry.ts
index 9da6561..4fb22c1 100644
--- a/studio/series/src/registry.ts
+++ b/studio/series/src/registry.ts
@@ -4,8 +4,9 @@
 import type { SeriesCompiler } from "./types.js";
 import { compiler as poetryShort100 } from "./compilers/poetry-short/1.0.0.js";
 import { compiler as dentroIVersiShort100 } from "./compilers/dentro-i-versi-short/1.0.0.js";
+import { compiler as dentroIVersiLong100 } from "./compilers/dentro-i-versi-long/1.0.0.js";
 
-export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100, dentroIVersiShort100]);
+export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100, dentroIVersiShort100, dentroIVersiLong100]);
 
 /** The compiler with exactly this id and version, or undefined. */
 export function resolveCompiler(id: string, version: string): SeriesCompiler | undefined {
diff --git a/studio/series/src/validators.ts b/studio/series/src/validators.ts
index 942ebac..c023bd3 100644
--- a/studio/series/src/validators.ts
+++ b/studio/series/src/validators.ts
@@ -6,8 +6,9 @@
 import type { CheckResult, SeriesValidator, ValidateInput } from "./types.js";
 import { validator as poetryShort100 } from "./validators/poetry-short/1.0.0.js";
 import { validator as dentroIVersiShort100 } from "./validators/dentro-i-versi-short/1.0.0.js";
+import { validator as dentroIVersiLong100 } from "./validators/dentro-i-versi-long/1.0.0.js";
 
-export const VALIDATORS: readonly SeriesValidator[] = Object.freeze([poetryShort100, dentroIVersiShort100]);
+export const VALIDATORS: readonly SeriesValidator[] = Object.freeze([poetryShort100, dentroIVersiShort100, dentroIVersiLong100]);
 
 /** The validator with exactly this id and version, or undefined. */
 export function resolveValidator(id: string, version: string): SeriesValidator | undefined {
````

- [ ] **Step 4: Run them, then everything**

Run: `npx tsc --noEmit -p . && node --import tsx --test test/dentro-i-versi-long.test.ts test/golden.test.ts test/validators-golden.test.ts`
Expected: PASS. The golden must equal `expected-timeline.json` byte for byte.

Run: `npm test`
Expected: PASS, 153 tests.

- [ ] **Step 5: Docs and commit**

````diff
diff --git a/studio/series/README.md b/studio/series/README.md
index 4811720..7124447 100644
--- a/studio/series/README.md
+++ b/studio/series/README.md
@@ -39,6 +39,7 @@ input.
 |---|---|
 | `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |
 | `dentro-i-versi-short@1.0.0` | Dentro i versi · short (CreativeStudio's `sala8`): the `recital` unit — the title take, then the poem — from 0.3 s; the video lasts until 6 s after `voiceEndWord`. From the spec's data and the measured words it computes the camera's breathing, pushes and shakes, lightning at each picture change, lights, wind, shatter, blackout, the actor's poses, expressions, gazes, blinks, mouth (from the voice's energy), live and bow windows, and the title card's fit; it lays out the museum kits (`museum-hall`, `room-effect`, `verse-plate`, `interprete`, `lower-third`, `title-chip`, `brand-mark`), the sounds, applause and music. Times are seconds or `verse:N`, `verseEnd:N`, `word:parola`, `end`, `picture:N`, ± seconds. Items that overlap go on separate lanes (`verses-1`, `verses-2`, `room-1`…, `sfx-1`…). Sections: `title`, `verse-N`, `bow`. |
+| `dentro-i-versi-long@1.0.0` | Dentro i versi · long (CreativeStudio's `poesie-museo-long`, runtime v10): the lesson's blocks in order — `opening` (the atrio, the cover, the warp into the hall), `announcement`, `recital` (the pinned source's takes; `annotated` adds each verse's figure), `story`, `note`, `specimen` (one figure tool per painting), `meter`, `invite`, `summary`, `end` — each lasting its guide take (0.4 s before, 0.6 s after) plus its gap, with a 4 s chapter card after `chapterAfter`. Every time in a block is a cue: seconds, `end`, or `{word, n?, offset?}` on its take (elided words found: «L'Italia» answers `italia`); a cue that finds nothing stops with `cue-not-found`. The look, rooms and characters are the pinned theme's; the paintings and recitals are `source-<pin>-…` from the pinned source episode. Draws the channel-neutral lesson kits; the last frame is the first (`loop: true`). Sections: `block-<id>`, `chapter-N`. |
 
 ## Validators
 
@@ -57,6 +58,7 @@ const { validator, findings } = checkSeries({ ...input, timeline, compiled });
 |---|---|
 | `poetry-short@1.0.0` | Errors: a track missing, `profile-changed`, `fps-changed`, `duration-range` (10–60 s), `extra-track`, `hidden-track`, `stacking-changed`, `forbidden-kit`, `forbidden-transition` (only a 12-frame crossfade in), `altered-voice` (takes never cut, moved or reworked), `asset-changed` (no picture or take swapped, added or removed by hand), `text-not-voice` (the captions say exactly what the compiler captioned from the voice), `missing-picture`, `uncovered-frames`. Warnings: `panel-flash` (under 1 s), `panel-long` (over 7 s), `caption-long` (over 42 characters). |
 | `dentro-i-versi-short@1.0.0` | Errors: `profile-changed`, `fps-changed`, `duration-range` (25–90 s), `hidden-track`, `forbidden-kit` (only the seven museum kits at 1.0.0), `verse-text` (a plate that is not a verse of the spec), `missing-verse` (counted), `missing-actor`, `missing-teleport` and `loop-broken` (the first and last frame are the empty hall), `altered-voice` (takes, and the voice track's gain and ducking). Warnings: `apparitions` (not 2), `apparition-short` (under 5 s), `title-pause` (not 0.8–1.4 s between the title and the poem). |
+| `dentro-i-versi-long@1.0.0` | Errors: `profile-changed`, `loop-broken`, `duration` (240–600 s), `unknown-kit` (only the lesson kits at their versions), `look-changed` (every kit in the theme's look), `voice-missing` and `voice-changed` (the guide's and the source's voices untouched), `missing-teleport` (the guide arrives at the opening and leaves at the exit). Warnings: `chapters` (not 5), `specimen-without-tool`, `no-theme-sound`. |
 
 Like compilers, validators are pure, one file per version
 (`src/validators/<id>/<version>.ts`, registered in `src/validators.ts`, the
````

```bash
git add studio/series/fixtures/dentro-i-versi-long studio/series/fixtures/validators/dentro-i-versi-long studio/series/src/compilers/dentro-i-versi-long studio/series/src/validators/dentro-i-versi-long studio/series/src/registry.ts studio/series/src/validators.ts studio/series/test/dentro-i-versi-long.test.ts studio/series/README.md
git commit -m "dentro-i-versi-long@1.0.0: the lesson's release, compiler and validator, Il lampo as its golden (avg-dcf.6.2, avg-dcf.6.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The long episode on disk, compiled and drawn

**Files:**
- Create:
  - `studio/episode/tests/dentro-i-versi-long.test.ts`;
  - `studio/episode/tests/dentro-i-versi-long.e2e.test.ts`.
- Modify: `studio/episode/src/testing.ts` (`divLongEpisode`).

- [ ] **Step 1: Write the failing tests**

Create `studio/episode/tests/dentro-i-versi-long.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEpisode, compileEpisode, loadEpisode, sharedRootsOf } from "../src/series-compile.js";
import { divLongEpisode } from "../src/testing.js";

/**
 * Il lampo's lesson on disk (avg-dcf.6.2–6.3): the long episode pins the
 * short as its source, and compiles with its release's compiler.
 */

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "div-long-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the dentro-i-versi-long episode", () => {
  it("loads its pinned source and compiles, looping, in the theme's look", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    const loaded = loadEpisode(episodeDir, { episodeRef });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(Object.keys(loaded.input.sources!)).toEqual(["fonte"]);
    const compiled = compileEpisode(episodeDir, { episodeRef });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    expect((compiled.timeline as any).loop).toBe(true);
    expect(compiled.timeline.assets["source-fonte-narration-recita"]!.path).toBe("../../../short/episodes/il-lampo/assets/takes/recita.wav");
    expect(sharedRootsOf(episodeDir)).toEqual([join(root, "dentro-i-versi", "themes", "dentro-i-versi", "1.0.0"), join(root, "dentro-i-versi", "series", "short", "episodes", "il-lampo")]);
  });

  it("passes its series rules but for the missing sound theme", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    const checked = checkEpisode(episodeDir, { episodeRef });
    if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
    expect(checked.validator).toBe("dentro-i-versi-long@1.0.0");
    expect(checked.findings.map((f) => [f.code, f.severity])).toEqual([["no-theme-sound", "warning"]]);
  });

  it("stops when the source changed since it was pinned", async () => {
    const { episodeDir, episodeRef } = await divLongEpisode(root);
    writeFileSync(join(root, "dentro-i-versi", "series", "short", "episodes", "il-lampo", "assets", "images", "lampo-04-casa.png"), "repainted");
    const compiled = compileEpisode(episodeDir, { episodeRef });
    expect(compiled.ok ? null : compiled.problems[0]!.code).toBe("pin-mismatch");
  });
});
````

Create `studio/episode/tests/dentro-i-versi-long.e2e.test.ts`:

````ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
import { divLongEpisode } from "../src/testing.js";

/**
 * The dentro-i-versi-long golden episode (avg-dcf.6.3) drawn for real
 * through Remotion with every lesson kit: its layout sheet — every block's
 * start and middle, every chapter card. Slow, and it needs headless Chrome
 * and ffmpeg. Only with REMOTION_E2E=1, against @av/remotion-composer's and
 * @studio/series's dist/ (build them first). The full 6½-minute render is
 * avg-dcf.6.5's.
 */

const enabled = process.env.REMOTION_E2E === "1";
let root: string;
let episode: Awaited<ReturnType<typeof divLongEpisode>>;
const LIBRARY_PAINTINGS = join(import.meta.dirname, "..", "..", "..", "library", "dentro-i-versi", "series", "short", "episodes", "il-lampo", "assets", "images");
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

beforeAll(async () => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), "div-long-e2e-"));
  let i = 0;
  episode = await divLongEpisode(root, {
    // Il lampo's paintings from the channel library when there (the source Pi made), else plain colours.
    image: (path, name) => existsSync(join(LIBRARY_PAINTINGS, `${name}.png`)) ? copyFileSync(join(LIBRARY_PAINTINGS, `${name}.png`), path) : ff("-f", "lavfi", "-i", `color=c=0x${(0x304870 + 0x0c0a08 * i++).toString(16)}:s=${name.startsWith("lampo-") ? "1536x2048" : name.startsWith("ic-") ? "256x256" : "1600x1200"}`, "-frames:v", "1", path),
    audio: (path, _take, seconds) => ff("-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ar", "48000", path),
  });
});
// KEEP=1 leaves the episode (and its sheet) to look at.
afterAll(() => { if (root && process.env.KEEP !== "1") rmSync(root, { recursive: true, force: true }); else if (root) console.log(`kept ${root}`); });

describe.skipIf(!enabled)("the dentro-i-versi-long golden episode, drawn", () => {
  it("makes its layout sheet at every block and chapter; the sheet is then current", async () => {
    const { episodeDir, episodeRef } = episode;
    const { report, sheetPath } = await makeLayoutSheet(episodeDir, { episodeRef });
    const labels = report.frames.map((f) => f.label ?? "").join(" ");
    for (const block of ["portale", "epoca", "scheda", "reperto1", "reperto5", "metrica", "invito", "ripasso", "uscita"]) expect(labels).toContain(`block-${block}`);
    expect(labels).toContain("chapter-1");
    expect(readdirSync(join(episodeDir, "artifacts/layout-sheet/frames"))).toHaveLength(report.frames.length);
    expect(existsSync(sheetPath)).toBe(true);
    expect(layoutSheetStatus(episodeDir, { episodeRef }).state).toBe("current");
  }, 900_000);
});
````

Run: `npm run build --workspace @studio/series && cd studio/episode && npx vitest run tests/dentro-i-versi-long.test.ts`
Expected: FAIL. `divLongEpisode` does not exist.

- [ ] **Step 2: The helper**

````diff
diff --git a/studio/episode/src/testing.ts b/studio/episode/src/testing.ts
index 9507004..0fe68d9 100644
--- a/studio/episode/src/testing.ts
+++ b/studio/episode/src/testing.ts
@@ -10,11 +10,14 @@ import { createRequire } from "node:module";
 import { dirname, join } from "node:path";
 import { signReceipt } from "@studio/contracts/src/receipt.mjs";
 import { buildSheetReview, LAYOUT_SHEET_REPORT, SHEET_REVIEW_PATH } from "@studio/contracts/src/sheet-reviews.mjs";
+import { inventory } from "@studio/contracts/src/source-pins.mjs";
 
 const require = createRequire(import.meta.url);
 const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
 const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
 const DIV_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-short/1.0.0/input.json");
+const DIV_LONG_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-long/1.0.0/input.json");
+const DIV_THEME = dirname(require.resolve("@studio/series/fixtures/themes/dentro-i-versi/1.0.0/theme.json"));
 
 export const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
 
@@ -125,3 +128,68 @@ export function approveSheet(episodeDir: string, episodeRef: { channel: string;
   writeFileSync(join(episodeDir, SHEET_REVIEW_PATH), `${JSON.stringify(review, null, 2)}\n`);
   return review;
 }
+
+/**
+ * Lay out the dentro-i-versi-long golden episode — Il lampo's lesson — under
+ * `libraryRoot`, with everything it reads: the channel's theme release, the
+ * short episode it pins as its source (its paintings, and its title and
+ * recital takes with their timing), and the long episode itself (its release,
+ * spec, guide takes with their timing, own pictures and the pin). Returns the
+ * long episode's directory and reference.
+ */
+export async function divLongEpisode(
+  libraryRoot: string,
+  options: DivShortEpisodeOptions = {},
+): Promise<{ episodeDir: string; episodeRef: { channel: string; series: string; episode: string } }> {
+  const input = JSON.parse(readFileSync(DIV_LONG_INPUT, "utf-8"));
+  const channelDir = join(libraryRoot, "dentro-i-versi");
+  cpSync(DIV_THEME, join(channelDir, "themes", "dentro-i-versi", "1.0.0"), { recursive: true });
+  const sourceDir = join(channelDir, "series", "short", "episodes", "il-lampo");
+  const episodeRef = { channel: "dentro-i-versi", series: "long", episode: "il-lampo" };
+  const episodeDir = join(channelDir, "series", "long", "episodes", "il-lampo");
+  const writeIn = (dir: string, relative: string, content: string | Buffer) => {
+    mkdirSync(dirname(join(dir, relative)), { recursive: true });
+    writeFileSync(join(dir, relative), content);
+  };
+  /** Takes' audio, then their timing (bound to that audio's real hash), then takes.json. */
+  const takes = (dir: string, narration: any, timings: Record<string, any>) => {
+    for (const take of narration.takes as any[]) {
+      const path = join(dir, take.audio.path);
+      mkdirSync(dirname(path), { recursive: true });
+      if (options.audio) options.audio(path, take.id, take.audio.durationSeconds);
+      else writeFileSync(path, `audio ${take.id}`);
+      take.audio.hash = sha256(readFileSync(path));
+      const timingText = `${JSON.stringify({ ...timings[take.id], audio: { ...take.audio } }, null, 2)}\n`;
+      writeIn(dir, take.timing.path, timingText);
+      take.timing.hash = sha256(timingText);
+    }
+    writeIn(dir, "artifacts/narration/takes.json", `${JSON.stringify(narration, null, 2)}\n`);
+  };
+  const picture = (dir: string, relative: string, name: string) => {
+    const path = join(dir, relative);
+    mkdirSync(dirname(path), { recursive: true });
+    if (options.image) options.image(path, name);
+    else writeFileSync(path, `image ${name}`);
+  };
+
+  // The source: the short episode's paintings and takes.
+  for (const [id, asset] of Object.entries<{ path: string }>(input.assets)) {
+    if (id.startsWith("source-fonte-image-")) picture(sourceDir, `assets/images/${asset.path.split("/").pop()}`, id.slice("source-fonte-image-".length));
+  }
+  takes(sourceDir, input.sources.fonte.narration, input.sources.fonte.timings);
+
+  // The lesson.
+  cpSync(join(dirname(DIV_LONG_INPUT), "release"), join(channelDir, "series", "long", "templates", "dentro-i-versi-long", input.template.version), { recursive: true });
+  for (const [id, asset] of Object.entries<{ path: string }>(input.assets)) {
+    if (id.startsWith("image-")) picture(episodeDir, asset.path, id.slice(6));
+  }
+  takes(episodeDir, input.narration, input.timings);
+  writeIn(episodeDir, "episode-spec.json", `${JSON.stringify({ ...input.spec, episodeRef }, null, 2)}\n`);
+  const files = await inventory(sourceDir);
+  writeIn(episodeDir, "source/pins/fonte.json", `${JSON.stringify({
+    apiVersion: "studio.video/v1alpha1", kind: "SourcePin", id: "fonte",
+    source: { kind: "episode", series: "short", episode: "il-lampo" },
+    usedBy: ["timeline"], pinnedAt: "2026-10-09T12:00:00.000Z", files,
+  }, null, 2)}\n`);
+  return { episodeDir, episodeRef };
+}
````

- [ ] **Step 3: Run it, everything, then the real sheet**

Run: `npx tsc --noEmit && npx vitest run tests/dentro-i-versi-long.test.ts && npx vitest run`
Expected: PASS. 3 new tests; the suite passes 233 (4 skipped).

Run: `npm run build --workspace @av/remotion-composer && npm run build --workspace @studio/series && cd studio/episode && REMOTION_E2E=1 npx vitest run tests/dentro-i-versi-long.e2e.test.ts`
Expected: PASS in under a minute. The layout sheet has every block and chapter.

Then rebuild `@studio/episode` (`npm run build --workspace @studio/episode`) and run `studio/agent` (`npx vitest run`, 210) and `studio/adapters` (`npx vitest run`, 46). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/episode/src/testing.ts studio/episode/tests/dentro-i-versi-long.test.ts studio/episode/tests/dentro-i-versi-long.e2e.test.ts
git commit -m "Il lampo's lesson on disk: it pins the short, compiles, passes its rules, and draws its layout sheet (avg-dcf.6.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Whole-branch checks

- [ ] **Step 1:** Run `git diff --stat 89f7ed7 HEAD -- studio`. It must be empty.
- [ ] **Step 2:** From the root, run `npm run check && npm run docs:build`. Expected: PASS.
- [ ] **Step 3:** No commit. Report the test counts.
