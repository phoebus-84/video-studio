# Series Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the compiler seat of ADR-0037: a new workspace `@studio/series` with versioned, pure series compilers (first: `poetry-short@1.0.0`, frozen by a golden output), an agent loader `compileEpisode` that reads and checks a spec-driven episode, and `pva_build_timeline`/`pva_compose_video` using it whenever an episode has an `episode-spec.json`.

**Architecture:** Compilers are pure functions `CompileInput → CompileResult` registered by exact `id@version`; `compileSpec` dispatches and holds the result to both timeline validators. The agent's `compileEpisode` is the only code that touches files: it loads the pinned release from the series, validates bundle/spec/takes/timings with the contracts' helpers, hashes every file into `inputs`, offers every picture as `image-<name>`, and calls `compileSpec`. `episode-render.ts` chooses the producer per episode (`isSpecDriven`), keeps tk7.6's rebuild/hand-edit logic, and never falls back from a spec to the legacy builder.

**Tech Stack:** TypeScript (NodeNext, `tsc` to `dist/`), `node:test` + `tsx` for `@studio/series`, vitest for `studio/agent`, `@studio/contracts` helpers (`resolveCues`, `layoutUnit`, `outputProfile`, `validateTemplateBundle`, `validateEpisodeSpec`, `validateNarrationTakes`, `validateWordTiming`, `validateEditTimeline`), `@av/remotion-composer` (`validateTimeline`, `renderTimeline`), bun 1.2.0 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-06-series-compiler-design.md`

## Global Constraints

- Branch `feat/series-compiler` (already holds the spec commit). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `@studio/series` imports nothing from `studio/agent` or `studio/runtime`; `packages/` never imports `studio/` (`npm run check:boundaries`).
- A released compiler version is frozen by its golden output; a version file imports only `@studio/contracts` helpers and `../../types.js`.
- Compilers are pure: no file reads, no clock, no randomness, no environment.
- fps 30; crossfade 12 frames centred on each boundary; a panel shorter than 13 frames gets none on either side; captions close after `. ! ? ; :` or before passing 42 characters.
- Lockfile: bun **1.2.0**. Update `bun.lock` only with `bun install --lockfile-only --ignore-scripts`, then `bun install --frozen-lockfile` — in the main checkout, never in a second worktree.
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.
- Do not edit `studio/contracts/fixtures/series-template/**` (its hashes are pinned by the contract tests).

## Review Focus

- A spec edited into a broken state after a successful render → `pva_compose_video` must fail with the spec's problems, not render the older valid timeline (Task 3: "refuses to render while the spec does not compile…").
- `pva_compose_video` asked for the other profile on a spec-driven episode → `profile-fixed-by-template`, nothing rendered (Task 3: "refuses to render another profile than the template's…").
- A picture saved as `cat.PNG` → offered as `image-cat` like `cat.png` (Task 2: "offers a picture whatever the case of its extension").
- A template release file that is a symlink out of the series → `path-escape`, never read (Task 2: "path-escape: a release file that is a link out of the series").
- Two panels showing the same picture → one asset, both items refer to it (Task 1: "two panels may show the same picture").

---

### Task 1: `@studio/series` — registry, `compileSpec`, `poetry-short@1.0.0`, golden fixture, wiring

**Files:**
- Create: `studio/series/package.json`, `studio/series/tsconfig.json`, `studio/series/tsconfig.build.json`, `studio/series/README.md`
- Create: `studio/series/src/types.ts`, `studio/series/src/registry.ts`, `studio/series/src/compile.ts`, `studio/series/src/index.ts`, `studio/series/src/compilers/poetry-short/1.0.0.ts`
- Create: `studio/series/scripts/golden.ts`
- Create: `studio/series/fixtures/poetry-short/1.0.0/input.json` (generated), `studio/series/fixtures/poetry-short/1.0.0/expected-timeline.json` (generated)
- Test: `studio/series/test/golden.test.ts`, `studio/series/test/poetry-short.test.ts`
- Modify: `package.json` (workspaces), `bun.lock`, `tools/build-required.mjs`, `.github/workflows/ci.yml`, `compose.config.json`, `README.md`; generated `docs/studio/series.md`

**Interfaces:**
- Consumes: `@studio/contracts/src/cues.mjs` `resolveCues(entries: {path, cue, scope}[]) → {frames: Record<path, number>, problems: {code, message, path}[]}`; `@studio/contracts/src/narration-takes.mjs` `layoutUnit(doc, unitId, timings) → {layout: {durationSeconds, pieces: {take, at, from, duration}[], timing: {take, words, lines}}} | {problems}` (throws `RangeError` for an unknown unit); `@studio/contracts/src/output-profiles.mjs` `outputProfile(id)`; `@studio/contracts/src/edit-timeline.mjs` `validateEditTimeline(doc) → {code, message, path}[]`; `@av/remotion-composer` `validateTimeline(doc) → {ok: true} | {ok: false, problems}`.
- Produces (from `@studio/series`): `compileSpec(input: CompileInput): CompileResult`; `resolveCompiler(id, version): SeriesCompiler | undefined`; `listCompilers(): {id, version, description}[]`; `COMPILERS`; types `CompileInput { spec, template, narration, timings, assets: Record<id, {path, hash, kind: "image" | "audio"}>, inputs: Record<path, "sha256:…"> }`, `CompileProblem { code, message, path }`, `CompileResult = {ok: true, timeline, warnings} | {ok: false, problems}`, `SeriesCompiler`, `EditTimeline`. Export `./fixtures/*` (Task 2's test helper reads `@studio/series/fixtures/poetry-short/1.0.0/input.json`).

- [ ] **Step 1: Generate the golden input fixture**

From the repository root, write this one-off generator to the scratchpad (not committed) and run it. It builds the whole `CompileInput`: the contracts' example release manifest, a spec (revision 2) with three panels cued on "Light", "cup" and "cat", two takes (`light` 2.6 s; `cup` 5.2 s after a 0.5 s pause, with a 1 s hold after "window."), their word timings, assets and input hashes.

```js
// One-off: writes studio/series/fixtures/poetry-short/1.0.0/input.json.
// Run from the repository root: node make-fixture.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const h = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const RELEASE = "studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0";
const manifestText = readFileSync(`${RELEASE}/series-template.json`);
const manifest = JSON.parse(manifestText);
const pin = h(manifestText);

const words = (rows) => rows.map(([text, start, end]) => ({ text, start, end }));
const light = words([["Light", 0.1, 0.42], ["falls", 0.42, 0.8], ["across", 0.8, 1.22], ["the", 1.22, 1.34], ["quiet", 1.34, 1.78], ["room.", 1.78, 2.4]]);
const cup = words([
  ["A", 0.05, 0.12], ["cup", 0.12, 0.4], ["of", 0.4, 0.5], ["tea", 0.5, 0.86], ["is", 0.86, 0.98], ["cooling", 0.98, 1.44],
  ["by", 1.44, 1.6], ["the", 1.6, 1.7], ["window.", 1.7, 2.3], ["The", 2.6, 2.72], ["cat", 2.72, 3.1], ["has", 3.1, 3.32],
  ["not", 3.32, 3.58], ["moved", 3.58, 3.98], ["since", 3.98, 4.36], ["dawn.", 4.36, 5.0],
]);
const text = (ws) => ws.map((w) => w.text).join(" ");
const audio = {
  light: { path: "assets/takes/light.wav", hash: h("light.wav"), durationSeconds: 2.6 },
  cup: { path: "assets/takes/cup.wav", hash: h("cup.wav"), durationSeconds: 5.2 },
};
const timing = (id, ws) => ({
  apiVersion: "studio.video/v1alpha1", kind: "WordTiming", take: { id }, audio: audio[id], text: text(ws), language: "en",
  alignment: { provider: "fixture", method: "forced", createdAt: "2026-10-06T00:00:00Z" }, words: ws,
});
const timings = { light: timing("light", light), cup: timing("cup", cup) };
const timingPath = (id) => `artifacts/timing/${id}.json`;
const narration = {
  apiVersion: "studio.video/v1alpha1",
  kind: "NarrationTakes",
  takes: ["light", "cup"].map((id) => ({
    id, audio: audio[id], text: timings[id].text, voice: { provider: "qwen3-tts-local", voiceId: "narrator-v1" },
    timing: { path: timingPath(id), hash: h(timingPath(id)) },
  })),
  units: [{
    id: "narration", source: "narration",
    sequence: [{ take: "light" }, { take: "cup", pauseBefore: 0.5, holds: [{ afterWord: "window.", seconds: 1, reason: "let the cup be seen before the cat" }] }],
  }],
};
const spec = {
  apiVersion: "studio.video/v1alpha1",
  kind: "EpisodeSpec",
  episodeRef: { channel: "sample", series: "poetry", episode: "morning" },
  revision: 2,
  template: { id: "poetry-short", version: "1.0.0", hash: pin },
  data: {
    title: "Morning",
    narration: `${timings.light.text} ${timings.cup.text}`,
    holdSeconds: 1.5,
    panels: [{ assetId: "morning-room", cue: "Light" }, { assetId: "teacup", cue: "cup" }, { assetId: "cat", cue: "cat" }],
    style: { fontFamily: "Georgia", captionKit: { name: "captions", version: "1.1.0" }, voiceProfile: "narrator-v1", outputProfile: "vertical-1080x1920" },
  },
};
const assets = {};
for (const id of ["morning-room", "teacup", "cat"]) assets[`image-${id}`] = { path: `assets/images/${id}.png`, hash: h(`${id}.png`), kind: "image" };
for (const id of ["light", "cup"]) assets[`narration-${id}`] = { path: audio[id].path, hash: audio[id].hash, kind: "audio" };
const rel = "../../templates/poetry-short/1.0.0/";
const inputs = { "episode-spec.json": h("episode-spec.json"), [`${rel}series-template.json`]: pin };
inputs[`${rel}episode-spec.schema.json`] = manifest.files.schema.hash;
inputs[`${rel}episode-spec.template.json`] = manifest.files.template.hash;
inputs[`${rel}FORMAT.md`] = manifest.files.standard.hash;
inputs["artifacts/narration/takes.json"] = h("takes.json");
for (const id of ["light", "cup"]) {
  inputs[timingPath(id)] = narration.takes.find((t) => t.id === id).timing.hash;
  inputs[audio[id].path] = audio[id].hash;
}
for (const a of Object.values(assets)) inputs[a.path] = a.hash;
writeFileSync("studio/series/fixtures/poetry-short/1.0.0/input.json", `${JSON.stringify({ spec, template: manifest, narration, timings, assets, inputs }, null, 2)}\n`);
```

```bash
mkdir -p studio/series/fixtures/poetry-short/1.0.0
node <scratchpad>/make-fixture.mjs
shasum -a 256 studio/series/fixtures/poetry-short/1.0.0/input.json
```

Expected: `9a22d14b0ae0f41f0fecc8a5d19c523b92654b8017f98d9cb927b288aca227fc`.

- [ ] **Step 2: Write the failing tests**

`studio/series/test/golden.test.ts`:

```ts
// Every released compiler version compiles its fixture to the timeline it
// was released with, byte for byte. A difference means the version's
// behaviour changed — in its own file or in a contract helper it calls —
// and an episode pinned to it would silently re-render differently.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COMPILERS, compileSpec, listCompilers } from "../src/index.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");

for (const { id, version } of listCompilers()) {
  test(`${id}@${version} compiles its fixture to its golden timeline`, () => {
    const dir = join(fixtures, id, version);
    assert.ok(existsSync(join(dir, "input.json")), `fixtures/${id}/${version}/input.json is missing: every released version has one`);
    assert.ok(existsSync(join(dir, "expected-timeline.json")), `fixtures/${id}/${version}/expected-timeline.json is missing: run scripts/golden.ts ${id} ${version}`);
    const input = JSON.parse(readFileSync(join(dir, "input.json"), "utf-8"));
    assert.equal(input.template.compiler.id, id);
    assert.equal(input.template.compiler.version, version);

    const result = compileSpec(input);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
    const expected = readFileSync(join(dir, "expected-timeline.json"), "utf-8");
    assert.equal(
      `${JSON.stringify(result.timeline, null, 2)}\n`,
      expected,
      `${id}@${version} no longer compiles its fixture as released: add src/compilers/${id}/<next>.ts instead of changing this version`,
    );
  });
}

test("compiling is deterministic", () => {
  const input = JSON.parse(readFileSync(join(fixtures, "poetry-short", "1.0.0", "input.json"), "utf-8"));
  assert.deepEqual(compileSpec(structuredClone(input)), compileSpec(structuredClone(input)));
});

test("compiling does not change its input", () => {
  const input = JSON.parse(readFileSync(join(fixtures, "poetry-short", "1.0.0", "input.json"), "utf-8"));
  const before = structuredClone(input);
  compileSpec(input);
  assert.deepEqual(input, before);
});

test("ids and versions are well formed and unique", () => {
  const seen = new Set<string>();
  for (const c of COMPILERS) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(c.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.ok(c.description.trim().length > 0);
    assert.ok(!seen.has(`${c.id}@${c.version}`), `${c.id}@${c.version} registered twice`);
    seen.add(`${c.id}@${c.version}`);
  }
});
```

`studio/series/test/poetry-short.test.ts`:

```ts
// What poetry-short@1.0.0 does with a spec and its narration. The fixture:
// take "light" (2.6 s) from 0 s, then 0.5 s of silence, then take "cup"
// (5.2 s) from 3.1 s with a 1 s pause after "window." — 9.3 s of narration,
// then holdSeconds 1.5: 10.8 s, 324 frames. Panels change on "Light" (frame
// 3), "cup" (3.1 + 0.12 s → frame 97) and "cat" (3.1 + 2.72 + 1 s of pause →
// frame 205).

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import { compileSpec, type CompileInput, type CompileResult } from "../src/index.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0", "input.json");
const load = (): CompileInput & { spec: { data: any } } => JSON.parse(readFileSync(FIXTURE, "utf-8"));

function compiled(input: CompileInput) {
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems, null, 2));
  return result;
}
const problems = (result: CompileResult) => {
  assert.ok(!result.ok, "expected problems");
  return result.problems;
};
const track = (r: ReturnType<typeof compiled>, id: string) => r.timeline.tracks.find((t) => t.id === id)!.items as any[];

/** Replace the narration by one take saying `words`, 0.3 s each, and cue every panel on the first word. */
function soloTake(input: ReturnType<typeof load>, words: string[]) {
  const text = words.join(" ");
  const audio = { path: "assets/takes/solo.wav", hash: `sha256:${"a".repeat(64)}`, durationSeconds: words.length * 0.3 };
  input.narration.takes = [{ id: "solo", audio, text, voice: { provider: "qwen3-tts-local" }, timing: { path: "artifacts/timing/solo.json", hash: `sha256:${"b".repeat(64)}` } }];
  input.narration.units = [{ id: "narration", sequence: [{ take: "solo" }] }];
  input.timings = {
    solo: {
      apiVersion: "studio.video/v1alpha1", kind: "WordTiming", take: { id: "solo" }, audio, text, language: "en",
      alignment: { provider: "fixture", method: "forced", createdAt: "2026-10-06T00:00:00Z" },
      words: words.map((w, i) => ({ text: w, start: Math.round(i * 300) / 1000, end: Math.round((i + 1) * 300) / 1000 })),
    },
  } as never;
  delete input.assets["narration-light"];
  delete input.assets["narration-cup"];
  input.assets["narration-solo"] = { path: audio.path, hash: audio.hash, kind: "audio" };
  input.spec.data.narration = text;
  input.spec.data.panels = [{ assetId: "morning-room", cue: words[0] }];
}

