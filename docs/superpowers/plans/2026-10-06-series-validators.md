# Series Validators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Series validators (avg-jao.3): pure, versioned rules beside the compilers in `@studio/series`, first `poetry-short@1.0.0`, applied to whatever is rendered (hand edits included); errors refuse `pva_build_timeline` and `pva_compose_video` before anything is written; a new `pva_check_episode` runs the same check writing nothing.

**Architecture:** `checkSeries(ValidateInput)` dispatches on `template.validator` and returns `{validator, findings}`; each validator version is frozen by golden cases (edits of the compiler fixture's golden timeline with exact `[code, severity, path]`). In the agent, the loader splits into `loadEpisode` / `compileEpisode` / `checkEpisode` (findings located as `file#path`); `episode-render.ts` splits `currentEditTimeline` into `decideEditTimeline` (reads only, carries `validation`) and `applyDecision` (writes), so the render refuses on errors before writing and the check tool writes nothing.

**Tech Stack:** TypeScript (NodeNext), `node:test` + `tsx` (`@studio/series`), vitest (`studio/agent`), `@studio/series` consumed by the agent from `dist/`.

**Spec:** `docs/superpowers/specs/2026-10-06-series-validators-design.md`

## Global Constraints

- Branch `feat/series-validators` (already holds the spec commit). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit paths only.
- `.beads/` changes are not part of these commits unless the plan says so; never run `bd`.
- Validators are pure (no file, clock, randomness or environment), never mutate their input, are deterministic; a version file imports only `@studio/contracts` helpers and `../../types.js`, keeps its helpers inside, does not import a compiler.
- A released validator version is frozen by its golden cases; a new rule is a new version.
- `poetry-short@1.0.0` numbers: 300–1800 frames (10–60 s), flash < 30 frames, long > 210 frames, crossfade 12 frames, caption 42 characters.
- After changing `studio/series/src`, rebuild its `dist/` (`npm run build --workspace @studio/series`): the agent imports it from there.
- Never run `bun install` (no dependency changes in this plan).
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.

## Review Focus

- A hand edit the contracts already reject (e.g. overlapping panels) → the contracts' error, not a series finding, and nothing rendered (existing tk7.6 behaviour; Task 3's warnings test uses a spec change for that reason).
- A spec edit that makes the video too short after a valid render → `pva_compose_video` refuses with `duration-range` and "change the spec or the takes", writes no rebuilt timeline (Task 3: build refusal test and check-recompiled test cover the decision; the render path shares `decideEditTimeline`).
- `pva_check_episode` on an episode with no timeline yet → "would be recompiled: there was no timeline yet" and the compiled timeline's findings, nothing written (Task 3: legacy-episode test asserts the wording; spec-driven case shares the code).
- A template that names no validator → "no series rules", nothing blocked (Task 1: `checkSeries` returns `{validator: null, findings: []}`; Task 3's legacy test checks the wording).
- Findings about the spec (`missing-picture`) → located in `episode-spec.json`, not in the timeline (Task 2: "locates a finding about the spec in the spec").

---

### Task 1: `@studio/series` — validator registry, `checkSeries`, `poetry-short@1.0.0` (validator), golden cases

**Files:**
- Modify: `studio/series/src/types.ts` (append), `studio/series/src/index.ts` (replace), `studio/series/README.md`
- Create: `studio/series/src/validators.ts`, `studio/series/src/validators/poetry-short/1.0.0.ts`, `studio/series/fixtures/validators/poetry-short/1.0.0/cases.json`
- Test: `studio/series/test/json-path.ts` (helper), `studio/series/test/validators-golden.test.ts`, `studio/series/test/check-series.test.ts`

**Interfaces:**
- Consumes: the compiler fixture `fixtures/poetry-short/1.0.0/{input.json,expected-timeline.json}` (its `template.validator` is `poetry-short@1.0.0`); `compileSpec`.
- Produces (exported from `@studio/series`): `checkSeries(input: ValidateInput): CheckResult`, `resolveValidator(id, version)`, `listValidators()`, `VALIDATORS`; types `ValidateInput extends CompileInput { timeline: EditTimeline; compiled: EditTimeline }`, `Finding { code; severity: "error" | "warning"; path; message }`, `SeriesValidator`, `CheckResult { validator: string | null; findings: Finding[] }`.

- [ ] **Step 1: Write the test helper, the golden cases and the failing tests**

`studio/series/test/json-path.ts`:

```ts
// Set a value at a JSON path such as $.tracks[1].items[0].props.text.
// `null` deletes: the key from an object, the element from an array.

export function setPath(doc: unknown, path: string, value: unknown): void {
  const keys = [...path.slice(1).matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g)].map((m) => (m[1] !== undefined ? m[1] : Number(m[2])));
  if (!path.startsWith("$") || keys.length === 0) throw new Error(`not a JSON path: ${path}`);
  let at: any = doc;
  for (const key of keys.slice(0, -1)) {
    if (at[key] === undefined) throw new Error(`${path}: nothing at ${String(key)}`);
    at = at[key];
  }
  const last = keys.at(-1)!;
  if (value === null) {
    if (Array.isArray(at)) at.splice(last as number, 1);
    else delete at[last];
  } else at[last] = structuredClone(value);
}
```

`studio/series/fixtures/validators/poetry-short/1.0.0/cases.json`:

```json
{
  "compiler": { "id": "poetry-short", "version": "1.0.0" },
  "cases": [
    {
      "name": "the compiled timeline, untouched",
      "set": [],
      "expect": []
    },
    {
      "name": "a picture change moved by 10 frames and a caption split at a word: within the rules",
      "set": [
        { "path": "$.tracks[0].items[0].duration", "value": 113 },
        { "path": "$.tracks[0].items[1].from", "value": 101 },
        { "path": "$.tracks[0].items[1].duration", "value": 110 },
        { "path": "$.tracks[1].items[0].props.text", "value": "Light falls across" },
        { "path": "$.tracks[1].items[0].duration", "value": 30 },
        { "path": "$.tracks[1].items[3]", "value": { "id": "caption-4", "from": 33, "duration": 39, "kit": { "name": "captions", "version": "1.1.0" }, "props": { "text": "the quiet room.", "position": "bottom", "font": "Georgia" }, "source": "narration" } }
      ],
      "expect": []
    },
    {
      "name": "a track removed",
      "set": [{ "path": "$.tracks[2]", "value": null }],
      "expect": [{ "code": "missing-track", "severity": "error", "path": "$.tracks" }]
    },
    {
      "name": "the loudness of the profile changed",
      "set": [{ "path": "$.profile.loudness.integrated", "value": -16 }],
      "expect": [{ "code": "profile-changed", "severity": "error", "path": "$.profile" }]
    },
    {
      "name": "no hold: 9.3 s, under 10 s",
      "setInput": [{ "path": "$.spec.data.holdSeconds", "value": 0 }],
      "set": [],
      "expect": [{ "code": "duration-range", "severity": "error", "path": "$.durationInFrames" }]
    },
    {
      "name": "a 60 s hold: over 60 s, and the last picture held",
      "setInput": [{ "path": "$.spec.data.holdSeconds", "value": 60 }],
      "set": [],
      "expect": [
        { "code": "duration-range", "severity": "error", "path": "$.durationInFrames" },
        { "code": "panel-long", "severity": "warning", "path": "$.tracks[0].items[2]" }
      ]
    },
    {
      "name": "a music track added",
      "set": [{ "path": "$.tracks[3]", "value": { "id": "music", "type": "audio", "items": [] } }],
      "expect": [{ "code": "extra-track", "severity": "error", "path": "$.tracks[3]" }]
    },
    {
      "name": "the captions hidden",
      "set": [{ "path": "$.tracks[1].hidden", "value": true }],
      "expect": [{ "code": "hidden-track", "severity": "error", "path": "$.tracks[1]" }]
    },
    {
      "name": "the voice muted",
      "set": [{ "path": "$.tracks[2].muted", "value": true }],
      "expect": [{ "code": "hidden-track", "severity": "error", "path": "$.tracks[2]" }]
    },
    {
      "name": "a panel played as a clip",
      "set": [{ "path": "$.tracks[0].items[1].kit", "value": { "name": "clip", "version": "1.0.0" } }],
      "expect": [{ "code": "forbidden-kit", "severity": "error", "path": "$.tracks[0].items[1].kit" }]
    },
    {
      "name": "captions in another kit version",
      "set": [{ "path": "$.tracks[1].items[0].kit", "value": { "name": "captions", "version": "1.0.0" } }],
      "expect": [{ "code": "forbidden-kit", "severity": "error", "path": "$.tracks[1].items[0].kit" }]
    },
    {
      "name": "a fade instead of a crossfade, and a caption fading out",
      "set": [
        { "path": "$.tracks[0].items[1].transitionIn", "value": { "type": "fade", "duration": 12 } },
        { "path": "$.tracks[1].items[2].transitionOut", "value": { "type": "fade", "duration": 6 } }
      ],
      "expect": [
        { "code": "forbidden-transition", "severity": "error", "path": "$.tracks[0].items[1]" },
        { "code": "forbidden-transition", "severity": "error", "path": "$.tracks[1].items[2]" }
      ]
    },
    {
      "name": "a longer crossfade",
      "set": [{ "path": "$.tracks[0].items[2].transitionIn.duration", "value": 24 }],
      "expect": [{ "code": "forbidden-transition", "severity": "error", "path": "$.tracks[0].items[2]" }]
    },
    {
      "name": "a take moved, another made louder",
      "set": [
        { "path": "$.tracks[2].items[0].from", "value": 3 },
        { "path": "$.tracks[2].items[1].gain", "value": 1.5 }
      ],
      "expect": [
        { "code": "altered-voice", "severity": "error", "path": "$.tracks[2].items[0]" },
        { "code": "altered-voice", "severity": "error", "path": "$.tracks[2].items[1]" }
      ]
    },
    {
      "name": "the hold's second piece removed",
      "set": [{ "path": "$.tracks[2].items[2]", "value": null }],
      "expect": [{ "code": "altered-voice", "severity": "error", "path": "$.tracks[2]" }]
    },
    {
      "name": "a caption rewritten by hand",
      "set": [{ "path": "$.tracks[1].items[0].props.text", "value": "Light falls across the room." }],
      "expect": [{ "code": "text-not-voice", "severity": "error", "path": "$.tracks[1]" }]
    },
    {
      "name": "the cat never shown",
      "set": [{ "path": "$.tracks[0].items[2].props.src.$asset", "value": "image-teacup" }],
      "expect": [{ "code": "missing-picture", "severity": "error", "path": "$.data.panels[2]" }]
    },
    {
      "name": "the last picture cut short",
      "set": [{ "path": "$.tracks[0].items[2].duration", "value": 100 }],
      "expect": [{ "code": "uncovered-frames", "severity": "error", "path": "$.tracks[0]" }]
    },
    {
      "name": "a picture on screen for under a second",
      "set": [
        { "path": "$.tracks[0].items[0].duration", "value": 185 },
        { "path": "$.tracks[0].items[1].from", "value": 180 },
        { "path": "$.tracks[0].items[1].duration", "value": 25 }
      ],
      "expect": [{ "code": "panel-flash", "severity": "warning", "path": "$.tracks[0].items[1]" }]
    },
    {
      "name": "the first picture held over 7 s",
      "set": [{ "path": "$.tracks[0].items[0].duration", "value": 220 }],
      "expect": [{ "code": "panel-long", "severity": "warning", "path": "$.tracks[0].items[0]" }]
    },
    {
      "name": "two captions merged into one too long",
      "set": [
        { "path": "$.tracks[1].items[0].props.text", "value": "Light falls across the quiet room. A cup of tea is cooling by the window." },
        { "path": "$.tracks[1].items[1]", "value": null }
      ],
      "expect": [{ "code": "caption-long", "severity": "warning", "path": "$.tracks[1].items[0]" }]
    }
  ]
}
```

`studio/series/test/validators-golden.test.ts`:

```ts
// Every released validator version gives, on each of its golden cases, the
// findings it was released with — code, severity and path, in order. A case
// starts from its compiler fixture's golden timeline, may change the compile
// input (`setInput`, then recompiled) and edits the timeline (`set`), as a
// person editing by hand would. Messages are not part of the golden.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeries, compileSpec, listValidators, VALIDATORS, type EditTimeline } from "../src/index.js";
import { setPath } from "./json-path.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");

interface Case {
  name: string;
  setInput?: { path: string; value: unknown }[];
  set: { path: string; value: unknown }[];
  expect: { code: string; severity: string; path: string }[];
}

for (const { id, version } of listValidators()) {
  const file = join(fixtures, "validators", id, version, "cases.json");
  test(`${id}@${version} (validator) has golden cases`, () => {
    assert.ok(existsSync(file), `fixtures/validators/${id}/${version}/cases.json is missing: every released validator has one`);
  });
  if (!existsSync(file)) continue;
  const golden = JSON.parse(readFileSync(file, "utf-8")) as { compiler: { id: string; version: string }; cases: Case[] };
  const compilerDir = join(fixtures, golden.compiler.id, golden.compiler.version);

  for (const c of golden.cases) {
    test(`${id}@${version} (validator): ${c.name}`, () => {
      const input = JSON.parse(readFileSync(join(compilerDir, "input.json"), "utf-8"));
      let compiled: EditTimeline = JSON.parse(readFileSync(join(compilerDir, "expected-timeline.json"), "utf-8"));
      if (c.setInput && c.setInput.length > 0) {
        for (const { path, value } of c.setInput) setPath(input, path, value);
        const result = compileSpec(input);
        assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
        compiled = result.timeline;
      }
      const timeline = structuredClone(compiled);
      for (const { path, value } of c.set) setPath(timeline, path, value);
      input.template.validator = { id, version };

      const result = checkSeries({ ...input, timeline, compiled });
      assert.equal(result.validator, `${id}@${version}`);
      assert.deepEqual(
        result.findings.map((f) => ({ code: f.code, severity: f.severity, path: f.path })),
        c.expect,
        `${id}@${version} no longer gives the findings it was released with: add src/validators/${id}/<next>.ts instead of changing this version`,
      );
    });
  }
}

test("validator ids and versions are well formed and unique", () => {
  const seen = new Set<string>();
  for (const v of VALIDATORS) {
    assert.match(v.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(v.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.ok(v.description.trim().length > 0);
    assert.ok(!seen.has(`${v.id}@${v.version}`), `${v.id}@${v.version} registered twice`);
    seen.add(`${v.id}@${v.version}`);
  }
});
```

`studio/series/test/check-series.test.ts`:

```ts
// checkSeries: which validator runs, and what it may not do.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSeries, type ValidateInput } from "../src/index.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "poetry-short", "1.0.0");
function load(): ValidateInput {
  const input = JSON.parse(readFileSync(join(DIR, "input.json"), "utf-8"));
  const compiled = JSON.parse(readFileSync(join(DIR, "expected-timeline.json"), "utf-8"));
  return { ...input, compiled, timeline: structuredClone(compiled) };
}

test("a template that names no validator has no series rules", () => {
  const input = load();
  delete (input.template as { validator?: unknown }).validator;
  assert.deepEqual(checkSeries(input), { validator: null, findings: [] });
});

test("unknown-validator names the versions that exist", () => {
  const input = load();
  input.template.validator = { id: "poetry-short", version: "2.0.0" };
  const result = checkSeries(input);
  assert.equal(result.validator, "poetry-short@2.0.0");
  assert.deepEqual(result.findings.map((f) => [f.code, f.severity, f.path]), [["unknown-validator", "error", "$.template.validator"]]);
  assert.match(result.findings[0]!.message, /poetry-short@2\.0\.0: available poetry-short@1\.0\.0/);
});

test("checking is deterministic and does not change its input", () => {
  const input = load();
  (input.timeline.tracks[1]!.items[0] as { props: unknown }).props = { text: "Light falls across the room.", position: "bottom", font: "Georgia" };
  const before = structuredClone(input);
  assert.deepEqual(checkSeries(structuredClone(input)), checkSeries(structuredClone(input)));
  checkSeries(input);
  assert.deepEqual(input, before);
});

test("the untouched compiled timeline passes poetry-short@1.0.0", () => {
  assert.deepEqual(checkSeries(load()), { validator: "poetry-short@1.0.0", findings: [] });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/series && node --import tsx --test "test/**/*.test.ts"`
Expected: FAIL — `checkSeries` / `listValidators` not exported from `../src/index.js`.

- [ ] **Step 3: Implement**

Append to `studio/series/src/types.ts`:

```ts
/** What a series validator checks: the compile input, the timeline to render and the compiled reference. */
export interface ValidateInput extends CompileInput {
  /** The timeline about to be rendered: stored (possibly hand-edited) or fresh. */
  timeline: EditTimeline;
  /** What the release's compiler makes of the same inputs: the reference. */
  compiled: EditTimeline;
}

/**
 * One breach of a series rule. Paths $.tracks…, $.profile and
 * $.durationInFrames point into `timeline`; $.data… into the spec.
 */
export interface Finding {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface SeriesValidator {
  /** ^[a-z0-9]+(-[a-z0-9]+)*$, as a SeriesTemplate's `validator.id`. */
  id: string;
  /** Exact x.y.z. */
  version: string;
  /** One sentence. */
  description: string;
  validate(input: ValidateInput): Finding[];
}

export interface CheckResult {
  /** "<id>@<version>" of the validator that ran; null when the template names none. */
  validator: string | null;
  findings: Finding[];
}
```

`studio/series/src/validators.ts`:

```ts
// The registered series validators, and the check that runs the one a
// template names. Like compilers, each released version is its own file and
// stays registered; its golden cases hold it to the findings it was released
// with.

import type { CheckResult, SeriesValidator, ValidateInput } from "./types.js";
import { validator as poetryShort100 } from "./validators/poetry-short/1.0.0.js";

export const VALIDATORS: readonly SeriesValidator[] = Object.freeze([poetryShort100]);

/** The validator with exactly this id and version, or undefined. */
export function resolveValidator(id: string, version: string): SeriesValidator | undefined {
  return VALIDATORS.find((v) => v.id === id && v.version === version);
}

/** Every registered validator, sorted by id then version. */
export function listValidators(): { id: string; version: string; description: string }[] {
  return VALIDATORS.map(({ id, version, description }) => ({ id, version, description }))
    .sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));
}

/** Run the series rules the template names on the timeline about to be rendered. */
export function checkSeries(input: ValidateInput): CheckResult {
  const ref = input.template.validator;
  if (!ref) return { validator: null, findings: [] };
  const validator = resolveValidator(ref.id, ref.version);
  if (!validator) {
    const available = listValidators().filter((v) => v.id === ref.id).map((v) => `${v.id}@${v.version}`);
    return {
      validator: `${ref.id}@${ref.version}`,
      findings: [{
        code: "unknown-validator",
        severity: "error",
        path: "$.template.validator",
        message: `${ref.id}@${ref.version}: ${available.length > 0 ? `available ${available.join(", ")}` : "no validator with this id"}`,
      }],
    };
  }
  return { validator: `${validator.id}@${validator.version}`, findings: validator.validate(input) };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}
```

`studio/series/src/validators/poetry-short/1.0.0.ts`:

```ts
// poetry-short@1.0.0 (validator) — released: never edit this file; add poetry-short/<next>.ts instead.
//
// The mechanical rules of the poetry-short format, checked on the timeline
// that is about to be rendered — hand edits included — with what the
// compiler makes of the same inputs as the reference. A hand edit may move a
// picture change or split a caption; it may not touch the voice, the text,
// the profile or the effects. Everything this version does is in this file,
// and its golden cases fail if its findings ever change.

import type { EditTimeline, Finding, SeriesValidator, ValidateInput } from "../../types.js";

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
  narration: string;
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

  const said = collapse([...captions].sort((a, b) => a.from - b.from).map((c) => String(c.props?.text ?? "")).join(" "));
  if (captionsAt !== -1 && said !== collapse(data.narration)) {
    error("text-not-voice", `$.tracks[${captionsAt}]`, `the captions say "${said}", not the narration: change the spec and the takes, not the captions`);
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
```

Replace `studio/series/src/index.ts` with:

```ts
export { compileSpec } from "./compile.js";
export { COMPILERS, listCompilers, resolveCompiler } from "./registry.js";
export { checkSeries, listValidators, resolveValidator, VALIDATORS } from "./validators.js";
export type {
  CheckResult,
  CompileAsset,
  CompileInput,
  CompileProblem,
  CompileResult,
  EditTimeline,
  EpisodeSpec,
  Finding,
  NarrationTakes,
  SeriesCompiler,
  SeriesTemplate,
  SeriesValidator,
  ValidateInput,
  WordTiming,
} from "./types.js";
```

- [ ] **Step 4: Run the tests, typecheck, build**

Run: `cd studio/series && node --import tsx --test "test/**/*.test.ts" && npx tsc --noEmit && npm run build`
Expected: `# pass 50`, `# fail 0` (23 earlier + 21 golden cases + "has golden cases" + ids test + 4 `checkSeries` tests); no type errors; `dist/validators.js` exists.

- [ ] **Step 5: README**

Apply to `studio/series/README.md`:

````diff
diff --git a/studio/series/README.md b/studio/series/README.md
index 44c5d95..1122c9d 100644
--- a/studio/series/README.md
+++ b/studio/series/README.md
@@ -34,6 +34,31 @@ input.
 |---|---|
 | `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |
 
+## Validators
+
+A template release may also name a **validator**: the series' mechanical
+rules, checked on the timeline about to be rendered — hand edits included —
+against what the compiler makes of the same inputs.
+
+```ts
+import { checkSeries } from "@studio/series";
+
+const { validator, findings } = checkSeries({ ...input, timeline, compiled });
+// findings: [{ code, severity: "error" | "warning", path, message }]
+```
+
+| Validator | Rules |
+|---|---|
+| `poetry-short@1.0.0` | Errors: a track missing, `profile-changed`, `duration-range` (10–60 s), `extra-track`, `hidden-track`, `forbidden-kit`, `forbidden-transition` (only a 12-frame crossfade in), `altered-voice` (takes never cut, moved or reworked), `text-not-voice` (the captions say exactly the narration), `missing-picture`, `uncovered-frames`. Warnings: `panel-flash` (under 1 s), `panel-long` (over 7 s), `caption-long` (over 42 characters). |
+
+Like compilers, validators are pure, one file per version
+(`src/validators/<id>/<version>.ts`, registered in `src/validators.ts`, the
+same import rule), and frozen: `fixtures/validators/<id>/<version>/cases.json`
+lists edits of a compiler fixture's golden timeline (`set`, and `setInput`
+for the compile input) with the exact findings — code, severity, path, in
+order. `test/validators-golden.test.ts` holds every version to them; a new
+rule is a new version, never a changed case.
+
 ## Adding a compiler or a version
 
 - One file per version: `src/compilers/<id>/<version>.ts`, exporting
````

- [ ] **Step 6: Commit**

```bash
git add studio/series/src/types.ts studio/series/src/index.ts studio/series/src/validators.ts studio/series/src/validators/poetry-short/1.0.0.ts studio/series/fixtures/validators studio/series/test/json-path.ts studio/series/test/validators-golden.test.ts studio/series/test/check-series.test.ts studio/series/README.md
git commit -m "feat(series): validator registry and poetry-short@1.0.0 rules, frozen by golden cases (avg-jao.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Agent loader — `loadEpisode`, `compileEpisode`, `checkEpisode`

**Files:**
- Modify: `studio/agent/src/series-compile.ts`
- Test: `studio/agent/tests/series-compile.test.ts`

**Interfaces:**
- Consumes: `checkSeries`, `CompileInput`, `Finding` from `@studio/series` (Task 1, built `dist/`).
- Produces: `loadEpisode(episodeDir, {episodeRef}) → {ok: true, input: CompileInput, releaseKey: string} | {ok: false, problems}`; `compileEpisode` (results unchanged); `checkEpisode(episodeDir, {episodeRef, timeline?}) → {ok: true, compiled: EditTimeline, validator: string | null, findings: SeriesFinding[]} | {ok: false, problems}`; `SeriesFinding extends SeriesCompileProblem { severity: "error" | "warning" }`. Paths `$.tracks…`, `$.profile`, `$.durationInFrames` (also `$.resolution`, `$.assets`, `$.sections`) → `artifacts/edit-timeline.json#…`; `$.data…` → `episode-spec.json#…`; `$.template.validator` → `<release>/series-template.json#$.validator`.

- [ ] **Step 1: Write the failing tests**

Apply to `studio/agent/tests/series-compile.test.ts`:

```diff
diff --git a/studio/agent/tests/series-compile.test.ts b/studio/agent/tests/series-compile.test.ts
index 00818b0..4ad2d42 100644
--- a/studio/agent/tests/series-compile.test.ts
+++ b/studio/agent/tests/series-compile.test.ts
@@ -2,7 +2,7 @@ import { afterEach, beforeEach, describe, expect, it } from "vitest";
 import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
 import { tmpdir } from "node:os";
 import { dirname, join } from "node:path";
-import { compileEpisode, isSpecDriven } from "../src/series-compile.js";
+import { checkEpisode, compileEpisode, isSpecDriven, loadEpisode } from "../src/series-compile.js";
 import { editSpec, sha256, specEpisode } from "./spec-episode.js";
 
 /**
@@ -183,3 +183,60 @@ describe("compileEpisode", () => {
     expect(problemsOf()).toEqual([["unknown-word", "episode-spec.json#$.data.panels[1].cue"]]);
   });
 });
+
+describe("loadEpisode", () => {
+  it("gives the compile input without compiling, every file hashed", () => {
+    const loaded = loadEpisode(dir(), { episodeRef: REF });
+    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
+    expect(loaded.releaseKey).toBe("../../templates/poetry-short/1.0.0");
+    expect(loaded.input.spec.revision).toBe(2);
+    expect(Object.keys(loaded.input.inputs)).toHaveLength(13);
+    expect(Object.keys(loaded.input.assets).sort()).toEqual(["image-cat", "image-morning-room", "image-teacup", "narration-cup", "narration-light"]);
+  });
+});
+
+describe("checkEpisode", () => {
+  it("finds nothing wrong with the compiled timeline of a complete episode", () => {
+    const result = checkEpisode(dir(), { episodeRef: REF });
+    if (!result.ok) throw new Error(JSON.stringify(result.problems));
+    expect(result.validator).toBe("poetry-short@1.0.0");
+    expect(result.findings).toEqual([]);
+    expect(result.compiled.durationInFrames).toBe(324);
+  });
+
+  it("checks the timeline it is given, against what the compiler makes", () => {
+    const compiled = compileEpisode(dir(), { episodeRef: REF });
+    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
+    const timeline = structuredClone(compiled.timeline) as any;
+    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
+    const result = checkEpisode(dir(), { episodeRef: REF, timeline });
+    if (!result.ok) throw new Error(JSON.stringify(result.problems));
+    expect(result.findings.map((f) => [f.code, f.severity, f.path])).toEqual([
+      ["text-not-voice", "error", "artifacts/edit-timeline.json#$.tracks[1]"],
+    ]);
+  });
+
+  it("finds a spec whose video is shorter than the series allows", () => {
+    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
+    const result = checkEpisode(dir(), { episodeRef: REF });
+    if (!result.ok) throw new Error(JSON.stringify(result.problems));
+    expect(result.findings.map((f) => [f.code, f.path])).toEqual([["duration-range", "artifacts/edit-timeline.json#$.durationInFrames"]]);
+  });
+
+  it("locates a finding about the spec in the spec", () => {
+    const compiled = compileEpisode(dir(), { episodeRef: REF });
+    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
+    const timeline = structuredClone(compiled.timeline) as any;
+    timeline.tracks[0].items[2].props.src.$asset = "image-teacup";
+    const result = checkEpisode(dir(), { episodeRef: REF, timeline });
+    if (!result.ok) throw new Error(JSON.stringify(result.problems));
+    expect(result.findings.map((f) => [f.code, f.path])).toEqual([["missing-picture", "episode-spec.json#$.data.panels[2]"]]);
+  });
+
+  it("reports the loader's problems when the episode cannot be compiled", () => {
+    unlinkSync(at("artifacts/narration/takes.json"));
+    const result = checkEpisode(dir(), { episodeRef: REF });
+    expect(result.ok).toBe(false);
+    if (!result.ok) expect(result.problems.map((p) => p.code)).toEqual(["missing-narration"]);
+  });
+});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/agent && npx vitest run tests/series-compile.test.ts`
Expected: FAIL — `checkEpisode` / `loadEpisode` are not exported.

- [ ] **Step 3: Implement**

Apply to `studio/agent/src/series-compile.ts`:

```diff
diff --git a/studio/agent/src/series-compile.ts b/studio/agent/src/series-compile.ts
index b4fdd40..dc80d39 100644
--- a/studio/agent/src/series-compile.ts
+++ b/studio/agent/src/series-compile.ts
@@ -12,7 +12,7 @@
 import { createHash } from "node:crypto";
 import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
 import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
-import { compileSpec, type CompileAsset, type CompileProblem, type EditTimeline } from "@studio/series";
+import { checkSeries, compileSpec, type CompileAsset, type CompileInput, type CompileProblem, type EditTimeline, type Finding } from "@studio/series";
 import { EPISODE_SPEC_PATH, SERIES_TEMPLATE_MANIFEST, seriesTemplatePath } from "@studio/contracts/src/layout.mjs";
 import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
 import { SERIES_TEMPLATE_FILES, validateEpisodeSpec, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
@@ -40,6 +40,26 @@ export type EpisodeCompileResult =
   }
   | { ok: false; problems: SeriesCompileProblem[] };
 
+/** A series rule broken by the timeline about to be rendered, located like a problem. */
+export interface SeriesFinding extends SeriesCompileProblem {
+  severity: "error" | "warning";
+}
+
+export type EpisodeLoadResult =
+  | { ok: true; input: CompileInput; releaseKey: string }
+  | { ok: false; problems: SeriesCompileProblem[] };
+
+export type EpisodeCheckResult =
+  | {
+    ok: true;
+    /** What the release's compiler makes of the episode: the reference. */
+    compiled: EditTimeline;
+    /** "<id>@<version>" of the validator that ran; null when the template names none. */
+    validator: string | null;
+    findings: SeriesFinding[];
+  }
+  | { ok: false; problems: SeriesCompileProblem[] };
+
 /** Does this episode have a spec, and so a compiler instead of the legacy builder? */
 export function isSpecDriven(episodeDir: string): boolean {
   return existsSync(join(episodeDir, EPISODE_SPEC_PATH));
@@ -58,23 +78,65 @@ const at = (file: string, problems: { code: string; message: string; path?: stri
 const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
 
 /**
- * Compile the episode's spec. Reads files only; writes nothing. Every file
- * read is in the timeline's `metadata.inputs` with its hash, keyed by its
- * path relative to the episode (release files as ../../templates/…).
+ * Read, check and hash everything the episode's compiler needs. Reads files
+ * only; writes nothing. Every file read is in `input.inputs` with its hash,
+ * keyed by its path relative to the episode (release files as ../../templates/…).
  */
-export function compileEpisode(
+export function loadEpisode(
   episodeDir: string,
   options: { episodeRef: { channel: string; series: string; episode: string } },
-): EpisodeCompileResult {
+): EpisodeLoadResult {
   try {
-    return compile(resolve(episodeDir), options.episodeRef);
+    return load(resolve(episodeDir), options.episodeRef);
   } catch (error) {
     if (error instanceof Stop) return { ok: false, problems: error.problems };
     throw error;
   }
 }
 
-function compile(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }): EpisodeCompileResult {
+/** Compile the episode's spec with its release's compiler. Writes nothing. */
+export function compileEpisode(
+  episodeDir: string,
+  options: { episodeRef: { channel: string; series: string; episode: string } },
+): EpisodeCompileResult {
+  const loaded = loadEpisode(episodeDir, options);
+  if (!loaded.ok) return loaded;
+  const { input, releaseKey } = loaded;
+  const result = compileSpec(input);
+  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
+  return {
+    ok: true,
+    timeline: result.timeline,
+    warnings: result.warnings,
+    compiler: `${input.template.compiler.id}@${input.template.compiler.version}`,
+    template: { ...input.spec.template },
+    revision: input.spec.revision,
+  };
+}
+
+/**
+ * The series rules on the timeline about to be rendered (by default, the
+ * one the compiler makes). Writes nothing.
+ */
+export function checkEpisode(
+  episodeDir: string,
+  options: { episodeRef: { channel: string; series: string; episode: string }; timeline?: EditTimeline },
+): EpisodeCheckResult {
+  const loaded = loadEpisode(episodeDir, options);
+  if (!loaded.ok) return loaded;
+  const { input, releaseKey } = loaded;
+  const result = compileSpec(input);
+  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
+  const checked = checkSeries({ ...input, compiled: result.timeline, timeline: options.timeline ?? result.timeline });
+  return {
+    ok: true,
+    compiled: result.timeline,
+    validator: checked.validator,
+    findings: checked.findings.map((f: Finding) => ({ ...locate(f, releaseKey), severity: f.severity })),
+  };
+}
+
+function load(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }): EpisodeLoadResult {
   const seriesDir = dirname(dirname(episodeDir));
   const inputs: Record<string, string> = {};
 
@@ -192,26 +254,18 @@ function compile(episodeDir: string, episodeRef: { channel: string; series: stri
     assets[id] = { path, hash: inputs[path]!, kind: "image" };
   }
 
-  // ── Compile ───────────────────────────────────────────────────────────────
-  const result = compileSpec({ spec, template, narration, timings, assets, inputs });
-  if (!result.ok) return { ok: false, problems: result.problems.map((p) => locate(p, releaseKey)) };
-  return {
-    ok: true,
-    timeline: result.timeline,
-    warnings: result.warnings,
-    compiler: `${template.compiler.id}@${template.compiler.version}`,
-    template: { ...spec.template },
-    revision: spec.revision,
-  };
+  return { ok: true, input: { spec, template, narration, timings, assets, inputs }, releaseKey };
 }
 
-/** A compiler's paths point into its input; name the file each one is in. */
+const IN_TIMELINE = /^\$\.(tracks|profile|durationInFrames|resolution|assets|sections)\b/;
+
+/** A compiler's or validator's paths point into its input; name the file each one is in. */
 function locate(problem: CompileProblem, releaseKey: string): SeriesCompileProblem {
   const { path } = problem;
   const file = path.startsWith("$.data") || path.startsWith("$.episodeRef") ? EPISODE_SPEC_PATH
     : path.startsWith("$.units") || path.startsWith("$.takes") ? NARRATION_TAKES_PATH
     : path.startsWith("$.template") ? `${releaseKey}/${SERIES_TEMPLATE_MANIFEST}`
-    : problem.code.startsWith("timeline:") ? "artifacts/edit-timeline.json"
+    : problem.code.startsWith("timeline:") || IN_TIMELINE.test(path) ? "artifacts/edit-timeline.json"
     : null;
   const inFile = path.startsWith("$.template") ? path.replace(/^\$\.template/, "$") : path;
   return { code: problem.code, message: problem.message, path: file ? `${file}#${inFile}` : path };
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd studio/agent && npx vitest run tests/series-compile.test.ts tests/compose-spec.test.ts && npx tsc --noEmit`
Expected: 28 + 8 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add studio/agent/src/series-compile.ts studio/agent/tests/series-compile.test.ts
git commit -m "feat(agent): load, compile and check a spec-driven episode against its series rules (avg-jao.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Renders refuse on series errors; `pva_check_episode`

**Files:**
- Modify: `studio/agent/src/episode-render.ts` (whole file below), `studio/agent/src/capability-tools.ts`, `docs/running.md`
- Test: `studio/agent/tests/compose-spec.test.ts`, `studio/agent/tests/extension.test.ts`, `studio/agent/tests/e2e-scenarios.test.ts`

**Interfaces:**
- Consumes: `checkEpisode`, `SeriesFinding` (Task 2).
- Produces: `Validation { validator: string | null; findings: SeriesFinding[] }`; `SeriesRulesError extends TimelineBuildError` (`code = "series-rules"`, `validator`, `problems` = error findings); `decideEditTimeline(episodeDir, options): TimelineDecision` (reads only: `timeline`, `text`, `hash`, `rebuilt`, `compiledBy`, `validation`, `warnings`); `currentEditTimeline` unchanged in behaviour (decide + apply); `WrittenTimeline.validation`, `EpisodeRender.validation`, report field `validation`; tool `pva_check_episode`.

- [ ] **Step 1: Write the failing tests**

Apply to `studio/agent/tests/compose-spec.test.ts` (updates the jao.2 tests — a 0 s hold is now too short, and a caption rewrite is now refused — and adds the series-rules tests):

```diff
diff --git a/studio/agent/tests/compose-spec.test.ts b/studio/agent/tests/compose-spec.test.ts
index ccafcfd..c8dd22b 100644
--- a/studio/agent/tests/compose-spec.test.ts
+++ b/studio/agent/tests/compose-spec.test.ts
@@ -1,5 +1,5 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
-import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
+import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
 import { tmpdir } from "node:os";
 import { dirname, join } from "node:path";
 import { editSpec, specEpisode } from "./spec-episode.js";
@@ -121,18 +121,23 @@ describe("pva_compose_video on a spec-driven episode", () => {
 
   it("recompiles after the spec is edited, and names the spec as the reason", async () => {
     await tool("pva_build_timeline");
-    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; spec.revision = 3; });
+    editSpec(dir(), (spec) => { spec.data.holdSeconds = 2; spec.revision = 3; });
     const result = await tool("pva_compose_video");
     expect(result.isError).toBeFalsy();
     expect(result.content[0].text).toMatch(/timeline rebuilt: episode-spec\.json changed/);
-    expect(renders.at(-1)!.timeline.durationInFrames).toBe(279);
+    // 9.3 s of narration and 2 s of hold.
+    expect(renders.at(-1)!.timeline.durationInFrames).toBe(339);
     expect(readJson("artifacts/edit-timeline.json").derivedFrom.spec.revision).toBe(3);
   });
 
   it("renders a hand-edited timeline as it stands when its inputs did not change", async () => {
     await tool("pva_build_timeline");
+    // The teacup arrives 10 frames later: a change the series allows.
     const timeline = readJson("artifacts/edit-timeline.json");
-    timeline.tracks.find((t: any) => t.id === "captions").items[0].props.text = "Light falls across the room.";
+    const panels = timeline.tracks.find((t: any) => t.id === "panels").items;
+    panels[0].duration = 113;
+    panels[1].from = 101;
+    panels[1].duration = 110;
     const edited = `${JSON.stringify(timeline, null, 2)}\n`;
     writeFileSync(at("artifacts/edit-timeline.json"), edited);
     const result = await tool("pva_compose_video");
@@ -141,7 +146,7 @@ describe("pva_compose_video on a spec-driven episode", () => {
     expect(result.content[0].text).toMatch(/compiled by poetry-short@1\.0\.0 from episode-spec\.json revision 2, then edited by hand/);
     const current = readJson("output/current.json");
     expect(readJson(`output/${current.renderId}.report.json`).compiledBy.editedByHand).toBe(true);
-    expect(renders.at(-1)!.timeline.tracks.find((t: any) => t.id === "captions").items[0].props.text).toBe("Light falls across the room.");
+    expect(renders.at(-1)!.timeline.tracks.find((t: any) => t.id === "panels").items[1].from).toBe(101);
     expect(readFileSync(at("artifacts/edit-timeline.json"), "utf-8")).toBe(edited);
   });
 
@@ -155,3 +160,101 @@ describe("pva_compose_video on a spec-driven episode", () => {
     expect(existsSync(at("output/current.json"))).toBe(false);
   });
 });
+
+describe("series rules (poetry-short@1.0.0) on a spec-driven episode", () => {
+  /** Every file under the series, with its bytes: to prove a tool wrote nothing. */
+  function snapshot(): Map<string, string> {
+    const files = new Map<string, string>();
+    const walk = (d: string) => {
+      for (const e of readdirSync(d, { withFileTypes: true })) {
+        const p = join(d, e.name);
+        if (e.isDirectory()) walk(p);
+        else files.set(p, readFileSync(p).toString("base64"));
+      }
+    };
+    walk(join(root, REF.channel));
+    return files;
+  }
+  function editTimeline(change: (timeline: any) => void): string {
+    const timeline = readJson("artifacts/edit-timeline.json");
+    change(timeline);
+    const text = `${JSON.stringify(timeline, null, 2)}\n`;
+    writeFileSync(at("artifacts/edit-timeline.json"), text);
+    return text;
+  }
+
+  it("pva_build_timeline refuses a spec whose video falls outside 10–60 s, and writes nothing", async () => {
+    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
+    const result = await tool("pva_build_timeline");
+    expect(result.isError).toBe(true);
+    expect(result.content[0].text).toMatch(/series rules \(poetry-short@1\.0\.0\) refuse this timeline: change the spec or the takes/);
+    expect(result.content[0].text).toMatch(/duration-range at artifacts\/edit-timeline\.json#\$\.durationInFrames/);
+    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
+  });
+
+  it("pva_build_timeline says the rules passed", async () => {
+    const result = await tool("pva_build_timeline");
+    expect(result.content[0].text).toMatch(/series rules poetry-short@1\.0\.0: no errors/);
+  });
+
+  it("pva_compose_video refuses a hand edit that rewrites a caption, renders nothing and leaves the edit alone", async () => {
+    await tool("pva_build_timeline");
+    const edited = editTimeline((t) => { t.tracks[1].items[0].props.text = "Light falls across the room."; });
+    const result = await tool("pva_compose_video");
+    expect(result.isError).toBe(true);
+    const text = result.content[0].text;
+    expect(text).toMatch(/^❌ series-rules: the series rules \(poetry-short@1\.0\.0\) refuse this timeline: fix the edit in artifacts\/edit-timeline\.json, or delete it to recompile/);
+    expect(text).toMatch(/text-not-voice at artifacts\/edit-timeline\.json#\$\.tracks\[1\]/);
+    expect(result.details.code).toBe("series-rules");
+    expect(renders).toHaveLength(0);
+    expect(existsSync(at("output"))).toBe(false);
+    expect(readFileSync(at("artifacts/edit-timeline.json"), "utf-8")).toBe(edited);
+  });
+
+  it("pva_compose_video renders a timeline with only warnings, and records them in the report", async () => {
+    // A 5 s hold keeps the cat on screen for 7.7 s.
+    editSpec(dir(), (spec) => { spec.data.holdSeconds = 5; });
+    const result = await tool("pva_compose_video");
+    expect(result.isError).toBeFalsy();
+    expect(result.content[0].text).toMatch(/⚠️ panel-long at artifacts\/edit-timeline\.json#\$\.tracks\[0\]\.items\[2\]/);
+    const current = readJson("output/current.json");
+    const report = readJson(`output/${current.renderId}.report.json`);
+    expect(report.validation.validator).toBe("poetry-short@1.0.0");
+    expect(report.validation.findings.map((f: any) => [f.code, f.severity])).toEqual([["panel-long", "warning"]]);
+  });
+
+  it("pva_check_episode reports the findings on the timeline as it stands, and writes nothing", async () => {
+    editSpec(dir(), (spec) => { spec.data.holdSeconds = 5; });
+    await tool("pva_build_timeline");
+    editTimeline((t) => { t.tracks[1].items[0].props.text = "Light falls across the room."; });
+    const before = snapshot();
+    const result = await tool("pva_check_episode");
+    expect(result.isError).toBeFalsy();
+    const lines = result.content[0].text.split("\n");
+    expect(lines[0]).toBe("artifacts/edit-timeline.json would be rendered as it stands");
+    expect(lines[1]).toBe("❌ 1 error(s) against poetry-short@1.0.0: pva_compose_video would refuse it");
+    // Errors first.
+    expect(lines[2]).toMatch(/^ {2}❌ text-not-voice at artifacts\/edit-timeline\.json#\$\.tracks\[1\]/);
+    expect(lines[3]).toMatch(/^ {2}⚠️ panel-long at artifacts\/edit-timeline\.json#\$\.tracks\[0\]\.items\[2\]/);
+    expect(snapshot()).toEqual(before);
+  });
+
+  it("pva_check_episode says when the timeline would be recompiled, and checks the recompiled one", async () => {
+    await tool("pva_build_timeline");
+    editSpec(dir(), (spec) => { spec.data.holdSeconds = 0; });
+    const before = snapshot();
+    const result = await tool("pva_check_episode");
+    const text = result.content[0].text;
+    expect(text).toMatch(/^the timeline would be recompiled: episode-spec\.json changed/);
+    expect(text).toMatch(/duration-range at artifacts\/edit-timeline\.json#\$\.durationInFrames/);
+    expect(snapshot()).toEqual(before);
+  });
+
+  it("pva_check_episode on an episode without a spec: no series rules", async () => {
+    rmSync(at("episode-spec.json"));
+    writeFileSync(at("assets/images/s1.png"), "a legacy scene");
+    const result = await tool("pva_check_episode");
+    expect(result.isError).toBeFalsy();
+    expect(result.content[0].text).toMatch(/^the timeline would be recompiled: there was no timeline yet\nno series rules for this episode$/);
+  });
+});
```

In `studio/agent/tests/extension.test.ts`: `expect(mockPi.tools.length).toBe(43);` → `toBe(44)`, and in the sorted tool list add `"pva_check_episode",` between `"pva_channels",` and `"pva_check_staleness",`.

In `studio/agent/tests/e2e-scenarios.test.ts`: `"pva_build_timeline", "pva_compose_video", "pva_compose_multitrack_video",` → `"pva_build_timeline", "pva_check_episode", "pva_compose_video", "pva_compose_multitrack_video",`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/agent && npx vitest run tests/compose-spec.test.ts tests/extension.test.ts tests/e2e-scenarios.test.ts`
Expected: FAIL — no `pva_check_episode`, caption rewrite rendered, no `validation` in the report.

- [ ] **Step 3: Decide without writing, refuse before writing (`episode-render.ts`)**

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
import { checkEpisode, compileEpisode, isSpecDriven, type SeriesFinding } from "./series-compile.js";

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const describe = (problems: BuildProblem[]) => problems.map((p) => `${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`).join("; ");

/** The timeline cannot be built or used; `problems` say why. */
export class TimelineBuildError extends Error {
  constructor(readonly problems: BuildProblem[], lead = "the edit timeline cannot be built") {
    super(`${lead}: ${describe(problems)}`);
    this.name = "TimelineBuildError";
  }
}

/** The series rules a spec-driven timeline was checked against, and what they found. */
export interface Validation {
  /** "<id>@<version>", or null when the template names no validator. */
  validator: string | null;
  findings: SeriesFinding[];
}

/**
 * The timeline breaks its series' rules (avg-jao.3). `problems` are the
 * error findings; nothing was written or rendered.
 */
export class SeriesRulesError extends TimelineBuildError {
  readonly code = "series-rules";
  constructor(readonly validator: string | null, errors: SeriesFinding[], hint = "") {
    super(errors, `the series rules (${validator}) refuse this timeline${hint}`);
    this.name = "SeriesRulesError";
  }
}

const errorsOf = (validation: Validation | null) => validation?.findings.filter((f) => f.severity === "error") ?? [];

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
  /** The timeline rendered differs from what the compiler makes of the same inputs: a person edited it. */
  editedByHand: boolean;
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
    compiledBy: { compiler, template, revision, editedByHand: false },
  };
}

export interface WrittenTimeline {
  timeline: EditTimelineDoc;
  /** Set when a series compiler made it from episode-spec.json. */
  compiledBy: CompiledBy | null;
  /** The series rules it was checked against; null for an episode without a spec. */
  validation: Validation | null;
  /** sha256 hex of the file as written. */
  hash: string;
  warnings: string[];
  /** Where a different previous timeline was kept, if one was replaced. */
  backup: string | null;
}

/** Check a spec-driven episode's timeline against its series rules; null for the others. */
function validate(episodeDir: string, options: BuildOptions, timeline: EditTimelineDoc): Validation | null {
  if (!isSpecDriven(episodeDir)) return null;
  const checked = checkEpisode(episodeDir, { episodeRef: options.episodeRef, timeline: timeline as never });
  if (!checked.ok) throw new TimelineBuildError(checked.problems);
  return { validator: checked.validator, findings: checked.findings };
}

/**
 * Build the timeline and write it to artifacts/edit-timeline.json — unless
 * it breaks its series' rules, in which case nothing is written.
 */
export function writeEditTimeline(episodeDir: string, options: BuildOptions): WrittenTimeline {
  const built = produceTimeline(episodeDir, options);
  if (!built.ok) throw new TimelineBuildError(built.problems);
  const validation = validate(episodeDir, options, built.timeline);
  const errors = errorsOf(validation);
  if (errors.length > 0) throw new SeriesRulesError(validation!.validator, errors, ": change the spec or the takes");
  const text = serialize(built.timeline);
  const backup = replaceTimeline(episodeDir, text);
  return { timeline: built.timeline, compiledBy: built.compiledBy, validation, hash: sha256(text), warnings: built.warnings, backup };
}

/** Which timeline a render would use, and why — decided without writing anything. */
export interface TimelineDecision {
  timeline: EditTimelineDoc;
  /** The timeline as it would be on disk. */
  text: string;
  /** sha256 hex of `text`. */
  hash: string;
  /** Why a fresh timeline replaces the stored one, or null when the stored one is used as it stands. */
  rebuilt: string | null;
  compiledBy: CompiledBy | null;
  validation: Validation | null;
  warnings: string[];
}

/**
 * The timeline to render: the one on disk when it still describes the
 * episode's material and the profile asked for, otherwise a fresh one.
 * Reads only. For a spec-driven episode the decision carries the series
 * rules' findings on that timeline.
 */
export function decideEditTimeline(episodeDir: string, options: BuildOptions): TimelineDecision {
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
        text: stored.text,
        hash: sha256(stored.text),
        warnings: [`the episode could not be rebuilt (${describe(fresh.problems)}); rendering it as it stands`],
        compiledBy: null,
        validation: null,
        rebuilt: null,
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
    const compiledBy = fresh.compiledBy && { ...fresh.compiledBy, editedByHand: stored.text !== serialize(fresh.timeline) };
    return {
      timeline: stored.doc,
      text: stored.text,
      hash: sha256(stored.text),
      rebuilt: null,
      compiledBy,
      validation: validate(episodeDir, options, stored.doc),
      warnings: fresh.warnings,
    };
  }
  const text = serialize(fresh.timeline);
  return {
    timeline: fresh.timeline,
    text,
    hash: sha256(text),
    rebuilt: reason,
    compiledBy: fresh.compiledBy,
    validation: validate(episodeDir, options, fresh.timeline),
    warnings: fresh.warnings,
  };
}

export interface CurrentTimeline extends WrittenTimeline {
  /** Why it was rebuilt, or null when the timeline on disk was used as it is. */
  rebuilt: string | null;
}

/** Write what a decision rebuilt (keeping a different previous timeline as a backup). */
function applyDecision(episodeDir: string, decision: TimelineDecision): CurrentTimeline {
  const backup = decision.rebuilt !== null ? replaceTimeline(episodeDir, decision.text) : null;
  const { timeline, hash, rebuilt, compiledBy, validation, warnings } = decision;
  return { timeline, hash, rebuilt, compiledBy, validation, warnings, backup };
}

/** The timeline to render, rebuilt and written when its material changed (see decideEditTimeline). */
export function currentEditTimeline(episodeDir: string, options: BuildOptions): CurrentTimeline {
  return applyDecision(episodeDir, decideEditTimeline(episodeDir, options));
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
  validation: Validation | null;
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
  const decision = decideEditTimeline(episodeDir, options);
  // Refused before anything is written: not even a rebuilt timeline.
  const errors = errorsOf(decision.validation);
  if (errors.length > 0) {
    throw new SeriesRulesError(decision.validation!.validator, errors, decision.rebuilt === null
      ? `: fix the edit in ${EDIT_TIMELINE_PATH}, or delete it to recompile from the spec`
      : ": change the spec or the takes");
  }
  const current = applyDecision(episodeDir, decision);

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
    ...(current.validation ? { validation: current.validation } : {}),
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
    validation: current.validation,
    result,
  };
}
```

What changed, for the reviewer: `Validation`, `SeriesRulesError`, `errorsOf`; `validate()` runs `checkEpisode` on the chosen timeline for spec-driven episodes; `writeEditTimeline` refuses on errors before writing; `currentEditTimeline`'s body became `decideEditTimeline` (reads only, returns `text` and `validation`) + `applyDecision` (backup and write when rebuilt); `renderEpisode` decides, refuses on errors with a hint (stored edit: fix it or delete it; rebuilt: change the spec or the takes), then applies and renders; the report gets `validation`.

- [ ] **Step 4: The tools (`capability-tools.ts`) and `docs/running.md`**

Apply to `studio/agent/src/capability-tools.ts`:

```diff
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index b6d3b4e..b06b6ad 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -45,7 +45,7 @@ import {
   type NarrationSegmentInput,
 } from "./narration-manifest.js";
 import { EDIT_TIMELINE_PATH } from "./edit-timeline-builder.js";
-import { renderEpisode, writeEditTimeline } from "./episode-render.js";
+import { decideEditTimeline, renderEpisode, writeEditTimeline, type Validation } from "./episode-render.js";
 
 // ── Inline fal client (avoids dynamic import complexity in Pi) ──────────────
 
@@ -890,6 +890,11 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
   // The episode is composed through its edit timeline: a reviewable document
   // in artifacts/, rendered by @av/remotion-composer. No FFmpeg runs here.
 
+  /** A series rule's finding, one line: "⚠️ panel-long at artifacts/edit-timeline.json#…: …". */
+  const findingLine = (f: Validation["findings"][number]) => `${f.severity === "error" ? "❌" : "⚠️"} ${f.code} at ${f.path}: ${f.message}`;
+  const seriesWarnings = (validation: Validation | null) =>
+    (validation?.findings ?? []).filter((f) => f.severity === "warning").map(findingLine);
+
   const profileParam = Type.Optional(Type.String({
     description: "Output profile id: youtube-1920x1080 (default) or vertical-1080x1920. An episode with episode-spec.json renders its template's profile.",
   }));
@@ -909,7 +914,7 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
         const dir = episodeDir(params.channel, params.series, params.episode);
         const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
         // Queued with pva_compose_video, which may rebuild the same file.
-        const { timeline, warnings, backup, compiledBy } = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
+        const { timeline, warnings, backup, compiledBy, validation } = await withFileMutationQueue(join(dir, "output", "current.json"), async () =>
           writeEditTimeline(dir, { episodeRef, ...(params.profile ? { profile: params.profile } : {}) }));
         const count = (id: string) => timeline.tracks.find((t) => t.id === id)?.items.length ?? 0;
         // The picture track is the lowest visual one: "scenes" from the legacy builder, "panels" from a compiler.
@@ -921,9 +926,14 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
             ? [`compiled by ${compiledBy.compiler} from episode-spec.json revision ${compiledBy.revision} (template ${compiledBy.template.id}@${compiledBy.template.version})`]
             : []),
           ...(backup ? [`previous timeline kept as ${backup}`] : []),
+          ...(validation?.validator ? [`series rules ${validation.validator}: no errors`] : []),
+          ...seriesWarnings(validation),
           ...warnings.map((w) => `⚠️ ${w}`),
         ];
-        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { path: EDIT_TIMELINE_PATH, timeline, warnings, compiledBy } as Record<string, unknown> };
+        return {
+          content: [{ type: "text" as const, text: lines.join("\n") }],
+          details: { path: EDIT_TIMELINE_PATH, timeline, warnings, compiledBy, validation } as Record<string, unknown>,
+        };
       } catch (err) {
         return {
           content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
@@ -965,6 +975,7 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
                 + (render.compiledBy.editedByHand ? ", then edited by hand" : "")]
               : []),
             ...(render.backup ? [`previous timeline kept as ${render.backup}`] : []),
