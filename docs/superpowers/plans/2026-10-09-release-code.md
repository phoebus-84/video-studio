# A Series Release Runs Its Own Code Implementation Plan (avg-d1x, phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A series template release can carry its own compiler and validator as source. `vpr template seal` builds them into sealed bundles, the loader runs those bundles instead of the application's registered code, and `vpr template verify` checks them against the release's fixtures.

**Architecture:**
- **Contracts:** `series-template.json`'s `compiler` and `validator` gain an optional `bundle: {path, hash}`.
- **`@studio/series`:** `compileSpec` and `checkSeries` use the code handed in `input.code` when the manifest names a bundle.
- **`@studio/episode`:**
  - the loader reads the bundle, checks its hash and runs those exact bytes;
  - `sealTemplateCode` and `verifyTemplateCode` build with esbuild and compare goldens.
- **`vpr`:** `vpr template seal|verify` imports `@studio/episode` at run time.

**Tech Stack:** TypeScript, esbuild (already installed), vitest and node:test.

**Spec:** `docs/superpowers/specs/2026-10-09-channel-series-extensions-design.md` (phase 1), on this branch.

Prototype: the local commit `7ff8819` on `scratch/release-code`. Never push or merge it. It passed:
- the root `npm run check`;
- the series suite (180);
- the episode tests (11 new);
- the CLI tests (2 new).

## Global Constraints

- Work on branch `feat/channel-extensions`, in the main checkout. Its spec commits are already there.
- Never push or merge without the user's go.
- **Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`.**
  - They hold the user's unrelated local changes. Never `git stash`.
  - Never run `bd`.
  - Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes: esbuild is resolved at run time from the installed `node_modules`.
- **Build order for dist consumers.** `@studio/episode` reads `@studio/series` from `dist/`, and `vpr` reads `@studio/episode` from `dist/`. Run `npm run build --workspace @studio/series`, then `--workspace @studio/episode`, then `--workspace @studio/runtime`, before the tests of the next package.
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **The loader runs exactly the bytes it hashed.** It never reads the file a second time. One module per hash.
- **A release without `bundle` behaves exactly as before.** Every existing test passes unchanged.
- **Sealing never changes a pinned release** (`release-pinned`), and a failed build writes nothing. Task 2 pins both.
- **The bundle is the same wherever the library and the app sit.** No path comments. Task 2 pins it.
- **Code that names another `id@version` than the manifest is refused** (`code-mismatch`), at compile and at check. Tasks 1 and 2 pin it.

---

### Task 1: The contract, and compiling and checking with a release's code

**Files:**
- Modify:
  - `studio/contracts/schemas/v1alpha1/series-template.schema.json`;
  - `studio/contracts/bindings/ts/series-template.ts` (regenerated);
  - `studio/contracts/src/series-templates.d.mts`;
  - `studio/series/src/types.ts`;
  - `studio/series/src/compile.ts`;
  - `studio/series/src/validators.ts`.
- Create: `studio/series/test/release-code.test.ts`.

**Interfaces:**
- Produces:
  - `SeriesComponentRef.bundle?: {path, hash}`;
  - `CompileInput.code?: {compiler?: SeriesCompiler; validator?: SeriesValidator}`;
  - `releaseCode(input, role)`, exported from `compile.ts`;
  - the problem codes `missing-code` and `code-mismatch`.

- [ ] **Step 1: Write the failing test.**

Create `studio/series/test/release-code.test.ts`:

````ts
// A release that runs its own compiler and validator (avg-d1x): compileSpec and
// checkSeries take them from the input's `code` when the manifest names a
// bundle, and say so when they are missing or are not what it names.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeries, compileSpec, resolveCompiler, resolveValidator, type CompileInput } from "../src/index.js";

const load = (): CompileInput => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0", "input.json"), "utf-8"));
const BUNDLE = { path: "compiler/compiler.cjs", hash: `sha256:${"a".repeat(64)}` };

/** The fixture's release, naming its own compiler and validator bundles. */
function withBundles(): CompileInput {
  const input = load();
  input.template = {
    ...input.template,
    compiler: { ...input.template.compiler, bundle: BUNDLE },
    validator: { ...input.template.validator!, bundle: { path: "validator/validator.cjs", hash: BUNDLE.hash } },
  };
  return input;
}

test("a release naming a bundle compiles with the code it was handed, not the registry's", () => {
  const registered = resolveCompiler("poetry-short", "1.0.0")!;
  let called = 0;
  const input = withBundles();
  input.code = { compiler: { ...registered, compile: (i) => { called++; return registered.compile(i); } } };
  const result = compileSpec(input);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
  assert.equal(called, 1);
});

test("a release naming a bundle refuses to compile without it, or with code of another version", () => {
  const missing = compileSpec(withBundles());
  assert.deepEqual(!missing.ok && missing.problems.map((p) => [p.code, p.path]), [["missing-code", "$.template.compiler.bundle"]]);

  const input = withBundles();
  input.code = { compiler: { ...resolveCompiler("poetry-short", "1.0.0")!, version: "1.0.1" } };
  const other = compileSpec(input);
  assert.deepEqual(!other.ok && other.problems.map((p) => p.code), ["code-mismatch"]);
});

test("the series check runs the release's own validator, and is an error without it", () => {
  const input = withBundles();
  input.code = { compiler: resolveCompiler("poetry-short", "1.0.0")! };
  const compiled = compileSpec(input);
  assert.ok(compiled.ok);
  const without = checkSeries({ ...input, compiled: compiled.timeline, timeline: compiled.timeline });
  assert.deepEqual(without.findings.map((f) => [f.code, f.severity]), [["missing-code", "error"]]);

  let called = 0;
  const validator = resolveValidator("poetry-short", "1.0.0")!;
  input.code.validator = { ...validator, validate: (i) => { called++; return validator.validate(i); } };
  const checked = checkSeries({ ...input, compiled: compiled.timeline, timeline: compiled.timeline });
  assert.equal(checked.validator, "poetry-short@1.0.0");
  assert.equal(called, 1);
});
````

- [ ] **Step 2: Run it, and see it fail.** `cd studio/series && node --import tsx --test test/release-code.test.ts`. Expect failures: the bundles are ignored, so `missing-code` is never reported and the handed code is never called.

- [ ] **Step 3: Implement.**

````diff
diff --git a/studio/contracts/schemas/v1alpha1/series-template.schema.json b/studio/contracts/schemas/v1alpha1/series-template.schema.json
index 4318d70..e87e456 100644
--- a/studio/contracts/schemas/v1alpha1/series-template.schema.json
+++ b/studio/contracts/schemas/v1alpha1/series-template.schema.json
@@ -14,9 +14,20 @@
       "required": ["id", "version"],
       "properties": {
         "id": { "$ref": "identity.schema.json#/$defs/Slug" },
-        "version": { "$ref": "#/$defs/TemplateVersion" }
+        "version": { "$ref": "#/$defs/TemplateVersion" },
+        "bundle": { "$ref": "#/$defs/CodeBundle" }
+      },
+      "description": "The compiler or validator the release runs: with `bundle`, the release's own sealed code (avg-d1x); without, the application's registered one."
+    },
+    "CodeBundle": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["path", "hash"],
+      "properties": {
+        "path": { "type": "string", "pattern": "^(compiler|validator)/[a-z0-9][a-z0-9._-]*\\.cjs$" },
+        "hash": { "$ref": "identity.schema.json#/$defs/ContentHash" }
       },
-      "description": "A reviewed repository registry entry, not executable code, a module path or a URL."
+      "description": "A self-contained CommonJS module built by `vpr template seal` from the release's source, relative to the release; `hash` is its sha256."
     },
     "TemplatePin": {
       "type": "object",
diff --git a/studio/contracts/src/series-templates.d.mts b/studio/contracts/src/series-templates.d.mts
index 892c483..381b8f5 100644
--- a/studio/contracts/src/series-templates.d.mts
+++ b/studio/contracts/src/series-templates.d.mts
@@ -6,8 +6,11 @@ export declare const SERIES_TEMPLATE_FILES: Readonly<{
   template: "episode-spec.template.json";
   standard: "FORMAT.md";
 }>;
-export interface SeriesComponentRef { id: string; version: string }
-export interface TemplatePin extends SeriesComponentRef { hash: string }
+/** A self-contained CommonJS module the release sealed (avg-d1x), relative to the release. */
+export interface CodeBundle { path: string; hash: string }
+/** With `bundle`, the release's own code; without, the application's registered compiler or validator. */
+export interface SeriesComponentRef { id: string; version: string; bundle?: CodeBundle }
+export interface TemplatePin { id: string; version: string; hash: string }
 export interface SeriesFileRef { path: string; hash: string }
 export interface SeriesEpisodeRef { channel: string; series: string; episode: string }
 /** One layout-sheet instant per matching section (avg-3th.1). */
diff --git a/studio/series/src/compile.ts b/studio/series/src/compile.ts
index 309e3e7..f64beb8 100644
--- a/studio/series/src/compile.ts
+++ b/studio/series/src/compile.ts
@@ -5,11 +5,34 @@
 import { validateTimeline } from "@av/remotion-composer";
 import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
 import { listCompilers, resolveCompiler } from "./registry.js";
-import type { CompileInput, CompileProblem, CompileResult } from "./types.js";
+import type { CompileInput, CompileProblem, CompileResult, SeriesCompiler, SeriesValidator } from "./types.js";
+
+/**
+ * The release's own compiler or validator (avg-d1x), when its manifest names a
+ * bundle: the loaded code, which must say the id and version the manifest
+ * does. Null when the manifest names none, so the registry answers.
+ */
+export function releaseCode<K extends "compiler" | "validator">(
+  input: CompileInput,
+  role: K,
+): { code: K extends "compiler" ? SeriesCompiler : SeriesValidator } | { problem: CompileProblem } | null {
+  const ref = input.template[role] as { id: string; version: string; bundle?: { path: string } } | undefined;
+  if (!ref?.bundle) return null;
+  const code = input.code?.[role];
+  if (!code) {
+    return { problem: { code: "missing-code", path: `$.template.${role}.bundle`, message: `the release runs its own ${role} (${ref.bundle.path}), and it was not loaded` } };
+  }
+  if (code.id !== ref.id || code.version !== ref.version) {
+    return { problem: { code: "code-mismatch", path: `$.template.${role}`, message: `${ref.bundle.path} is ${code.id}@${code.version}, not the ${ref.id}@${ref.version} the release names` } };
+  }
+  return { code: code as K extends "compiler" ? SeriesCompiler : SeriesValidator };
+}
 
 export function compileSpec(input: CompileInput): CompileResult {
   const { id, version } = input.template.compiler;
-  const compiler = resolveCompiler(id, version);
+  const own = releaseCode(input, "compiler");
+  if (own && "problem" in own) return { ok: false, problems: [own.problem] };
+  const compiler = own ? own.code : resolveCompiler(id, version);
   if (!compiler) {
     const available = listCompilers().filter((c) => c.id === id).map((c) => `${c.id}@${c.version}`);
     return {
diff --git a/studio/series/src/types.ts b/studio/series/src/types.ts
index 82ba1c9..bfdf646 100644
--- a/studio/series/src/types.ts
+++ b/studio/series/src/types.ts
@@ -50,6 +50,12 @@ export interface CompileInput {
    * source-<pin>-image-<name>.
    */
   sources?: Record<string, { narration: NarrationTakes; timings: Record<string, WordTiming> }>;
+  /**
+   * The release's own code, loaded by the episode's loader from its sealed
+   * bundles (avg-d1x): present exactly when the manifest's `compiler.bundle`
+   * or `validator.bundle` is. Not data: never in a fixture's input.json.
+   */
+  code?: { compiler?: SeriesCompiler; validator?: SeriesValidator };
 }
 
 /** Something in the input that stops compilation, located by a JSON path. */
diff --git a/studio/series/src/validators.ts b/studio/series/src/validators.ts
index c023bd3..3cc4651 100644
--- a/studio/series/src/validators.ts
+++ b/studio/series/src/validators.ts
@@ -4,6 +4,7 @@
 // with.
 
 import type { CheckResult, SeriesValidator, ValidateInput } from "./types.js";
+import { releaseCode } from "./compile.js";
 import { validator as poetryShort100 } from "./validators/poetry-short/1.0.0.js";
 import { validator as dentroIVersiShort100 } from "./validators/dentro-i-versi-short/1.0.0.js";
 import { validator as dentroIVersiLong100 } from "./validators/dentro-i-versi-long/1.0.0.js";
@@ -25,7 +26,11 @@ export function listValidators(): { id: string; version: string; description: st
 export function checkSeries(input: ValidateInput): CheckResult {
   const ref = input.template.validator;
   if (!ref) return { validator: null, findings: [] };
-  const validator = resolveValidator(ref.id, ref.version);
+  const own = releaseCode(input, "validator");
+  if (own && "problem" in own) {
+    return { validator: `${ref.id}@${ref.version}`, findings: [{ ...own.problem, severity: "error" }] };
+  }
+  const validator = own ? own.code : resolveValidator(ref.id, ref.version);
   if (!validator) {
     const available = listValidators().filter((v) => v.id === ref.id).map((v) => `${v.id}@${v.version}`);
     return {
````

Then regenerate the bindings: `cd studio/contracts && npm run bindings:generate`. This updates `bindings/ts/series-template.ts`.

- [ ] **Step 4: Run them, and see them pass.**
  - `cd studio/series && npm test`: 180 tests pass, including the 3 new ones.
  - `npx tsc --noEmit -p studio/series` is clean.
  - `cd studio/contracts && npm run check` passes.

- [ ] **Step 5: Commit.**

```bash
git add studio/contracts/schemas/v1alpha1/series-template.schema.json studio/contracts/bindings/ts/series-template.ts studio/contracts/src/series-templates.d.mts studio/series/src/types.ts studio/series/src/compile.ts studio/series/src/validators.ts studio/series/test/release-code.test.ts
git commit -m "A series release may name its own compiler and validator bundles; compile and check run them (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Loading, sealing and verifying a release's code