test("each panel starts on its cue, crossfading over 12 frames centred on it", () => {
  const panels = track(compiled(load()), "panels");
  assert.deepEqual(panels.map((p) => [p.id, p.from, p.from + p.duration, p.transitionIn?.duration ?? null]), [
    ["panel-1", 0, 103, null],
    ["panel-2", 91, 211, 12],
    ["panel-3", 199, 324, 12],
  ]);
  assert.deepEqual(panels.map((p) => p.props), [
    { src: { $asset: "image-morning-room" }, fit: "cover" },
    { src: { $asset: "image-teacup" }, fit: "cover" },
    { src: { $asset: "image-cat" }, fit: "cover" },
  ]);
  assert.deepEqual(panels.map((p) => p.source), ["panels[0]", "panels[1]", "panels[2]"]);
});

test("the first panel opens the video whatever its cue", () => {
  const input = load();
  input.spec.data.panels[0].cue = "quiet"; // 1.34 s: frame 40
  assert.equal(track(compiled(input), "panels")[0].from, 0);
});

test("the last panel holds for holdSeconds after the narration", () => {
  const input = load();
  assert.equal(compiled(input).timeline.durationInFrames, 324);
  input.spec.data.holdSeconds = 0;
  const r = compiled(input);
  assert.equal(r.timeline.durationInFrames, 279);
  const panels = track(r, "panels");
  assert.equal(panels.at(-1).from + panels.at(-1).duration, 279);
});

test("a panel shorter than 13 frames gets no crossfade on either side", () => {
  const input = load();
  // "of" is said 0.4 s into "cup": frame 105, 8 frames after "cup".
  input.spec.data.panels.splice(2, 0, { assetId: "teacup", cue: "of" });
  const panels = track(compiled(input), "panels");
  assert.deepEqual(panels.map((p) => [p.from, p.from + p.duration, p.transitionIn?.duration ?? null]), [
    [0, 97, null],
    [97, 105, null],
    [105, 211, null],
    [199, 324, 12],
  ]);
});

test("the voice plays each take where layoutUnit puts it, the hold splitting a take in two", () => {
  const voice = track(compiled(load()), "voice");
  assert.deepEqual(voice.map((v) => [v.id, v.asset, v.from, v.duration, v.trimStart ?? 0]), [
    ["voice-1", "narration-light", 0, 78, 0],
    // 0.5 s after "light" ends; the hold falls halfway between "window." (2.3 s) and "The" (2.6 s).
    ["voice-2", "narration-cup", 93, 74, 0],
    ["voice-3", "narration-cup", 197, 82, 74],
  ]);
});

test("captions are the measured words grouped at sentence ends", () => {
  const captions = track(compiled(load()), "captions");
  assert.deepEqual(captions.map((c) => [c.from, c.from + c.duration, c.props.text]), [
    [3, 72, "Light falls across the quiet room."],
    [95, 162, "A cup of tea is cooling by the window."],
    [201, 273, "The cat has not moved since dawn."],
  ]);
  for (const c of captions) {
    assert.deepEqual(c.kit, { name: "captions", version: "1.1.0" });
    assert.equal(c.props.position, "bottom");
    assert.equal(c.props.font, "Georgia");
  }
});

test("a caption closes at ; or : and before passing 42 characters", () => {
  const input = load();
  const words = "Under the wide and starry sky; dig the grave and let me lie, glad did I live and gladly die and I laid me down with a will".split(" ");
  soloTake(input, words);
  const texts = track(compiled(input), "captions").map((c) => c.props.text);
  assert.equal(texts[0], "Under the wide and starry sky;");
  for (const text of texts) assert.ok(text.length <= 42, `"${text}" is ${text.length} characters`);
  assert.equal(texts.join(" "), words.join(" "));
});

test("the timeline carries the profile whole, its provenance and the title as a chapter", () => {
  const r = compiled(load());
  assert.deepEqual(r.timeline.profile, outputProfile("vertical-1080x1920"));
  assert.deepEqual(r.timeline.resolution, { width: 1080, height: 1920 });
  assert.deepEqual(r.timeline.derivedFrom, {
    spec: { path: "episode-spec.json", hash: load().inputs["episode-spec.json"], revision: 2 },
    compiler: { id: "poetry-short", version: "1.0.0" },
  });
  assert.equal((r.timeline.metadata as any).builtBy, "@studio/series poetry-short@1.0.0");
  assert.deepEqual((r.timeline.metadata as any).template, load().spec.template);
  assert.deepEqual(Object.keys((r.timeline.metadata as any).inputs), Object.keys(load().inputs).sort());
  assert.deepEqual(r.timeline.sections, [{ id: "poem", from: 0, duration: 324, source: "title", chapter: { title: "Morning" } }]);
});

test("narration-mismatch: the takes do not say the spec's narration", () => {
  const input = load();
  input.spec.data.narration = "Light falls across the empty room. A cup of tea is cooling by the window. The cat has not moved since dawn.";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["narration-mismatch", "$.data.narration"]]);
});

test("whitespace alone is not a narration mismatch", () => {
  const input = load();
  input.spec.data.narration = `  ${input.spec.data.narration.replace(/ /g, "\n  ")} `;
  compiled(input);
});

test("cue-order: a panel cued before the one it follows", () => {
  const input = load();
  input.spec.data.panels = [{ assetId: "morning-room", cue: "Light" }, { assetId: "cat", cue: "cat" }, { assetId: "teacup", cue: "cup" }];
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["cue-order", "$.data.panels[2].cue"]]);
});

test("two panels may show the same picture", () => {
  const input = load();
  input.spec.data.panels[2].assetId = "morning-room";
  const r = compiled(input);
  assert.deepEqual(Object.keys(r.timeline.assets).filter((id) => id.startsWith("image-")), ["image-morning-room", "image-teacup"]);
  assert.deepEqual(track(r, "panels").map((p) => p.props.src.$asset), ["image-morning-room", "image-teacup", "image-morning-room"]);
});

test("a cue on a word never said is reported at its path", () => {
  const input = load();
  input.spec.data.panels[1].cue = "teapot";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["unknown-word", "$.data.panels[1].cue"]]);
});

test("missing-asset: a panel whose image the loader did not find", () => {
  const input = load();
  delete input.assets["image-teacup"];
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["missing-asset", "$.data.panels[1].assetId"]]);
});

test("unknown-profile: a profile not in the catalog", () => {
  const input = load();
  input.spec.data.style.outputProfile = "square-1080x1080";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["unknown-profile", "$.data.style.outputProfile"]]);
});

test("missing-unit: takes.json has no narration unit", () => {
  const input = load();
  input.narration.units[0]!.id = "recital";
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["missing-unit", "$.units"]]);
});

test("a layoutUnit problem comes back with its path in takes.json", () => {
  const input = load();
  delete (input.timings as Record<string, unknown>).cup;
  assert.deepEqual(problems(compileSpec(input)).map((p) => [p.code, p.path]), [["missing-timing", "$.units[0].sequence[1].take"]]);
});

test("unknown-compiler names the versions that exist", () => {
  const input = load();
  input.template.compiler.version = "2.0.0";
  const [problem, ...rest] = problems(compileSpec(input));
  assert.equal(rest.length, 0);
  assert.equal(problem!.code, "unknown-compiler");
  assert.equal(problem!.path, "$.template.compiler");
  assert.match(problem!.message, /poetry-short@2\.0\.0: available poetry-short@1\.0\.0/);
});
```

- [ ] **Step 3: Run them to see them fail**

Create `studio/series/package.json`, `tsconfig.json` and `tsconfig.build.json` first (the test runner needs them):

```json
{
  "name": "@studio/series",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Series compilers: a pinned episode spec and its measured narration, compiled into an edit timeline (ADR-0037)",
  "engines": {
    "node": ">=20"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./fixtures/*": "./fixtures/*"
  },
  "files": [
    "dist/",
    "fixtures/",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test \"test/**/*.test.ts\"",
    "check": "npm run typecheck && npm test"
  },
  "dependencies": {
    "@av/remotion-composer": "workspace:*",
    "@studio/contracts": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.0"
  }
}
```

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
    "declaration": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

Run: `cd studio/series && node --import tsx --test "test/**/*.test.ts"`
Expected: FAIL — `Cannot find module '../src/index.js'`.

- [ ] **Step 4: Implement the package**

`studio/series/src/types.ts`:

```ts
// ---------------------------------------------------------------------------
// What a series compiler takes and gives (avg-jao.2, ADR-0037)
// ---------------------------------------------------------------------------
// A compiler is pure: everything it needs arrives already read, checked and
// hashed by its caller (the agent's loader). It reads no file, asks no clock
// and keeps no state, so a released version compiles the same input to the
// same timeline for as long as it exists — which its golden test holds it to.
// ---------------------------------------------------------------------------