+            ...seriesWarnings(render.validation),
             ...render.warnings.map((w) => `⚠️ ${w}`),
           ];
           return { content: [{ type: "text" as const, text: lines.join("\n") }], details: render as unknown as Record<string, unknown> };
@@ -981,6 +992,52 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
+  pi.registerTool({
+    name: "pva_check_episode",
+    label: "Check Episode",
+    description: `Check what pva_compose_video would render against the episode's series rules, without writing or rendering anything: which timeline (${EDIT_TIMELINE_PATH} as it stands, or a recompiled one and why) and every finding, errors first. An episode without a spec, or whose template names no validator, has no series rules.`,
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+      profile: profileParam,
+    }),
+    async execute(_toolCallId, params) {
+      try {
+        const dir = episodeDir(params.channel, params.series, params.episode);
+        const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
+        // Reads only: not queued with the tools that write current.json.
+        const decision = decideEditTimeline(dir, { episodeRef, ...(params.profile ? { profile: params.profile } : {}) });
+        const validation = decision.validation;
+        const findings = [...(validation?.findings ?? [])].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
+        const errors = findings.filter((f) => f.severity === "error").length;
+        const lines = [
+          decision.rebuilt === null
+            ? `${EDIT_TIMELINE_PATH} would be rendered as it stands`
+            : `the timeline would be recompiled: ${decision.rebuilt}`,
+          !validation?.validator
+            ? "no series rules for this episode"
+            : errors > 0
+              ? `❌ ${errors} error(s) against ${validation.validator}: pva_compose_video would refuse it`
+              : `✅ ${validation.validator}: no errors`,
+          ...findings.map((f) => `  ${findingLine(f)}`),
+        ];
+        return {
+          content: [{ type: "text" as const, text: lines.join("\n") }],
+          details: { rebuilt: decision.rebuilt, validation } as Record<string, unknown>,
+        };
+      } catch (err) {
+        const e = err as { message?: string; problems?: Array<{ code: string; message: string; path?: string }> };
+        const problems = (e.problems ?? []).map((p) => `  - ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
+        return {
+          content: [{ type: "text" as const, text: [`❌ ${e.message ?? String(err)}`, ...problems].join("\n") }],
+          details: { problems: e.problems ?? [] } as Record<string, unknown>,
+          isError: true as unknown as boolean,
+        };
+      }
+    },
+  });
+
   // --- Tool: pva_render_terminal (via VHS) -----------------------------
 
   pi.registerTool({
```

Apply to `docs/running.md`:

```diff
diff --git a/docs/running.md b/docs/running.md
index 37e0762..67640ff 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -95,7 +95,8 @@ Pipeline: `pva_snapshot`, `pva_run_pipeline`, `pva_run_stage`, `pva_request_appr
 Production: `pva_generate_image`, `pva_synthesize_speech`,
 `pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
 `pva_render_terminal`, `pva_render_vector_animation`, `pva_build_timeline`,
-`pva_compose_video`, `pva_compose_multitrack_video`, `pva_probe_media`
+`pva_check_episode`, `pva_compose_video`, `pva_compose_multitrack_video`,
+`pva_probe_media`
 
 A tool whose capability is not ready will fail rather than silently degrade.
 `npm run doctor` tells you which are ready; `pva_capability_status` tells the
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd studio/agent && npx vitest run && npx tsc --noEmit`
Expected: `Test Files 30 passed | 2 skipped`, `Tests 269 passed | 3 skipped`; no type errors.

- [ ] **Step 6: Commit**

```bash
git add studio/agent/src/episode-render.ts studio/agent/src/capability-tools.ts docs/running.md studio/agent/tests/compose-spec.test.ts studio/agent/tests/extension.test.ts studio/agent/tests/e2e-scenarios.test.ts
git commit -m "feat(agent): series rules refuse builds and renders; pva_check_episode checks without writing (avg-jao.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ADR-0037, skill, full check

**Files:**
- Modify: `docs/adr/0037-series-templates-pin-editorial-standards.md`, `skills/studio/compose-video.md`

- [ ] **Step 1: ADR-0037**

```diff
diff --git a/docs/adr/0037-series-templates-pin-editorial-standards.md b/docs/adr/0037-series-templates-pin-editorial-standards.md
index f371032..691a983 100644
--- a/docs/adr/0037-series-templates-pin-editorial-standards.md
+++ b/docs/adr/0037-series-templates-pin-editorial-standards.md
@@ -8,7 +8,8 @@ Accepted. The contract and pure validation helpers are implemented in
 golden output, with `poetry-short@1.0.0` the first; the agent's
 `compileEpisode` loads and checks a spec-driven episode, and
 `pva_build_timeline`/`pva_compose_video` use it whenever an episode has an
-`episode-spec.json`. Series-specific validator hooks are `avg-jao.3`.
+`episode-spec.json`. Series validators are implemented beside the compilers
+(`avg-jao.3`); golden-reference verification and promotion are `avg-jao.6`.
 
 ## Context
 
@@ -115,6 +116,25 @@ shared contract helper, is a new version. An episode with a spec is always
 compiled; it never falls back to ADR-0036's builder, whose hand-edit
 preservation applies to compiled timelines too.
 
+### Series validators check what is rendered
+
+`SeriesTemplate.validator` names a versioned, reviewed validator in
+`@studio/series`, registered and frozen like a compiler: each released
+version has golden cases (small edits of its compiler fixture's timeline with
+their exact findings), and a new rule is a new version. A validator is pure;
+it receives the compile input, the timeline about to be rendered and what the
+compiler makes of the same inputs, and returns findings (`error` or
+`warning`) located by JSON path.
+
+The rules apply to **whatever is rendered**, a hand-edited timeline included:
+a hand edit may change what the series allows (when a picture changes, how
+captions are split), never the format itself (the voice, the text, the
+profile, the effects). Errors refuse the build and the render before anything
+is written; warnings are reported and recorded in the render report.
+`pva_check_episode` runs the same check without writing anything — the gate
+the layout sheet (`avg-3th.1`) and the pipeline stages (`avg-jao.4`) will
+block on. A template that names no validator has no series rules.
+
 ### Golden references are evidence, not live pointers
 
 A `SeriesReference` records the source episode, the exact template pin,
@@ -162,8 +182,9 @@ a trusted golden; it cannot infer trust from `validateSeriesReference() === []`.
   code versions and media; hashes do not constitute a backup.
 - `avg-jao.2` owns loading/resolving the pinned release, compiler dispatch,
   workspace writes/staleness and the spec → timeline integration.
-- `avg-jao.3` owns series-specific mechanical checks, reference trust/promotion
-  integration and blocking the layout sheet on invalid inputs.
+- `avg-jao.3` owns the series validators and the check that blocks rendering;
+  `avg-jao.6` owns reference trust/promotion integration; blocking the layout
+  sheet comes with the sheet (`avg-3th.1`).
 - `avg-jao.4` owns pipeline wiring; `avg-jao.5` owns identical-instant visual
   comparisons. Real channel templates and approved reference media belong to
   `avg-dcf`, not contract fixtures. No CreativeStudio runtime or production
```

- [ ] **Step 2: The compose-video skill (0.4.0)**

````diff
diff --git a/skills/studio/compose-video.md b/skills/studio/compose-video.md
index eefb23e..3f0e868 100644
--- a/skills/studio/compose-video.md
+++ b/skills/studio/compose-video.md
@@ -1,6 +1,6 @@
 ---
 name: compose-video
-version: "0.3.0"
+version: "0.4.0"
 description: Compose the final video through the episode's edit timeline, rendered with Remotion
 inputs:
   - name: illustrations
@@ -76,6 +76,24 @@ compiler ran and from which spec revision.
 - Never change a template release to make a spec compile: a release is
   immutable, and its hash check fails.
 
+### Series rules
+
+The template may name a **validator** (`poetry-short@1.0.0`, …) whose rules
+apply to whatever is rendered, hand edits included. Run `pva_check_episode`
+before rendering: it says which timeline would be rendered (as it stands, or
+recompiled and why) and lists every finding, writing nothing.
+
+- **Errors** refuse `pva_build_timeline` and `pva_compose_video`; nothing is
+  written or rendered. Each names the file and path to fix
+  (`artifacts/edit-timeline.json#$.tracks[1]`, `episode-spec.json#$.data.panels[2]`).
+- A hand edit may change what the series allows — when a picture changes, how
+  captions are split. It may not touch the voice, the captions' words, the
+  profile, the kits or the effects: tell the person to change the spec or the
+  takes instead, or to delete `artifacts/edit-timeline.json` to recompile.
+- **Warnings** (a picture flashing or held over 7 s, a long caption) do not
+  block; they are in the reply and the render report's `validation`. Mention
+  them to the person.
+
 ## What the timeline holds (episodes without a spec)
 
 - **Scenes** in reading order (`s1, s2, s4a, s10`), each for its length from
````

- [ ] **Step 3: Full check**

Run: `npm run check && npm run docs:build`
Then: `cd studio/agent && REMOTION_E2E=1 npx vitest run tests/compose-spec.e2e.test.ts tests/compose-video.e2e.test.ts`
Expected: everything passes; VitePress builds; 3 e2e tests pass.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0037-series-templates-pin-editorial-standards.md skills/studio/compose-video.md
git commit -m "docs: series validators in ADR-0037 and the compose-video skill (avg-jao.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After the PR merges: close `avg-jao.3`.