**Files:**
- Create:
  - `studio/episode/src/release-code.ts`;
  - `studio/episode/src/template-code.ts`;
  - `studio/series/fixtures/release-code/poetry-short/compiler/index.ts`;
  - `studio/series/fixtures/release-code/poetry-short/validator/index.ts`;
  - `studio/episode/tests/release-code.test.ts`.
- Modify:
  - `studio/episode/src/series-compile.ts`;
  - `studio/episode/src/index.ts`;
  - `studio/episode/src/testing.ts`.

**Interfaces:**
- Consumes: Task 1's `CompileInput.code` and the problem codes.
- Produces:
  - `releaseCodeOf(role, file, bytes, hash)`;
  - `sealTemplateCode(seriesDir, id, version, {dryRun})`, which returns `{hash, code}`;
  - `verifyTemplateCode(seriesDir, id, version, {update})`, which returns `{ok, problems, fixtures}`;
  - `TemplateCodeError`, whose codes are `missing-template`, `bad-template`, `release-pinned`, `build-failed`, `no-code` and `no-esbuild`;
  - the test helper `releaseCodeEpisode(episodeDir, ref)`;
  - the load problem codes `missing-code`, `code-mismatch` and `bad-code`.

- [ ] **Step 1: The fixtures and the failing test.** The fixtures are the registered poetry-short compiler and validator, with the import of their types pointed at `@studio/series`.

Create `studio/series/fixtures/release-code/poetry-short/compiler/index.ts`:

````ts
// poetry-short@1.0.0's compiler, as a release's own code (avg-d1x): the
// application's registered 1.0.0.ts with its imports pointed at the
// packages, so a sealed bundle of it must compile exactly as the registered one.
// poetry-short@1.0.0 — released: never edit this file; add poetry-short/<next>.ts instead.
//
// A vertical poem: pictures that change on the words the spec names, one
// narration unit, captions grouped from the measured words. Everything this
// version does is in this file (it imports only the contracts' helpers and
// ../../types.js), and its golden test fails if its output ever changes.

import { resolveCues } from "@studio/contracts/src/cues.mjs";
import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler } from "@studio/series";

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

  // This template's schema allows only words as cues, and a word is said
  // before the voice ends; but a compiler does not re-validate its input, and
  // a panel starting after the end must not reach the validators as a bug.
  const late = cueFrames.findIndex((frame, i) => i > 0 && frame >= durationInFrames);
  if (late !== -1) {
    return {
      ok: false,
      problems: [{
        code: "cue-after-end",
        path: `$.data.panels[${late}].cue`,
        message: `panel ${late + 1} would start at frame ${cueFrames[late]}, at or after the end of the video (${durationInFrames} frames)`,
      }],
    };
  }

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
````

Create `studio/series/fixtures/release-code/poetry-short/validator/index.ts`:

````ts
// poetry-short@1.0.0's validator, as a release's own code (avg-d1x): the
// application's registered 1.0.0.ts with its imports pointed at the
// packages, so a sealed bundle of it must compile exactly as the registered one.
// poetry-short@1.0.0 (validator) — released: never edit this file; add poetry-short/<next>.ts instead.
//
// The mechanical rules of the poetry-short format, checked on the timeline
// that is about to be rendered — hand edits included — with what the
// compiler makes of the same inputs as the reference. A hand edit may move a
// picture change or split a caption; it may not touch the voice, the text,
// the profile or the effects. Everything this version does is in this file,
// and its golden cases fail if its findings ever change.

import type { EditTimeline, Finding, SeriesValidator, ValidateInput } from "@studio/series";

/** 10 s at 30 fps. */
const MIN_FRAMES = 300;
/** 60 s at 30 fps. */
const MAX_FRAMES = 1800;
/** A picture on screen for less than a second flashes. */
const FLASH_FRAMES = 30;
/** A picture held for more than 7 s with nothing changing. */
const LONG_FRAMES = 210;
const CROSSFADE = 12;
const CAPTION_CHARACTERS = 42;
const ALLOWED: Record<string, "visual" | "audio"> = { panels: "visual", captions: "visual", voice: "audio" };