import type { EpisodeSpec, SeriesTemplate } from "@studio/contracts/src/series-templates.mjs";
import type { NarrationTakes } from "@studio/contracts/bindings/ts/narration-takes.ts";
import type { WordTiming } from "@studio/contracts/bindings/ts/word-timing.ts";
import type { EditTimeline } from "@studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts";

export type { EditTimeline, EpisodeSpec, NarrationTakes, SeriesTemplate, WordTiming };

/** A file the timeline refers to, relative to the episode. */
export interface CompileAsset {
  path: string;
  hash: string;
  kind: "image" | "audio";
}

export interface CompileInput {
  /** Already passed validateEpisodeSpec against its pinned release. */
  spec: EpisodeSpec;
  /** The pinned release's manifest. */
  template: SeriesTemplate;
  /** artifacts/narration/takes.json, already passed validateNarrationTakes. */
  narration: NarrationTakes;
  /** Take id → its WordTiming, valid and made for that take's audio. */
  timings: Record<string, WordTiming>;
  /**
   * Asset id → file. The loader names them `image-<assetId>` for
   * assets/images/<assetId>.<ext> and `narration-<take>` for each take's audio.
   */
  assets: Record<string, CompileAsset>;
  /** Relative path → "sha256:…" of every file read, recorded as provenance. */
  inputs: Record<string, string>;
}

/** Something in the input that stops compilation, located by a JSON path. */
export interface CompileProblem {
  code: string;
  message: string;
  path: string;
}

export type CompileResult =
  | { ok: true; timeline: EditTimeline; warnings: string[] }
  | { ok: false; problems: CompileProblem[] };

export interface SeriesCompiler {
  /** ^[a-z0-9]+(-[a-z0-9]+)*$, as a SeriesTemplate's `compiler.id`. */
  id: string;
  /** Exact x.y.z. */
  version: string;
  /** One sentence. */
  description: string;
  compile(input: CompileInput): CompileResult;
}
```

`studio/series/src/registry.ts`:

```ts
// The registered compilers. Each released version is its own file and stays
// registered, so an episode pinned to it keeps compiling the same way.

import type { SeriesCompiler } from "./types.js";
import { compiler as poetryShort100 } from "./compilers/poetry-short/1.0.0.js";

export const COMPILERS: readonly SeriesCompiler[] = Object.freeze([poetryShort100]);

/** The compiler with exactly this id and version, or undefined. */
export function resolveCompiler(id: string, version: string): SeriesCompiler | undefined {
  return COMPILERS.find((c) => c.id === id && c.version === version);
}

/** Every registered compiler, sorted by id then version. */
export function listCompilers(): { id: string; version: string; description: string }[] {
  return COMPILERS.map(({ id, version, description }) => ({ id, version, description }))
    .sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}
```

`studio/series/src/compile.ts`:

```ts
// Dispatch a spec to the compiler its template names, then hold the result
// to both timeline validators: the contracts' (structure, overlaps,
// references) and the composer's (kits and their props).

import { validateTimeline } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { listCompilers, resolveCompiler } from "./registry.js";
import type { CompileInput, CompileProblem, CompileResult } from "./types.js";

export function compileSpec(input: CompileInput): CompileResult {
  const { id, version } = input.template.compiler;
  const compiler = resolveCompiler(id, version);
  if (!compiler) {
    const available = listCompilers().filter((c) => c.id === id).map((c) => `${c.id}@${c.version}`);
    return {
      ok: false,
      problems: [{
        code: "unknown-compiler",
        path: "$.template.compiler",
        message: `${id}@${version}: ${available.length > 0 ? `available ${available.join(", ")}` : "no compiler with this id"}`,
      }],
    };
  }

  const result = compiler.compile(input);
  if (!result.ok) return result;

  // A timeline the validators refuse is the compiler's fault, not the
  // episode's: the prefix says so.
  const problems: CompileProblem[] = validateEditTimeline(result.timeline)
    .map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" }));
  if (problems.length === 0) {
    const composer = validateTimeline(result.timeline);
    if (!composer.ok) {
      problems.push(...composer.problems.map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" })));
    }
  }
  return problems.length > 0 ? { ok: false, problems } : result;
}
```

`studio/series/src/index.ts`:

```ts
export { compileSpec } from "./compile.js";
export { COMPILERS, listCompilers, resolveCompiler } from "./registry.js";
export type {
  CompileAsset,
  CompileInput,
  CompileProblem,
  CompileResult,
  EditTimeline,
  EpisodeSpec,
  NarrationTakes,
  SeriesCompiler,
  SeriesTemplate,
  WordTiming,
} from "./types.js";
```

`studio/series/src/compilers/poetry-short/1.0.0.ts`:

```ts
// poetry-short@1.0.0 — released: never edit this file; add poetry-short/<next>.ts instead.
//
// A vertical poem: pictures that change on the words the spec names, one
// narration unit, captions grouped from the measured words. Everything this
// version does is in this file (it imports only the contracts' helpers and
// ../../types.js), and its golden test fails if its output ever changes.

import { resolveCues } from "@studio/contracts/src/cues.mjs";
import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler } from "../../types.js";

const FPS = 30;
/** Frames a crossfade between two panels lasts, centred on their boundary. */
const CROSSFADE = 12;
/** A caption group closes before it would grow past this many characters. */
const CAPTION_CHARACTERS = 42;
const SENTENCE_PAUSE = /[.!?;:]$/;
const UNIT = "narration";
const SPEC_PATH = "episode-spec.json";

interface PoetryShortData {
  title: string;
  narration: string;
  holdSeconds: number;
  panels: { assetId: string; cue: string }[];
  style: {
    fontFamily: string;
    captionKit: { name: string; version: string };
    voiceProfile: string;
    outputProfile: string;
  };
}

const frames = (seconds: number) => Math.round(seconds * FPS);
const collapse = (text: string) => text.trim().split(/\s+/).join(" ");

function compile(input: CompileInput): CompileResult {
  const data = input.spec.data as unknown as PoetryShortData;
  const problems: CompileProblem[] = [];
  const warnings: string[] = [];

  const profile = outputProfile(data.style.outputProfile);
  if (!profile) {
    problems.push({ code: "unknown-profile", path: "$.data.style.outputProfile", message: `no output profile "${data.style.outputProfile}"` });
  }

  const specHash = input.inputs[SPEC_PATH];
  if (!specHash) {
    problems.push({ code: "missing-input", path: "$.inputs", message: `the hash of ${SPEC_PATH} was not supplied` });
  }

  // ── Narration ─────────────────────────────────────────────────────────────
  const unitIndex = input.narration.units.findIndex((u) => u.id === UNIT);
  if (unitIndex === -1) {
    problems.push({ code: "missing-unit", path: "$.units", message: `takes.json has no unit "${UNIT}"` });
    return { ok: false, problems };
  }
  const unit = input.narration.units[unitIndex]!;
  const texts = new Map(input.narration.takes.map((t) => [t.id, t.text]));
  const spoken = collapse(unit.sequence.map((entry) => texts.get(entry.take) ?? "").join(" "));
  if (spoken !== collapse(data.narration)) {
    problems.push({
      code: "narration-mismatch",
      path: "$.data.narration",
      message: `the takes of unit "${UNIT}" say "${spoken}", not the spec's narration`,
    });
  }

  const laid = layoutUnit(input.narration, UNIT, input.timings);
  if ("problems" in laid) {
    problems.push(...laid.problems);
    return { ok: false, problems };
  }
  const layout = laid.layout;

  // ── Panels on their cues ──────────────────────────────────────────────────
  const scope = { timing: layout.timing, startSeconds: 0, fps: FPS };
  const resolved = resolveCues(data.panels.map((panel, i) => ({ path: `$.data.panels[${i}].cue`, cue: panel.cue, scope })));
  problems.push(...resolved.problems);
  data.panels.forEach((panel, i) => {
    if (!input.assets[`image-${panel.assetId}`]) {
      problems.push({ code: "missing-asset", path: `$.data.panels[${i}].assetId`, message: `no image for "${panel.assetId}" in assets/images` });
    }
  });
  if (problems.length > 0) return { ok: false, problems };

  const cueFrames = data.panels.map((_, i) => resolved.frames[`$.data.panels[${i}].cue`]!);
  for (let i = 1; i < cueFrames.length; i++) {
    if (cueFrames[i]! <= cueFrames[i - 1]!) {
      return {
        ok: false,
        problems: [{
          code: "cue-order",
          path: `$.data.panels[${i}].cue`,
          message: `panel ${i + 1} starts at frame ${cueFrames[i]}, not after panel ${i} (frame ${cueFrames[i - 1]})`,
        }],
      };
    }
  }

  // ── Duration ──────────────────────────────────────────────────────────────
  // Voice items are rounded on absolute times, so pieces that touch in
  // seconds still touch in frames.
  const voiceItems = layout.pieces.map((piece, k) => {
    const from = frames(piece.at);
    return {
      id: `voice-${k + 1}`,
      from,
      duration: Math.max(1, frames(piece.at + piece.duration) - from),
      asset: `narration-${piece.take}`,
      ...(frames(piece.from) > 0 ? { trimStart: frames(piece.from) } : {}),
      source: "narration",
    };
  });
  const voiceEnd = Math.max(0, ...voiceItems.map((item) => item.from + item.duration));
  // A hair under the next frame is that frame: 7.5 s × 30 is 225, not 226.
  const durationInFrames = Math.max(1, voiceEnd, Math.ceil((layout.durationSeconds + data.holdSeconds) * FPS - 1e-6));

  // ── Panels ────────────────────────────────────────────────────────────────
  // The first panel opens the video whatever its cue; the last holds to the end.
  const bounds = [0, ...cueFrames.slice(1), durationInFrames];
  const length = (i: number) => bounds[i + 1]! - bounds[i]!;
  const fades = (i: number) => i > 0 && length(i - 1) > CROSSFADE && length(i) > CROSSFADE;
  const half = CROSSFADE / 2;
  const panelItems = data.panels.map((panel, i) => {
    const from = bounds[i]! - (fades(i) ? half : 0);
    const end = bounds[i + 1]! + (i + 1 < data.panels.length && fades(i + 1) ? half : 0);
    return {
      id: `panel-${i + 1}`,
      from,
      duration: end - from,
      kit: { name: "still", version: "1.0.0" },
      props: { src: { $asset: `image-${panel.assetId}` }, fit: "cover" },
      source: `panels[${i}]`,
      ...(fades(i) ? { transitionIn: { type: "crossfade" as const, duration: CROSSFADE } } : {}),
    };
  });

  // ── Captions ──────────────────────────────────────────────────────────────
  const groups: { text: string; from: number; end: number }[] = [];
  let group: typeof layout.timing.words = [];
  const close = () => {
    if (group.length === 0) return;
    groups.push({ text: group.map((w) => w.text).join(" "), from: frames(group[0]!.start), end: frames(group[group.length - 1]!.end) });
    group = [];
  };
  for (const word of layout.timing.words) {
    if (group.length > 0 && [...group, word].map((w) => w.text).join(" ").length > CAPTION_CHARACTERS) close();
    group.push(word);
    if (SENTENCE_PAUSE.test(word.text)) close();
  }
  close();
  const captionItems: Record<string, unknown>[] = [];
  groups.forEach((cue, i) => {
    const end = Math.min(cue.end, groups[i + 1]?.from ?? Infinity, durationInFrames);
    if (end <= cue.from) {
      warnings.push(`caption "${cue.text}" dropped: shorter than a frame once the next one starts`);
      return;
    }
    captionItems.push({
      id: `caption-${captionItems.length + 1}`,
      from: cue.from,
      duration: end - cue.from,
      kit: { name: data.style.captionKit.name, version: data.style.captionKit.version },
      props: { text: cue.text, position: "bottom", font: data.style.fontFamily },
      source: "narration",
    });
  });

  // ── Assets ────────────────────────────────────────────────────────────────
  const assets: EditTimeline["assets"] = {};
  for (const panel of data.panels) assets[`image-${panel.assetId}`] = { ...input.assets[`image-${panel.assetId}`]! };
  for (const piece of layout.pieces) {
    const id = `narration-${piece.take}`;
    const asset = input.assets[id];
    if (!asset) {
      return { ok: false, problems: [{ code: "missing-asset", path: "$.takes", message: `no audio asset "${id}" for take "${piece.take}"` }] };
    }
    assets[id] = { ...asset };
  }

  const tracks: EditTimeline["tracks"] = [{ id: "panels", type: "visual", z: 0, items: panelItems }];
  if (captionItems.length > 0) tracks.push({ id: "captions", type: "visual", z: 10, items: captionItems as never });
  tracks.push({ id: "voice", type: "audio", items: voiceItems });

  const timeline = {
    apiVersion: "studio.video/v1alpha2",
    kind: "EditTimeline",
    episodeRef: { ...input.spec.episodeRef },
    revision: 1,
    derivedFrom: {
      spec: { path: SPEC_PATH, hash: specHash!, revision: input.spec.revision },
      compiler: { id: compiler.id, version: compiler.version },
    },
    fps: FPS,
    durationInFrames,
    resolution: { width: profile!.width, height: profile!.height },
    profile: structuredClone(profile!),
    assets,
    tracks,
    sections: [{ id: "poem", from: 0, duration: durationInFrames, source: "title", chapter: { title: data.title } }],
    metadata: {
      builtBy: `@studio/series ${compiler.id}@${compiler.version}`,
      template: { ...input.spec.template },
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    },
  } as EditTimeline;
  return { ok: true, timeline, warnings };
}