interface PoetryShortData {
  panels: { assetId: string }[];
  style: { captionKit: { name: string; version: string } };
}

type Track = EditTimeline["tracks"][number];
type Item = Record<string, any>;

const collapse = (text: string) => text.trim().split(/\s+/).join(" ");

/** JSON with sorted keys: equal values give equal text whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validate(input: ValidateInput): Finding[] {
  const { timeline, compiled } = input;
  const data = input.spec.data as unknown as PoetryShortData;
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) => findings.push({ code, severity: "error", path, message });
  const warning = (code: string, path: string, message: string) => findings.push({ code, severity: "warning", path, message });

  const tracks = timeline.tracks;
  const indexOf = (id: string) => tracks.findIndex((t) => t.id === id);

  // ── The tracks the format is made of ──────────────────────────────────────
  const required = ["panels", "voice", ...(compiled.tracks.some((t) => t.id === "captions") ? ["captions"] : [])];
  for (const id of required) {
    const i = indexOf(id);
    if (i === -1 || tracks[i]!.type !== ALLOWED[id]) {
      error("missing-track", "$.tracks", `the ${ALLOWED[id]} track "${id}" is missing`);
    }
  }
  if (findings.length > 0) return findings;
  const panelsAt = indexOf("panels");
  const voiceAt = indexOf("voice");
  const captionsAt = indexOf("captions");
  const panels = tracks[panelsAt]!.items as Item[];
  const voice = tracks[voiceAt]!.items as Item[];
  const captions = captionsAt === -1 ? [] : (tracks[captionsAt]!.items as Item[]);

  // ── Errors ────────────────────────────────────────────────────────────────
  if (canonical(timeline.profile) !== canonical(compiled.profile)) {
    error("profile-changed", "$.profile", `the profile is ${timeline.profile.id}; this template renders ${compiled.profile.id}`);
  }

  if (timeline.fps !== compiled.fps) {
    error("fps-changed", "$.fps", `the timeline plays at ${timeline.fps} fps; this template renders ${compiled.fps}`);
  }

  const frames = timeline.durationInFrames;
  if (frames < MIN_FRAMES || frames > MAX_FRAMES) {
    error("duration-range", "$.durationInFrames",
      `${(frames / 30).toFixed(1)} s is outside 10–60 s: shorten or lengthen the narration or the hold, not the timeline`);
  }

  tracks.forEach((track: Track, i) => {
    if (ALLOWED[track.id] !== track.type) {
      error("extra-track", `$.tracks[${i}]`, `track "${track.id}" (${track.type}) is not part of this format: only panels, captions and voice`);
    }
  });

  tracks.forEach((track: Track, i) => {
    if (track.hidden || track.muted) {
      error("hidden-track", `$.tracks[${i}]`, `track "${track.id}" is ${track.hidden ? "hidden" : "muted"}: every track of this format plays`);
    }
  });

  tracks.forEach((track: Track, i) => {
    const reference = compiled.tracks.find((t) => t.id === track.id);
    if (reference && (track.z ?? null) !== (reference.z ?? null)) {
      error("stacking-changed", `$.tracks[${i}].z`, `track "${track.id}" is stacked at ${track.z ?? "none"}; this format stacks it at ${reference.z ?? "none"}`);
    }
  });

  const kitOf = (item: Item) => `${item.kit?.name}@${item.kit?.version}`;
  const captionKit = `${data.style.captionKit.name}@${data.style.captionKit.version}`;
  panels.forEach((item, j) => {
    if (kitOf(item) !== "still@1.0.0") {
      error("forbidden-kit", `$.tracks[${panelsAt}].items[${j}].kit`, `panel "${item.id}" uses ${kitOf(item)}; panels use still@1.0.0`);
    }
  });
  captions.forEach((item, j) => {
    if (kitOf(item) !== captionKit) {
      error("forbidden-kit", `$.tracks[${captionsAt}].items[${j}].kit`, `caption "${item.id}" uses ${kitOf(item)}; captions use ${captionKit}`);
    }
  });

  for (const [at, items] of [[panelsAt, panels], [captionsAt, captions]] as const) {
    items.forEach((item, j) => {
      const tin = item.transitionIn;
      if (item.transitionOut || (tin && (tin.type !== "crossfade" || tin.duration !== CROSSFADE))) {
        error("forbidden-transition", `$.tracks[${at}].items[${j}]`,
          `"${item.id}" has ${item.transitionOut ? "a transitionOut" : `a ${tin.type} of ${tin.duration} frames`}; only a 12-frame crossfade in`);
      }
    });
  }

  const reference = (compiled.tracks.find((t) => t.id === "voice")?.items ?? []) as Item[];
  if (voice.length !== reference.length) {
    error("altered-voice", `$.tracks[${voiceAt}]`, `the voice has ${voice.length} items; the takes are laid out in ${reference.length}`);
  } else {
    voice.forEach((item, j) => {
      const want = reference[j]!;
      const moved = item.from !== want.from || item.duration !== want.duration || item.asset !== want.asset
        || (item.trimStart ?? 0) !== (want.trimStart ?? 0);
      const reworked = ["gain", "fadeIn", "fadeOut", "transitionIn", "transitionOut"].filter((k) => item[k] !== undefined);
      if (moved || reworked.length > 0) {
        error("altered-voice", `$.tracks[${voiceAt}].items[${j}]`,
          moved
            ? `"${item.id}" is not where the takes put it (frame ${want.from}, ${want.duration} frames, ${want.asset}): takes are never cut or moved`
            : `"${item.id}" sets ${reworked.join(", ")}: takes are never reworked`);
      }
    });
  }

  // Every picture and every take is the compiler's: a file swapped or added
  // by hand changes what is seen or heard without the spec saying so.
  const ids = [...new Set([...Object.keys(timeline.assets), ...Object.keys(compiled.assets)])];
  for (const id of ids) {
    const have = timeline.assets[id];
    const want = compiled.assets[id];
    if (canonical(have) !== canonical(want)) {
      error("asset-changed", `$.assets[${JSON.stringify(id)}]`,
        !want ? `"${id}" is not one of the episode's files: pictures and takes come from the spec and the takes`
          : !have ? `"${id}" was removed`
            : `"${id}" now points at ${have.path} (${have.hash}), not the file the compiler used`);
    }
  }

  // The captions' words are the ones the compiler captioned from the voice
  // (it drops a caption too short to show); a hand edit may split them, not change them.
  const text = (items: Item[]) => collapse([...items].sort((a, b) => a.from - b.from).map((c) => String(c.props?.text ?? "")).join(" "));
  const said = text(captions);
  const voiced = text((compiled.tracks.find((t) => t.id === "captions")?.items ?? []) as Item[]);
  if (captionsAt !== -1 && said !== voiced) {
    error("text-not-voice", `$.tracks[${captionsAt}]`, `the captions say "${said}", not the voice ("${voiced}"): change the spec and the takes, not the captions`);
  }

  const shown = new Set(panels.map((item) => item.props?.src?.$asset));
  data.panels.forEach((panel, k) => {
    if (!shown.has(`image-${panel.assetId}`)) {
      error("missing-picture", `$.data.panels[${k}]`, `"${panel.assetId}" is never shown`);
    }
  });

  const spans = panels.map((item) => [item.from as number, (item.from as number) + (item.duration as number)] as const)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [from, end] of spans) {
    if (from > covered) break;
    covered = Math.max(covered, end);
  }
  if (covered < frames) {
    error("uncovered-frames", `$.tracks[${panelsAt}]`, `no picture from frame ${covered}: every frame shows a panel`);
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  panels.forEach((item, j) => {
    if (item.duration < FLASH_FRAMES) {
      warning("panel-flash", `$.tracks[${panelsAt}].items[${j}]`, `"${item.id}" is on screen for ${item.duration} frames, under a second`);
    }
  });
  panels.forEach((item, j) => {
    if (item.duration > LONG_FRAMES) {
      warning("panel-long", `$.tracks[${panelsAt}].items[${j}]`, `"${item.id}" holds for ${(item.duration / 30).toFixed(1)} s with nothing changing (over 7 s)`);
    }
  });
  captions.forEach((item, j) => {
    const text = String(item.props?.text ?? "");
    if (text.length > CAPTION_CHARACTERS) {
      warning("caption-long", `$.tracks[${captionsAt}].items[${j}]`, `"${text}" is ${text.length} characters, over 42`);
    }
  });

  return findings;
}

export const validator: SeriesValidator = {
  id: "poetry-short",
  version: "1.0.0",
  description: "The poetry-short format's mechanical rules, on the timeline about to be rendered: 10–60 s, its tracks and kits only, the voice and its text untouched.",
  validate,
};
````

Create `studio/episode/tests/release-code.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkEpisode, compileEpisode, loadEpisode } from "../src/series-compile.js";
import { sealTemplateCode, TemplateCodeError, verifyTemplateCode } from "../src/template-code.js";
import { editSpec, releaseCodeEpisode, specEpisode } from "../src/testing.js";

/**
 * A series release that runs its own code (avg-d1x): its compiler and
 * validator sealed into the release as bundles, loaded from there, and the
 * same as the registered ones they were copied from.
 */

const require = createRequire(import.meta.url);
const POETRY_INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = (episode = REF.episode) => join(root, REF.channel, "series", REF.series, "episodes", episode);
const seriesDir = () => join(root, REF.channel, "series", REF.series);
const opts = (episode = REF.episode) => ({ episodeRef: { ...REF, episode } });

/** Throws the TemplateCodeError a call makes, or fails. */
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
  root = mkdtempSync(join(tmpdir(), "release-code-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a release that runs its own code", () => {
  it("compiles exactly as the registered compiler it was copied from", async () => {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    const own = compileEpisode(dir(), opts());
    expect(own.ok, JSON.stringify(!own.ok && own.problems)).toBe(true);

    // The same episode on the registered poetry-short@1.0.0, in another series of the library.
    const otherRef = { channel: "sample", series: "registered", episode: "morning" };
    const otherDir = join(root, "sample", "series", "registered", "episodes", "morning");
    specEpisode(otherDir, otherRef);
    const registered = compileEpisode(otherDir, { episodeRef: otherRef });
    expect(registered.ok).toBe(true);
    if (!own.ok || !registered.ok) return;
    const drawn = (t: any) => ({ tracks: t.tracks, assets: t.assets, sections: t.sections, durationInFrames: t.durationInFrames, profile: t.profile });
    expect(drawn(own.timeline)).toEqual(drawn(registered.timeline));

    // The code ran from the release, and its bundle is one of the inputs the timeline records.
    const bundle = JSON.parse(readFileSync(join(releaseDir, "series-template.json"), "utf-8")).compiler.bundle;
    expect(bundle.path).toBe("compiler/compiler.cjs");
    expect((own.timeline.metadata?.inputs as Record<string, string>)["../../templates/poetry-short/1.0.0/compiler/compiler.cjs"]).toBe(bundle.hash);
  });

  it("checks the timeline with the release's own validator", async () => {
    await releaseCodeEpisode(dir(), REF);
    const checked = checkEpisode(dir(), opts());
    expect(checked.ok && checked.validator).toBe("poetry-short@1.0.0");
  });

  it("refuses a bundle that is not the sealed one, or is missing", async () => {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    appendFileSync(join(releaseDir, "compiler", "compiler.cjs"), "\n// changed");
    const changed = loadEpisode(dir(), opts());
    expect(!changed.ok && changed.problems[0]).toMatchObject({ code: "code-mismatch", path: "../../templates/poetry-short/1.0.0/compiler/compiler.cjs" });
    rmSync(join(releaseDir, "compiler", "compiler.cjs"));
    const missing = loadEpisode(dir(), opts());
    expect(!missing.ok && missing.problems[0]!.code).toBe("missing-code");
  });

  it("refuses code that exports no compiler, and code that is not the release's named version", async () => {
    specEpisode(dir(), REF);
    const releaseDir = join(seriesDir(), "templates", "poetry-short", "1.0.0");
    mkdirSync(join(releaseDir, "compiler"), { recursive: true });
    writeFileSync(join(releaseDir, "compiler", "index.ts"), "export const nothing = 1;\n");
    const spec = join(dir(), "episode-spec.json");
    const aside = readFileSync(spec);
    rmSync(spec);
    const sealed = await sealTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    writeFileSync(spec, aside);
    editSpec(dir(), (doc) => { doc.template.hash = sealed.hash; });
    const empty = loadEpisode(dir(), opts());
    expect(!empty.ok && empty.problems[0]).toMatchObject({ code: "bad-code" });
    expect(!empty.ok && empty.problems[0]!.message).toContain("export const compiler");
  });

  it("says when the code is another version than the one the release names", async () => {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    const manifestFile = join(releaseDir, "series-template.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
    manifest.compiler.version = "9.9.9";
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const spec = join(dir(), "episode-spec.json");
    const aside = readFileSync(spec);
    rmSync(spec);
    const sealed = await sealTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    writeFileSync(spec, aside);
    editSpec(dir(), (doc) => { doc.template.hash = sealed.hash; });
    const compiled = compileEpisode(dir(), opts());
    expect(!compiled.ok && compiled.problems[0]).toMatchObject({ code: "code-mismatch" });
  });
});

describe("sealing", () => {
  it("is refused once an episode pins the release", async () => {
    await releaseCodeEpisode(dir(), REF);
    const e = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect(e.code).toBe("release-pinned");
    expect(e.message).toContain(REF.episode);
  });

  it("names a source that does not build, and writes nothing", async () => {
    specEpisode(dir(), REF);
    rmSync(join(dir(), "episode-spec.json"));
    const releaseDir = join(seriesDir(), "templates", "poetry-short", "1.0.0");
    const before = readFileSync(join(releaseDir, "series-template.json"), "utf-8");
    mkdirSync(join(releaseDir, "compiler"), { recursive: true });
    writeFileSync(join(releaseDir, "compiler", "index.ts"), "import { nowhere } from \"./missing.js\";\nexport const compiler = nowhere;\n");
    const e = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect(e.code).toBe("build-failed");
    expect(e.message).toContain("missing.js");
    expect(readFileSync(join(releaseDir, "series-template.json"), "utf-8")).toBe(before);
  });

  it("builds the same bundle wherever the library is", async () => {
    const a = await releaseCodeEpisode(dir(), REF);
    const elsewhere = mkdtempSync(join(tmpdir(), "release-code-elsewhere-"));
    try {
      const b = await releaseCodeEpisode(join(elsewhere, "x", "series", "poetry", "episodes", "e"), { channel: "x", series: "poetry", episode: "e" });
      const bundle = (r: string) => readFileSync(join(r, "compiler", "compiler.cjs"), "utf-8");
      expect(bundle(b.releaseDir)).toBe(bundle(a.releaseDir));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("verifying", () => {
  /** A release with code and one fixture: poetry-short's golden input. */
  async function withFixture() {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    mkdirSync(join(releaseDir, "fixtures", "morning"), { recursive: true });
    cpSync(POETRY_INPUT, join(releaseDir, "fixtures", "morning", "input.json"));
    return releaseDir;
  }

  it("asks for the goldens, writes them when told to before any episode pins it, then passes", async () => {
    const releaseDir = await withFixture();
    const first = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect(first.ok).toBe(false);
    expect(first.fixtures).toEqual([{ name: "morning", ok: false, message: "no expected-timeline.json: verify --update writes it" }]);

    expect((await refusal(() => verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true }))).code).toBe("release-pinned");
    rmSync(join(dir(), "episode-spec.json"));
    await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true });
    const verified = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect(verified).toEqual({ ok: true, problems: [], fixtures: [{ name: "morning", ok: true }] });
    expect(readFileSync(join(releaseDir, "fixtures", "morning", "expected-timeline.json"), "utf-8")).toContain('"kind": "EditTimeline"');
  });

  it("finds a source changed after sealing, a changed bundle and a golden that no longer matches", async () => {
    const releaseDir = await withFixture();
    rmSync(join(dir(), "episode-spec.json"));
    await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true });

    appendFileSync(join(releaseDir, "compiler", "index.ts"), "\nexport const extra = 1;\n");
    expect((await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0")).problems.map((p) => p.code)).toEqual(["source-differs"]);

    writeFileSync(join(releaseDir, "fixtures", "morning", "expected-timeline.json"), "{}\n");
    const golden = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect(golden.fixtures[0]).toEqual({ name: "morning", ok: false, message: "compiles differently from its expected-timeline.json" });

    appendFileSync(join(releaseDir, "validator", "validator.cjs"), "\n// changed");
    expect((await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0")).problems.map((p) => p.code)).toContain("code-mismatch");
  });
});

it("leaves a release without code on the registered compiler", () => {
  specEpisode(dir(), REF);
  const compiled = compileEpisode(dir(), opts());
  expect(compiled.ok).toBe(true);
  expect(dirname(POETRY_INPUT)).toContain("poetry-short");
});
````

- [ ] **Step 2: Run it, and see it fail.**
  - Run `npm run build --workspace @studio/series`.
  - Then `cd studio/episode && npx vitest run tests/release-code.test.ts`.
  - Expect the modules `../src/template-code.js` and `releaseCodeEpisode` not to be found.

- [ ] **Step 3: Implement.**

Create `studio/episode/src/release-code.ts`:

````ts
// ---------------------------------------------------------------------------
// A series release's own code (avg-d1x)
// ---------------------------------------------------------------------------
// A template release may carry its compiler and validator as sealed,
// self-contained CommonJS bundles (`vpr template seal`). The loader runs the
// exact bytes whose hash it checked — never a second read of the file — and
// keeps one module per hash, so a release's code loads once per process.
// ---------------------------------------------------------------------------

import Module from "node:module";
import type { SeriesCompiler, SeriesValidator } from "@studio/series";

const loaded = new Map<string, Record<string, unknown>>();

/** The module of a bundle's bytes, its sha256 already checked by the caller. */
function moduleOf(file: string, bytes: Buffer, hash: string): Record<string, unknown> {
  const hit = loaded.get(hash);
  if (hit) return hit;
  const ModuleCtor = Module as unknown as new (id: string) => { filename: string; paths: string[]; exports: Record<string, unknown>; _compile(code: string, file: string): void };
  const m = new ModuleCtor(file);
  m.filename = file;
  m.paths = [];
  m._compile(bytes.toString("utf-8"), file);
  loaded.set(hash, m.exports);
  return m.exports;
}

/**
 * The compiler or validator a release's bundle exports (`export const
 * compiler` / `export const validator`), or why it is not one.
 */
export function releaseCodeOf<K extends "compiler" | "validator">(
  role: K,
  file: string,
  bytes: Buffer,
  hash: string,
): { ok: true; code: K extends "compiler" ? SeriesCompiler : SeriesValidator } | { ok: false; message: string } {
  let exports: Record<string, unknown>;
  try {
    exports = moduleOf(file, bytes, hash);
  } catch (error) {
    return { ok: false, message: `it does not load: ${(error as Error).message}` };
  }
  const code = exports[role] as Record<string, unknown> | undefined;
  const run = role === "compiler" ? "compile" : "validate";
  if (!code || typeof code.id !== "string" || typeof code.version !== "string" || typeof code[run] !== "function") {
    return { ok: false, message: `it does not export a ${role} (\`export const ${role}\` with id, version and ${run}())` };
  }
  return { ok: true, code: code as unknown as K extends "compiler" ? SeriesCompiler : SeriesValidator };
}
````

Create `studio/episode/src/template-code.ts`:

````ts
// ---------------------------------------------------------------------------
// Sealing and verifying a series release's own code (avg-d1x)
// ---------------------------------------------------------------------------
// A series template release may hold its compiler and validator as source:
// compiler/index.ts and validator/index.ts, exporting `compiler` and
// `validator`. Sealing builds each into one self-contained CommonJS file
// (esbuild: the toolbox and the contracts' helpers it imports are inlined, so
// a later change to them never alters this release) and names it, with its
// hash, in series-template.json. Verifying checks the bundles are the sealed
// ones, that the source still builds to them, and that the release's fixtures
// compile to their golden timelines.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { compileSpec, checkSeries } from "@studio/series";
import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
import { SERIES_TEMPLATE_FILES, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { releaseCodeOf } from "./release-code.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ROLES = ["compiler", "validator"] as const;
type Role = (typeof ROLES)[number];

export type TemplateCodeCode = "missing-template" | "bad-template" | "release-pinned" | "build-failed" | "no-code" | "no-esbuild";

export class TemplateCodeError extends Error {
  constructor(readonly code: TemplateCodeCode, message: string) {
    super(message);
    this.name = "TemplateCodeError";
  }
}

const fail = (code: TemplateCodeCode, message: string): never => {
  throw new TemplateCodeError(code, message);
};
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sourceOf = (releaseDir: string, role: Role) => join(releaseDir, role, "index.ts");
const bundlePath = (role: Role) => `${role}/${role}.cjs`;

function releaseDirOf(seriesDir: string, id: string, version: string): string {
  if (!SLUG.test(id)) fail("missing-template", `"${id}" is not a template id`);
  if (!EXACT.test(version)) fail("missing-template", `"${version}" is not an exact x.y.z release`);
  const dir = join(seriesDir, "templates", id, version);
  if (!existsSync(join(dir, SERIES_TEMPLATE_MANIFEST))) fail("missing-template", `${id}@${version} is not in this series`);
  return dir;
}

function readManifest(releaseDir: string, label: string): { manifest: any; text: string } {
  const text = readFileSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST), "utf-8");
  try {
    const manifest = JSON.parse(text);
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("not an object");
    return { manifest, text };
  } catch (error) {
    return fail("bad-template", `${label}'s ${SERIES_TEMPLATE_MANIFEST} is not a release manifest: ${(error as Error).message}`);
  }
}

/** The episodes of this series whose spec pins the release. */
function pinnedBy(seriesDir: string, id: string, version: string): string[] {
  const episodes = join(seriesDir, "episodes");
  if (!existsSync(episodes)) return [];
  return readdirSync(episodes).filter((name) => {
    try {
      const spec = JSON.parse(readFileSync(join(episodes, name, "episode-spec.json"), "utf-8"));
      return spec?.template?.id === id && spec?.template?.version === version;
    } catch {
      return false;
    }
  }).sort();
}

/** One self-contained CommonJS bundle of a role's source; the app's packages resolve from its node_modules. */
async function build(releaseDir: string, role: Role): Promise<string> {
  const require = createRequire(import.meta.url);
  let esbuild: typeof import("esbuild");
  let nodeModules: string;
  try {
    const main = require.resolve("esbuild");
    esbuild = require(main);
    nodeModules = dirname(dirname(dirname(main)));
  } catch {
    return fail("no-esbuild", "esbuild is not installed beside the studio: it builds a release's code");
  }
  try {
    const out = await esbuild.build({
      entryPoints: [sourceOf(releaseDir, role)],
      absWorkingDir: releaseDir,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      write: false,
      nodePaths: [nodeModules],
      // No path comments: the bundle is the same wherever the library and the app sit.
      minifyWhitespace: true,
      legalComments: "none",
      logLevel: "silent",
    });
    return out.outputFiles[0]!.text;
  } catch (error) {
    const errors = (error as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors ?? [];
    const detail = errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("; ");
    return fail("build-failed", `${role}/index.ts does not build: ${detail || (error as Error).message}`);
  }
}

export interface SealedCode {
  /** The manifest's hash: what an episode pins. */
  hash: string;
  code: Partial<Record<Role, { path: string; hash: string }>>;
}

/**
 * Build the release's compiler/ and validator/ sources into their bundles and
 * name them, with every file's hash, in its manifest. Refused once an episode
 * pins the release: a pinned release never changes.
 */
export async function sealTemplateCode(seriesDir: string, id: string, version: string, options: { dryRun?: boolean } = {}): Promise<SealedCode> {
  const releaseDir = releaseDirOf(seriesDir, id, version);
  const label = `${id}@${version}`;
  const pinned = pinnedBy(seriesDir, id, version);
  if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: a pinned release never changes; make a new one (vpr template release --from ${version})`);
  const { manifest } = readManifest(releaseDir, label);

  const built: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    if (!existsSync(sourceOf(releaseDir, role))) continue;
    if (!manifest[role] || typeof manifest[role] !== "object") fail("bad-template", `${label} has ${role}/index.ts but its manifest names no ${role} (id and version)`);
    built[role] = await build(releaseDir, role);
    manifest[role] = { id: manifest[role].id, version: manifest[role].version, bundle: { path: bundlePath(role), hash: sha256(built[role]!) } };
  }
  if (Object.keys(built).length === 0) fail("no-code", `${label} has neither compiler/index.ts nor validator/index.ts`);

  const files: Record<string, string> = {};
  for (const [roleName, name] of Object.entries(SERIES_TEMPLATE_FILES)) {
    const file = join(releaseDir, name);
    if (!existsSync(file)) fail("missing-template", `${label} has no ${name}`);
    files[name] = readFileSync(file, "utf-8");
    manifest.files[roleName] = { path: name, hash: sha256(files[name]!) };
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const problems = validateTemplateBundle({ manifest: manifestText, files });
  if (problems.length > 0) fail("bad-template", problems.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; "));

  const result: SealedCode = {
    hash: sha256(manifestText),
    code: Object.fromEntries(Object.keys(built).map((role) => [role, manifest[role].bundle])),
  };
  if (options.dryRun) return result;
  for (const [role, text] of Object.entries(built)) {
    const target = join(releaseDir, bundlePath(role as Role));
    writeFileSync(`${target}.tmp`, text);
    renameSync(`${target}.tmp`, target);
  }
  const manifestFile = join(releaseDir, SERIES_TEMPLATE_MANIFEST);
  writeFileSync(`${manifestFile}.tmp`, manifestText);
  renameSync(`${manifestFile}.tmp`, manifestFile);
  return result;
}

export interface CodeVerification {
  ok: boolean;
  problems: { code: string; message: string }[];
  fixtures: { name: string; ok: boolean; message?: string }[];
}

/**
 * Is the release's code the sealed code, does its source still build to it,
 * and do its fixtures (fixtures/<name>/input.json) compile to their golden
 * timelines (expected-timeline.json)? `update` writes the goldens instead,
 * refused once an episode pins the release.
 */
export async function verifyTemplateCode(seriesDir: string, id: string, version: string, options: { update?: boolean } = {}): Promise<CodeVerification> {
  const releaseDir = releaseDirOf(seriesDir, id, version);
  const label = `${id}@${version}`;
  if (options.update) {
    const pinned = pinnedBy(seriesDir, id, version);
    if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: its goldens never change`);
  }
  const { manifest, text: manifestText } = readManifest(releaseDir, label);
  const problems: CodeVerification["problems"] = [];
  const code: { compiler?: any; validator?: any } = {};
  for (const role of ROLES) {
    const bundle = manifest[role]?.bundle as { path: string; hash: string } | undefined;
    if (!bundle) continue;
    const file = join(releaseDir, bundle.path);
    if (!existsSync(file)) {
      problems.push({ code: "missing-code", message: `${bundle.path} is missing` });
      continue;
    }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== bundle.hash) {
      problems.push({ code: "code-mismatch", message: `${bundle.path} is not the code the release sealed` });
      continue;
    }
    if (existsSync(sourceOf(releaseDir, role)) && sha256(await build(releaseDir, role)) !== bundle.hash) {
      problems.push({ code: "source-differs", message: `${role}/index.ts no longer builds to ${bundle.path}: the source changed after sealing` });
    }
    const loaded = releaseCodeOf(role, file, bytes, bundle.hash);
    if (!loaded.ok) problems.push({ code: "bad-code", message: `${bundle.path}: ${loaded.message}` });
    else code[role] = loaded.code;
  }
  if (!manifest.compiler?.bundle && !manifest.validator?.bundle) problems.push({ code: "no-code", message: `${label} names no code of its own` });

  const fixtures: CodeVerification["fixtures"] = [];
  const fixturesDir = join(releaseDir, "fixtures");
  for (const name of existsSync(fixturesDir) ? readdirSync(fixturesDir).sort() : []) {
    const dir = join(fixturesDir, name);
    if (!existsSync(join(dir, "input.json"))) continue;
    const input = JSON.parse(readFileSync(join(dir, "input.json"), "utf-8"));
    // The fixture is compiled as this release, whatever release it was written for.
    input.template = manifest;
    input.spec.template = { id, version, hash: sha256(manifestText) };
    input.code = code;
    const result = compileSpec(input);
    if (!result.ok) {
      fixtures.push({ name, ok: false, message: result.problems.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; ") });
      continue;
    }
    const errors = checkSeries({ ...input, compiled: result.timeline, timeline: result.timeline }).findings.filter((f) => f.severity === "error");
    if (errors.length > 0) {
      fixtures.push({ name, ok: false, message: `the validator refuses it: ${errors.map((f) => `${f.code} at ${f.path}`).join("; ")}` });
      continue;
    }
    const text = `${JSON.stringify(result.timeline, null, 2)}\n`;
    const golden = join(dir, "expected-timeline.json");
    if (options.update) {
      writeFileSync(golden, text);
      fixtures.push({ name, ok: true, message: "golden written" });
    } else if (!existsSync(golden)) {
      fixtures.push({ name, ok: false, message: "no expected-timeline.json: verify --update writes it" });
    } else if (readFileSync(golden, "utf-8") !== text) {
      fixtures.push({ name, ok: false, message: "compiles differently from its expected-timeline.json" });
    } else {
      fixtures.push({ name, ok: true });
    }
  }
  return { ok: problems.length === 0 && fixtures.every((f) => f.ok), problems, fixtures };
}
````

````diff
diff --git a/studio/episode/src/index.ts b/studio/episode/src/index.ts
index a0e76e5..1350309 100644
--- a/studio/episode/src/index.ts
+++ b/studio/episode/src/index.ts
@@ -17,3 +17,4 @@ export * from "./speech-align.js";
 export * from "./take-align.js";
 export * from "./take-register.js";
 export * from "./stage-evidence.js";
+export * from "./template-code.js";
diff --git a/studio/episode/src/series-compile.ts b/studio/episode/src/series-compile.ts
index c666683..b245d55 100644
--- a/studio/episode/src/series-compile.ts
+++ b/studio/episode/src/series-compile.ts
@@ -19,6 +19,7 @@ import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } fr
 import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
 import { THEME_FILE, themeReleasePath, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";
 import { PINS_DIR, sourceDir, validateSourcePin } from "@studio/contracts/src/source-pins.mjs";
+import { releaseCodeOf } from "./release-code.js";
 
 export const NARRATION_TAKES_PATH = "artifacts/narration/takes.json";
 /** What the loader offers from assets/: every file in each folder, as <prefix>-<name>. */
@@ -246,6 +247,20 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
   if (specProblems.length > 0) throw new Stop(at(EPISODE_SPEC_PATH, specProblems));
   const template = JSON.parse(bundle.manifest);
 
+  // ── The release's own code (avg-d1x): its sealed compiler and validator ──
+  const code: NonNullable<CompileInput["code"]> = {};
+  for (const role of ["compiler", "validator"] as const) {
+    const ref = template[role] as { bundle?: { path: string; hash: string } } | undefined;
+    if (!ref?.bundle) continue;
+    const key = `${releaseKey}/${ref.bundle.path}`;
+    const file = join(releaseDir, ref.bundle.path);
+    const bytes = read(file, seriesDir, () => stop("missing-code", key, `${key} is missing: the release names it, so it was sealed with it (vpr template seal)`));
+    if (sha256(bytes) !== ref.bundle.hash) stop("code-mismatch", key, `${key} is not the code the release sealed (${ref.bundle.hash}): a release never changes, make a new one`);
+    const loaded = releaseCodeOf(role, file, bytes, ref.bundle.hash);
+    if (!loaded.ok) return stop("bad-code", key, `${key}: ${loaded.message}`);
+    (code as Record<string, unknown>)[role] = loaded.code;
+  }
+
   // ── Narration takes and their timing ──────────────────────────────────────
   const takesBytes = read(join(episodeDir, NARRATION_TAKES_PATH), episodeDir,
     () => stop("missing-narration", NARRATION_TAKES_PATH, `${NARRATION_TAKES_PATH} is missing: record and verify the narration takes first`));
@@ -428,7 +443,7 @@ function load(episodeDir: string, episodeRef: { channel: string; series: string;
     }
   }
 
-  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}), ...(Object.keys(sources).length > 0 ? { sources } : {}) }, releaseKey, warnings };
+  return { ok: true, input: { spec, template, narration, timings, assets, inputs, ...(theme ? { theme } : {}), ...(Object.keys(sources).length > 0 ? { sources } : {}), ...(Object.keys(code).length > 0 ? { code } : {}) }, releaseKey, warnings };
 }
 
 const IN_TIMELINE = /^\$\.(tracks|profile|durationInFrames|resolution|assets|sections)\b/;