export const compiler: SeriesCompiler = {
  id: "poetry-short",
  version: "1.0.0",
  description: "A vertical poem: pictures changing on cued words, one narration unit, captions grouped from the measured words.",
  compile,
};
```

`studio/series/scripts/golden.ts`:

```ts
// Write a released compiler's golden output — only when the version is new.
//
//   node --import tsx scripts/golden.ts poetry-short 1.0.0
//
// Refuses to overwrite: a released version's golden never changes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSpec } from "../src/index.js";

const [id, version] = process.argv.slice(2);
if (!id || !version) throw new Error("usage: golden.ts <compiler-id> <version>");
const dir = join(import.meta.dirname, "..", "fixtures", id, version);
const out = join(dir, "expected-timeline.json");
if (existsSync(out)) throw new Error(`${out} exists: a released version's golden never changes; add a new version instead`);
const result = compileSpec(JSON.parse(readFileSync(join(dir, "input.json"), "utf-8")));
if (!result.ok) throw new Error(`the fixture does not compile: ${JSON.stringify(result.problems, null, 2)}`);
writeFileSync(out, `${JSON.stringify(result.timeline, null, 2)}\n`);
console.log(`wrote ${out}`);
```

- [ ] **Step 5: Write the golden output once and check it**

```bash
cd studio/series && node --import tsx scripts/golden.ts poetry-short 1.0.0
shasum -a 256 fixtures/poetry-short/1.0.0/expected-timeline.json
```

Expected: `8fc259d76542d9166d02d9ab038a778d56776fdca53f92b1419c9ab8fcf32b97`. A different hash means the compiler differs from the reviewed prototype: compare with the behaviour tests before going on, never just accept it.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `cd studio/series && node --import tsx --test "test/**/*.test.ts" && npx tsc --noEmit`
Expected: `# pass 22`, `# fail 0`, no type errors.

- [ ] **Step 7: Wire the workspace into the repository**

1. `package.json`: in `workspaces`, add `"studio/series",` right after `"studio/contracts",` (a text edit — do not re-serialise the file, its description holds an escaped `—`).
2. `tools/build-required.mjs`: `REQUIRED` becomes
   `["packages/fal-media", "packages/video-composer", "packages/remotion-composer", "studio/series", "studio/runtime", "studio/adapters"]` (series after the composer, whose `dist/` types it compiles against).