diff --git a/studio/episode/src/testing.ts b/studio/episode/src/testing.ts
index e179956..37bd3f5 100644
--- a/studio/episode/src/testing.ts
+++ b/studio/episode/src/testing.ts
@@ -5,16 +5,19 @@
 // small placeholder files unless the caller writes real ones.
 
 import { createHash } from "node:crypto";
-import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
+import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
 import { createRequire } from "node:module";
 import { dirname, join } from "node:path";
 import { signReceipt } from "@studio/contracts/src/receipt.mjs";
 import { buildSheetReview, LAYOUT_SHEET_REPORT, SHEET_REVIEW_PATH } from "@studio/contracts/src/sheet-reviews.mjs";
 import { inventory } from "@studio/contracts/src/source-pins.mjs";
+import { sealTemplateCode } from "./template-code.js";
 
 const require = createRequire(import.meta.url);
 const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
 const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
+/** poetry-short@1.0.0's compiler and validator as a release's own code (avg-d1x). */
+const RELEASE_CODE = dirname(require.resolve("@studio/series/fixtures/release-code/poetry-short/compiler/index.ts"));
 const DIV_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-short/1.0.0/input.json");
 /** The long's golden fixture, for each released compiler version. */
 const divLongInput = (version: string) => require.resolve(`@studio/series/fixtures/dentro-i-versi-long/${version}/input.json`);