3. `.github/workflows/ci.yml`: in the `modules` matrix add `- studio/series` after `- studio/contracts`.
4. `compose.config.json` (text edits, keep the file's formatting): after the `contracts` component's closing `},` insert

   ```json
       "series": {
         "path": "studio/series",
         "kind": "node",
         "standalone": false,
         "summary": "Series compilers: a pinned episode spec and its measured narration, compiled into an edit timeline.",
         "capabilities": [],
         "requires": {},
         "docs": "docs/studio/series.md"
       },
   ```

   and add `"series"` right after `"contracts"` in the components of the profiles `full`, `studio`, `headless` (multi-line arrays) and `blender` (one-line array).
5. `README.md`, the studio module table: after the `studio/contracts` row add
   `| \`studio/series\` | Series compilers: episode spec and narration → edit timeline |`.
6. `studio/series/README.md`:

````markdown
# @studio/series

Series compilers (ADR-0037): an episode's `episode-spec.json`, pinned to a
series template release, and its measured narration, compiled into a
`studio.video/v1alpha2` edit timeline (ADR-0034) that `@av/remotion-composer`
renders.

A series template release names its compiler —
`"compiler": { "id": "poetry-short", "version": "1.0.0" }` — and this package
is where that name is resolved. Templates are data in the library; compilers
are reviewed code in this repository. Nothing in a release is executed.

## Using it

```ts
import { compileSpec, listCompilers, resolveCompiler } from "@studio/series";

const result = compileSpec({ spec, template, narration, timings, assets, inputs });
if (result.ok) result.timeline; // passed validateEditTimeline and the composer's validateTimeline
else result.problems;           // [{ code, message, path }], paths into the input ($.data…, $.units…)
```

Compilers are **pure**: they read no file, ask no clock and keep no state.
Everything arrives already read, checked and hashed — in the studio, by
`compileEpisode` in `studio/agent/src/series-compile.ts`, which also decides
the asset ids (`image-<name>` for `assets/images/<name>.<ext>`,
`narration-<take>` for each take's audio). A timeline the validators refuse
comes back with problem codes prefixed `timeline:` — a compiler bug, not bad
input.

## Compilers

| Compiler | What it makes |
|---|---|
| `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |

## Adding a compiler or a version

- One file per version: `src/compilers/<id>/<version>.ts`, exporting
  `compiler: SeriesCompiler`, registered in `src/registry.ts`.
- A version file imports only `@studio/contracts` helpers and
  `../../types.js`. Its own helpers stay in the file, so changing a helper
  for a later version cannot reach a released one.
- Every version has a fixture, `fixtures/<id>/<version>/input.json` (a whole
  `CompileInput`), and its golden output, `expected-timeline.json`, written
  once with `node --import tsx scripts/golden.ts <id> <version>` (it refuses
  to overwrite).
- **A released version never changes.** `test/golden.test.ts` compiles every
  fixture and compares the result byte for byte; a difference — from the
  version's file or from a contract helper it calls — fails, and the fix is a
  new version file, never a new golden. An episode stays pinned to the
  version its template release names.

## Commands

```
npm run build       # tsc to dist/ (the agent imports it from there)
npm run typecheck
npm test            # golden and behaviour tests, node:test
```
````

7. Lockfile and install (main checkout only):

```bash
bun install --lockfile-only --ignore-scripts
bun install --frozen-lockfile
git diff --stat bun.lock
```

Expected `bun.lock` additions: a `"studio/series"` workspace entry (`@av/remotion-composer`, `@studio/contracts`; dev `@types/node ^24.10.0`, `tsx ^4.21.0`, `typescript ^5.9.0`), `"@studio/series": ["@studio/series@workspace:studio/series"]`, and nested `@studio/series/@types/node` entries. The install's postinstall builds `studio/series/dist`.

8. Generated docs: `npm run docs:generate` (writes `docs/studio/series.md`).

- [ ] **Step 8: Check the wiring**

Run: `npm run check:boundaries && npm run compose -- --list && npm run docs:check && npm run check --workspace @studio/series && ls studio/series/dist/index.js`
Expected: boundaries ✓; `series` listed after `contracts` in `full`, `studio`, `headless`, `blender`; docs up to date; 22 tests pass; `dist/index.js` exists.

- [ ] **Step 9: Commit**

```bash
git add studio/series package.json bun.lock tools/build-required.mjs .github/workflows/ci.yml compose.config.json README.md docs/studio/series.md
git commit -m "feat(series): compiler registry and poetry-short@1.0.0, frozen by a golden output (avg-jao.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Agent loader — `compileEpisode`

**Files:**
- Create: `studio/agent/src/series-compile.ts`
- Create: `studio/agent/tests/spec-episode.ts` (test helper, not a test file)
- Test: `studio/agent/tests/series-compile.test.ts`
- Modify: `studio/agent/package.json` (dependency), `bun.lock`

**Interfaces:**
- Consumes: `@studio/series` `compileSpec`, types `CompileAsset`, `CompileProblem`, `EditTimeline` (Task 1); `@studio/contracts/src/layout.mjs` `EPISODE_SPEC_PATH` (`"episode-spec.json"`), `SERIES_TEMPLATE_MANIFEST` (`"series-template.json"`), `seriesTemplatePath(root, channel, series, id, version)` (throws `RangeError` on a non-exact pin); `@studio/contracts/src/series-templates.mjs` `SERIES_TEMPLATE_FILES`, `validateTemplateBundle({manifest, files})`, `validateEpisodeSpec(doc, bundle)`; `validateNarrationTakes(doc)`; `validateWordTiming(doc, {audioHash})`.
- Produces: `compileEpisode(episodeDir, {episodeRef}) → {ok: true, timeline, warnings, compiler: "<id>@<version>", template: {id, version, hash}, revision} | {ok: false, problems: {code, message, path: "<file>#<json path>"}[]}`; `isSpecDriven(episodeDir): boolean`; `NARRATION_TAKES_PATH = "artifacts/narration/takes.json"`. Test helper: `specEpisode(episodeDir, episodeRef, {image?, audio?})`, `editSpec(episodeDir, change)`, `sha256(bytes)`.

- [ ] **Step 1: Add the dependency**

In `studio/agent/package.json` `dependencies`, after `"@studio/contracts": "workspace:*"` add `"@studio/series": "workspace:*"`. Then, in the main checkout:

```bash
bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile
```

Expected `bun.lock` change: `"@studio/series": "workspace:*"` in the `studio/agent` dependencies.

- [ ] **Step 2: Write the test helper and the failing tests**

`studio/agent/tests/spec-episode.ts`:

```ts
// A spec-driven episode on disk, made from @studio/series's poetry-short
// fixture: the contracts' example release copied into the series, the
// fixture's spec, two narration takes with their word timing, three images.
// Media are small placeholder files unless the caller writes real ones.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");

export const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export interface SpecEpisodeOptions {
  /** Write the image at `path` (absolute); placeholder bytes by default. */
  image?: (path: string, assetId: string) => void;
  /** Write the take's audio at `path` (absolute), `seconds` long; placeholder bytes by default. */
  audio?: (path: string, take: string, seconds: number) => void;
}

/** Lay out a complete poetry-short episode at `episodeDir` (…/series/<series>/episodes/<episode>). */
export function specEpisode(
  episodeDir: string,
  episodeRef: { channel: string; series: string; episode: string },
  options: SpecEpisodeOptions = {},
): void {
  const input = JSON.parse(readFileSync(INPUT, "utf-8"));
  const seriesDir = dirname(dirname(episodeDir));
  const write = (relative: string, content: string | Buffer) => {
    mkdirSync(dirname(join(episodeDir, relative)), { recursive: true });
    writeFileSync(join(episodeDir, relative), content);
  };

  cpSync(RELEASE, join(seriesDir, "templates", "poetry-short", "1.0.0"), { recursive: true });

  for (const panel of input.spec.data.panels as { assetId: string }[]) {
    const path = join(episodeDir, "assets", "images", `${panel.assetId}.png`);
    mkdirSync(dirname(path), { recursive: true });
    if (options.image) options.image(path, panel.assetId);
    else writeFileSync(path, `image ${panel.assetId}`);
  }

  // Each take's audio, then its timing (bound to that audio's real hash),
  // then takes.json (bound to both).
  for (const take of input.narration.takes as any[]) {
    const path = join(episodeDir, take.audio.path);
    mkdirSync(dirname(path), { recursive: true });
    if (options.audio) options.audio(path, take.id, take.audio.durationSeconds);
    else writeFileSync(path, `audio ${take.id}`);
    take.audio.hash = sha256(readFileSync(path));
    const timing = { ...input.timings[take.id], audio: { ...take.audio } };
    const timingText = `${JSON.stringify(timing, null, 2)}\n`;
    write(take.timing.path, timingText);
    take.timing.hash = sha256(timingText);
  }
  write("artifacts/narration/takes.json", `${JSON.stringify(input.narration, null, 2)}\n`);
  write("episode-spec.json", `${JSON.stringify({ ...input.spec, episodeRef }, null, 2)}\n`);
}

/** Read, change and rewrite the episode's spec (a person editing it). */
export function editSpec(episodeDir: string, change: (spec: any) => void): void {
  const path = join(episodeDir, "episode-spec.json");
  const spec = JSON.parse(readFileSync(path, "utf-8"));
  change(spec);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
}
```

`studio/agent/tests/series-compile.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileEpisode, isSpecDriven } from "../src/series-compile.js";
import { editSpec, sha256, specEpisode } from "./spec-episode.js";

/**
 * compileEpisode (avg-jao.2): everything a series compiler needs, read from
 * the episode and its series, checked, hashed, then compiled. What the
 * compiler does with it is @studio/series's tests; these pin what the loader
 * refuses before it ever runs.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "series-compile-"));
  specEpisode(dir(), REF);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const problemsOf = () => {
  const result = compileEpisode(dir(), { episodeRef: REF });
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.problems.map((p) => [p.code, p.path]);
};

describe("compileEpisode", () => {
  it("compiles a complete episode and records every file it read", () => {
    const result = compileEpisode(dir(), { episodeRef: REF });
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    expect(result.compiler).toBe("poetry-short@1.0.0");
    expect(result.revision).toBe(2);
    expect(result.timeline.durationInFrames).toBe(324);
    expect(result.timeline.profile.id).toBe("vertical-1080x1920");
    const inputs = (result.timeline.metadata as any).inputs as Record<string, string>;
    expect(Object.keys(inputs).sort()).toEqual([
      "../../templates/poetry-short/1.0.0/FORMAT.md",
      "../../templates/poetry-short/1.0.0/episode-spec.schema.json",
      "../../templates/poetry-short/1.0.0/episode-spec.template.json",
      "../../templates/poetry-short/1.0.0/series-template.json",
      "artifacts/narration/takes.json",
      "artifacts/timing/cup.json",
      "artifacts/timing/light.json",
      "assets/images/cat.png",
      "assets/images/morning-room.png",
      "assets/images/teacup.png",
      "assets/takes/cup.wav",
      "assets/takes/light.wav",
      "episode-spec.json",
    ]);
    expect(inputs["episode-spec.json"]).toBe(sha256(readFileSync(at("episode-spec.json"))));
    expect(result.timeline.derivedFrom?.spec.hash).toBe(inputs["episode-spec.json"]);
    expect(result.timeline.assets["image-teacup"]).toEqual({ path: "assets/images/teacup.png", hash: inputs["assets/images/teacup.png"], kind: "image" });
  });

  it("knows a spec-driven episode by its episode-spec.json", () => {
    expect(isSpecDriven(dir())).toBe(true);
    unlinkSync(at("episode-spec.json"));
    expect(isSpecDriven(dir())).toBe(false);
  });

  it("missing-template: the pinned release is not in the series", () => {
    editSpec(dir(), (spec) => { spec.template.version = "1.1.0"; });
    expect(problemsOf()).toEqual([["missing-template", "episode-spec.json#$.template"]]);
  });

  it("refuses a release edited in place", () => {
    appendFileSync(join(dirname(dirname(dir())), "templates/poetry-short/1.0.0/FORMAT.md"), "\nA quiet change of style.\n");
    expect(problemsOf()).toEqual([["hash-mismatch", "../../templates/poetry-short/1.0.0/series-template.json#$.files[\"FORMAT.md\"]"]]);
  });

  it("refuses a spec still holding __FILL__", () => {
    editSpec(dir(), (spec) => { spec.data.title = "__FILL__"; });
    expect(problemsOf()).toEqual([["unfilled", "episode-spec.json#$.data[\"title\"]"]]);
  });

  it("refuses a spec that is not JSON", () => {
    writeFileSync(at("episode-spec.json"), "{ half an edit");
    expect(problemsOf()).toEqual([["bad-spec", "episode-spec.json"]]);
  });

  it("refuses a spec that belongs to another episode", () => {
    editSpec(dir(), (spec) => { spec.episodeRef.episode = "evening"; });
    expect(problemsOf()).toEqual([["episode-mismatch", "episode-spec.json#$.episodeRef"]]);
  });

  it("missing-narration: no takes.json yet", () => {
    unlinkSync(at("artifacts/narration/takes.json"));
    expect(problemsOf()).toEqual([["missing-narration", "artifacts/narration/takes.json"]]);
  });

  it("missing-timing: a take whose word timing is gone", () => {
    unlinkSync(at("artifacts/timing/cup.json"));
    expect(problemsOf()).toEqual([["missing-timing", "artifacts/narration/takes.json#$.takes[1].timing.path"]]);
  });

  it("refuses a take whose audio was replaced after its timing was made", () => {
    writeFileSync(at("assets/takes/cup.wav"), "another recording");
    expect(problemsOf()).toEqual([["hash-mismatch", "artifacts/narration/takes.json#$.takes[1].audio.hash"]]);
  });

  it("refuses a timing made for another recording, even when takes.json was updated to it", () => {
    // Someone re-recorded "cup" and updated takes.json, but not the timing.
    writeFileSync(at("assets/takes/cup.wav"), "another recording");
    const takes = JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));
    takes.takes[1].audio.hash = sha256("another recording");
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(takes));
    expect(problemsOf()).toEqual([["audio-mismatch", "artifacts/timing/cup.json#$.audio.hash"]]);
  });

  it("ambiguous-asset: two files for one picture", () => {
    writeFileSync(at("assets/images/teacup.jpg"), "another teacup");
    expect(problemsOf()).toEqual([["ambiguous-asset", "assets/images/teacup.png"]]);
  });

  it("path-escape: a picture that is a link out of the episode", () => {
    const outside = join(root, "elsewhere.png");
    writeFileSync(outside, "not this episode's");
    unlinkSync(at("assets/images/cat.png"));
    symlinkSync(outside, at("assets/images/cat.png"));
    expect(problemsOf()).toEqual([["path-escape", "assets/images/cat.png"]]);
  });

  it("path-escape: a take whose audio path climbs out of the episode", () => {
    const takes = JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));
    takes.takes[0].audio.path = "../other/light.wav";
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(takes));
    expect(problemsOf()).toEqual([["path-escape", "artifacts/narration/takes.json#$.takes[0].audio.path"]]);
  });

  it("ignores hidden files and files that are not pictures in assets/images", () => {
    writeFileSync(at("assets/images/.DS_Store"), "finder");
    writeFileSync(at("assets/images/notes.txt"), "which picture goes where");
    const result = compileEpisode(dir(), { episodeRef: REF });
    expect(result.ok).toBe(true);
  });

  it("offers a picture whatever the case of its extension", () => {
    renameSync(at("assets/images/cat.png"), at("assets/images/cat.PNG"));
    const result = compileEpisode(dir(), { episodeRef: REF });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.timeline.assets["image-cat"]?.path).toBe("assets/images/cat.PNG");
  });

  it("path-escape: a release file that is a link out of the series", () => {
    const release = join(dirname(dirname(dir())), "templates/poetry-short/1.0.0");
    const outside = join(root, "FORMAT.md");
    writeFileSync(outside, readFileSync(join(release, "FORMAT.md")));
    unlinkSync(join(release, "FORMAT.md"));
    symlinkSync(outside, join(release, "FORMAT.md"));
    expect(problemsOf()).toEqual([["path-escape", "../../templates/poetry-short/1.0.0/FORMAT.md"]]);
  });

  it("names the file a compiler problem is in", () => {
    editSpec(dir(), (spec) => { spec.data.panels[1].cue = "teapot"; });
    expect(problemsOf()).toEqual([["unknown-word", "episode-spec.json#$.data.panels[1].cue"]]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd studio/agent && npx vitest run tests/series-compile.test.ts`
Expected: FAIL — cannot resolve `../src/series-compile.js`.

- [ ] **Step 4: Implement the loader**

`studio/agent/src/series-compile.ts`:

```ts
// ---------------------------------------------------------------------------
// A spec-driven episode, compiled into its edit timeline (avg-jao.2)
// ---------------------------------------------------------------------------
// An episode with an episode-spec.json is pinned to a series template release
// (ADR-0037). Its timeline is not assembled from whatever is on disk, as
// buildEditTimeline does for the others: the release's compiler, a reviewed
// and versioned piece of @studio/series, turns the spec and the measured
// narration into it. This module is the only part that touches files: it
// reads, checks and hashes everything, then hands it to the pure compiler.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compileSpec, type CompileAsset, type CompileProblem, type EditTimeline } from "@studio/series";
import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from "@studio/contracts/src/layout.mjs";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";

export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

/** Located as `<file relative to the episode>#<JSON path>`, or a bare file. */
export interface SeriesCompileProblem {
  code: string;
  message: string;
  path: string;
}

export type EpisodeCompileResult =
  | {
    ok: true;
    timeline: EditTimeline;
    warnings: string[];
    /** "<id>@<version>" of the compiler that ran. */
    compiler: string;
    template: { id: string; version: string; hash: string };
    revision: number;
  }
  | { ok: false; problems: SeriesCompileProblem[] };

/** Does this episode have a spec, and so a compiler instead of the legacy builder? */
export function isSpecDriven(episodeDir: string): boolean {
  return existsSync(join(episodeDir, EPISODE_SPEC_PATH));
}

class Stop extends Error {
  constructor(readonly problems: SeriesCompileProblem[]) {
    super(problems.map((p) => p.message).join("; "));
  }
}
const stop = (code: string, path: string, message: string): never => {
  throw new Stop([{ code, path, message }]);
};
const at = (file: string, problems: { code: string; message: string; path?: string }[]) =>
  problems.map((p) => ({ code: p.code, message: p.message, path: `${file}#${p.path ?? "$"}` }));
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * Compile the episode's spec. Reads files only; writes nothing. Every file
 * read is in the timeline's `metadata.inputs` with its hash, keyed by its
 * path relative to the episode (release files as ../../templates/…).
 */
export function compileEpisode(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string } },
): EpisodeCompileResult {
  try {
    return compile(resolve(episodeDir), options.episodeRef);
  } catch (error) {
    if (error instanceof Stop) return { ok: false, problems: error.problems };
    throw error;
  }
}

function compile(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }): EpisodeCompileResult {
  const seriesDir = dirname(dirname(episodeDir));
  const inputs: Record<string, string> = {};

  /** Read a file that must stay inside `within` once symlinks are followed. */
  const read = (file: string, within: string, missing: () => never): Buffer => {
    const key = relative(episodeDir, file).split(sep).join("/");
    if (!existsSync(file)) return missing();
    const real = realpathSync(file);
    const root = realpathSync(within);
    if (real !== root && !real.startsWith(root + sep)) {
      stop("path-escape", key, `${key} leads outside ${within === episodeDir ? "the episode" : "the series"} (${real})`);
    }
    const bytes = readFileSync(real);
    inputs[key] = sha256(bytes);
    return bytes;
  };
  const inEpisode = (path: string, where: string) => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) stop("path-escape", where, `${path} is not a path inside the episode`);
    return join(episodeDir, path);
  };

  // ── The spec and its pinned release ───────────────────────────────────────
  const specBytes = read(join(episodeDir, EPISODE_SPEC_PATH), episodeDir, () => stop("missing-spec", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} is missing`));
  let spec: any;
  try {
    spec = JSON.parse(specBytes.toString("utf-8"));
  } catch (error) {
    return stop("bad-spec", EPISODE_SPEC_PATH, `${EPISODE_SPEC_PATH} is not JSON: ${(error as Error).message}`);
  }
  const pin = spec?.template;
  let releaseDir: string;
  try {
    releaseDir = seriesTemplatePath(dirname(dirname(dirname(seriesDir))), basename(dirname(dirname(seriesDir))), basename(seriesDir), pin?.id, pin?.version);
  } catch (error) {
    return stop("bad-spec", `${EPISODE_SPEC_PATH}#$.template`, `the spec does not pin an exact template release: ${(error as Error).message}`);
  }
  const releaseKey = relative(episodeDir, releaseDir).split(sep).join("/");
  if (!existsSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST))) {
    stop("missing-template", `${EPISODE_SPEC_PATH}#$.template`, `the pinned release ${pin.id}@${pin.version} is not in this series (${releaseKey})`);
  }
  const text = (name: string) => read(join(releaseDir, name), seriesDir, () => stop("missing-template", `${releaseKey}/${name}`, `${releaseKey}/${name} is missing`)).toString("utf-8");
  const bundle = {
    manifest: text(SERIES_TEMPLATE_MANIFEST),
    files: Object.fromEntries(Object.values(SERIES_TEMPLATE_FILES).map((name) => [name, text(name)])),
  };
  const bundleProblems = validateTemplateBundle(bundle);
  if (bundleProblems.length > 0) throw new Stop(at(`${releaseKey}/${SERIES_TEMPLATE_MANIFEST}`, bundleProblems));
  const specProblems = validateEpisodeSpec(spec, bundle);
  if (specProblems.length > 0) throw new Stop(at(EPISODE_SPEC_PATH, specProblems));
  if (JSON.stringify(spec.episodeRef) !== JSON.stringify({ channel: episodeRef.channel, series: episodeRef.series, episode: episodeRef.episode })) {
    stop("episode-mismatch", `${EPISODE_SPEC_PATH}#$.episodeRef`,
      `the spec belongs to ${spec.episodeRef.channel}/${spec.episodeRef.series}/${spec.episodeRef.episode}, not this episode`);
  }
  const template = JSON.parse(bundle.manifest);

  // ── Narration takes and their timing ──────────────────────────────────────
  const takesBytes = read(join(episodeDir, NARRATION_TAKES_PATH), episodeDir,
    () => stop("missing-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is missing: record and verify the narration takes first`));
  let narration: any;
  try {
    narration = JSON.parse(takesBytes.toString("utf-8"));
  } catch (error) {
    return stop("bad-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is not JSON: ${(error as Error).message}`);
  }
  const takesProblems = validateNarrationTakes(narration);
  if (takesProblems.length > 0) throw new Stop(at(NARRATION_TAKES_PATH, takesProblems));

  const assets: Record<string, CompileAsset> = {};
  const timings: Record<string, any> = {};
  (narration.takes as any[]).forEach((take, i) => {
    const where = `${NARRATION_TAKES_PATH}#$.takes[${i}]`;
    const audio = read(inEpisode(take.audio.path, `${where}.audio.path`), episodeDir,
      () => stop("missing-asset", `${where}.audio.path`, `take "${take.id}": ${take.audio.path} is missing`));
    if (sha256(audio) !== take.audio.hash) {
      stop("hash-mismatch", `${where}.audio.hash`, `take "${take.id}": ${take.audio.path} is not the audio the take recorded`);
    }
    assets[`narration-${take.id}`] = { path: take.audio.path, hash: take.audio.hash, kind: "audio" };
    if (!take.timing) stop("missing-timing", `${where}.timing`, `take "${take.id}" has no word timing: align it first`);
    const timingBytes = read(inEpisode(take.timing.path, `${where}.timing.path`), episodeDir,
      () => stop("missing-timing", `${where}.timing.path`, `take "${take.id}": ${take.timing.path} is missing`));
    if (sha256(timingBytes) !== take.timing.hash) {
      stop("hash-mismatch", `${where}.timing.hash`, `take "${take.id}": ${take.timing.path} changed since the take recorded it`);
    }
    let timing: unknown;
    try {
      timing = JSON.parse(timingBytes.toString("utf-8"));
    } catch (error) {
      return stop("bad-timing", take.timing.path, `${take.timing.path} is not JSON: ${(error as Error).message}`);
    }
    const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
    if (timingProblems.length > 0) throw new Stop(at(take.timing.path, timingProblems));
    timings[take.id] = timing;
  });

  // ── Images ────────────────────────────────────────────────────────────────
  // Every picture in assets/images is offered as image-<name>; the compiler
  // says which it needs. Two files with one name is a choice nobody made.
  const imagesDir = join(episodeDir, "assets", "images");
  const images = existsSync(imagesDir)
    ? readdirSync(imagesDir).filter((f) => !f.startsWith(".") && IMAGE_EXTENSIONS.includes(extname(f).toLowerCase())).sort()
    : [];
  for (const file of images) {
    const id = `image-${file.slice(0, -extname(file).length)}`;
    const path = `assets/images/${file}`;
    if (assets[id]) stop("ambiguous-asset", path, `${assets[id].path} and ${path} are both ${id.slice(6)}: keep one`);
    read(join(episodeDir, path), episodeDir, () => stop("missing-asset", path, `${path} is missing`));
    assets[id] = { path, hash: inputs[path]!, kind: "image" };
  }

  // ── Compile ───────────────────────────────────────────────────────────────
  const result = compileSpec({ spec, template, narration, timings, assets, inputs });
  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
  return {
    ok: true,
    timeline: result.timeline,
    warnings: result.warnings,
    compiler: `${template.compiler.id}@${template.compiler.version}`,
    template: { ...spec.template },
    revision: spec.revision,
  };
}

/** A compiler's paths point into its input; name the file each one is in. */
function locate(problem: CompileProblem, releaseKey: string): SeriesCompileProblem {
  const { path } = problem;
  const file = path.startsWith("$.data") || path.startsWith("$.episodeRef") ? EPISODE_SPEC_PATH
    : path.startsWith("$.units") || path.startsWith("$.takes") ? NARRATION_TAKES_PATH
    : path.startsWith("$.template") ? `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}`
    : problem.code.startsWith("timeline:") ? "artifacts/edit-timeline.json"
    : null;
  const inFile = path.startsWith("$.template") ? path.replace(/^\$\.template/, "$") : path;
  return { code: problem.code, message: problem.message, path: file ? `${file}#${inFile}` : path };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd studio/agent && npx vitest run tests/series-compile.test.ts && npx tsc --noEmit`
Expected: 18 passed; no type errors.

- [ ] **Step 6: Commit**

```bash
git add studio/agent/package.json bun.lock studio/agent/src/series-compile.ts studio/agent/tests/spec-episode.ts studio/agent/tests/series-compile.test.ts
git commit -m "feat(agent): load, check and compile a spec-driven episode (avg-jao.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tools — the compiler as the timeline producer of spec-driven episodes

**Files:**
- Modify: `studio/agent/src/episode-render.ts` (whole file below)
- Modify: `studio/agent/src/capability-tools.ts` (`pva_build_timeline`, `pva_compose_video`, `profileParam`)
- Test: `studio/agent/tests/compose-spec.test.ts`, `studio/agent/tests/compose-spec.e2e.test.ts`

**Interfaces:**
- Consumes: `compileEpisode`, `isSpecDriven` (Task 2); `buildEditTimeline`, `BuildOptions`, `BuildProblem`, `EditTimelineDoc`, `DEFAULT_PROFILE`, `EDIT_TIMELINE_PATH` from `./edit-timeline-builder.js` (unchanged).
- Produces: `CompiledBy { compiler: string; template: {id, version, hash}; revision: number }`; `WrittenTimeline.compiledBy` and `EpisodeRender.compiledBy` (`CompiledBy | null`); render report field `compiledBy` (only for compiled timelines); problem `profile-fixed-by-template` at `episode-spec.json#$.template`.

- [ ] **Step 1: Write the failing tests**

`studio/agent/tests/compose-spec.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { editSpec, specEpisode } from "./spec-episode.js";

/**
 * pva_build_timeline and pva_compose_video on an episode with an
 * episode-spec.json (avg-jao.2): the timeline comes from the template's
 * compiler, never from the legacy builder. The render is a fake, as in
 * compose-video.test.ts.
 */

const renders: Array<{ timeline: any; outputPath: string }> = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      renders.push({ timeline: options.timeline, outputPath: options.outputPath });
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: `sha256:${"0".repeat(64)}`,
        kits: [{ name: "still", version: "1.0.0" }],
        profile: options.timeline.profile.id,
        loudness: null,
        cache: { wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 1, totalSegments: 1, warnings: [] },
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const readJson = (relative: string) => JSON.parse(readFileSync(at(relative), "utf-8"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-compose-spec-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  renders.length = 0;
  specEpisode(dir(), REF);
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function tool(name: string, params: Record<string, unknown> = {}) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get(name)!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_build_timeline on a spec-driven episode", () => {
  it("compiles the spec with its template's compiler and says so", async () => {
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toMatch(/artifacts\/edit-timeline\.json: 3 panels, 3 captions, 10\.8s, vertical-1080x1920/);
    expect(text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2 \(template poetry-short@1\.0\.0\)/);
    const timeline = readJson("artifacts/edit-timeline.json");
    expect(timeline.derivedFrom.compiler).toEqual({ id: "poetry-short", version: "1.0.0" });
    expect(timeline.metadata.builtBy).toBe("@studio/series poetry-short@1.0.0");
  });

  it("lists what is wrong with the spec and writes nothing, never falling back to the legacy builder", async () => {
    // Scene-named images would satisfy the legacy builder: it must not be asked.
    writeFileSync(at("assets/images/s1.png"), "a legacy scene");
    editSpec(dir(), (spec) => { spec.data.panels[1].cue = "teapot"; });
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown-word at episode-spec\.json#\$\.data\.panels\[1\]\.cue/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });

  it("refuses another profile than the template's, and accepts the same one", async () => {
    const other = await tool("pva_build_timeline", { profile: "youtube-1920x1080" });
    expect(other.isError).toBe(true);
    expect(other.content[0].text).toMatch(/profile-fixed-by-template/);
    expect(other.content[0].text).toMatch(/renders vertical-1080x1920, not youtube-1920x1080/);
    const same = await tool("pva_build_timeline", { profile: "vertical-1080x1920" });
    expect(same.isError).toBeFalsy();
  });
});

describe("pva_compose_video on a spec-driven episode", () => {
  it("compiles a missing timeline, renders its template's profile and records the compiler in the report", async () => {
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2/);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.timeline.profile.id).toBe("vertical-1080x1920");
    const current = readJson("output/current.json");
    const report = readJson(`output/${current.renderId}.report.json`);
    expect(report.compiledBy).toEqual({
      compiler: "poetry-short@1.0.0",
      template: readJson("episode-spec.json").template,
      revision: 2,
    });
  });

  it("refuses to render another profile than the template's, and renders nothing", async () => {
    const result = await tool("pva_compose_video", { profile: "youtube-1920x1080" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/profile-fixed-by-template/);
    expect(renders).toHaveLength(0);
  });

  it("recompiles after the spec is edited, and names the spec as the reason", async () => {
    await tool("pva_build_timeline");
    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; spec.revision = 3; });
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/timeline rebuilt: episode-spec\.json changed/);
    expect(renders.at(-1)!.timeline.durationInFrames).toBe(279);
    expect(readJson("artifacts/edit-timeline.json").derivedFrom.spec.revision).toBe(3);
  });

  it("renders a hand-edited timeline as it stands when its inputs did not change", async () => {
    await tool("pva_build_timeline");
    const timeline = readJson("artifacts/edit-timeline.json");
    timeline.tracks.find((t: any) => t.id === "captions").items[0].props.text = "Light falls across the room.";
    const edited = `${JSON.stringify(timeline, null, 2)}\n`;
    writeFileSync(at("artifacts/edit-timeline.json"), edited);
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/rendered artifacts\/edit-timeline\.json as it stands/);
    expect(renders.at(-1)!.timeline.tracks.find((t: any) => t.id === "captions").items[0].props.text).toBe("Light falls across the room.");
    expect(readFileSync(at("artifacts/edit-timeline.json"), "utf-8")).toBe(edited);
  });

  it("refuses to render while the spec does not compile, even with a valid timeline from before", async () => {
    await tool("pva_build_timeline");
    editSpec(dir(), (spec) => { spec.data.title = "__FILL__"; });
    const result = await tool("pva_compose_video");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unfilled/);
    expect(renders).toHaveLength(0);
    expect(existsSync(at("output/current.json"))).toBe(false);
  });
});
```

`studio/agent/tests/compose-spec.e2e.test.ts` (runs only with `REMOTION_E2E=1`):

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "./spec-episode.js";

/**
 * A spec-driven episode rendered for real (avg-jao.2): poetry-short@1.0.0
 * compiles the fixture's spec, Remotion renders it, loudness is normalised.
 * Only with REMOTION_E2E=1, as compose-video.e2e.test.ts.
 */

const enabled = process.env.REMOTION_E2E === "1";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
const COLOURS: Record<string, string> = { "morning-room": "0x600000", teacup: "0x006000", cat: "0x000060" };

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

describe.skipIf(!enabled)("composing a spec-driven episode", () => {
  let root: string;
  let previousRoot: string | undefined;
  const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-compose-spec-e2e-"));
    previousRoot = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
    specEpisode(dir(), REF, {
      image: (path, assetId) => ffmpeg(["-f", "lavfi", "-i", `color=c=${COLOURS[assetId]}:s=720x1280`, "-frames:v", "1", path]),
      audio: (path, _take, seconds) => ffmpeg(["-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`, "-af", "volume=0.3",
        "-ar", "48000", "-ac", "1", path]),
    });
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  const probe = (file: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf-8" }).stdout);

  /** The dominant channel of the top half of the frame shown at `seconds`. */
  function channelAt(file: string, seconds: number): "r" | "g" | "b" {
    const out = spawnSync("ffmpeg", ["-v", "quiet", "-ss", String(seconds), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw:ih/2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" }).stdout;
    const [r, g, b] = out;
    if (r! >= g! && r! >= b!) return "r";
    return g! >= b! ? "g" : "b";
  }

  /** The brightest luma in the bottom third of the frame at `seconds` (white caption text is near 235). */
  function bottomBrightness(file: string, seconds: number): number {
    const out = spawnSync("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw:ih/3:0:2*ih/3,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf-8" }).stdout;
    return Number(/lavfi\.signalstats\.YMAX=(\d+)/.exec(out)?.[1]);
  }

  function loudness(file: string): number {
    const err = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf-8" }).stderr;
    return Number(JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1)).input_i);
  }

  it("renders 1080x1920 at -14 LUFS, pictures on their cues, captions while the voice speaks", async () => {
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
    registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
    const result = await tools.get("pva_compose_video")!.execute("call-1", { ...REF }, undefined, undefined, undefined);
    if (result.isError) throw new Error(result.content[0].text);
    const current = JSON.parse(readFileSync(join(dir(), "output", "current.json"), "utf-8"));
    const out = join(dir(), "output", current.path);

    const video = probe(out).streams.find((s: any) => s.codec_type === "video");
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(Number(video.nb_frames)).toBe(324);
    // "cup" at frame 97, "cat" at frame 205; the last panel holds to the end.
    expect([channelAt(out, 1), channelAt(out, 5), channelAt(out, 9), channelAt(out, 10.6)]).toEqual(["r", "g", "b", "b"]);
    // A caption from 0.1 s to 2.4 s; none in the 1.5 s hold at the end.
    expect(bottomBrightness(out, 1.5)).toBeGreaterThan(200);
    expect(bottomBrightness(out, 10.5)).toBeLessThan(100);
    expect(Math.abs(loudness(out) + 14)).toBeLessThanOrEqual(1);
  });
}, 300_000);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/agent && npx vitest run tests/compose-spec.test.ts`
Expected: FAIL — the legacy builder answers (`no-scenes`), no `compiled by` line, no `profile-fixed-by-template`.

- [ ] **Step 3: Choose the producer per episode in `episode-render.ts`**

Replace `studio/agent/src/episode-render.ts` with:

```ts
// ---------------------------------------------------------------------------
// Rendering an episode through its edit timeline (avg-tk7.6, ADR-0036)
// ---------------------------------------------------------------------------
// `artifacts/edit-timeline.json` is the reviewable account of a render. It is
// rebuilt from the episode's material when that material changed, and is
// otherwise rendered exactly as it stands — a hand edit, on the web or on
// disk, is never overwritten. Renders are immutable: output/<render-id>.mp4
// with a sibling report, and output/current.json moved last.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderTimeline, type RenderResult } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import {
  buildEditTimeline,
  DEFAULT_PROFILE,
  EDIT_TIMELINE_PATH,
  type BuildOptions,
  type BuildProblem,
  type EditTimelineDoc,
} from "./edit-timeline-builder.js";
import { compileEpisode, isSpecDriven } from "./series-compile.js";

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const describe = (problems: BuildProblem[]) => problems.map((p) => `${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`).join("; ");

/** The timeline cannot be built or used; `problems` say why. */
export class TimelineBuildError extends Error {
  constructor(readonly problems: BuildProblem[], lead = "the edit timeline cannot be built") {
    super(`${lead}: ${describe(problems)}`);
    this.name = "TimelineBuildError";
  }
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const serialize = (timeline: unknown) => `${JSON.stringify(timeline, null, 2)}\n`;

let temporaries = 0;

/** Write through a temporary file, so no reader ever sees half a document. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${temporaries++}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

/**
 * Write a new timeline. A different one already there — possibly a person's
 * edit — is kept first as artifacts/edit-timeline.<hash8>.bak.json, whose path
 * is returned so the caller can say where it went.
 */
function replaceTimeline(episodeDir: string, text: string): string | null {
  const path = join(episodeDir, EDIT_TIMELINE_PATH);
  let backup: string | null = null;
  if (existsSync(path)) {
    const previous = readFileSync(path);
    if (!previous.equals(Buffer.from(text, "utf-8"))) {
      backup = EDIT_TIMELINE_PATH.replace(/\.json$/, `.${sha256(previous).slice(0, 8)}.bak.json`);
      copyFileSync(path, join(episodeDir, backup));
    }
  }
  writeAtomically(path, text);
  return backup;
}

/** How a spec-driven timeline was made; absent for the legacy builder's. */
export interface CompiledBy {
  /** "<id>@<version>" of the series compiler. */
  compiler: string;
  template: { id: string; version: string; hash: string };
  revision: number;
}

type Produced =
  | { ok: true; timeline: EditTimelineDoc; warnings: string[]; compiledBy: CompiledBy | null }
  | { ok: false; problems: BuildProblem[] };

/**
 * The episode's timeline as its material says it should be: compiled from
 * episode-spec.json by the release's compiler when there is a spec, built by
 * buildEditTimeline otherwise. A spec that does not compile is never
 * replaced by the legacy builder's guess.
 */
function produceTimeline(episodeDir: string, options: BuildOptions): Produced {
  if (!isSpecDriven(episodeDir)) {
    const built = buildEditTimeline(episodeDir, options);
    return built.ok ? { ...built, compiledBy: null } : built;
  }
  const compiled = compileEpisode(episodeDir, { episodeRef: options.episodeRef });
  if (!compiled.ok) return compiled;
  const fixed = compiled.timeline.profile.id;
  if (options.profile !== undefined && options.profile !== fixed) {
    return {
      ok: false,
      problems: [{
        code: "profile-fixed-by-template",
        path: "episode-spec.json#$.template",
        message: `this episode's template ${compiled.template.id}@${compiled.template.version} renders ${fixed}, not ${options.profile}`,
      }],
    };
  }
  const { compiler, template, revision } = compiled;
  return {
    ok: true,
    timeline: compiled.timeline as unknown as EditTimelineDoc,
    warnings: compiled.warnings,
    compiledBy: { compiler, template, revision },
  };
}

export interface WrittenTimeline {
  timeline: EditTimelineDoc;
  /** Set when a series compiler made it from episode-spec.json. */
  compiledBy: CompiledBy | null;
  /** sha256 hex of the file as written. */
  hash: string;
  warnings: string[];
  /** Where a different previous timeline was kept, if one was replaced. */
  backup: string | null;
}

/** Build the timeline and write it to artifacts/edit-timeline.json. */
export function writeEditTimeline(episodeDir: string, options: BuildOptions): WrittenTimeline {
  const built = produceTimeline(episodeDir, options);
  if (!built.ok) throw new TimelineBuildError(built.problems);
  const text = serialize(built.timeline);
  const backup = replaceTimeline(episodeDir, text);
  return { timeline: built.timeline, compiledBy: built.compiledBy, hash: sha256(text), warnings: built.warnings, backup };
}

export interface CurrentTimeline extends WrittenTimeline {
  /** Why it was rebuilt, or null when the timeline on disk was used as it is. */
  rebuilt: string | null;
}

/**
 * The timeline to render: the one on disk when it still describes the
 * episode's material and the profile asked for, otherwise a fresh one.
 */
export function currentEditTimeline(episodeDir: string, options: BuildOptions): CurrentTimeline {
  const path = join(episodeDir, EDIT_TIMELINE_PATH);
  let stored: { text: string; doc: any } | null = null;
  if (existsSync(path)) {
    const text = readFileSync(path, "utf-8");
    try {
      stored = { text, doc: JSON.parse(text) };
    } catch (error) {
      // Possibly a person's edit, half done: never rebuild over it.
      throw new TimelineBuildError(
        [{ code: "bad-timeline", path: EDIT_TIMELINE_PATH, message: `not JSON (${(error as Error).message}); fix it, or delete it to rebuild` }],
        `${EDIT_TIMELINE_PATH} is not JSON`,
      );
    }
  }

  const storedProfile: string | undefined = stored?.doc?.profile?.id;
  const profileChange = options.profile !== undefined && options.profile !== storedProfile;
  // A spec-driven episode's profile is its template's. Otherwise a stored
  // profile outside the catalog (a hand edit) cannot be rebuilt; comparing
  // inputs does not need it.
  const specDriven = isSpecDriven(episodeDir);
  const profile = specDriven
    ? options.profile
    : options.profile ?? (storedProfile && outputProfile(storedProfile) ? storedProfile : DEFAULT_PROFILE);
  const fresh = produceTimeline(episodeDir, { ...options, profile });
  const storedProblems = stored ? validateEditTimeline(stored.doc) : [];

  if (!fresh.ok) {
    // A spec that no longer compiles is an edit to finish, not a reason to
    // render the timeline it replaced.
    if (stored && !specDriven && !profileChange && storedProblems.length === 0) {
      return {
        timeline: stored.doc,
        hash: sha256(stored.text),
        warnings: [`the episode could not be rebuilt (${describe(fresh.problems)}); rendering it as it stands`],
        compiledBy: null,
        rebuilt: null,
        backup: null,
      };
    }
    throw new TimelineBuildError(fresh.problems);
  }

  let reason: string | null = null;
  if (!stored) reason = "there was no timeline yet";
  else if (profileChange) reason = `the profile changed from ${storedProfile ?? "none"} to ${options.profile}`;
  else {
    const before: Record<string, string> = stored.doc?.metadata?.inputs ?? {};
    const after = fresh.timeline.metadata.inputs;
    const changes = [
      ...Object.keys(after).filter((p) => p in before && before[p] !== after[p]).map((p) => `${p} changed`),
      ...Object.keys(after).filter((p) => !(p in before)).map((p) => `${p} added`),
      ...Object.keys(before).filter((p) => !(p in after)).map((p) => `${p} removed`),
    ];
    if (changes.length > 0) reason = changes.join(", ");
  }

  if (reason === null && stored) {
    if (storedProblems.length > 0) {
      throw new TimelineBuildError(storedProblems, `${EDIT_TIMELINE_PATH} as it stands is not valid; fix the edit, or delete the file to rebuild`);
    }
    return { timeline: stored.doc, compiledBy: fresh.compiledBy, hash: sha256(stored.text), warnings: fresh.warnings, rebuilt: null, backup: null };
  }
  const text = serialize(fresh.timeline);
  const backup = replaceTimeline(episodeDir, text);
  return { timeline: fresh.timeline, compiledBy: fresh.compiledBy, hash: sha256(text), warnings: fresh.warnings, rebuilt: reason, backup };
}

export interface EpisodeRenderOptions extends BuildOptions {
  /** Lowercase kebab-case; the render id starts with it. */
  label?: string;
  onProgress?: (progress: number) => void;
}

export interface EpisodeRender {
  renderId: string;
  outputPath: string;
  reportPath: string;
  rebuilt: string | null;
  backup: string | null;
  warnings: string[];
  compiledBy: CompiledBy | null;
  result: RenderResult;
}

/**
 * Render the episode's current timeline to output/<render-id>.mp4.
 *
 * The video is written beside its final name and renamed when complete; the
 * report follows; output/current.json moves last. A failure leaves output/
 * as it was. The caller serialises renders of one episode (current.json).
 */
export async function renderEpisode(episodeDir: string, options: EpisodeRenderOptions): Promise<EpisodeRender> {
  const label = options.label ?? "render";
  if (!LABEL.test(label)) throw new Error(`label "${label}" must be lowercase kebab-case`);
  const current = currentEditTimeline(episodeDir, options);

  const outputDir = join(episodeDir, "output");
  mkdirSync(outputDir, { recursive: true });
  const renderId = `${label}-${Date.now()}-${current.hash.slice(0, 8)}`;
  const outputPath = join(outputDir, `${renderId}.mp4`);
  const partialPath = join(outputDir, `.${renderId}.partial.mp4`);
  const reportPath = join(outputDir, `${renderId}.report.json`);

  let result: RenderResult;
  try {
    result = await renderTimeline({
      timeline: current.timeline,
      assetRoot: episodeDir,
      cacheDir: join(episodeDir, ".cache", "remotion"),
      outputPath: partialPath,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    renameSync(partialPath, outputPath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
  result = { ...result, path: outputPath };

  writeAtomically(reportPath, serialize({
    renderId,
    createdAt: new Date().toISOString(),
    timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${current.hash}` },
    ...(current.compiledBy ? { compiledBy: current.compiledBy } : {}),
    ...(current.rebuilt ? { rebuilt: current.rebuilt } : {}),
    ...(current.warnings.length > 0 ? { warnings: current.warnings } : {}),
    render: { ...result, path: `${renderId}.mp4` },
  }));
  writeAtomically(join(outputDir, "current.json"), serialize({ renderId, path: `${renderId}.mp4` }));

  return {
    renderId,
    outputPath,
    reportPath,
    rebuilt: current.rebuilt,
    backup: current.backup,
    warnings: current.warnings,
    compiledBy: current.compiledBy,
    result,
  };
}
```

What changed from tk7.6, for the reviewer: `produceTimeline` (compiler when `isSpecDriven`, else `buildEditTimeline`; `profile-fixed-by-template`); `currentEditTimeline` passes the template's profile through untouched for a spec-driven episode and never renders a stored timeline when its spec fails; `compiledBy` travels through `WrittenTimeline`, `CurrentTimeline`, `EpisodeRender` and the report.

- [ ] **Step 4: Say it in the tools (`capability-tools.ts`)**

Apply exactly this diff:

```diff
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index 48728a1..fc82e41 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -891,13 +891,13 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
   // in artifacts/, rendered by @av/remotion-composer. No FFmpeg runs here.
 
   const profileParam = Type.Optional(Type.String({
-    description: "Output profile id: youtube-1920x1080 (default) or vertical-1080x1920",
+    description: "Output profile id: youtube-1920x1080 (default) or vertical-1080x1920. An episode with episode-spec.json renders its template's profile.",
   }));
 
   pi.registerTool({
     name: "pva_build_timeline",
     label: "Build Edit Timeline",
-    description: `Build the episode's edit timeline (${EDIT_TIMELINE_PATH}) from its scene images, timing and narration: the reviewable account of what pva_compose_video will render.`,
+    description: `Build the episode's edit timeline (${EDIT_TIMELINE_PATH}): compiled from episode-spec.json by its series template's compiler when the episode has a spec, otherwise from its scene images, timing and narration. The reviewable account of what pva_compose_video will render.`,
     parameters: Type.Object({
       channel: Type.String({ description: "Channel slug" }),
       series: Type.String({ description: "Series slug" }),
@@ -909,16 +909,21 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
         const dir = episodeDir(params.channel, params.series, params.episode);
         const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
         // Queued with pva_compose_video, which may rebuild the same file.
-        const { timeline, warnings, backup } = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
+        const { timeline, warnings, backup, compiledBy } = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
           writeEditTimeline(dir, { episodeRef, ...(params.profile ? { profile: params.profile } : {}) }));
         const count = (id: string) => timeline.tracks.find((t) => t.id === id)?.items.length ?? 0;
+        // The picture track is the lowest visual one: "scenes" from the legacy builder, "panels" from a compiler.
+        const picture = timeline.tracks.filter((t) => t.type === "visual").sort((a, b) => Number(a.z) - Number(b.z))[0];
         const lines = [
-          `✅ ${EDIT_TIMELINE_PATH}: ${count("scenes")} scenes, ${count("captions")} captions, `
+          `✅ ${EDIT_TIMELINE_PATH}: ${picture?.items.length ?? 0} ${picture?.id ?? "scenes"}, ${count("captions")} captions, `
             + `${(timeline.durationInFrames / timeline.fps).toFixed(1)}s, ${timeline.profile.id}`,
+          ...(compiledBy
+            ? [`compiled by ${compiledBy.compiler} from episode-spec.json revision ${compiledBy.revision} (template ${compiledBy.template.id}@${compiledBy.template.version})`]
+            : []),
           ...(backup ? [`previous timeline kept as ${backup}`] : []),
           ...warnings.map((w) => `⚠️ ${w}`),
         ];
-        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { path: EDIT_TIMELINE_PATH, timeline, warnings } as Record<string, unknown> };
+        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { path: EDIT_TIMELINE_PATH, timeline, warnings, compiledBy } as Record<string, unknown> };
       } catch (err) {
         return {
           content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
@@ -955,6 +960,7 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
           const lines = [
             `✅ output/${render.renderId}.mp4 — ${render.result.durationSeconds.toFixed(1)}s, ${mb}MB, ${render.result.profile}`,
             ...(render.rebuilt ? [`timeline rebuilt: ${render.rebuilt}`] : [`rendered ${EDIT_TIMELINE_PATH} as it stands`]),
+            ...(render.compiledBy ? [`compiled by ${render.compiledBy.compiler} from episode-spec.json revision ${render.compiledBy.revision}`] : []),
             ...(render.backup ? [`previous timeline kept as ${render.backup}`] : []),
             ...render.warnings.map((w) => `⚠️ ${w}`),
           ];
```

- [ ] **Step 5: Run the tests, the old ones too, and the typecheck**

Run: `cd studio/agent && npx vitest run tests/compose-spec.test.ts tests/compose-video.test.ts tests/edit-timeline-builder.test.ts tests/series-compile.test.ts && npx tsc --noEmit`
Expected: all pass (8 + 14 + 14 + 18); the legacy reply still reads `2 scenes, 0 captions, 5.0s, youtube-1920x1080`.

- [ ] **Step 6: Render for real**

Run: `cd studio/agent && REMOTION_E2E=1 npx vitest run tests/compose-spec.e2e.test.ts tests/compose-video.e2e.test.ts`
Expected: 3 passed (the spec-driven one: 1080×1920, 324 frames, red/green/blue on their cues, a caption at 1.5 s and none at 10.5 s, −14 ±1 LUFS). Takes about a minute; Remotion may download headless Chrome first.

- [ ] **Step 7: Commit**

```bash
git add studio/agent/src/episode-render.ts studio/agent/src/capability-tools.ts studio/agent/tests/compose-spec.test.ts studio/agent/tests/compose-spec.e2e.test.ts
git commit -m "feat(agent): spec-driven episodes are compiled, never built from scene images (avg-jao.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ADRs, skill, full check

**Files:**
- Modify: `docs/adr/0037-series-templates-pin-editorial-standards.md`, `docs/adr/0036-the-studio-renders-episodes-through-the-edit-timeline.md`, `skills/studio/compose-video.md`

- [ ] **Step 1: ADR-0037**

Replace the Status paragraph

````markdown
Proposed for review with `avg-jao.1`. The contract and pure validation helpers
are implemented in `studio/contracts`. Compiler integration is `avg-jao.2`;
series-specific validator hooks are `avg-jao.3`. This does not change what
`pva_compose_video` currently renders.
````

with

````markdown
Accepted. The contract and pure validation helpers are implemented in
`studio/contracts` (`avg-jao.1`). The compiler seat is `@studio/series`
(`avg-jao.2`): a registry of versioned, pure compilers, each frozen by a
golden output, with `poetry-short@1.0.0` the first; the agent's
`compileEpisode` loads and checks a spec-driven episode, and
`pva_build_timeline`/`pva_compose_video` use it whenever an episode has an
`episode-spec.json`. Series-specific validator hooks are `avg-jao.3`.
````

and the paragraph

````markdown
The compiler consumes the spec plus measured timing/source pins and produces
the existing typed timeline with spec/compiler provenance (ADR-0034). Until
`avg-jao.2` switches the consumer, ADR-0036's current timeline construction
and hand-edit preservation remain untouched.
````

with

````markdown
The compiler consumes the spec plus measured timing/source pins and produces
the existing typed timeline with spec/compiler provenance (ADR-0034):
`derivedFrom` names the spec's hash and revision and the compiler's id and
version, and `metadata.inputs` the hash of every file read. A released
compiler version is frozen by its golden output — a fixture must compile to
a byte-identical timeline — so a change in behaviour, even one coming from a
shared contract helper, is a new version. An episode with a spec is always
compiled; it never falls back to ADR-0036's builder, whose hand-edit
preservation applies to compiled timelines too.
````

- [ ] **Step 2: ADR-0036**

After the Decision bullet ending "`remotion-composer` is the default `video.compose` provider in every profile that composes the agent." add:

````markdown

**Note (`avg-jao.2`, ADR-0037).** The timeline now has two producers, chosen by
the episode itself: an episode with an `episode-spec.json` is compiled by its
series template's compiler (`@studio/series`), and its profile is the
template's; one without is built as above. A spec that does not compile is an
error — never a reason to fall back to the builder or to render the timeline
it was meant to replace. Rebuilding on changed inputs and rendering hand
edits as they stand work the same for both.
````

- [ ] **Step 3: The compose-video skill**

In `skills/studio/compose-video.md`: front matter `version: "0.2.0"` → `version: "0.3.0"`; replace the heading `## What the timeline holds` with:

````markdown
## Episodes with a spec

An episode with an `episode-spec.json` is pinned to a series template release
(ADR-0037), and its timeline is **compiled** by the compiler that release names
(`poetry-short@1.0.0`, …) from the spec, `artifacts/narration/takes.json` and
each take's word timing — not assembled from scene images. Both tools say which
compiler ran and from which spec revision.

- The profile is the template's: asking for another is refused
  (`profile-fixed-by-template`).
- A problem is reported with the file and JSON path to fix
  (`episode-spec.json#$.data.panels[1].cue`, `artifacts/narration/takes.json#…`).
  Tell the person what to change in the spec or the takes; there is no
  fallback to scene images, and no render of an older timeline while the
  spec does not compile.
- Editing the spec, a take or a picture makes the next render recompile.
- Never change a template release to make a spec compile: a release is
  immutable, and its hash check fails.

## What the timeline holds (episodes without a spec)
````

- [ ] **Step 4: Full check**

Run: `npm run check && npm run docs:build`
Expected: everything passes (boundaries, contracts, pipelines, docs, typecheck and every module's tests, `@studio/series` included); VitePress builds.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0036-the-studio-renders-episodes-through-the-edit-timeline.md docs/adr/0037-series-templates-pin-editorial-standards.md skills/studio/compose-video.md
git commit -m "docs: ADR-0037 accepted with the compiler seat; spec-driven episodes in ADR-0036 and compose-video (avg-jao.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After the PR merges: close `avg-jao.2` and `avg-lho.1` (the compiler seat is filled).