@@ -195,3 +198,27 @@ export async function divLongEpisode(
   }, null, 2)}\n`);
   return { episodeDir, episodeRef };
 }
+
+/**
+ * specEpisode, with its release running its own code (avg-d1x): the
+ * poetry-short compiler and validator copied into the release as source and
+ * sealed, the spec pinned to the sealed release. Returns the release's
+ * directory and its manifest's hash.
+ */
+export async function releaseCodeEpisode(
+  episodeDir: string,
+  episodeRef: { channel: string; series: string; episode: string },
+  options: SpecEpisodeOptions = {},
+): Promise<{ releaseDir: string; hash: string }> {
+  specEpisode(episodeDir, episodeRef, options);
+  const seriesDir = dirname(dirname(episodeDir));
+  const releaseDir = join(seriesDir, "templates", "poetry-short", "1.0.0");
+  cpSync(dirname(RELEASE_CODE), releaseDir, { recursive: true });
+  // Sealing refuses a pinned release: the spec steps aside while it is sealed, then pins the sealed one.
+  const spec = join(episodeDir, "episode-spec.json");
+  renameSync(spec, `${spec}.aside`);
+  const sealed = await sealTemplateCode(seriesDir, "poetry-short", "1.0.0");
+  renameSync(`${spec}.aside`, spec);
+  editSpec(episodeDir, (doc) => { doc.template.hash = sealed.hash; });
+  return { releaseDir, hash: sealed.hash };
+}
````

- [ ] **Step 4: Run them, and see them pass.**
  - `cd studio/episode && npx vitest run`: all pass, including the 11 new tests.
  - `npx tsc --noEmit -p studio/episode` is clean.

- [ ] **Step 5: Commit.**

```bash
git add studio/episode/src/release-code.ts studio/episode/src/template-code.ts studio/series/fixtures/release-code studio/episode/tests/release-code.test.ts studio/episode/src/series-compile.ts studio/episode/src/index.ts studio/episode/src/testing.ts
git commit -m "The loader runs a release's sealed compiler and validator; sealTemplateCode builds them, verifyTemplateCode checks them and their fixtures (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `vpr template seal` and `vpr template verify`, and the decision record

**Files:**
- Create:
  - `studio/runtime/test/integration/cli-template-code.test.ts`;
  - `docs/adr/0041-a-series-release-carries-its-own-code.md`.
- Modify:
  - `studio/runtime/src/cli.ts`;
  - `docs/running.md`;
  - `docs/index.md`.

**Interfaces:**
- Consumes: Task 2's `sealTemplateCode`, `verifyTemplateCode` and `TemplateCodeError`, through a run-time import of `@studio/episode`.

- [ ] **Step 1: Write the failing test.**

Create `studio/runtime/test/integration/cli-template-code.test.ts`:

````ts
// ---------------------------------------------------------------------------
// `vpr template seal` and `vpr template verify` (avg-d1x): a release's own
// compiler and validator, built into it and checked against its fixtures.
// Spawns the compiled CLI, like cli.test.ts.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { specEpisode } from "@studio/episode/testing";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const require = createRequire(import.meta.url);
const CODE = path.dirname(path.dirname(require.resolve("@studio/series/fixtures/release-code/poetry-short/compiler/index.ts")));
const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A library whose poetry-short release holds its own code, no episode pinning it. */
function library() {
  const root = mkdtempSync(path.join(tmpdir(), "cli-template-code-"));
  roots.push(root);
  const episodeDir = path.join(root, "sample", "series", "poetry", "episodes", "morning");
  specEpisode(episodeDir, { channel: "sample", series: "poetry", episode: "morning" });
  rmSync(path.join(episodeDir, "episode-spec.json"));
  const release = path.join(root, "sample", "series", "poetry", "templates", "poetry-short", "1.0.0");
  cpSync(CODE, release, { recursive: true });
  return { root, release };
}

function vpr(root: string, args: string[]) {
  const result = spawnSync("node", [cliPath, "template", ...args, "--library", root, "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr template seal / verify", () => {
  it("seals the release's code, then verifies it against its fixtures", () => {
    const { root, release } = library();
    const sealed = vpr(root, ["seal", "sample/poetry", "poetry-short", "1.0.0"]);
    expect(sealed.status, sealed.stderr).toBe(0);
    expect(sealed.json.code.compiler.path).toBe("compiler/compiler.cjs");
    const manifest = JSON.parse(readFileSync(path.join(release, "series-template.json"), "utf-8"));
    expect(manifest.validator.bundle.hash).toBe(sealed.json.code.validator.hash);

    mkdirSync(path.join(release, "fixtures", "morning"), { recursive: true });
    cpSync(INPUT, path.join(release, "fixtures", "morning", "input.json"));
    expect(vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0"]).status).toBe(2); // no golden yet
    expect(vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0", "--update"]).status).toBe(0);
    const verified = vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0"]);
    expect([verified.status, verified.json.ok, verified.json.fixtures]).toEqual([0, true, [{ name: "morning", ok: true }]]);

    appendFileSync(path.join(release, "compiler", "index.ts"), "\nexport const extra = 1;\n");
    const changed = vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0"]);
    expect([changed.status, changed.json.problems[0].code]).toEqual([2, "source-differs"]);
  });

  it("refuses to seal a release an episode pins, as a runtime error", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-template-code-"));
    roots.push(root);
    specEpisode(path.join(root, "sample", "series", "poetry", "episodes", "morning"), { channel: "sample", series: "poetry", episode: "morning" });
    cpSync(CODE, path.join(root, "sample", "series", "poetry", "templates", "poetry-short", "1.0.0"), { recursive: true });
    const refused = vpr(root, ["seal", "sample/poetry", "poetry-short", "1.0.0"]);
    expect([refused.status, refused.json.code]).toEqual([2, "release-pinned"]);
  });
});
````

- [ ] **Step 2: Run it, and see it fail.**
  - Run `npm run build --workspace @studio/episode`.
  - Then `npm run build --workspace @studio/runtime`.
  - Then `cd studio/runtime && npx vitest run test/integration/cli-template-code.test.ts`.
  - Expect a usage error (exit 1), because `seal` isn't a subcommand yet.

- [ ] **Step 3: Implement, and document.**

````diff
diff --git a/docs/index.md b/docs/index.md
index b9eb9b9..9e42184 100644
--- a/docs/index.md
+++ b/docs/index.md
@@ -56,7 +56,7 @@ synced into the site at build time from where they live next to the code.
 
 ## Decision records
 
-[`adr/`](./adr/0040-channel-themes-carry-the-look-as-data) holds 40 accepted
+[`adr/`](./adr/0041-a-series-release-carries-its-own-code) holds 41 accepted
 decisions. The ones that most shape the code:
 
 | ADR | Decision |
@@ -74,6 +74,7 @@ decisions. The ones that most shape the code:
 | [0038](./adr/0038-word-timing-comes-from-forced-alignment) | Word timing comes from forced alignment against the text |
 | [0039](./adr/0039-format-kits-share-frozen-libraries) | Format kits share frozen libraries, locked with them |
 | [0040](./adr/0040-channel-themes-carry-the-look-as-data) | Channel themes carry the look as data |
+| [0041](./adr/0041-a-series-release-carries-its-own-code) | A series release carries its own code |
 
 ADR-0022 (independent repositories per module) is superseded by 0032.
 ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.
diff --git a/docs/running.md b/docs/running.md
index a1ed848..7ee9c41 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -447,6 +447,29 @@ node studio/runtime/dist/src/cli.js template release my-channel/my-series my-tem
   --from 1.0.0 --theme my-theme@1.1.0 --library "$PWD/library"
 ```
 
+**`vpr template seal`** and **`vpr template verify`** handle a series
+release's own code (ADR-0041). A release may hold its compiler and validator
+as source, `compiler/index.ts` and `validator/index.ts`, exporting `compiler`
+and `validator`.
+- **`template seal`** builds each into one self-contained file
+  (`compiler/compiler.cjs`), names it with its hash in `series-template.json`,
+  and rehashes the release's files. Episodes on that release then compile with
+  it, not with the application's registered compiler. It refuses a release an
+  episode pins: make a new one with `template release --from`, change its code,
+  seal it.
+- **`template verify`** checks:
+  - that the bundles are the sealed ones;
+  - that the source still builds to them;
+  - that each `fixtures/<name>/input.json` compiles, and passes the
+    validator, to its `expected-timeline.json`.
+
+  `--update` writes the goldens, before any episode pins the release.
+
+```bash
+node studio/runtime/dist/src/cli.js template seal my-channel/my-series my-template 1.1.0 --library "$PWD/library"
+node studio/runtime/dist/src/cli.js template verify my-channel/my-series my-template 1.1.0 --library "$PWD/library"
+```
+
 **`vpr select`** puts an earlier candidate back in place. The gateway offers
 the same thing as `POST …/stages/:stage/select`, and `GET …/episodes/:episode/takes`
 lists the candidates.
diff --git a/studio/runtime/src/cli.ts b/studio/runtime/src/cli.ts
index ce06c14..d1d36a8 100644
--- a/studio/runtime/src/cli.ts
+++ b/studio/runtime/src/cli.ts
@@ -992,11 +992,54 @@ async function cmdTheme(ctx: CliContext, args: string[]): Promise<number> {
 }
 
 /** `vpr template release`: a new release of a series template, a copy of `--from`, pinned to a sealed theme. */
+/**
+ * `vpr template seal|verify` (avg-d1x): a release's own compiler and
+ * validator, built and checked by @studio/episode, loaded at run time as
+ * `vpr status` loads the studio's reader: that package depends on this one.
+ */
+async function cmdTemplateCode(ctx: CliContext, sub: "seal" | "verify", seriesDir: string, id: string, version: string, update: boolean): Promise<number> {
+  const episode = "@studio/episode";
+  let mod: {
+    sealTemplateCode: (s: string, i: string, v: string, o: { dryRun?: boolean }) => Promise<{ hash: string; code: Record<string, { path: string; hash: string }> }>;
+    verifyTemplateCode: (s: string, i: string, v: string, o: { update?: boolean }) => Promise<{ ok: boolean; problems: { code: string; message: string }[]; fixtures: { name: string; ok: boolean; message?: string }[] }>;
+    TemplateCodeError: new (...a: never[]) => Error & { code: string };
+  };
+  try {
+    mod = await import(episode);
+  } catch (error) {
+    emit(ctx, { error: `the studio's episode package could not be loaded: ${error instanceof Error ? error.message : String(error)}` });
+    return EX_RUNTIME;
+  }
+  try {
+    if (sub === "seal") {
+      const sealed = await mod.sealTemplateCode(seriesDir, id, version, { dryRun: ctx.dryRun });
+      const built = Object.entries(sealed.code).map(([role, b]) => `${role} ${b.path}`).join(", ");
+      emit(ctx, { message: `${ctx.dryRun ? "[DRY RUN] " : ""}${id}@${version} ${ctx.dryRun ? "would be sealed" : "sealed"}: ${built}; verify it with vpr template verify`, ...sealed, dryRun: ctx.dryRun });
+      return EX_OK;
+    }
+    const verified = await mod.verifyTemplateCode(seriesDir, id, version, { update });
+    const fixtures = verified.fixtures.map((f) => `${f.ok ? "✓" : "✗"} ${f.name}${f.message ? `: ${f.message}` : ""}`).join("; ");
+    emit(ctx, {
+      message: `${id}@${version}: ${verified.ok ? "verified" : "NOT verified"}${verified.problems.length ? `; ${verified.problems.map((p) => p.message).join("; ")}` : ""}${fixtures ? `; fixtures: ${fixtures}` : "; no fixtures"}`,
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
 async function cmdTemplate(ctx: CliContext, args: string[]): Promise<number> {
-  const usage = "Usage: vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] [--library <path>]";
+  const usage = "Usage: vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] [--library <path>] | " +
+    "vpr template seal <channel>/<series> <template-id> <version> [--dry-run] | vpr template verify <channel>/<series> <template-id> <version> [--update]";
   const libraryRoot = libraryFrom(args);
   const [sub, target, id, version] = positionalArgs(args);
   const parts = target?.split("/") ?? [];
+  if ((sub === "seal" || sub === "verify") && libraryRoot && parts.length === 2 && parts.every(isNamePart) && id && version) {
+    return cmdTemplateCode(ctx, sub, seriesPath(libraryRoot, parts[0]!, parts[1]!), id, version, args.includes("--update"));
+  }
   const from = flagValue(args, "--from");
   const themeArg = flagValue(args, "--theme");
   const theme = themeArg?.match(/^([^@]+)@([^@]+)$/);
@@ -1721,7 +1764,7 @@ const COMMANDS: Record<string, CliCommand> = {
   sheet: { name: "sheet", description: "Review an episode's layout sheet: approve it, reject it with a note, or see its review; a spec-driven episode renders only with an approval of its current sheet", usage: "vpr sheet approve <channel>/<series>/<episode> [--note <text>] [--dry-run] | vpr sheet reject <channel>/<series>/<episode> --note <text> | vpr sheet status <channel>/<series>/<episode>", examples: ["vpr sheet approve dentro-i-versi/short/san-martino", "vpr sheet reject dentro-i-versi/short/san-martino --note 'the verse bar covers the hand at 0:12'", "vpr sheet status dentro-i-versi/short/san-martino"], run: cmdSheet },
   reference: { name: "reference", description: "Golden references of a series: approve a proposed one, withdraw, verify, list", usage: "vpr reference approve <channel>/<series>/<episode> <ref-id> [--note <text>] [--dry-run] | vpr reference withdraw <channel>/<series> <template-id> <ref-id> --reason <text> | vpr reference verify <channel>/<series> <template-id> <ref-id> | vpr reference list <channel>/<series> [--json]", examples: ["vpr reference approve dentro-i-versi/short/san-martino san-martino-v1 --dry-run", "vpr reference verify dentro-i-versi/short short-room san-martino-v1", "vpr reference withdraw dentro-i-versi/short short-room san-martino-v1 --reason 'the recital was re-recorded'"], run: cmdReference },
   theme: { name: "theme", description: "Seal a theme release: its files and their hashes in theme.json, so a changed room never passes for the released one", usage: "vpr theme seal <channel>/<theme>/<version> [--library <path>]", examples: ["vpr theme seal dentro-i-versi/dentro-i-versi/1.1.0"], run: cmdTheme },
-  template: { name: "template", description: "Release a series template: a copy of an earlier release, optionally pinned to a sealed theme (a new look)", usage: "vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] [--library <path>]", examples: ["vpr template release dentro-i-versi/long dentro-i-versi-long 1.1.0 --from 1.0.0 --theme dentro-i-versi@1.1.0", "vpr template release dentro-i-versi/long dentro-i-versi-long 1.2.0 --from 1.1.0 --compiler 1.1.0"], run: cmdTemplate },
+  template: { name: "template", description: "Release a series template (a copy of an earlier release, optionally pinned to a sealed theme), seal its own compiler and validator, or verify them against its fixtures", usage: "vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--compiler <version>] [--validator <version>] | vpr template seal <channel>/<series> <template-id> <version> [--dry-run] | vpr template verify <channel>/<series> <template-id> <version> [--update] [--library <path>]", examples: ["vpr template seal sample/poetry poetry-short 1.1.0", "vpr template verify sample/poetry poetry-short 1.1.0", "vpr template release dentro-i-versi/long dentro-i-versi-long 1.1.0 --from 1.0.0 --theme dentro-i-versi@1.1.0", "vpr template release dentro-i-versi/long dentro-i-versi-long 1.2.0 --from 1.1.0 --compiler 1.1.0"], run: cmdTemplate },
   takes: { name: "takes", description: "List each stage's kept candidates and its selected take", usage: "vpr takes <channel>/<series>/<episode> [<stage-id>] [--pipeline <name>] [--json]", examples: ["vpr takes my-channel/my-series/ep001 illustrations"], run: cmdTakes },
   select: { name: "select", description: "Make an earlier candidate a stage's take; an operator's selection locks it", usage: "vpr select <channel>/<series>/<episode> <stage-id> <attempt> [--expect <attempt|none>] [--json] [--dry-run]", examples: ["vpr select my-channel/my-series/ep001 illustrations 2 --expect 3"], run: cmdSelect },
   doctor: { name: "doctor", description: "Validate workspace against canonical tree", usage: "vpr doctor --library <path> [--channel X] [--series Y] [--episode Z] [--json]", examples: ["vpr doctor --library /tmp/library", "vpr doctor --library . --channel my-channel --series season-1 --json"], run: cmdDoctor },
````

Create `docs/adr/0041-a-series-release-carries-its-own-code.md`:

````markdown
# ADR-0041: A series release carries its own code

## Status

Accepted (`avg-d1x`, phase 1). Implemented:
- `compiler.bundle` and `validator.bundle` in `SeriesTemplate`;
- the loader that runs a release's sealed bundles;
- `vpr template seal` and `vpr template verify`.

Kits (phase 2), the toolbox (phase 3) and moving dentro-i-versi out of the application (phase 4) follow. See `docs/superpowers/specs/2026-10-09-channel-series-extensions-design.md`.

## Context

ADR-0037 pinned a series template release to a compiler and a validator by `id@version` in the application's registry. That makes every series format application code: dentro-i-versi's director lives in `studio/series`, and a new series means a change to the core.

The operator's rule (2026-10-09): the application holds generic code and capabilities. Everything about a channel or a series, data and procedures, sits at the channel's and the series' level. Each channel is its own git repository.

## Decision

**A series template release may carry its compiler and validator as code.**
- **Source.** The source is `compiler/index.ts` and `validator/index.ts` in the release, exporting `compiler` (a `SeriesCompiler`) and `validator` (a `SeriesValidator`).
- **Sealing.** `vpr template seal` builds each with esbuild into one self-contained CommonJS file:
  - the packages it imports (the contracts' helpers, later the toolbox) are inlined, so a later change to them never alters the release;
  - Node's built-ins stay external;
  - path comments are dropped, so the bundle is the same wherever the library and the application sit.
- **The manifest.** It names the bundle and its sha256: `compiler: {id, version, bundle: {path, hash}}`. A release without `bundle` keeps the registered compiler or validator, so ADR-0037 releases are unchanged.
- **Loading.** The loader reads the bundle like every other file of the release:
  - inside the series, its hash recorded among the timeline's inputs;
  - refused when its hash isn't the sealed one (`code-mismatch`), missing (`missing-code`), or not exporting the role (`bad-code`).

  It runs the bytes it checked, one module per hash. The compiler and validator must say the `id@version` the manifest names.
- **Pinned releases.** A release an episode pins is never resealed (`release-pinned`). A change is a new release: `template release --from`, change the source, seal.
- **Tests travel with the code.** `vpr template verify`:
  - checks the bundles;
  - rebuilds the source and compares;
  - compiles `fixtures/<name>/input.json` as this release and compares with `expected-timeline.json` byte for byte;
  - holds the result to the release's validator.

## Consequences

- **A series format is library data plus library code.** The application runs it without knowing it, and it is versioned in its channel's repository.
- **The application runs code from the library**, in its own process. It is a local, single-user system; isolation from the user's own code is avg-qr4.8's OS question, not this one's.
- **The registry stays.** It holds the starter compilers and what phase 4 has not moved yet.
````

- [ ] **Step 4: Run them, and see them pass.**
  - `npm run build --workspace @studio/runtime`.
  - `cd studio/runtime && npx vitest run`: all pass, including the 2 new tests.
  - At the root, `npm run check`.

- [ ] **Step 5: Commit.**

```bash
git add studio/runtime/src/cli.ts studio/runtime/test/integration/cli-template-code.test.ts docs/running.md docs/index.md docs/adr/0041-a-series-release-carries-its-own-code.md
git commit -m "vpr template seal and verify; ADR-0041: a series release carries its own code (avg-d1x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
