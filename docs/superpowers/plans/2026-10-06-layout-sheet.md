# Layout Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The layout sheet (avg-3th.1): a series template's optional `sheet` instants, the pure `sheetInstants`, `renderLayoutSheet` in `@av/remotion-composer` (stills plus a labelled grid, and a `layout-sheet` CLI), `makeLayoutSheet` / `layoutSheetStatus` in `@studio/episode`, the `sheet` stage of `series-production` 1.1.0 with the render refusing a missing or stale sheet, the agent's `pva_layout_sheet` and the `review-layout-sheet` skill.

**Architecture:** Which frames is decided from the timeline alone (`sheetInstants`, pure); the composer renders them from one bundle in one browser and draws the grid with a second Remotion composition; the episode writes `artifacts/layout-sheet/` through a temporary directory and a whole-directory swap, with an `inputsHash` over the timeline hash, the kits' code hashes, the rules and the scale, so the status needs no rendering. The pipeline gates the render on that status.

**Tech Stack:** Node ESM `.mjs` + `.d.mts` and JSON Schema (contracts, `node:test`), TypeScript + React/Remotion 4.0.505 (composer, `node --test` with tsx), TypeScript (episode, adapters, agent; vitest), YAML pipeline manifests.

**Spec:** `docs/superpowers/specs/2026-10-06-layout-sheet-design.md`

Every line of code below was run in a scratch worktree before this plan was written: the unit suites, `npm run check` (all but `check:paths`, which only the scratch worktree's symlinks trip), `npm run docs:build`, and the opt-in real renders (`REMOTION_E2E=1`) of the composer and the episode.

## Global Constraints

- Branch `feat/layout-sheet` (holds the spec commits). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit paths only; never stage `.beads/`; never run `bd`.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- Rebuild what is consumed through `dist/` after changing it: `npm run build --workspace @av/remotion-composer` (the episode imports it), `npm run build --workspace @studio/episode` (the adapters and the agent import it).
- Dependencies: none added. The only lockfile change is the composer's new bin (Task 3), made with `bun install --lockfile-only --ignore-scripts`, then checked with `bun install --frozen-lockfile`. Never run `bun install` in a worktree.
- Real renders only with `REMOTION_E2E=1`; the first one downloads Remotion's headless Chrome.
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.
- A template release is immutable: `poetry-short@1.0.0` (the contracts' fixture) is not edited; tests that need `sheet` rules publish a 1.1.0 in their temporary library.

## Review Focus

- A hand edit that shortens a section so a declared instant falls outside it → a warning in `sheet.json`, the sheet still made (Task 2 test "warns about, and drops…", Task 4 test "adds the instants the pinned release declares…").
- A `sheet.jpg` touched up after it was rendered → status `missing` and the render refuses (Task 4 test "is missing when the sheet image is not the one rendered…", Task 5 test "refuses a sheet whose image was replaced").
- Remotion failing halfway through a sheet → the previous sheet untouched, no `.layout-sheet.*` directory left (Task 4 test "keeps the previous sheet…").
- A timeline edited by hand and checked again, but its sheet not made again → the render refuses `stale (the timeline changed)` (Task 5 test "refuses a sheet of an earlier timeline…").
- A half-written `edit-timeline.json` → status `stale` with the reason, never a crash (Task 4 test "is stale, saying why, when the timeline cannot be decided").

---

### Task 1: Contracts — the template's `sheet` rules

**Files:**
- Modify: `studio/contracts/schemas/v1alpha1/series-template.schema.json`, `studio/contracts/src/series-templates.d.mts`, `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md`
- Regenerate: `studio/contracts/bindings/ts/series-template.ts`
- Test: `studio/contracts/test/series-templates.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SeriesTemplate.sheet?: SheetRules`; types `SheetInstantRule { at: "start" | "middle" | "end"; offsetSeconds?: number; sections?: string[] }` and `SheetRules { instants: SheetInstantRule[] }`, exported from `@studio/contracts/src/series-templates.mjs` (the `.d.mts`) and from `bindings/ts/series-template.ts`. `validateSeriesTemplate` accepts and checks the field.

- [ ] **Step 1: Write the failing tests**

Add a `describe` block before `describe("golden reference descriptors", …)` in `studio/contracts/test/series-templates.test.mjs`:

````diff
diff --git a/studio/contracts/test/series-templates.test.mjs b/studio/contracts/test/series-templates.test.mjs
index 36048e3..5f1ee65 100644
--- a/studio/contracts/test/series-templates.test.mjs
+++ b/studio/contracts/test/series-templates.test.mjs
@@ -192,6 +192,40 @@ describe("series template contracts", () => {
   });
 });
 
+describe("layout sheet rules (avg-3th.1)", () => {
+  const withSheet = (sheet) => ({ ...JSON.parse(bundle().manifest), sheet });
+
+  it("accepts instants anchored to sections, with offsets and section patterns", () => {
+    assert.deepEqual(validateSeriesTemplate(withSheet({
+      instants: [
+        { at: "start", offsetSeconds: 2 },
+        { at: "middle" },
+        { at: "end", offsetSeconds: -1.5, sections: ["opening", "block-*"] },
+      ],
+    })), []);
+  });
+
+  it("refuses rules it cannot read", () => {
+    const cases = {
+      "no instants": {},
+      "empty instants": { instants: [] },
+      "too many rules": { instants: Array.from({ length: 33 }, () => ({ at: "start" })) },
+      "unknown anchor": { instants: [{ at: "quarter" }] },
+      "missing anchor": { instants: [{ offsetSeconds: 1 }] },
+      "offset as text": { instants: [{ at: "start", offsetSeconds: "2" }] },
+      "unknown key": { instants: [{ at: "start", frame: 10 }] },
+      "unknown sheet key": { instants: [{ at: "start" }], scale: 0.5 },
+      "empty sections": { instants: [{ at: "start", sections: [] }] },
+      "star inside": { instants: [{ at: "start", sections: ["bl*ck"] }] },
+      "bare star": { instants: [{ at: "start", sections: ["*"] }] },
+      "uppercase id": { instants: [{ at: "start", sections: ["Opening"] }] },
+    };
+    for (const [name, sheet] of Object.entries(cases)) {
+      assert.ok(validateSeriesTemplate(withSheet(sheet)).length > 0, name);
+    }
+  });
+});
+
 describe("golden reference descriptors", () => {
   it("requires an explicit human approval, never policy, agent, request or rejection", () => {
     for (const [field, value] of [["origin", "agent"], ["origin", "policy"], ["decision", "requested"], ["decision", "rejected"]]) {
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test studio/contracts/test/series-templates.test.mjs`
Expected: FAIL — `accepts instants anchored to sections…` gets a `schema` problem (`sheet` is not an allowed property). The refusal test passes already (everything with `sheet` is refused today).

- [ ] **Step 3: Add the field to the schema**

````diff
diff --git a/studio/contracts/schemas/v1alpha1/series-template.schema.json b/studio/contracts/schemas/v1alpha1/series-template.schema.json
index d98c591..3cc429d 100644
--- a/studio/contracts/schemas/v1alpha1/series-template.schema.json
+++ b/studio/contracts/schemas/v1alpha1/series-template.schema.json
@@ -48,6 +48,32 @@
         "hash": { "$ref": "identity.schema.json#/$defs/ContentHash" }
       }
     },
+    "SheetInstantRule": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["at"],
+      "properties": {
+        "at": { "enum": ["start", "middle", "end"], "description": "Where in each matching section: its first frame, its middle, its last frame." },
+        "offsetSeconds": { "type": "number", "description": "Shift from the anchor, in seconds; may be negative." },
+        "sections": {
+          "type": "array",
+          "minItems": 1,
+          "maxItems": 32,
+          "items": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*\\*?$" },
+          "description": "Section ids this rule applies to: an exact id, or a prefix ending in * (block-*). Absent: every section."
+        }
+      },
+      "description": "One instant per matching section of the edit timeline, added to the layout sheet's defaults (avg-3th.1)."
+    },
+    "SheetRules": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["instants"],
+      "properties": {
+        "instants": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "$ref": "#/$defs/SheetInstantRule" } }
+      },
+      "description": "The instants this series' layout sheets always show, besides the first and last frame and a spread over the sections."
+    },
     "SeriesTemplate": {
       "type": "object",
       "additionalProperties": false,
@@ -69,6 +95,7 @@
             "standard": { "$ref": "#/$defs/SeriesFileRef" }
           }
         },
+        "sheet": { "$ref": "#/$defs/SheetRules" },
         "metadata": { "type": "object", "additionalProperties": true }
       }
     },
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Then regenerate the bindings: `npm run bindings:generate --workspace @studio/contracts`. The result must be:

````diff
diff --git a/studio/contracts/bindings/ts/series-template.ts b/studio/contracts/bindings/ts/series-template.ts
index 9dae044..6532658 100644
--- a/studio/contracts/bindings/ts/series-template.ts
+++ b/studio/contracts/bindings/ts/series-template.ts
@@ -31,6 +31,19 @@ export interface SeriesFileRef {
   hash: ContentHash;
 }
 
+export interface SheetInstantRule {
+  /** Where in each matching section: its first frame, its middle, its last frame. */
+  at: "start" | "middle" | "end";
+  /** Shift from the anchor, in seconds; may be negative. */
+  offsetSeconds?: number;
+  /** Section ids this rule applies to: an exact id, or a prefix ending in * (block-*). Absent: every section. */
+  sections?: string[];
+}
+
+export interface SheetRules {
+  instants: SheetInstantRule[];
+}
+
 export interface SeriesTemplate {
   apiVersion: "studio.video/v1alpha1";
   kind: "SeriesTemplate";
@@ -43,6 +56,7 @@ export interface SeriesTemplate {
     template: SeriesFileRef;
     standard: SeriesFileRef;
   };
+  sheet?: SheetRules;
   metadata?: Record<string, unknown>;
 }
 
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

And the hand-written declarations:

````diff
diff --git a/studio/contracts/src/series-templates.d.mts b/studio/contracts/src/series-templates.d.mts
index 52d4fa3..a48f30e 100644
--- a/studio/contracts/src/series-templates.d.mts
+++ b/studio/contracts/src/series-templates.d.mts
@@ -10,6 +10,14 @@ export interface SeriesComponentRef { id: string; version: string }
 export interface TemplatePin extends SeriesComponentRef { hash: string }
 export interface SeriesFileRef { path: string; hash: string }
 export interface SeriesEpisodeRef { channel: string; series: string; episode: string }
+/** One layout-sheet instant per matching section (avg-3th.1). */
+export interface SheetInstantRule {
+  at: "start" | "middle" | "end";
+  offsetSeconds?: number;
+  /** Exact section ids, or prefixes ending in `*`; absent: every section. */
+  sections?: string[];
+}
+export interface SheetRules { instants: SheetInstantRule[] }
 export interface SeriesTemplate {
   apiVersion: "studio.video/v1alpha1";
   kind: "SeriesTemplate";
@@ -18,6 +26,7 @@ export interface SeriesTemplate {
   compiler: SeriesComponentRef;
   validator?: SeriesComponentRef;
   files: { schema: SeriesFileRef; template: SeriesFileRef; standard: SeriesFileRef };
+  sheet?: SheetRules;
   metadata?: Record<string, unknown>;
 }
 export interface EpisodeSpec {
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: Document it**

````diff
diff --git a/studio/contracts/README.md b/studio/contracts/README.md
index 676621d..0d0e345 100644
--- a/studio/contracts/README.md
+++ b/studio/contracts/README.md
@@ -40,7 +40,8 @@ Filesystem mutation, pipeline execution, creative skills, provider calls, render
 
 `src/series-templates.mjs` exports:
 
-- `validateSeriesTemplate(manifest)`: closed manifest shape and canonical filenames.
+- `validateSeriesTemplate(manifest)`: closed manifest shape and canonical filenames,
+  including the optional `sheet.instants` rules a layout sheet adds (avg-3th.1).
 - `validateTemplateBundle({manifest, files})`: exact UTF-8 manifest text and a
   filename → UTF-8 text map; verifies every file hash and compiles the self-contained
   Draft 2020-12 data schema. No filesystem access or schema downloads.
diff --git a/studio/contracts/docs/contract-catalog.md b/studio/contracts/docs/contract-catalog.md
index 27ddff4..ce4762b 100644
--- a/studio/contracts/docs/contract-catalog.md
+++ b/studio/contracts/docs/contract-catalog.md
@@ -20,7 +20,7 @@ This catalog assigns every durable wire or workspace concept to one contract fam
 | `cue` | Cue grammar for series specs (word, prefix, seconds, word/line/take/mark objects) and its resolution to frames against a take's Word Timing | series spec authors (Pi, editors) | series compilers | `avg-7zp.2` |
 | `narration-takes` | Narration Takes: provider-neutral take registry (text, spoken text as sent, voice provenance, word timing ref, narration-manifest source) and unit sequences with pauses and scene pauses; unit layout; Qwen manifest mapping | TTS provider adapters, Qwen worker via mapping | series compilers, cue resolver, composer | `avg-7zp.4` |
 | `source-pin` | Source Pin: shared material an episode reads without copying (channel source or episode), its file inventory and the stages that read it | `vpr pin add`, series compilers | runtime status, `vpr pin renew` | `avg-7zp.5` |
-| `series-template` | Immutable SeriesTemplate release manifest, hash-pinned editorial EpisodeSpec, SeriesReference golden snapshot/approval descriptor (ADR-0037) | series authors, the operator's `vpr reference` (approve, withdraw) | Pi/editors, series compiler and QA, `verifySeriesReference` | `avg-jao.1`, `avg-jao.6` |
+| `series-template` | Immutable SeriesTemplate release manifest (with optional layout-sheet instants), hash-pinned editorial EpisodeSpec, SeriesReference golden snapshot/approval descriptor (ADR-0037) | series authors, the operator's `vpr reference` (approve, withdraw) | Pi/editors, series compiler and QA, the layout sheet, `verifySeriesReference` | `avg-jao.1`, `avg-jao.6`, `avg-3th.1` |
 | `event` | Journal Event envelope, correlation and causation, typed lifecycle payloads, cursor | runtime and services | gateway, projections, web, Pi | `vwc-5q0.7` |
 | `review` | Review Thread, anchor, reply, resolution, stale anchor, approval decision | users, Pi, gateway | runtime, gateway, web, Pi | `vwc-5q0.7` |
 | `policy` | Approval Policy, Budget Envelope, reservation/reconciliation, material downgrade, stale acceptance | channel/series owners and runtime | runtime, Pi, gateway, web, adapters | `vwc-5q0.3`, `vwc-5q0.7` |
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test studio/contracts/test/series-templates.test.mjs && npm run check --workspace @studio/contracts`
Expected: PASS (23 tests in the file); `bindings:check` reports the bindings up to date.

- [ ] **Step 6: Commit**

```bash
git add studio/contracts/schemas/v1alpha1/series-template.schema.json studio/contracts/bindings/ts/series-template.ts \
  studio/contracts/src/series-templates.d.mts studio/contracts/test/series-templates.test.mjs \
  studio/contracts/README.md studio/contracts/docs/contract-catalog.md
git commit -m "feat(contracts): a series template release may declare its layout-sheet instants (avg-3th.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Episode — `sheetInstants`

**Files:**
- Create: `studio/episode/src/sheet-instants.ts`
- Modify: `studio/episode/src/index.ts` (one export line; Task 4 adds the next)
- Test: `studio/episode/tests/sheet-instants.test.ts`

**Interfaces:**
- Consumes: `SheetInstantRule`, `SheetRules` from `@studio/contracts/src/series-templates.mjs` (Task 1).
- Produces: `sheetInstants(timeline: SheetTimeline, rules?: SheetRules, target = SHEET_TARGET): SheetInstants`; `SheetTimeline { fps; durationInFrames; sections?: {id, from, duration}[] }`; `SheetPick { frame: number; label: string }`; `SheetInstants { picks: SheetPick[]; warnings: string[] }`; `SHEET_TARGET = 24`; re-exports the two rule types.

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/sheet-instants.test.ts` (new):

````ts
import { describe, expect, it } from "vitest";
import { sheetInstants, type SheetTimeline } from "../src/sheet-instants.js";

/**
 * sheetInstants (avg-3th.1): the frames a layout sheet shows, from the
 * timeline alone. avg-jao.5 renders two versions at exactly these frames, so
 * every case here is exact.
 */

const timeline = (sections?: SheetTimeline["sections"], durationInFrames = 300): SheetTimeline =>
  ({ fps: 30, durationInFrames, ...(sections ? { sections } : {}) });

const frames = (t: SheetTimeline, ...rest: Parameters<typeof sheetInstants> extends [unknown, ...infer R] ? R : never) =>
  sheetInstants(t, ...rest).picks.map((p) => p.frame);

describe("sheetInstants", () => {
  it("always shows the first and the last frame", () => {
    const { picks } = sheetInstants(timeline([{ id: "a", from: 0, duration: 300 }]), undefined, 2);
    expect(picks.at(0)).toEqual({ frame: 0, label: "first" });
    expect(picks.at(-1)).toEqual({ frame: 299, label: "last" });
  });

  it("spreads the rest over the sections by length, at least one each, never on a cut", () => {
    // 22 to spread: a (200 of 300 frames) gets 15, b gets 7, c (1 frame) still gets 1.
    const t = timeline([{ id: "b", from: 200, duration: 99 }, { id: "a", from: 0, duration: 200 }, { id: "c", from: 299, duration: 1 }]);
    const { picks } = sheetInstants(t);
    const count = (id: string) => picks.filter((p) => p.label.split(" / ").includes(id)).length;
    expect(count("a")).toBe(15);
    expect(count("b")).toBe(7);
    expect(count("c")).toBe(1);
    expect(picks.find((p) => p.label.includes("a"))!.frame).toBe(Math.floor(200 * 0.6 / 15));
    expect(picks.some((p) => p.frame === 200)).toBe(false);
  });

  it("treats a timeline without sections as one section", () => {
    const { picks } = sheetInstants(timeline(undefined, 100), undefined, 4);
    expect(picks).toEqual([
      { frame: 0, label: "first" },
      { frame: 30, label: "timeline" },
      { frame: 80, label: "timeline" },
      { frame: 99, label: "last" },
    ]);
  });

  it("ignores empty sections", () => {
    const { picks } = sheetInstants(timeline([{ id: "a", from: 0, duration: 300 }, { id: "gone", from: 100, duration: 0 }]), undefined, 3);
    expect(picks.map((p) => p.label)).toEqual(["first", "a", "last"]);
  });

  it("adds each rule's instant in every matching section, labelled with the rule", () => {
    const t = timeline([{ id: "intro", from: 0, duration: 60 }, { id: "block-1", from: 60, duration: 120 }, { id: "block-2", from: 180, duration: 120 }]);
    const { picks, warnings } = sheetInstants(t, {
      instants: [
        { at: "start", offsetSeconds: 1 },
        { at: "middle", sections: ["block-*"] },
        { at: "end", offsetSeconds: -0.5, sections: ["intro"] },
      ],
    }, 2);
    expect(warnings).toEqual([]);
    const ruled = picks.filter((p) => p.label.includes("·"));
    expect(ruled).toEqual([
      { frame: 30, label: "intro · start+1s" },
      { frame: 44, label: "intro · end-0.5s" },
      { frame: 90, label: "block-1 · start+1s" },
      { frame: 120, label: "block-1 · middle" },
      { frame: 210, label: "block-2 · start+1s" },
      { frame: 240, label: "block-2 · middle" },
    ]);
  });

  it("warns about, and drops, an instant outside its section or a rule matching nothing", () => {
    const t = timeline([{ id: "intro", from: 0, duration: 30 }, { id: "body", from: 30, duration: 270 }]);
    const { picks, warnings } = sheetInstants(t, {
      instants: [
        { at: "start", offsetSeconds: 2 },
        { at: "end", offsetSeconds: 1 },
        { at: "start", sections: ["outro"] },
      ],
    }, 2);
    expect(warnings).toEqual([
      "rule 1 (start+2s) falls outside section intro",
      "rule 2 (end+1s) falls outside section intro",
      "rule 2 (end+1s) falls outside section body",
      "rule 3 (start) matches no section",
    ]);
    expect(picks.map((p) => p.label)).toEqual(["first", "intro", "body · start+2s", "body", "last"]);
  });

  it("merges picks on one frame, labels in order, each once", () => {
    const t = timeline([{ id: "a", from: 0, duration: 300 }]);
    const { picks } = sheetInstants(t, { instants: [{ at: "start" }, { at: "end" }] }, 2);
    expect(picks).toEqual([
      { frame: 0, label: "first / a · start" },
      { frame: 180, label: "a" },
      { frame: 299, label: "last / a · end" },
    ]);
    // A section too short for its share puts several spread picks on one frame.
    expect(sheetInstants(timeline([{ id: "a", from: 0, duration: 2 }], 2), undefined, 10).picks)
      .toEqual([{ frame: 0, label: "first / a" }, { frame: 1, label: "last / a" }]);
  });

  it("decides the same frames every time", () => {
    const t = timeline([{ id: "a", from: 0, duration: 137 }, { id: "b", from: 137, duration: 163 }]);
    const rules = { instants: [{ at: "middle" as const }] };
    expect(frames(t, rules)).toEqual(frames(structuredClone(t), structuredClone(rules)));
    expect(frames(t, rules).length).toBeGreaterThanOrEqual(24);
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/sheet-instants.test.ts`
Expected: FAIL — cannot resolve `../src/sheet-instants.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/sheet-instants.ts` (new):

````ts
// ---------------------------------------------------------------------------
// The layout sheet's instants (avg-3th.1)
// ---------------------------------------------------------------------------
// Which frames a layout sheet shows, decided the same way every time from the
// timeline alone: the first and last frame, a spread over the sections by
// length (at least one per section, never on its cut), and the instants the
// series' template release declares. Pure: avg-jao.5 renders two versions of
// an episode at exactly these frames.
// ---------------------------------------------------------------------------

import type { SheetInstantRule, SheetRules } from "@studio/contracts/src/series-templates.mjs";

export type { SheetInstantRule, SheetRules };

/** What sheetInstants needs of an edit timeline. */
export interface SheetTimeline {
  fps: number;
  durationInFrames: number;
  sections?: { id: string; from: number; duration: number }[];
}

export interface SheetPick {
  frame: number;
  /** "first", "last", a section id, or "<section> · <at><±offset>s"; joined with " / " when picks share a frame. */
  label: string;
}

export interface SheetInstants {
  /** Sorted by frame, one per frame. */
  picks: SheetPick[];
  /** Rules that matched no section, or whose instant fell outside its section. */
  warnings: string[];
}

/** How many frames a sheet shows before the series' own instants, first and last included. */
export const SHEET_TARGET = 24;

const matches = (pattern: string, id: string) =>
  pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;

const seconds = (value: number) => `${value > 0 ? "+" : "-"}${Math.abs(value)}s`;
const describeRule = (rule: SheetInstantRule) => `${rule.at}${rule.offsetSeconds ? seconds(rule.offsetSeconds) : ""}`;

export function sheetInstants(timeline: SheetTimeline, rules?: SheetRules, target = SHEET_TARGET): SheetInstants {
  const last = timeline.durationInFrames - 1;
  const labels = new Map<number, string[]>();
  const add = (frame: number, label: string) => {
    const at = labels.get(frame) ?? [];
    if (!at.includes(label)) at.push(label);
    labels.set(frame, at);
  };
  add(0, "first");
  add(last, "last");

  const declared = (timeline.sections ?? []).filter((s) => s.duration > 0);
  const sections = declared.length > 0
    ? [...declared].sort((a, b) => a.from - b.from)
    : [{ id: "timeline", from: 0, duration: timeline.durationInFrames }];

  // CreativeStudio's spread: k frames per section in proportion to its length,
  // at least one, placed at (i + 0.6) / k of the way through.
  const total = sections.reduce((sum, s) => sum + s.duration, 0) || 1;
  const spread = Math.max(0, target - 2);
  for (const s of sections) {
    const k = Math.max(1, Math.round((spread * s.duration) / total));
    for (let i = 0; i < k; i++) add(Math.min(last, s.from + Math.floor((s.duration * (i + 0.6)) / k)), s.id);
  }

  const warnings: string[] = [];
  (rules?.instants ?? []).forEach((rule, index) => {
    const name = `rule ${index + 1} (${describeRule(rule)})`;
    const matching = sections.filter((s) => rule.sections === undefined || rule.sections.some((p) => matches(p, s.id)));
    if (matching.length === 0) {
      warnings.push(`${name} matches no section`);
      return;
    }
    const offset = Math.round((rule.offsetSeconds ?? 0) * timeline.fps);
    for (const s of matching) {
      const end = s.from + s.duration - 1;
      const anchor = rule.at === "start" ? s.from : rule.at === "middle" ? s.from + Math.floor(s.duration / 2) : end;
      const frame = anchor + offset;
      if (frame < s.from || frame > end || frame < 0 || frame > last) {
        warnings.push(`${name} falls outside section ${s.id}`);
        continue;
      }
      add(frame, `${s.id} · ${describeRule(rule)}`);
    }
  });

  const picks = [...labels.entries()]
    .sort(([a], [b]) => a - b)
    .map(([frame, names]) => ({ frame, label: names.join(" / ") }));
  return { picks, warnings };
}
````

Append to `studio/episode/src/index.ts`:

```ts
export * from "./sheet-instants.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd studio/episode && npx vitest run tests/sheet-instants.test.ts && npx tsc --noEmit`
Expected: 8 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/sheet-instants.ts studio/episode/src/index.ts studio/episode/tests/sheet-instants.test.ts
git commit -m "feat(episode): sheetInstants — the frames a layout sheet shows (avg-3th.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Composer — `renderLayoutSheet`, the `Sheet` grid and the `layout-sheet` CLI

**Files:**
- Create: `packages/remotion-composer/src/Sheet.tsx`, `packages/remotion-composer/src/kit-lock.ts`, `packages/remotion-composer/src/layout-sheet.ts`, `packages/remotion-composer/src/sheet-cli.ts`
- Modify: `packages/remotion-composer/src/Root.tsx`, `packages/remotion-composer/src/errors.ts`, `packages/remotion-composer/src/index.ts`, `packages/remotion-composer/package.json`, `bun.lock`, `packages/remotion-composer/README.md`
- Test: `packages/remotion-composer/test/layout-sheet.test.ts`, `packages/remotion-composer/test/layout-sheet.e2e.test.ts`

**Interfaces:**
- Consumes: the package's own `validateTimeline`, `stageAssets`, `sha256`, `videoFrames`, `isAudioItem`, `EditTimeline`; `kits.lock.json` at the package root.
- Produces (exported from `@av/remotion-composer`): `renderLayoutSheet(options: LayoutSheetOptions): Promise<LayoutSheetResult>` with `LayoutSheetOptions { timeline: unknown; assetRoot: string; picks: {frame: number; label: string}[]; outDir: string; scale?: number; columns?: number; parallel?: number }` and `LayoutSheetResult { frames: LayoutSheetFrame[]; sheet: {path, hash, columns, rows, width, height}; kits: LockedKit[] }`, `LayoutSheetFrame { index, frame, seconds, label, path (absolute), hash ("sha256:…") }`; `sheetTime(frame, fps) → "mm:ss.ff"`; `MAX_SHEET_PICKS = 120`; `kitLockHash(name, version) → string | undefined`; `timelineKits(timeline) → LockedKit[] | null`; `LockedKit { name; version; hash }`. New `ComposerErrorCode`s `bad-sheet`, `sheet-failed`. Bin `layout-sheet` → `dist/sheet-cli.js`.

- [ ] **Step 1: Write the failing unit tests**

`packages/remotion-composer/test/layout-sheet.test.ts` (new):

````ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ComposerError} from '../src/errors.js';
import {kitLockHash, timelineKits} from '../src/kit-lock.js';
import {renderLayoutSheet, sheetTime} from '../src/layout-sheet.js';
import {CAPTION_HEIGHT, sheetSize} from '../src/Sheet.js';
import {clone, fixture} from './helpers.js';

// What renderLayoutSheet refuses before it renders anything (avg-3th.1). The
// rendering itself is layout-sheet.e2e.test.ts.

const refusal = async (options: Partial<Parameters<typeof renderLayoutSheet>[0]>) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sheet-refused-'));
  try {
    await renderLayoutSheet({timeline: fixture('explainer.json'), assetRoot: outDir, picks: [{frame: 0, label: 'first'}], outDir, ...options});
    assert.fail('expected a refusal');
  } catch (e) {
    assert.ok(e instanceof ComposerError, String(e));
    // Nothing was written: refusals come before staging and rendering.
    assert.deepEqual(await readdir(outDir), []);
    return {code: e.code, message: e.message};
  } finally {
    await rm(outDir, {recursive: true, force: true});
  }
};

describe('renderLayoutSheet refuses before rendering', () => {
  it('a timeline the composer cannot render', async () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit.version = '9.9.9';
    assert.equal((await refusal({timeline: doc})).code, 'unknown-kit');
  });

  it('no frames, too many, a frame outside the timeline, a fraction, a repeat', async () => {
    const cases: [Parameters<typeof renderLayoutSheet>[0]['picks'], RegExp][] = [
      [[], /at least one frame/],
      [Array.from({length: 121}, (_, i) => ({frame: i, label: 'x'})), /at most 120 frames, not 121/],
      [[{frame: 765, label: 'x'}], /frame 765 is not a frame of this timeline \(0–764\)/],
      [[{frame: -1, label: 'x'}], /frame -1/],
      [[{frame: 1.5, label: 'x'}], /frame 1.5/],
      [[{frame: 3, label: 'a'}, {frame: 3, label: 'b'}], /frame 3 is picked twice/],
    ];
    for (const [picks, message] of cases) {
      const {code, message: actual} = await refusal({picks});
      assert.equal(code, 'bad-sheet');
      assert.match(actual, message);
    }
  });

  it('a scale or a column count it cannot use', async () => {
    for (const scale of [0, -0.25, 1.5, Number.NaN]) assert.match((await refusal({scale})).message, /scale/);
    for (const columns of [0, 2.5]) assert.match((await refusal({columns})).message, /columns/);
  });
});

describe('the sheet grid', () => {
  it('writes times as mm:ss.ff', () => {
    assert.equal(sheetTime(0, 30), '00:00.00');
    assert.equal(sheetTime(29, 30), '00:00.29');
    assert.equal(sheetTime(30 * 61 + 7, 30), '01:01.07');
  });

  it('is as wide as its columns and as tall as its rows of tile and caption', () => {
    const tiles = Array.from({length: 13}, () => ({src: '', caption: ''}));
    assert.deepEqual(sheetSize({tiles, columns: 6, tileWidth: 480, tileHeight: 270}), {width: 2880, height: 3 * (270 + CAPTION_HEIGHT)});
  });

  it('knows each released kit\'s code hash', () => {
    assert.match(kitLockHash('still', '1.0.0') ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.equal(kitLockHash('still', '9.9.9'), undefined);
  });

  it('lists the kits a timeline draws with, once each, sorted, with their code hashes', () => {
    const doc = fixture('explainer.json');
    assert.deepEqual(timelineKits(doc as never), [
      {name: 'captions', version: '1.0.0', hash: kitLockHash('captions', '1.0.0')},
      {name: 'still', version: '1.0.0', hash: kitLockHash('still', '1.0.0')},
    ]);
    doc.tracks[0].items[0].kit.version = '9.9.9';
    assert.equal(timelineKits(doc as never), null);
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/remotion-composer && node --import tsx --test test/layout-sheet.test.ts`
Expected: FAIL — cannot find `../src/kit-lock.js`.

- [ ] **Step 3: The error codes, the kit lock and the grid**

````diff
diff --git a/packages/remotion-composer/src/errors.ts b/packages/remotion-composer/src/errors.ts
index c4f7a7f..8c104e6 100644
--- a/packages/remotion-composer/src/errors.ts
+++ b/packages/remotion-composer/src/errors.ts
@@ -5,7 +5,9 @@ export type ComposerErrorCode =
   | 'missing-asset'
   | 'hash-mismatch'
   | 'render-failed'
-  | 'loudness-failed';
+  | 'loudness-failed'
+  | 'bad-sheet'
+  | 'sheet-failed';
 
 export interface ComposerProblem {
   code: ComposerErrorCode;
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

`packages/remotion-composer/src/kit-lock.ts` (new):

````ts
// kits.lock.json: each released kit version's code hash (avg-tk7.3). A layout
// sheet records the hashes of the kits it drew with, so a kit's code changing
// under the same version would still make the sheet stale.

import {readFileSync} from 'node:fs';
import {isAudioItem, type EditTimeline} from './schema.js';

let lock: Record<string, string> | undefined;

/** "sha256:…" of a released kit version's code, or undefined for a version the lock does not know. */
export function kitLockHash(name: string, version: string): string | undefined {
  // ../kits.lock.json from both src/ (tests) and dist/ (the build).
  lock ??= JSON.parse(readFileSync(new URL('../kits.lock.json', import.meta.url), 'utf8')) as Record<string, string>;
  return lock[`${name}@${version}`];
}

export interface LockedKit {
  name: string;
  version: string;
  hash: string;
}

/**
 * Each kit a timeline draws with, once, sorted by name then version, with its
 * code hash; null for a kit the lock does not know (a timeline the composer
 * would refuse anyway).
 */
export function timelineKits(timeline: Pick<EditTimeline, 'tracks'>): LockedKit[] | null {
  const kits = new Map<string, {name: string; version: string}>();
  for (const item of timeline.tracks.flatMap((t) => t.items)) {
    if (isAudioItem(item)) continue;
    const {name, version} = (item as {kit: {name: string; version: string}}).kit;
    kits.set(`${name}@${version}`, {name, version});
  }
  const locked: LockedKit[] = [];
  for (const {name, version} of [...kits.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    const hash = kitLockHash(name, version);
    if (hash === undefined) return null;
    locked.push({name, version, hash});
  }
  return locked;
}
````

`packages/remotion-composer/src/Sheet.tsx` (new):

````tsx
// The layout sheet's grid (avg-3th.1): the stills of a timeline, in order,
// each with its number, time and label underneath, drawn by the same engine
// that rendered them. One frame; its size is the grid's.

import React from 'react';
import {AbsoluteFill, Img} from 'remotion';

export const CAPTION_HEIGHT = 40;

export interface SheetTile {
  /** A data: URL of the still. */
  src: string;
  caption: string;
}

export interface SheetProps {
  tiles: SheetTile[];
  columns: number;
  tileWidth: number;
  tileHeight: number;
  /** Index signature Remotion's Composition requires of its props. */
  [key: string]: unknown;
}

/** Width and height of the sheet's single frame. */
export const sheetSize = ({tiles, columns, tileWidth, tileHeight}: SheetProps) => ({
  width: columns * tileWidth,
  height: Math.max(1, Math.ceil(tiles.length / columns)) * (tileHeight + CAPTION_HEIGHT),
});

export const Sheet: React.FC<SheetProps> = ({tiles, columns, tileWidth, tileHeight}) => (
  <AbsoluteFill style={{backgroundColor: '#111', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', width: columns * tileWidth}}>
    {tiles.map((tile, i) => (
      <div key={i} style={{width: tileWidth, height: tileHeight + CAPTION_HEIGHT, boxSizing: 'border-box', borderRight: '1px solid #333', borderBottom: '1px solid #333'}}>
        <Img src={tile.src} style={{display: 'block', width: '100%', height: tileHeight - 1, objectFit: 'contain'}} />
        <div style={{height: CAPTION_HEIGHT, lineHeight: `${CAPTION_HEIGHT}px`, padding: '0 8px', color: '#eee', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
          {tile.caption}
        </div>
      </div>
    ))}
  </AbsoluteFill>
);
````

Register the grid as a second composition beside `Timeline`:

````diff
diff --git a/packages/remotion-composer/src/Root.tsx b/packages/remotion-composer/src/Root.tsx
index c620992..02c4f83 100644
--- a/packages/remotion-composer/src/Root.tsx
+++ b/packages/remotion-composer/src/Root.tsx
@@ -1,6 +1,7 @@
 import React from 'react';
 import {Composition} from 'remotion';
 import {Timeline, type TimelineProps} from './Timeline.js';
+import {Sheet, sheetSize, type SheetProps} from './Sheet.js';
 
 const preview: TimelineProps = {
   timeline: {
@@ -23,20 +24,34 @@ const preview: TimelineProps = {
   assetFrames: {},
 };
 
+const emptySheet: SheetProps = {tiles: [], columns: 1, tileWidth: 480, tileHeight: 270};
+
 export const RemotionRoot: React.FC = () => (
-  <Composition
-    id="Timeline"
-    component={Timeline}
-    durationInFrames={preview.timeline.durationInFrames}
-    fps={preview.timeline.fps}
-    width={preview.timeline.resolution.width}
-    height={preview.timeline.resolution.height}
-    defaultProps={preview}
-    calculateMetadata={({props}) => ({
-      durationInFrames: props.timeline.durationInFrames,
-      fps: props.timeline.fps,
-      width: props.timeline.resolution.width,
-      height: props.timeline.resolution.height,
-    })}
-  />
+  <>
+    <Composition
+      id="Timeline"
+      component={Timeline}
+      durationInFrames={preview.timeline.durationInFrames}
+      fps={preview.timeline.fps}
+      width={preview.timeline.resolution.width}
+      height={preview.timeline.resolution.height}
+      defaultProps={preview}
+      calculateMetadata={({props}) => ({
+        durationInFrames: props.timeline.durationInFrames,
+        fps: props.timeline.fps,
+        width: props.timeline.resolution.width,
+        height: props.timeline.resolution.height,
+      })}
+    />
+    <Composition
+      id="Sheet"
+      component={Sheet}
+      durationInFrames={1}
+      fps={30}
+      width={sheetSize(emptySheet).width}
+      height={sheetSize(emptySheet).height}
+      defaultProps={emptySheet}
+      calculateMetadata={({props}) => ({...sheetSize(props), durationInFrames: 1, fps: 30})}
+    />
+  </>
 );
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: `renderLayoutSheet` and its exports**

`packages/remotion-composer/src/layout-sheet.ts` (new):

````ts
// renderLayoutSheet (avg-3th.1): a timeline's stills at the frames the caller
// picks, then one labelled grid of them — both rendered by Remotion, from one
// bundle, in one browser. Which frames, and where an episode keeps its sheet,
// are the studio's business, not this package's.

import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition, type HeadlessBrowser} from '@remotion/renderer';
import {stageAssets, sha256} from './assets.js';
import {ComposerError} from './errors.js';
import {timelineKits, type LockedKit} from './kit-lock.js';
import {sheetSize, type SheetProps} from './Sheet.js';
import {validateTimeline} from './validate.js';
import {videoFrames} from './probe.js';

/** The most stills one sheet holds. */
export const MAX_SHEET_PICKS = 120;

export interface LayoutSheetOptions {
  /** A studio.video/v1alpha2 EditTimeline that already passed validateEditTimeline. */
  timeline: unknown;
  /** The directory asset paths are relative to (the episode). */
  assetRoot: string;
  /** Distinct whole frames inside the timeline, in the order the sheet shows them. */
  picks: {frame: number; label: string}[];
  /** Created if missing; frames/NNN.jpg and sheet.jpg are written inside. */
  outDir: string;
  /** Of the timeline's resolution, in (0, 1]. Default 0.25. */
  scale?: number;
  /** Default 6 for a landscape timeline, 8 for portrait or square. */
  columns?: number;
  /** Stills rendered at once. Default 6. */
  parallel?: number;
}

export interface LayoutSheetFrame {
  index: number;
  frame: number;
  seconds: number;
  label: string;
  /** Absolute. */
  path: string;
  hash: string;
}

export interface LayoutSheetResult {
  frames: LayoutSheetFrame[];
  sheet: {path: string; hash: string; columns: number; rows: number; width: number; height: number};
  /** Each kit the timeline draws with, and its code hash from kits.lock.json. */
  kits: LockedKit[];
}

/** mm:ss.ff — minutes, seconds and the frame within the second. */
export function sheetTime(frame: number, fps: number): string {
  const whole = Math.floor(frame / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}.${pad(frame - whole * fps)}`;
}

function refuse(message: string): never {
  throw new ComposerError('bad-sheet', message);
}

export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<LayoutSheetResult> {
  const checked = validateTimeline(options.timeline);
  if (!checked.ok) {
    const code = checked.problems[0]!.code;
    throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
  }
  const timeline = checked.timeline;
  const {picks} = options;
  const scale = options.scale ?? 0.25;
  const {width, height} = timeline.resolution;
  const columns = options.columns ?? (width > height ? 6 : 8);
  if (picks.length === 0) refuse('a sheet needs at least one frame');
  if (picks.length > MAX_SHEET_PICKS) refuse(`a sheet holds at most ${MAX_SHEET_PICKS} frames, not ${picks.length}`);
  const seen = new Set<number>();
  for (const {frame} of picks) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= timeline.durationInFrames) {
      refuse(`frame ${frame} is not a frame of this timeline (0–${timeline.durationInFrames - 1})`);
    }
    if (seen.has(frame)) refuse(`frame ${frame} is picked twice`);
    seen.add(frame);
  }
  if (!(scale > 0 && scale <= 1)) refuse(`scale ${scale} is not in (0, 1]`);
  if (!Number.isInteger(columns) || columns < 1) refuse(`columns ${columns} is not a positive whole number`);

  const kits = timelineKits(timeline) ?? refuse('a kit of this timeline is not in kits.lock.json');

  const staging = await stageAssets(timeline, options.assetRoot);
  if (!staging.ok) {
    throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
  }
  const {staged} = staging;
  const work = await mkdtemp(path.join(tmpdir(), 'remotion-composer-sheet-'));
  const outDir = path.resolve(options.outDir);
  let browser: HeadlessBrowser | undefined;
  try {
    const assetFrames: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
    }
    await mkdir(path.join(outDir, 'frames'), {recursive: true});
    const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remotion-entry.js');
    const frames: LayoutSheetFrame[] = picks.map((p, index) => ({
      index,
      frame: p.frame,
      seconds: Number((p.frame / timeline.fps).toFixed(3)),
      label: p.label,
      path: path.join(outDir, 'frames', `${String(index).padStart(3, '0')}.jpg`),
      hash: '',
    }));
    const sheetPath = path.join(outDir, 'sheet.jpg');
    let sheet: SheetProps;
    try {
      const serveUrl = await bundle({entryPoint, publicDir: staged.publicDir, outDir: path.join(work, 'bundle')});
      browser = await openBrowser('chrome');
      const inputProps = {timeline, files: staged.files, assetFrames};
      const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps, puppeteerInstance: browser});
      let next = 0;
      const worker = async () => {
        while (next < frames.length) {
          const f = frames[next++]!;
          await renderStill({composition, serveUrl, inputProps, output: f.path, frame: f.frame, scale, imageFormat: 'jpeg', jpegQuality: 80, puppeteerInstance: browser});
        }
      };
      await Promise.all(Array.from({length: Math.max(1, Math.min(options.parallel ?? 6, frames.length))}, worker));

      sheet = {
        columns,
        tileWidth: Math.round(width * scale),
        tileHeight: Math.round(height * scale),
        tiles: await Promise.all(frames.map(async (f) => ({
          src: `data:image/jpeg;base64,${(await readFile(f.path)).toString('base64')}`,
          caption: `#${String(f.index).padStart(2, '0')} · ${sheetTime(f.frame, timeline.fps)} · ${f.label}`,
        }))),
      };
      const grid = await selectComposition({serveUrl, id: 'Sheet', inputProps: sheet, puppeteerInstance: browser});
      await renderStill({composition: grid, serveUrl, inputProps: sheet, output: sheetPath, frame: 0, imageFormat: 'jpeg', jpegQuality: 85, puppeteerInstance: browser});
    } catch (e) {
      throw new ComposerError('sheet-failed', `Remotion could not render the layout sheet: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const f of frames) f.hash = await sha256(f.path);
    const size = sheetSize(sheet);
    return {
      frames,
      sheet: {path: sheetPath, hash: await sha256(sheetPath), columns, rows: Math.ceil(frames.length / columns), ...size},
      kits,
    };
  } finally {
    await browser?.close({silent: true}).catch(() => undefined);
    await staged.cleanup();
    await rm(work, {recursive: true, force: true});
  }
}
````

````diff
diff --git a/packages/remotion-composer/src/index.ts b/packages/remotion-composer/src/index.ts
index 9a406ab..abf08b0 100644
--- a/packages/remotion-composer/src/index.ts
+++ b/packages/remotion-composer/src/index.ts
@@ -1,6 +1,8 @@
 export {renderTimeline, type RenderTimelineOptions, type RenderResult} from './render.js';
 export {type CacheReport} from './render-cache.js';
 export {validateTimeline} from './validate.js';
+export {renderLayoutSheet, sheetTime, MAX_SHEET_PICKS, type LayoutSheetOptions, type LayoutSheetResult, type LayoutSheetFrame} from './layout-sheet.js';
+export {kitLockHash, timelineKits, type LockedKit} from './kit-lock.js';
 export {listKits, previewPath, resolveKit, kitVersions, KIT_VERSIONS, type KitListing, type KitVersion, type KitExample, type KitProfile} from './kits/index.js';
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
 export {type LoudnessTarget, type LoudnessResult} from './loudness.js';
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `cd packages/remotion-composer && node --import tsx --test test/layout-sheet.test.ts && npx tsc --noEmit -p .`
Expected: 7 pass, 0 fail; no type errors.

- [ ] **Step 6: The real render (opt-in)**

`packages/remotion-composer/test/layout-sheet.e2e.test.ts` (new):

````ts
// A real layout sheet through Remotion (avg-3th.1). Slow, and it needs
// headless Chrome: only with REMOTION_E2E=1, against the build in dist/ (run
// `npm run build` first).

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
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
const size = (file: string) => {
  const out = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {encoding: 'utf8'}).stdout) as {streams: {width: number; height: number}[]};
  return [out.streams[0]!.width, out.streams[0]!.height];
};
const remotionTemp = () => readdirSync(tmpdir()).filter((n) => /remotion|react-motion/.test(n)).sort();

describe('renderLayoutSheet end to end', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
  let sandbox: string;
  const previousTmpdir = process.env.TMPDIR;
  before(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'composer-sheet-sandbox-'));
    process.env.TMPDIR = sandbox;
  });
  after(async () => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    await rm(sandbox, {recursive: true, force: true});
  });

  it('renders the explainer\'s stills and a labelled grid of them', async () => {
    const {renderLayoutSheet, kitLockHash} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'composer-sheet-'));
    const doc = clone(fixture('explainer.json'));
    const colors = ['0x2e7d32', '0x6a1b9a', '0xef6c00'];
    let i = 0;
    for (const asset of Object.values(doc.assets) as {path: string; hash: string}[]) {
      await mkdir(path.dirname(path.join(root, asset.path)), {recursive: true});
      ffmpeg(['-f', 'lavfi', '-i', `color=c=${colors[i++]}:s=1920x1080`, '-frames:v', '1', path.join(root, asset.path)]);
      asset.hash = await sha256(path.join(root, asset.path));
    }
    const outDir = path.join(root, 'sheet');
    const picks = [{frame: 0, label: 'first'}, {frame: 300, label: 'middle'}, {frame: 764, label: 'last'}];
    const leftoversBefore = remotionTemp();
    const result = await renderLayoutSheet({timeline: doc, assetRoot: root, picks, outDir, columns: 2});
    assert.deepEqual(remotionTemp(), leftoversBefore, 'a sheet must leave no bundle or staging directory behind');

    assert.deepEqual(result.frames.map((f: {index: number; frame: number; seconds: number; label: string}) => [f.index, f.frame, f.seconds, f.label]),
      [[0, 0, 0, 'first'], [1, 300, 10, 'middle'], [2, 764, 25.467, 'last']]);
    for (const f of result.frames) {
      assert.equal(f.path, path.join(outDir, 'frames', `${String(f.index).padStart(3, '0')}.jpg`));
      assert.deepEqual(size(f.path), [480, 270]);
      assert.equal(f.hash, await sha256(f.path));
    }
    assert.deepEqual({...result.sheet, hash: undefined}, {path: path.join(outDir, 'sheet.jpg'), hash: undefined, columns: 2, rows: 2, width: 960, height: 620});
    assert.deepEqual(size(result.sheet.path), [960, 620]);
    assert.equal(result.sheet.hash, await sha256(result.sheet.path));
    assert.deepEqual(result.kits, [
      {name: 'captions', version: '1.0.0', hash: kitLockHash('captions', '1.0.0')},
      {name: 'still', version: '1.0.0', hash: kitLockHash('still', '1.0.0')},
    ]);
    await rm(root, {recursive: true, force: true});
  });
});
````

Run: `npm run build --workspace @av/remotion-composer && cd packages/remotion-composer && REMOTION_E2E=1 node --import tsx --test test/layout-sheet.e2e.test.ts`
Expected: 1 pass (about 10 s once Chrome is downloaded). Without `REMOTION_E2E=1` it is skipped.

Open the sheet once by hand to see it: tiles in rows of the chosen column count, each captioned `#NN · mm:ss.ff · label`, long labels ellipsised.

- [ ] **Step 7: The CLI and its bin**

`packages/remotion-composer/src/sheet-cli.ts` (new):

````ts
#!/usr/bin/env node
// layout-sheet <timeline.json> <out-dir> --assets <dir> --times <s,s,…> [--scale <0..1>] [--columns <n>]
// A timeline's layout sheet at the given seconds. An episode's own sheet, at
// its series' instants, is the studio's (the pipeline's sheet stage, or the
// agent); this renders any timeline at any times.

import {readFile} from 'node:fs/promises';
import {ComposerError, renderLayoutSheet} from './index.js';

const args = process.argv.slice(2);
const VALUE_FLAGS = ['--assets', '--times', '--scale', '--columns'];
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1] ?? ''));
const [timelinePath, outDir] = positional;
const assetRoot = flag('--assets');
const times = flag('--times');
if (!timelinePath || !outDir || !assetRoot || !times) {
  console.error('Usage: layout-sheet <timeline.json> <out-dir> --assets <dir> --times <s,s,…> [--scale <0..1>] [--columns <n>]');
  process.exit(1);
}

try {
  const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as {fps?: unknown};
  const fps = typeof timeline.fps === 'number' ? timeline.fps : 0;
  const picks = times.split(',').map((t) => ({frame: Math.round(Number(t) * fps), label: `${t}s`}));
  const scale = flag('--scale');
  const columns = flag('--columns');
  const result = await renderLayoutSheet({
    timeline, assetRoot, outDir, picks,
    ...(scale ? {scale: Number(scale)} : {}),
    ...(columns ? {columns: Number(columns)} : {}),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  if (e instanceof ComposerError) {
    console.error(`${e.code}: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
````

````diff
diff --git a/packages/remotion-composer/package.json b/packages/remotion-composer/package.json
index 6bb37e7..4924b39 100644
--- a/packages/remotion-composer/package.json
+++ b/packages/remotion-composer/package.json
@@ -8,7 +8,8 @@
     "node": ">=20"
   },
   "bin": {
-    "render-timeline": "./dist/cli.js"
+    "render-timeline": "./dist/cli.js",
+    "layout-sheet": "./dist/sheet-cli.js"
   },
   "exports": {
     ".": "./dist/index.js"
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Update the lockfile from the main checkout (not a worktree): `bun install --lockfile-only --ignore-scripts`. Its diff must be exactly:

````diff
diff --git a/bun.lock b/bun.lock
index bee0dc0..ab1472f 100644
--- a/bun.lock
+++ b/bun.lock
@@ -78,7 +78,8 @@
       "name": "@av/remotion-composer",
       "version": "0.3.0",
       "bin": {
-        "render-timeline": "./dist/cli.js"
+        "layout-sheet": "./dist/sheet-cli.js",
+        "render-timeline": "./dist/cli.js",
       },
       "dependencies": {
         "@remotion/bundler": "4.0.505",
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Then `bun install --frozen-lockfile` must succeed. Build and smoke-test:

```bash
npm run build --workspace @av/remotion-composer
node packages/remotion-composer/dist/sheet-cli.js; echo "exit $?"
# Usage: layout-sheet <timeline.json> <out-dir> --assets <dir> --times <s,s,…> [--scale <0..1>] [--columns <n>]
# exit 1
node packages/remotion-composer/dist/sheet-cli.js studio/contracts/fixtures/timeline/v1alpha2/valid/explainer.json /tmp/x --assets /tmp --times 0,99; echo "exit $?"
# bad-sheet: frame 2970 is not a frame of this timeline (0–764)
# exit 2
```

- [ ] **Step 8: Document it**

````diff
diff --git a/packages/remotion-composer/README.md b/packages/remotion-composer/README.md
index 4fb0d44..46aca48 100644
--- a/packages/remotion-composer/README.md
+++ b/packages/remotion-composer/README.md
@@ -74,8 +74,32 @@ const result = await renderTimeline({
 
 Failures throw `ComposerError` with a `code` (`invalid-timeline`,
 `unknown-kit`, `bad-props`, `missing-asset`, `hash-mismatch`,
-`render-failed`, `loudness-failed`) and, for validation, `problems` with JSON
-paths.
+`render-failed`, `loudness-failed`, `bad-sheet`, `sheet-failed`) and, for
+validation, `problems` with JSON paths.
+
+### Layout sheet
+
+`renderLayoutSheet` renders a timeline's stills at the frames the caller
+picks, then one labelled grid of them (the `Sheet` composition), from one
+bundle in one browser (avg-3th.1):
+
+```ts
+const sheet = await renderLayoutSheet({
+  timeline, assetRoot,
+  picks: [{frame: 0, label: 'first'}, {frame: 300, label: 'poem · start+2s'}],
+  outDir: 'sheet/',    // frames/000.jpg … and sheet.jpg
+  scale: 0.25,         // default; columns default to 6 (landscape) or 8
+});
+// sheet.frames[i] = {index, frame, seconds, label, path, hash}
+// sheet.sheet = {path, hash, columns, rows, width, height}
+// sheet.kits = [{name, version, hash}] — code hashes from kits.lock.json
+```
+
+Each tile is captioned `#NN · mm:ss.ff · label`. At most 120 distinct whole
+frames inside the timeline; anything else is `bad-sheet`, refused before
+anything is written. Which frames to pick, and where an episode keeps its
+sheet, are the studio's (`@studio/episode`). `timelineKits(timeline)` lists
+the kits a timeline draws with and their code hashes without rendering.
 
 ## Partial render cache
 
@@ -119,6 +143,7 @@ network or wall-clock inputs.
 ```bash
 npm run build --workspace @av/remotion-composer
 node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <episode-dir> --cache <cache-dir>
+node packages/remotion-composer/dist/sheet-cli.js timeline.json out-dir/ --assets <episode-dir> --times 0,2.5,10 [--scale 0.25] [--columns 6]
 ```
 
 ## Tests
@@ -126,7 +151,7 @@ node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <epis
 ```bash
 npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example and profile
 npm run build --workspace @av/remotion-composer && \
-  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also real renders and cache recovery/reuse checks
+  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also real renders, a real layout sheet and cache recovery/reuse checks
 ```
 
 The first render downloads Remotion's headless Chrome.
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 9: Run the package's checks and commit**

Run: `npm run check --workspace @av/remotion-composer`
Expected: typecheck clean; every test passes (real renders skipped).

```bash
git add packages/remotion-composer/src/Sheet.tsx packages/remotion-composer/src/kit-lock.ts \
  packages/remotion-composer/src/layout-sheet.ts packages/remotion-composer/src/sheet-cli.ts \
  packages/remotion-composer/src/Root.tsx packages/remotion-composer/src/errors.ts packages/remotion-composer/src/index.ts \
  packages/remotion-composer/package.json bun.lock packages/remotion-composer/README.md \
  packages/remotion-composer/test/layout-sheet.test.ts packages/remotion-composer/test/layout-sheet.e2e.test.ts
git commit -m "feat(remotion-composer): renderLayoutSheet — stills and a labelled grid, and the layout-sheet CLI (avg-3th.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Episode — `makeLayoutSheet` and `layoutSheetStatus`

**Files:**
- Create: `studio/episode/src/layout-sheet.ts`
- Modify: `studio/episode/src/index.ts`, `studio/episode/README.md`
- Test: `studio/episode/tests/layout-sheet.test.ts`, `studio/episode/tests/layout-sheet.e2e.test.ts`

**Interfaces:**
- Consumes: `renderLayoutSheet`, `timelineKits`, `LockedKit` (Task 3, through the composer's `dist/` — build it first); `sheetInstants`, `SheetRules` (Task 2); `decideEditTimeline`, `SeriesRulesError`, `TimelineDecision` (`episode-render.ts`); `loadEpisode`, `isSpecDriven` (`series-compile.ts`); `EDIT_TIMELINE_PATH`, `BuildOptions` (`edit-timeline-builder.ts`); `canonicalJson` (`@studio/contracts/src/receipt.mjs`).
- Produces: `LAYOUT_SHEET_DIR = "artifacts/layout-sheet"`, `LAYOUT_SHEET_REPORT = "artifacts/layout-sheet/sheet.json"`, `SHEET_SCALE = 0.25`; `makeLayoutSheet(episodeDir, options: BuildOptions): Promise<LayoutSheet>` with `LayoutSheet { report: LayoutSheetReport; reportPath; sheetPath }` (absolute paths); `layoutSheetStatus(episodeDir, options: BuildOptions): LayoutSheetStatus` = `{state: "missing", reason} | {state: "stale", reasons: string[]} | {state: "current", inputsHash, sheetHash}`; `sheetInputsHash({timeline, kits, rules, scale})`; types `LayoutSheetReport`, `SheetRulesSource { source: string; instants }`.

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/layout-sheet.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { decideEditTimeline, SeriesRulesError, writeEditTimeline } from "../src/episode-render.js";
import { LAYOUT_SHEET_REPORT, layoutSheetStatus, makeLayoutSheet, sheetInputsHash } from "../src/layout-sheet.js";
import { sheetInstants } from "../src/sheet-instants.js";
import { editSpec, sha256, specEpisode } from "../src/testing.js";

/**
 * An episode's layout sheet (avg-3th.1): what makeLayoutSheet writes and
 * refuses, and when layoutSheetStatus calls a sheet current, stale or
 * missing. The rendering is faked — @av/remotion-composer's own tests render
 * for real — and layout-sheet.e2e.test.ts makes one real sheet.
 */

const calls: { picks: { frame: number; label: string }[]; outDir: string; scale?: number }[] = [];
let failAfterWriting = false;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string; scale?: number }) => {
      calls.push(options);
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      if (failAfterWriting) throw new actual.ComposerError("sheet-failed", "Remotion could not render the layout sheet: the browser went away");
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, `sheet of ${frames.length}`);
      return {
        frames,
        sheet: { path, hash: sha256(`sheet of ${frames.length}`), columns: 8, rows: Math.ceil(frames.length / 8), width: 2160, height: 1600 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const report = () => JSON.parse(readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8"));
/** Anything a sheet left in artifacts/ besides itself. */
const leftovers = () => readdirSync(at("artifacts")).filter((n) => n.startsWith(".layout-sheet"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "layout-sheet-"));
  specEpisode(dir(), REF);
  calls.length = 0;
  failAfterWriting = false;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Publish poetry-short@1.1.0 — 1.0.0 plus `sheet` — and pin the episode to it. */
function pinReleaseWithSheet(sheet: unknown): void {
  const templates = join(dirname(dirname(dir())), "templates", "poetry-short");
  cpSync(join(templates, "1.0.0"), join(templates, "1.1.0"), { recursive: true });
  const manifestPath = join(templates, "1.1.0", "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const text = `${JSON.stringify({ ...manifest, version: "1.1.0", sheet }, null, 2)}\n`;
  writeFileSync(manifestPath, text);
  editSpec(dir(), (spec) => { spec.template = { id: "poetry-short", version: "1.1.0", hash: sha256(text) }; });
}

describe("makeLayoutSheet", () => {
  it("renders the timeline a render would use, at sheetInstants' frames, and says so in sheet.json", async () => {
    const decision = decideEditTimeline(dir(), { episodeRef: REF });
    const made = await makeLayoutSheet(dir(), { episodeRef: REF });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.picks).toEqual(sheetInstants(decision.timeline as never).picks);
    expect(calls[0]!.scale).toBe(0.25);
    const r = report();
    expect(made.report).toEqual(r);
    expect(made.sheetPath).toBe(at("artifacts/layout-sheet/sheet.jpg"));
    expect(r.timeline).toEqual({ path: "artifacts/edit-timeline.json", hash: `sha256:${decision.hash}` });
    expect(r.rebuilt).toBe("there was no timeline yet");
    expect(r.rules).toEqual({ source: "poetry-short@1.0.0", instants: [] });
    expect(r.kits.map((k: { name: string }) => k.name)).toEqual(["captions", "still"]);
    expect(r.inputsHash).toBe(sheetInputsHash({ timeline: r.timeline.hash, kits: r.kits, rules: r.rules, scale: 0.25 }));
    expect(r.frames[0]).toEqual({ index: 0, frame: 0, seconds: 0, label: "first", path: "frames/000.jpg", hash: sha256("still 0") });
    expect(r.sheet.path).toBe("sheet.jpg");
    expect(r.warnings).toEqual([]);
    // Only the sheet: the rebuilt timeline is the render's to write.
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("adds the instants the pinned release declares, and reports the ones that fall outside", async () => {
    pinReleaseWithSheet({ instants: [{ at: "start", offsetSeconds: 1 }, { at: "end", offsetSeconds: 5 }] });
    await makeLayoutSheet(dir(), { episodeRef: REF });
    const r = report();
    expect(r.rules.source).toBe("poetry-short@1.1.0");
    expect(r.frames.map((f: { label: string }) => f.label)).toContain("poem · start+1s");
    expect(r.warnings).toEqual(["rule 2 (end+5s) falls outside section poem"]);
  });

  it("replaces the previous sheet whole", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/frames/999.jpg"), "a still from before");
    await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(existsSync(at("artifacts/layout-sheet/frames/999.jpg"))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("keeps the previous sheet, and leaves nothing behind, when rendering fails", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    const before = readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8");
    failAfterWriting = true;
    await expect(makeLayoutSheet(dir(), { episodeRef: REF })).rejects.toThrow(/the browser went away/);
    expect(readFileSync(at(LAYOUT_SHEET_REPORT), "utf-8")).toBe(before);
    expect(leftovers()).toEqual([]);
  });

  it("refuses a timeline that breaks the series' rules, rendering and writing nothing", async () => {
    writeEditTimeline(dir(), { episodeRef: REF });
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    const refusal = makeLayoutSheet(dir(), { episodeRef: REF });
    await expect(refusal).rejects.toBeInstanceOf(SeriesRulesError);
    await expect(refusal).rejects.toThrow(/the layout sheet shows only a timeline a render would accept/);
    expect(calls).toEqual([]);
    expect(existsSync(at("artifacts/layout-sheet"))).toBe(false);
  });
});

describe("layoutSheetStatus", () => {
  it("is missing before the first sheet", () => {
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: `${LAYOUT_SHEET_REPORT} does not exist` });
  });

  it("is current right after a sheet, naming its hashes", async () => {
    const made = await makeLayoutSheet(dir(), { episodeRef: REF });
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "current", inputsHash: made.report.inputsHash, sheetHash: made.report.sheet.hash });
  });

  it("stays current when the render writes the very timeline the sheet shows", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeEditTimeline(dir(), { episodeRef: REF });
    expect(layoutSheetStatus(dir(), { episodeRef: REF }).state).toBe("current");
  });

  it("is stale when the timeline changed", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    editSpec(dir(), (spec) => { spec.data.title = "Another morning"; });
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "stale", reasons: ["the timeline changed"] });
  });

  it("is stale when the sheet's rules changed", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    pinReleaseWithSheet({ instants: [{ at: "middle" }] });
    const status = layoutSheetStatus(dir(), { episodeRef: REF });
    expect(status.state).toBe("stale");
    expect(status.state === "stale" && status.reasons).toContain("the sheet's rules changed");
  });

  it("is stale, saying why, when the timeline cannot be decided", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/edit-timeline.json"), "{ half an edit");
    const status = layoutSheetStatus(dir(), { episodeRef: REF });
    expect(status.state).toBe("stale");
    expect(status.state === "stale" && status.reasons[0]).toMatch(/cannot be decided: .*not JSON/);
  });

  it("is missing when the sheet image is not the one rendered, or sheet.json is not JSON", async () => {
    await makeLayoutSheet(dir(), { episodeRef: REF });
    writeFileSync(at("artifacts/layout-sheet/sheet.jpg"), "touched up");
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: "the sheet image is not the one rendered" });
    writeFileSync(at(LAYOUT_SHEET_REPORT), "{");
    expect(layoutSheetStatus(dir(), { episodeRef: REF })).toEqual({ state: "missing", reason: `${LAYOUT_SHEET_REPORT} is not JSON` });
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build --workspace @av/remotion-composer && cd studio/episode && npx vitest run tests/layout-sheet.test.ts`
Expected: FAIL — cannot resolve `../src/layout-sheet.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/layout-sheet.ts` (new):

````ts
// ---------------------------------------------------------------------------
// An episode's layout sheet (avg-3th.1)
// ---------------------------------------------------------------------------
// Small stills of the timeline a render would use, at the instants
// sheetInstants decides, and one labelled grid of them, kept in
// artifacts/layout-sheet/ with the sheet.json that says what they show. Its
// inputsHash covers everything that decides the pictures — the timeline
// (assets, timing and kit versions by hash), the kits' code, the instants'
// rules and the scale — so layoutSheetStatus can tell a current sheet from
// a stale one without rendering anything.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderLayoutSheet, timelineKits, type LockedKit } from "@av/remotion-composer";
import { canonicalJson } from "@studio/contracts/src/receipt.mjs";
import { decideEditTimeline, SeriesRulesError, type TimelineDecision } from "./episode-render.js";
import { EDIT_TIMELINE_PATH, type BuildOptions } from "./edit-timeline-builder.js";
import { isSpecDriven, loadEpisode } from "./series-compile.js";
import { sheetInstants, type SheetRules } from "./sheet-instants.js";

export const LAYOUT_SHEET_DIR = "artifacts/layout-sheet";
export const LAYOUT_SHEET_REPORT = `${LAYOUT_SHEET_DIR}/sheet.json`;
/** Of the timeline's resolution. */
export const SHEET_SCALE = 0.25;

/** Where a sheet's instants come from: the pinned release's rules, or the defaults alone. */
export interface SheetRulesSource {
  /** "<template id>@<version>", or "default". */
  source: string;
  instants: SheetRules["instants"];
}

/** sheet.json. Paths are relative to artifacts/layout-sheet/. */
export interface LayoutSheetReport {
  createdAt: string;
  timeline: { path: string; hash: string };
  /** Why a render would rebuild the stored timeline first; absent when it renders it as it stands. */
  rebuilt?: string;
  rules: SheetRulesSource;
  scale: number;
  kits: LockedKit[];
  inputsHash: string;
  frames: { index: number; frame: number; seconds: number; label: string; path: string; hash: string }[];
  sheet: { path: string; hash: string; columns: number; rows: number; width: number; height: number };
  warnings: string[];
}

export interface LayoutSheet {
  report: LayoutSheetReport;
  /** Absolute paths. */
  reportPath: string;
  sheetPath: string;
}

export type LayoutSheetStatus =
  | { state: "missing"; reason: string }
  | { state: "stale"; reasons: string[] }
  | { state: "current"; inputsHash: string; sheetHash: string };

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** sha256 of the canonical JSON of what decides a sheet's pictures. */
export function sheetInputsHash(parts: { timeline: string; kits: LockedKit[]; rules: SheetRulesSource; scale: number }): string {
  return sha256(canonicalJson(parts));
}

/** The rules a spec-driven episode's pinned release declares; the defaults for every other episode. */
function rulesFor(episodeDir: string, options: BuildOptions): SheetRulesSource {
  if (!isSpecDriven(episodeDir)) return { source: "default", instants: [] };
  const loaded = loadEpisode(episodeDir, options);
  // decideEditTimeline compiled this episode a moment ago; a failure here is a race.
  if (!loaded.ok) throw new Error(`the episode could not be loaded: ${loaded.problems.map((p) => p.message).join("; ")}`);
  const { template } = loaded.input;
  return { source: `${template.id}@${template.version}`, instants: template.sheet?.instants ?? [] };
}

/** What the sheet of this decision would be made from; throws what decideEditTimeline throws. */
function inputsOf(episodeDir: string, options: BuildOptions, decision: TimelineDecision) {
  const kits = timelineKits(decision.timeline as never);
  if (kits === null) throw new Error("a kit of this timeline is not one this studio has");
  const rules = rulesFor(episodeDir, options);
  const timeline = `sha256:${decision.hash}`;
  return { timeline, kits, rules, scale: SHEET_SCALE, inputsHash: sheetInputsHash({ timeline, kits, rules, scale: SHEET_SCALE }) };
}

let temporaries = 0;

/**
 * Render the layout sheet of the timeline a render would use, and replace
 * artifacts/layout-sheet/ with it whole. Refuses a timeline that breaks its
 * series' rules, writing nothing; a failure leaves the previous sheet as it
 * was. Writes nothing else: a rebuilt timeline is written by the render.
 */
export async function makeLayoutSheet(episodeDir: string, options: BuildOptions): Promise<LayoutSheet> {
  const decision = decideEditTimeline(episodeDir, options);
  const errors = decision.validation?.findings.filter((f) => f.severity === "error") ?? [];
  if (errors.length > 0) {
    throw new SeriesRulesError(decision.validation!.validator, errors, `: the layout sheet shows only a timeline a render would accept`);
  }
  const inputs = inputsOf(episodeDir, options, decision);
  const { picks, warnings } = sheetInstants(decision.timeline as never, { instants: inputs.rules.instants });

  const artifacts = join(episodeDir, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const suffix = `${process.pid}.${temporaries++}`;
  const temp = join(artifacts, `.layout-sheet.${suffix}.tmp`);
  const old = join(artifacts, `.layout-sheet.${suffix}.old`);
  const final = join(episodeDir, LAYOUT_SHEET_DIR);
  try {
    const result = await renderLayoutSheet({ timeline: decision.timeline, assetRoot: episodeDir, picks, outDir: temp, scale: SHEET_SCALE });
    const report: LayoutSheetReport = {
      createdAt: new Date().toISOString(),
      timeline: { path: EDIT_TIMELINE_PATH, hash: inputs.timeline },
      ...(decision.rebuilt ? { rebuilt: decision.rebuilt } : {}),
      rules: inputs.rules,
      scale: inputs.scale,
      kits: inputs.kits,
      inputsHash: inputs.inputsHash,
      frames: result.frames.map((f) => ({ ...f, path: relative(temp, f.path) })),
      sheet: { ...result.sheet, path: relative(temp, result.sheet.path) },
      warnings,
    };
    writeFileSync(join(temp, "sheet.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    if (existsSync(final)) renameSync(final, old);
    renameSync(temp, final);
    rmSync(old, { recursive: true, force: true });
    return { report, reportPath: join(final, "sheet.json"), sheetPath: join(final, report.sheet.path) };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    // Between the two renames: put the previous sheet back.
    if (!existsSync(final) && existsSync(old)) renameSync(old, final);
    throw error;
  }
}

/** Read sheet.json, or say why there is no sheet to speak of. */
function readReport(episodeDir: string): { ok: true; report: LayoutSheetReport } | { ok: false; reason: string } {
  const path = join(episodeDir, LAYOUT_SHEET_REPORT);
  if (!existsSync(path)) return { ok: false, reason: `${LAYOUT_SHEET_REPORT} does not exist` };
  let report: LayoutSheetReport;
  try {
    report = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { ok: false, reason: `${LAYOUT_SHEET_REPORT} is not JSON` };
  }
  const image = typeof report?.sheet?.path === "string" ? join(episodeDir, LAYOUT_SHEET_DIR, report.sheet.path) : null;
  if (!image || !existsSync(image)) return { ok: false, reason: "the sheet image is missing" };
  if (sha256(readFileSync(image)) !== report.sheet.hash) return { ok: false, reason: "the sheet image is not the one rendered" };
  return { ok: true, report };
}

/**
 * Is the episode's layout sheet a picture of the timeline a render would use
 * now? Reads only.
 */
export function layoutSheetStatus(episodeDir: string, options: BuildOptions): LayoutSheetStatus {
  const read = readReport(episodeDir);
  if (!read.ok) return { state: "missing", reason: read.reason };
  const { report } = read;
  let now;
  try {
    now = inputsOf(episodeDir, options, decideEditTimeline(episodeDir, options));
  } catch (error) {
    return { state: "stale", reasons: [`the timeline a render would use cannot be decided: ${(error as Error).message}`] };
  }
  if (report.inputsHash === now.inputsHash) return { state: "current", inputsHash: now.inputsHash, sheetHash: report.sheet.hash };
  const reasons: string[] = [];
  if (report.timeline?.hash !== now.timeline) reasons.push("the timeline changed");
  if (canonicalJson(report.kits ?? null) !== canonicalJson(now.kits)) reasons.push("the kits changed");
  if (canonicalJson(report.rules ?? null) !== canonicalJson(now.rules)) reasons.push("the sheet's rules changed");
  if (report.scale !== now.scale) reasons.push("the scale changed");
  if (reasons.length === 0) reasons.push("its inputs hash does not match");
  return { state: "stale", reasons };
}
````

Append to `studio/episode/src/index.ts`:

```ts
export * from "./layout-sheet.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd studio/episode && npx vitest run tests/layout-sheet.test.ts && npx tsc --noEmit`
Expected: 12 passed; no type errors.

- [ ] **Step 5: One real sheet (opt-in)**

`studio/episode/tests/layout-sheet.e2e.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layoutSheetStatus, makeLayoutSheet } from "../src/layout-sheet.js";
import { specEpisode } from "../src/testing.js";

/**
 * One real layout sheet of a poetry-short episode (avg-3th.1), through
 * Remotion: slow, and it needs headless Chrome and ffmpeg. Only with
 * REMOTION_E2E=1, against @av/remotion-composer's dist/ (build it first).
 */

const enabled = process.env.REMOTION_E2E === "1";
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

const COLORS = ["0x2e7d32", "0x6a1b9a", "0xef6c00", "0x1565c0"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "layout-sheet-e2e-"));
  let i = 0;
  specEpisode(dir(), REF, {
    image: (path) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${COLORS[i++ % COLORS.length]}:s=1080x1920`, "-frames:v", "1", path]),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!enabled)("makeLayoutSheet, rendered", () => {
  it("renders every pick of the poetry-short episode and a grid of them; the sheet is then current", async () => {
    const made = await makeLayoutSheet(dir(), { episodeRef: REF });
    const { report } = made;
    expect(report.frames.length).toBeGreaterThanOrEqual(20);
    expect(readdirSync(join(dir(), "artifacts/layout-sheet/frames"))).toHaveLength(report.frames.length);
    // 1080x1920 at 0.25, eight columns.
    expect(report.sheet).toMatchObject({ columns: 8, width: 8 * 270, rows: Math.ceil(report.frames.length / 8) });
    expect(existsSync(made.sheetPath)).toBe(true);
    expect(layoutSheetStatus(dir(), { episodeRef: REF }).state).toBe("current");
  }, 300_000);
});
````

Run: `cd studio/episode && REMOTION_E2E=1 npx vitest run tests/layout-sheet.e2e.test.ts`
Expected: 1 passed (24 frames, 8 columns, then `current`). Skipped without the variable.

- [ ] **Step 6: Document, build, commit**

````diff
diff --git a/studio/episode/README.md b/studio/episode/README.md
index 2924f74..cba6b08 100644
--- a/studio/episode/README.md
+++ b/studio/episode/README.md
@@ -3,10 +3,10 @@
 An episode on disk, produced (ADR-0036, ADR-0037): its narration manifest and
 scene images, its edit timeline — built from its material, or compiled from
 its `episode-spec.json` by its series template's compiler — checked against its
-series' rules, and rendered with `@av/remotion-composer`.
+series' rules, shown on a layout sheet and rendered with `@av/remotion-composer`.
 
 The agent's tools (`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`,
-`pva_compose_video`, the narration tools) and the `series-production` stage
+`pva_layout_sheet`, `pva_compose_video`, the narration tools) and the `series-production` stage
 adapters both call this package, so a tool and a stage never disagree.
 
 ## What it offers
@@ -19,6 +19,9 @@ adapters both call this package, so a tool and a stage never disagree.
 | `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules |
 | `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
 | `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |
+| `references.ts` | `proposeReference`: freeze an episode as a proposed golden reference |
+| `sheet-instants.ts` | `sheetInstants`: the frames a layout sheet shows, from the timeline and the release's `sheet` rules (pure) |
+| `layout-sheet.ts` | `makeLayoutSheet`, `layoutSheetStatus`: `artifacts/layout-sheet/`, and whether it still shows what a render would use |
 
 `@studio/episode/testing` exports `specEpisode`, `editSpec` and `sha256`: a
 complete poetry-short episode on disk, from `@studio/series`'s golden fixture,
@@ -30,4 +33,5 @@ for tests.
 npm run build       # tsc to dist/ (the agent and the adapters import it from there)
 npm run typecheck
 npm test            # vitest
+REMOTION_E2E=1 npm test   # also one real layout sheet (build @av/remotion-composer first)
 ```
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Run: `npm run build --workspace @studio/episode && npm test --workspace @studio/episode`
Expected: every test passes (one skipped).

```bash
git add studio/episode/src/layout-sheet.ts studio/episode/src/index.ts studio/episode/README.md \
  studio/episode/tests/layout-sheet.test.ts studio/episode/tests/layout-sheet.e2e.test.ts
git commit -m "feat(episode): makeLayoutSheet and layoutSheetStatus — the episode's sheet and whether it is current (avg-3th.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Pipeline — `series-production` 1.1.0, the `series-sheet` adapter, the render's refusal

**Files:**
- Modify: `studio/pipelines/pipelines/series-production.yaml`, `studio/pipelines/fixtures/valid/series-local/poetry-short.yaml`, `studio/adapters/src/adapters/series.ts`, `studio/adapters/src/studio.ts`, `docs/pipelines.md`
- Test: `studio/adapters/test/series.test.ts`

**Interfaces:**
- Consumes: `makeLayoutSheet`, `layoutSheetStatus`, `LAYOUT_SHEET_REPORT` from `@studio/episode` (Task 4, through its `dist/`).
- Produces: adapter `seriesSheet` (id `series-sheet`, editorial, produces `layout-sheet.json`, consumes `edit-timeline.json` + `series-check.json`, provider `remotion-composer`); `seriesRender` now consumes `layout-sheet.json` too; stage `sheet` in `series-production` 1.1.0 between `check` and `render`, skill `review-layout-sheet@0.1.0` (written in Task 6).

- [ ] **Step 1: Write the failing tests**

````diff
diff --git a/studio/adapters/test/series.test.ts b/studio/adapters/test/series.test.ts
index b4dadae..70f6579 100644
--- a/studio/adapters/test/series.test.ts
+++ b/studio/adapters/test/series.test.ts
@@ -1,9 +1,10 @@
-// The series-production family (avg-jao.4): which stages the studio
-// performs, and what its three adapters do with a spec-driven episode. The
-// render itself is faked, as in the agent's tests: @av/remotion-composer has
-// its own.
+// The series-production family (avg-jao.4, avg-3th.1): which stages the
+// studio performs, and what its four adapters do with a spec-driven episode.
+// The render and the layout sheet are faked, as in the agent's tests:
+// @av/remotion-composer has its own.
 
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+import { createHash } from "node:crypto";
 import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
 import { createRequire } from "node:module";
 import { tmpdir } from "node:os";
@@ -11,10 +12,11 @@ import { dirname, join } from "node:path";
 import { FileSystemPipelineLoader, resolvePipeline } from "@studio/runtime";
 import { editSpec, specEpisode } from "@studio/episode/testing";
 import { createStudioRegistry } from "../src/index.js";
-import { seriesCheck, seriesRender, seriesTimeline } from "../src/adapters/series.js";
+import { seriesCheck, seriesRender, seriesSheet, seriesTimeline } from "../src/adapters/series.js";
 import { BUILTIN_NAMES, BUILTIN_PIPELINES, builtin } from "./helpers.js";
 
 const renders: string[] = [];
+const sheets: string[] = [];
 
 vi.mock("@av/remotion-composer", async (importOriginal) => {
   const actual = await importOriginal<typeof import("@av/remotion-composer")>();
@@ -35,6 +37,23 @@ vi.mock("@av/remotion-composer", async (importOriginal) => {
         cache: { wholeVideoReused: false, segmentsReused: 0, segmentsRendered: 1, totalSegments: 1, warnings: [] },
       };
     },
+    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
+      sheets.push(options.outDir);
+      mkdirSync(join(options.outDir, "frames"), { recursive: true });
+      const frames = options.picks.map((p, index) => {
+        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
+        writeFileSync(path, "still");
+        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: `sha256:${"1".repeat(64)}` };
+      });
+      const path = join(options.outDir, "sheet.jpg");
+      writeFileSync(path, "sheet");
+      return {
+        frames,
+        // layoutSheetStatus checks the image against this hash.
+        sheet: { path, hash: `sha256:${createHash("sha256").update("sheet").digest("hex")}`, columns: 8, rows: 3, width: 2160, height: 1560 },
+        kits: actual.timelineKits(options.timeline)!,
+      };
+    },
   };
 });
 
@@ -49,6 +68,7 @@ beforeEach(() => {
   root = mkdtempSync(join(tmpdir(), "series-adapters-"));
   specEpisode(dir(), REF);
   renders.length = 0;
+  sheets.length = 0;
   lines.length = 0;
 });
 afterEach(() => rmSync(root, { recursive: true, force: true }));
@@ -56,10 +76,11 @@ afterEach(() => rmSync(root, { recursive: true, force: true }));
 describe("the series-production pipeline", () => {
   it("resolves, every input produced by an earlier stage", async () => {
     const pipeline = await builtin("series-production");
-    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "render"]);
+    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "sheet", "render"]);
+    expect(pipeline.version).toBe("1.1.0");
   });
 
-  it("is performed by the studio at timeline, check and render; spec, pictures and takes are a person's or Pi's", async () => {
+  it("is performed by the studio at timeline, check, sheet and render; spec, pictures and takes are a person's or Pi's", async () => {
     const pipeline = await builtin("series-production");
     const registry = createStudioRegistry();
     expect(pipeline.stages.map((s) => [s.definition.id, registry.match(s)?.id ?? null])).toEqual([
@@ -68,13 +89,14 @@ describe("the series-production pipeline", () => {
       ["takes", null],
       ["timeline", "series-timeline"],
       ["check", "series-check"],
+      ["sheet", "series-sheet"],
       ["render", "series-render"],
     ]);
   });
 
   it("its adapters perform no stage of another built-in pipeline", async () => {
     const registry = createStudioRegistry();
-    const series = new Set(["series-timeline", "series-check", "series-render"]);
+    const series = new Set(["series-timeline", "series-check", "series-sheet", "series-render"]);
     for (const name of BUILTIN_NAMES.filter((n) => n !== "series-production")) {
       for (const stage of (await builtin(name)).stages) {
         expect(series.has(registry.match(stage)?.id ?? ""), `${name}/${stage.definition.id}`).toBe(false);
@@ -87,7 +109,7 @@ describe("the series-production pipeline", () => {
     const local = join(dirname(createRequire(import.meta.url).resolve("@studio/pipelines/package.json")), "fixtures/valid/series-local");
     const pipeline = await resolvePipeline(new FileSystemPipelineLoader([BUILTIN_PIPELINES, local]), "poetry-short");
     expect(pipeline.inheritanceChain).toEqual(["series-production", "poetry-short"]);
-    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "render"]);
+    expect(pipeline.stages.map((s) => s.definition.id)).toEqual(["spec", "pictures", "takes", "timeline", "check", "sheet", "render"]);
     expect(pipeline.stages.find((s) => s.definition.id === "takes")!.definition.name).toBe("Recital Take");
   });
 });
@@ -135,10 +157,47 @@ describe("series-check", () => {
   });
 });
 
+/** A change the rules allow (the teacup arrives 10 frames later), made after the review. */
+function editAllowed(): void {
+  const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
+  timeline.tracks[0].items[0].duration = 113;
+  timeline.tracks[0].items[1].from = 101;
+  timeline.tracks[0].items[1].duration = 110;
+  writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
+}
+
+describe("series-sheet", () => {
+  it("renders the layout sheet of the checked timeline and returns its report and image", async () => {
+    await seriesTimeline.perform(ctx());
+    await seriesCheck.perform(ctx());
+    const written = await seriesSheet.perform(ctx());
+    expect(written).toEqual([at("artifacts/layout-sheet/sheet.json"), at("artifacts/layout-sheet/sheet.jpg")]);
+    expect(sheets).toHaveLength(1);
+    const report = JSON.parse(readFileSync(at("artifacts/layout-sheet/sheet.json"), "utf-8"));
+    expect(report.timeline.hash).toBe(JSON.parse(readFileSync(at("artifacts/series-check.json"), "utf-8")).timeline.hash);
+    expect(lines.join("\n")).toMatch(/sheet: \d+ frames \(8×3\), rules poetry-short@1\.0\.0 → .*artifacts\/layout-sheet\/sheet\.jpg/);
+  });
+
+  it("refuses an episode never checked, or a timeline changed since its check", async () => {
+    await seriesTimeline.perform(ctx());
+    await expect(seriesSheet.perform(ctx())).rejects.toThrow(/series-check\.json is missing: run the check stage/);
+    await seriesCheck.perform(ctx());
+    editAllowed();
+    await expect(seriesSheet.perform(ctx())).rejects.toThrow(/changed since it was checked: run the check stage again/);
+    expect(sheets).toHaveLength(0);
+  });
+});
+
 describe("series-render", () => {
-  it("renders the checked timeline", async () => {
+  /** timeline → check → sheet, as the pipeline runs them. */
+  async function upToTheSheet(): Promise<void> {
     await seriesTimeline.perform(ctx());
     await seriesCheck.perform(ctx());
+    await seriesSheet.perform(ctx());
+  }
+
+  it("renders the checked timeline whose sheet is current", async () => {
+    await upToTheSheet();
     const written = await seriesRender.perform(ctx());
     expect(written).toHaveLength(1);
     expect(written[0]).toMatch(/output\/render-\d+-[0-9a-f]{8}\.mp4$/);
@@ -147,30 +206,49 @@ describe("series-render", () => {
   });
 
   it("refuses a timeline changed since it was checked, until the check runs again", async () => {
+    await upToTheSheet();
+    editAllowed();
+    await expect(seriesRender.perform(ctx())).rejects.toThrow(/changed since it was checked: run the check stage again/);
+    expect(renders).toHaveLength(0);
+  });
+
+  it("refuses without a layout sheet", async () => {
     await seriesTimeline.perform(ctx());
     await seriesCheck.perform(ctx());
-    // A change the rules allow (the teacup arrives 10 frames later), made after the review.
-    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
-    timeline.tracks[0].items[0].duration = 113;
-    timeline.tracks[0].items[1].from = 101;
-    timeline.tracks[0].items[1].duration = 110;
-    writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
-    await expect(seriesRender.perform(ctx())).rejects.toThrow(/changed since it was checked: run the check stage again/);
+    await expect(seriesRender.perform(ctx())).rejects.toThrow(
+      /the layout sheet is missing \(artifacts\/layout-sheet\/sheet\.json does not exist\): run the sheet stage again/,
+    );
     expect(renders).toHaveLength(0);
+  });
+
+  it("refuses a sheet of an earlier timeline, even one checked again since, until the sheet is made again", async () => {
+    await upToTheSheet();
+    editAllowed();
     await seriesCheck.perform(ctx());
+    await expect(seriesRender.perform(ctx())).rejects.toThrow(/the layout sheet is stale \(the timeline changed\): run the sheet stage again/);
+    expect(renders).toHaveLength(0);
+    await seriesSheet.perform(ctx());
     await seriesRender.perform(ctx());
     expect(renders).toHaveLength(1);
   });
 
+  it("refuses a sheet whose image was replaced", async () => {
+    await upToTheSheet();
+    writeFileSync(at("artifacts/layout-sheet/sheet.jpg"), "another picture");
+    await expect(seriesRender.perform(ctx())).rejects.toThrow(/the layout sheet is missing \(the sheet image is not the one rendered\)/);
+    expect(renders).toHaveLength(0);
+  });
+
   it("refuses a timeline that breaks the series' rules, writing no output", async () => {
-    await seriesTimeline.perform(ctx());
-    await seriesCheck.perform(ctx());
+    await upToTheSheet();
     const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
     timeline.tracks[1].items[0].props.text = "Light falls across the room.";
     writeFileSync(at("artifacts/edit-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
-    // Checked again (and refused): the render then refuses on the rules themselves.
+    // Checked again (and refused), no sheet can be made of it, and the old
+    // sheet no longer shows what would be rendered.
     await expect(seriesCheck.perform(ctx())).rejects.toThrow(/refuse this timeline/);
-    await expect(seriesRender.perform(ctx())).rejects.toThrow(/series rules/);
+    await expect(seriesSheet.perform(ctx())).rejects.toThrow(/series rules \(poetry-short@1\.0\.0\) refuse this timeline: the layout sheet shows only/);
+    await expect(seriesRender.perform(ctx())).rejects.toThrow(/the layout sheet is stale \(the timeline changed\)/);
     expect(renders).toHaveLength(0);
     expect(existsSync(at("output"))).toBe(false);
   });
@@ -179,7 +257,7 @@ describe("series-render", () => {
 describe("an episode without a spec", () => {
   it("is refused by every series adapter", async () => {
     unlinkSync(at("episode-spec.json"));
-    for (const adapter of [seriesTimeline, seriesCheck, seriesRender]) {
+    for (const adapter of [seriesTimeline, seriesCheck, seriesSheet, seriesRender]) {
       await expect(adapter.perform(ctx()), adapter.id).rejects.toThrow(/this pipeline needs an episode-spec\.json; run the spec stage/);
     }
   });
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/adapters && npx vitest run test/series.test.ts`
Expected: FAIL — `seriesSheet` is not exported, and the pipeline has no `sheet` stage.

- [ ] **Step 3: The pipeline's new version**

````diff
diff --git a/studio/pipelines/fixtures/valid/series-local/poetry-short.yaml b/studio/pipelines/fixtures/valid/series-local/poetry-short.yaml
index ef6b644..246a98e 100644
--- a/studio/pipelines/fixtures/valid/series-local/poetry-short.yaml
+++ b/studio/pipelines/fixtures/valid/series-local/poetry-short.yaml
@@ -7,7 +7,7 @@ pipeline:
   description: "A short vertical poem: series-production, with the poem's recital as its one take"
   extends:
     pipeline: series-production
-    version: "1.0.0"
+    version: "1.1.0"
   stages:
     - id: takes
       name: "Recital Take"
diff --git a/studio/pipelines/pipelines/series-production.yaml b/studio/pipelines/pipelines/series-production.yaml
index 9489eca..1856382 100644
--- a/studio/pipelines/pipelines/series-production.yaml
+++ b/studio/pipelines/pipelines/series-production.yaml
@@ -1,14 +1,15 @@
-# The series-production family (avg-jao.4, ADR-0037). One manifest for every
+# The series-production family (avg-jao.4, ADR-0037); 1.1.0 adds the layout
+# sheet between the check and the render (avg-3th.1). One manifest for every
 # series with a template: the compiler and the validator are the ones the
 # episode's pinned release names, never the pipeline's. Stages that depend on
 # work not done yet (source, take synthesis and verification, alignment, the
-# layout sheet, the render audit, the delivery package) are inserted by their
-# own issues as new versions of this manifest. A series extends it and
-# replaces stages by id (ADR-0001).
+# render audit, the delivery package) are inserted by their own issues as new
+# versions of this manifest. A series extends it and replaces stages by id
+# (ADR-0001).
 pipeline:
   id: series-production
-  version: "1.0.0"
-  description: "A series episode from its template: the spec, its pictures and narration takes, the timeline its template's compiler makes, the series rules checked, the render."
+  version: "1.1.0"
+  description: "A series episode from its template: the spec, its pictures and narration takes, the timeline its template's compiler makes, the series rules checked, the layout sheet read, the render."
   capabilities:
     - id: video.compose
       version: "1.0.0"
@@ -108,16 +109,40 @@ pipeline:
       depends_on:
         - timeline
 
+    - id: sheet
+      name: "Layout Sheet"
+      type: editorial
+      description: "Render the layout sheet of the checked timeline; a person reads it frame by frame before a render is spent"
+      inputs:
+        - contract: edit-timeline.json
+          version: "1.0.0"
+        - contract: series-check.json
+          version: "1.0.0"
+      outputs:
+        - contract: layout-sheet.json
+          version: "1.0.0"
+      gates:
+        autopilot: false
+        review: human
+        retry_on_failure: 1
+      skills:
+        - skill: review-layout-sheet
+          version: "0.1.0"
+      depends_on:
+        - check
+
     - id: render
       name: "Render"
       type: capability
-      description: "Render the checked timeline to output/<render-id>.mp4 and move output/current.json"
+      description: "Render the checked timeline, whose layout sheet was read, to output/<render-id>.mp4 and move output/current.json"
       capability: video.compose
       inputs:
         - contract: edit-timeline.json
           version: "1.0.0"
         - contract: series-check.json
           version: "1.0.0"
+        - contract: layout-sheet.json
+          version: "1.0.0"
       outputs:
         - contract: output.mp4
           version: "1.0.0"
@@ -132,4 +157,4 @@ pipeline:
         - skill: compose-video
           version: "0.5.0"
       depends_on:
-        - check
+        - sheet
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: The adapter and the render's refusal**

````diff
diff --git a/studio/adapters/src/adapters/series.ts b/studio/adapters/src/adapters/series.ts
index e629035..0a03b35 100644
--- a/studio/adapters/src/adapters/series.ts
+++ b/studio/adapters/src/adapters/series.ts
@@ -1,7 +1,7 @@
 // ---------------------------------------------------------------------------
 // The series-production stages the studio performs (avg-jao.4)
 // ---------------------------------------------------------------------------
-// Compile, check and render a spec-driven episode — the same code the agent's
+// Compile, check, sheet (avg-3th.1) and render a spec-driven episode — the same code the agent's
 // tools call (@studio/episode), so a stage and a tool never disagree. The
 // compiler and the validator are the ones the episode's pinned template
 // release names; nothing here chooses them.
@@ -13,6 +13,9 @@ import {
   decideEditTimeline,
   EDIT_TIMELINE_PATH,
   isSpecDriven,
+  LAYOUT_SHEET_REPORT,
+  layoutSheetStatus,
+  makeLayoutSheet,
   renderEpisode,
   writeEditTimeline,
 } from "@studio/episode";
@@ -99,36 +102,72 @@ export const seriesCheck: StageAdapter = {
   },
 };
 
-export const seriesRender: StageAdapter = {
-  id: "series-render",
-  summary: "Renders the checked edit timeline with Remotion to output/<render-id>.mp4, refusing one that breaks the series' rules",
-  capability: "video.compose",
+/**
+ * What a person reviewed is the timeline the check report names: a stage
+ * after the check works on that one, or none — a later edit, even one the
+ * rules allow, goes back to review.
+ */
+function requireCheckedTimeline(ctx: AdapterContext): void {
+  const reportPath = join(ctx.episodeDir, SERIES_CHECK_PATH);
+  if (!existsSync(reportPath)) {
+    throw new Error(`${SERIES_CHECK_PATH} is missing: run the check stage`);
+  }
+  let checked: unknown;
+  try {
+    checked = (JSON.parse(readFileSync(reportPath, "utf-8")) as { timeline?: { hash?: unknown } }).timeline?.hash;
+  } catch {
+    checked = undefined;
+  }
+  let current: string;
+  try {
+    current = `sha256:${decideEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref }).hash}`;
+  } catch (error) {
+    return failWith(ctx, error);
+  }
+  if (checked !== current) {
+    throw new Error(`the timeline changed since it was checked: run the check stage again (${SERIES_CHECK_PATH})`);
+  }
+}
+
+export const seriesSheet: StageAdapter = {
+  id: "series-sheet",
+  summary: "Renders the layout sheet of the checked timeline — small stills at the series' instants and a labelled grid of them — for a person to read before the render",
+  capability: null,
   provider: "remotion-composer",
-  produces: ["output.mp4"],
+  produces: ["layout-sheet.json"],
   consumes: ["edit-timeline.json", "series-check.json"],
-  requires: { system: ["ffmpeg"] },
+  requires: {},
   async perform(ctx) {
     requireSpec(ctx);
-    const reportPath = join(ctx.episodeDir, SERIES_CHECK_PATH);
-    if (!existsSync(reportPath)) {
-      throw new Error(`${SERIES_CHECK_PATH} is missing: run the check stage`);
-    }
-    // What a person reviewed is the timeline the report names: render that
-    // one, or none — a later edit, even one the rules allow, goes back to review.
-    let checked: unknown;
+    requireCheckedTimeline(ctx);
     try {
-      checked = (JSON.parse(readFileSync(reportPath, "utf-8")) as { timeline?: { hash?: unknown } }).timeline?.hash;
-    } catch {
-      checked = undefined;
-    }
-    let current: string;
-    try {
-      current = `sha256:${decideEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref }).hash}`;
+      const sheet = await makeLayoutSheet(ctx.episodeDir, { episodeRef: ctx.ref });
+      const { report } = sheet;
+      ctx.log(`  sheet: ${report.frames.length} frames (${report.sheet.columns}×${report.sheet.rows}), rules ${report.rules.source} → ${sheet.sheetPath}`);
+      for (const w of report.warnings) ctx.log(`    ⚠️ ${w}`);
+      return [sheet.reportPath, sheet.sheetPath];
     } catch (error) {
       return failWith(ctx, error);
     }
-    if (checked !== current) {
-      throw new Error(`the timeline changed since it was checked: run the check stage again (${SERIES_CHECK_PATH})`);
+  },
+};
+
+export const seriesRender: StageAdapter = {
+  id: "series-render",
+  summary: "Renders the checked edit timeline, whose layout sheet is current, with Remotion to output/<render-id>.mp4, refusing one that breaks the series' rules",
+  capability: "video.compose",
+  provider: "remotion-composer",
+  produces: ["output.mp4"],
+  consumes: ["edit-timeline.json", "series-check.json", "layout-sheet.json"],
+  requires: { system: ["ffmpeg"] },
+  async perform(ctx) {
+    requireSpec(ctx);
+    requireCheckedTimeline(ctx);
+    // The sheet a person read must show exactly what is about to be rendered.
+    const sheet = layoutSheetStatus(ctx.episodeDir, { episodeRef: ctx.ref });
+    if (sheet.state !== "current") {
+      const why = sheet.state === "missing" ? `missing (${sheet.reason})` : `stale (${sheet.reasons.join("; ")})`;
+      throw new Error(`the layout sheet is ${why}: run the sheet stage again (${LAYOUT_SHEET_REPORT})`);
     }
     try {
       const render = await renderEpisode(ctx.episodeDir, { episodeRef: ctx.ref });
diff --git a/studio/adapters/src/studio.ts b/studio/adapters/src/studio.ts
index 8f6e1fc..2d11a98 100644
--- a/studio/adapters/src/studio.ts
+++ b/studio/adapters/src/studio.ts
@@ -12,7 +12,7 @@ import { illustrationsFromAssets } from "./adapters/illustrations.js";
 import { narrationCaptions } from "./adapters/captions.js";
 import { narrationTiming } from "./adapters/timing.js";
 import { renderQa } from "./adapters/render-qa.js";
-import { seriesCheck, seriesRender, seriesTimeline } from "./adapters/series.js";
+import { seriesCheck, seriesRender, seriesSheet, seriesTimeline } from "./adapters/series.js";
 
 export const STUDIO_ADAPTERS: readonly StageAdapter[] = Object.freeze([
   illustrationsFromAssets,
@@ -21,6 +21,7 @@ export const STUDIO_ADAPTERS: readonly StageAdapter[] = Object.freeze([
   renderQa,
   seriesTimeline,
   seriesCheck,
+  seriesSheet,
   seriesRender,
 ]);
 
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd studio/adapters && npx vitest run && cd ../pipelines && npm test && cd ../.. && npm run check:pipelines`
Expected: adapters 46 passed (the conformance test included); pipelines pass.

- [ ] **Step 6: Document and commit**

````diff
diff --git a/docs/pipelines.md b/docs/pipelines.md
index 370adfd..0c5a605 100755
--- a/docs/pipelines.md
+++ b/docs/pipelines.md
@@ -84,7 +84,8 @@ pipeline's.
 | `takes` → `takes.json` | the person or Pi: the narration takes and their word timing | human |
 | `timeline` → `edit-timeline.json` | adapter `series-timeline` (the release's compiler) | — |
 | `check` → `series-check.json` | adapter `series-check` (the release's validator); errors fail it | human |
-| `render` → `output.mp4` | adapter `series-render` (`video.compose`, Remotion) | human |
+| `sheet` → `layout-sheet.json` | adapter `series-sheet` (Remotion): stills at the series' instants and a labelled grid; the `review-layout-sheet` skill | human |
+| `render` → `output.mp4` | adapter `series-render` (`video.compose`, Remotion); refuses a missing or stale sheet | human |
 
 A series extends it and replaces stages by id (ADR-0001). The example
 `studio/pipelines/fixtures/valid/series-local/poetry-short.yaml` keeps every
@@ -96,7 +97,7 @@ pipeline:
   version: "1.0.0"
   extends:
     pipeline: series-production
-    version: "1.0.0"
+    version: "1.1.0"
   stages:
     - id: takes
       name: "Recital Take"
@@ -105,9 +106,10 @@ pipeline:
 
 Stages that depend on unfinished work arrive as new versions of the base:
 take synthesis, alignment and verification (`avg-8hs.*`) turn `takes` into
-capability stages; the layout sheet (`avg-3th.1`) goes between `check` and
-`render`; the render audit (`avg-3th.3`) and the delivery package
-(`avg-3th.5`) follow `render`.
+capability stages; the render audit (`avg-3th.3`) and the delivery package
+(`avg-3th.5`) follow `render`. Version 1.1.0 added the layout sheet
+(`avg-3th.1`) between `check` and `render`; an episode resolved on 1.0.0 keeps
+its snapshot.
 
 ## Adding a workflow
 
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

```bash
git add studio/pipelines/pipelines/series-production.yaml studio/pipelines/fixtures/valid/series-local/poetry-short.yaml \
  studio/adapters/src/adapters/series.ts studio/adapters/src/studio.ts studio/adapters/test/series.test.ts docs/pipelines.md
git commit -m "feat(pipelines): series-production 1.1.0 — the layout sheet before the render (avg-3th.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Agent — `pva_layout_sheet`, the `review-layout-sheet` skill, the docs

**Files:**
- Create: `skills/studio/review-layout-sheet.md`, `studio/agent/tests/layout-sheet.test.ts`
- Modify: `studio/agent/src/capability-tools.ts`, `studio/agent/tests/extension.test.ts`, `studio/agent/tests/skill-discovery.test.ts`, `docs/running.md`, `docs/adr/0037-series-templates-pin-editorial-standards.md`

**Interfaces:**
- Consumes: `makeLayoutSheet` from `@studio/episode` (Task 4); the tool helpers already in `capability-tools.ts` (`episodeDir`, `withFileMutationQueue`, `Type`).
- Produces: tool `pva_layout_sheet { channel, series, episode }` (47 tools); skill `review-layout-sheet@0.1.0`, the one the pipeline's `sheet` stage names.

- [ ] **Step 1: Write the failing tests**

`studio/agent/tests/layout-sheet.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_layout_sheet (avg-3th.1): Pi makes the episode's layout sheet and is
 * told where to open it. The rendering is a fake, as in compose-spec.test.ts:
 * @av/remotion-composer and @studio/episode render for real in their tests.
 */

const sheets: string[] = [];

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string }) => {
      sheets.push(options.outDir);
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, "still");
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: `sha256:${"1".repeat(64)}` };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, "sheet");
      return {
        frames,
        sheet: { path, hash: `sha256:${createHash("sha256").update("sheet").digest("hex")}`, columns: 8, rows: 3, width: 2160, height: 1560 },
        kits: actual.timelineKits(options.timeline)!,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-layout-sheet-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  sheets.length = 0;
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

describe("pva_layout_sheet", () => {
  it("makes the sheet and says where to open it", async () => {
    const result = await tool("pva_layout_sheet");
    expect(result.isError).toBeFalsy();
    const text: string = result.content[0].text;
    expect(text).toMatch(/^✅ layout sheet: 24 frames, 8×3, rules poetry-short@1\.0\.0/);
    expect(text).toContain(`open it: ${at("artifacts/layout-sheet/sheet.jpg")}`);
    expect(text).toMatch(/inputs sha256:[0-9a-f]{64}/);
    expect(text).toMatch(/it shows the timeline a render would recompile first: there was no timeline yet/);
    expect(existsSync(at("artifacts/layout-sheet/sheet.json"))).toBe(true);
  });

  it("refuses a timeline that breaks the series' rules, with the findings", async () => {
    await tool("pva_build_timeline");
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    timeline.tracks[1].items[0].props.text = "Light falls across the room.";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(timeline));
    const result = await tool("pva_layout_sheet");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ series-rules: the series rules \(poetry-short@1\.0\.0\) refuse this timeline: the layout sheet shows only/);
    expect(result.content[0].text).toMatch(/text-not-voice at artifacts\/edit-timeline\.json#\$\.tracks\[1\]/);
    expect(result.details.code).toBe("series-rules");
    expect(sheets).toHaveLength(0);
  });
});
````

````diff
diff --git a/studio/agent/tests/extension.test.ts b/studio/agent/tests/extension.test.ts
index fa156e3..15c197c 100644
--- a/studio/agent/tests/extension.test.ts
+++ b/studio/agent/tests/extension.test.ts
@@ -129,7 +129,7 @@ describe("extensions/index.ts — tool registration", () => {
   });
 
   it("registers the expected suite of production tools", () => {
-    expect(mockPi.tools.length).toBe(46);
+    expect(mockPi.tools.length).toBe(47);
     const names = mockPi.tools.map((t) => t.name).sort();
     expect(names).toEqual([
       "pva_blender_create_scene",
@@ -158,6 +158,7 @@ describe("extensions/index.ts — tool registration", () => {
       "pva_health",
       "pva_init_spec",
       "pva_journal",
+      "pva_layout_sheet",
       "pva_list_skills",
       "pva_load_skill",
       "pva_plan_rerun",
diff --git a/studio/agent/tests/skill-discovery.test.ts b/studio/agent/tests/skill-discovery.test.ts
index 53b15fe..b7db165 100644
--- a/studio/agent/tests/skill-discovery.test.ts
+++ b/studio/agent/tests/skill-discovery.test.ts
@@ -44,6 +44,19 @@ it("discovers the propose-reference skill: Pi proposes, a person approves", asyn
   } finally { await rm(root, { recursive: true, force: true }); }
 });
 
+it("discovers the review-layout-sheet skill the series-production pipeline names", async () => {
+  const root = await mkdtemp(join(tmpdir(), "layout-sheet-skill-"));
+  try {
+    const builtInPath = fileURLToPath(new URL("../../../skills/studio/", import.meta.url));
+    const catalog = await discoverSkills({ libraryRoot: root, builtInPath });
+    expect(catalog.list({ source: "built-in" }).find(s => s.id === "review-layout-sheet")?.description).toContain("layout sheet");
+    const skill = await catalog.load("review-layout-sheet");
+    expect(skill).toContain("pva_layout_sheet");
+    expect(skill).toContain("no text over a face");
+    expect(skill).toContain("Never approve the sheet yourself");
+  } finally { await rm(root, { recursive: true, force: true }); }
+});
+
 it("discovers composed flat/folder skills and scopes layout-2 series overrides", async () => {
   const root = await mkdtemp(join(tmpdir(), "skills-discovery-"));
   try {
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build --workspace @studio/episode && cd studio/agent && npx vitest run tests/layout-sheet.test.ts tests/extension.test.ts tests/skill-discovery.test.ts`
Expected: FAIL — no `pva_layout_sheet` tool (46 tools), no `review-layout-sheet` skill.

- [ ] **Step 3: The tool**

````diff
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index 864472c..b47fee6 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -46,6 +46,7 @@ import {
   decideEditTimeline,
   EDIT_TIMELINE_PATH,
   initEpisodeSpec,
+  makeLayoutSheet,
   proposeReference,
   renderEpisode,
   writeEditTimeline,
@@ -1112,6 +1113,43 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
+  pi.registerTool({
+    name: "pva_layout_sheet",
+    label: "Layout Sheet",
+    description: `Render the episode's layout sheet: small stills of the timeline pva_compose_video would render, at the first and last frame, spread over its sections and at its series' declared instants, and one labelled grid of them (artifacts/layout-sheet/sheet.jpg). Open the grid and read it tile by tile with the review-layout-sheet skill before a render is spent. Refuses a timeline that breaks the series' rules.`,
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+    }),
+    async execute(_toolCallId, params) {
+      const dir = episodeDir(params.channel, params.series, params.episode);
+      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
+      try {
+        // Queued with pva_compose_video, which may rewrite the timeline this shows.
+        const sheet = await withFileMutationQueue(join(dir, "output", "current.json"), async () => makeLayoutSheet(dir, { episodeRef }));
+        const { report } = sheet;
+        const lines = [
+          `✅ layout sheet: ${report.frames.length} frames, ${report.sheet.columns}×${report.sheet.rows}, rules ${report.rules.source}`,
+          `open it: ${sheet.sheetPath}`,
+          `stills: ${join(dir, "artifacts", "layout-sheet", "frames")}`,
+          `inputs ${report.inputsHash}`,
+          ...(report.rebuilt ? [`it shows the timeline a render would recompile first: ${report.rebuilt}`] : []),
+          ...report.warnings.map((w) => `⚠️ ${w}`),
+        ];
+        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: sheet as unknown as Record<string, unknown> };
+      } catch (err) {
+        const e = err as { message?: string; code?: string; problems?: Array<{ code: string; message: string; path?: string }> };
+        const problems = (e.problems ?? []).map((p) => `  - ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
+        return {
+          content: [{ type: "text" as const, text: [`❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}`, ...problems].join("\n") }],
+          details: { code: e.code ?? null, problems: e.problems ?? [] } as Record<string, unknown>,
+          isError: true as unknown as boolean,
+        };
+      }
+    },
+  });
+
   // --- Tool: pva_render_terminal (via VHS) -----------------------------
 
   pi.registerTool({
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: The skill**

`skills/studio/review-layout-sheet.md` (new):

````markdown
---
name: review-layout-sheet
version: "0.1.0"
description: Make an episode's layout sheet and read it tile by tile for layout mistakes before a render is spent
inputs:
  - name: episode
    type: string
    description: The channel/series/episode whose checked timeline is about to be rendered
outputs:
  - layout-sheet.json:
      kind: application/json
      description: artifacts/layout-sheet/sheet.json, with sheet.jpg and frames/ beside it — what the sheet shows and the inputs hash that says when it is stale
capabilities:
  - llm
---

# Review Layout Sheet

A render costs minutes; most layout mistakes are visible in a still. The
layout sheet is a grid of small stills of the timeline a render would use, at
instants chosen the same way every time: the first and last frame, a spread
over the sections, and the instants the series' template release declares.
Each tile says its number, its time (`mm:ss.ff`) and why it was picked. This
is the `sheet` stage of the `series-production` pipeline; a person approves
it at its gate, and the render refuses a sheet that no longer shows exactly
what it would render.

## Steps

1. **Make it** with `pva_layout_sheet { channel, series, episode }`. It
   refuses a timeline that breaks the series' rules: fix those first
   (`pva_check_episode`).
2. **Open the grid** at the path the tool gives (`…/artifacts/layout-sheet/sheet.jpg`).
   For a tile you cannot read at that size, open its still in `frames/`
   (`frames/007.jpg` is tile `#07`).
3. **Read every tile**, in order, against this list:
   - no text over a face or over the picture's subject;
   - no two texts overlapping, and no text outside the margins;
   - no figure or object covering a text;
   - hands and objects inside the frame at the peak of a gesture;
   - titles at their size, captions saying what the voice says at that time;
   - no empty, black or wrong picture where the section needs one.
4. **Report** each problem with its tile number, its time and what is wrong
   (`#07 · 00:03.07 — the caption covers the cup`), then what to change (the
   spec, a picture, or the timeline). Report the tool's warnings too: an
   instant the series declares that fell outside its section usually means a
   section was shortened by hand.
5. **Hand it over** at the stage's review gate. A sheet with no problem
   found still needs a person's look.

## Never

- Never approve the sheet yourself, or say the layout is fine without
  having opened the grid.
- Never edit `sheet.json`, the stills or the grid: an image that is not the
  one rendered makes the render refuse the sheet.
- Never render to "see it moving" instead: the sheet is the cheap look.
````

- [ ] **Step 5: Run the agent's tests to see them pass**

Run: `cd studio/agent && npx vitest run`
Expected: every test passes (199, three skipped).

- [ ] **Step 6: The docs**

````diff
diff --git a/docs/adr/0037-series-templates-pin-editorial-standards.md b/docs/adr/0037-series-templates-pin-editorial-standards.md
index 82c91bb..b620f10 100644
--- a/docs/adr/0037-series-templates-pin-editorial-standards.md
+++ b/docs/adr/0037-series-templates-pin-editorial-standards.md
@@ -47,6 +47,7 @@ episodes/<episode>/
   episode.yaml                    # workspace identity/settings, unchanged
   episode-spec.json               # editable EpisodeSpec; pins a template release
   artifacts/edit-timeline.json    # compiler output (avg-jao.2)
+  artifacts/layout-sheet/         # sheet.json, sheet.jpg, frames/ (avg-3th.1)
   reviews/references/<reference-id>/
     episode-spec.json             # frozen editorial snapshot for the reference
     edit-timeline.json            # frozen derived snapshot
@@ -134,8 +135,39 @@ captions are split), never the format itself (the voice, the text, the
 profile, the effects). Errors refuse the build and the render before anything
 is written; warnings are reported and recorded in the render report.
 `pva_check_episode` runs the same check without writing anything — the gate
-the layout sheet (`avg-3th.1`) and the pipeline stages (`avg-jao.4`) will
-block on. A template that names no validator has no series rules.
+the layout sheet (`avg-3th.1`) and the pipeline stages (`avg-jao.4`) block
+on. A template that names no validator has no series rules.
+
+### The layout sheet shows what will be rendered
+
+Before a render, a person reads the episode's **layout sheet**
+(`avg-3th.1`): small stills of the timeline a render would use and one grid
+of them, labelled by number, time and reason. Its instants are decided the
+same way every time from the timeline alone — the first and last frame, a
+spread over the sections by length (at least one each, never on a cut) — plus
+the instants the release declares in an optional `sheet` field of
+`series-template.json`:
+
+```json
+"sheet": { "instants": [{ "at": "start", "offsetSeconds": 2, "sections": ["block-*"] }] }
+```
+
+Each rule is anchored to the `start`, `middle` or `end` of every matching
+section, so a hand edit that moves a section moves its instants. Rules are
+data, pinned with the release like everything else: a series that wants
+different instants publishes a new release. An instant that falls outside
+its section is a warning in the sheet, not an error.
+
+The series rules block the sheet: a timeline they refuse has no sheet.
+`sheet.json` records the timeline it shows by hash, the kits it drew with by
+their code hashes, the rules and the scale, and an `inputsHash` over all of
+them; the timeline names every asset by hash and all timing in frames, so
+nothing else decides the pictures. In the `series-production` pipeline
+(1.1.0) the `sheet` stage sits between `check` and `render`, with a human
+gate, and `render` refuses a sheet that is missing, whose image was replaced,
+or whose inputs hash no longer matches the timeline it would render. Signing
+the sheet's review is `avg-3th.2`; comparing two versions at the same instants
+is `avg-jao.5`.
 
 ### Golden references are evidence, not live pointers
 
@@ -217,8 +249,8 @@ before it is promoted; afterwards only a signed withdrawal ends a reference.
 - `avg-jao.2` owns loading/resolving the pinned release, compiler dispatch,
   workspace writes/staleness and the spec → timeline integration.
 - `avg-jao.3` owns the series validators and the check that blocks rendering;
-  `avg-jao.6` owns reference trust/promotion integration; blocking the layout
-  sheet comes with the sheet (`avg-3th.1`).
+  `avg-jao.6` owns reference trust/promotion integration; `avg-3th.1` made
+  the layout sheet, which the series rules block.
 - `avg-jao.4` owns pipeline wiring: the `series-production` family (spec,
   pictures, takes, timeline, check, render), its stage adapters and
   `pva_init_spec`; `avg-jao.5` owns identical-instant visual
diff --git a/docs/running.md b/docs/running.md
index c414cf5..6faac21 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -96,13 +96,37 @@ Production: `pva_generate_image`, `pva_synthesize_speech`,
 `pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
 `pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`,
 `pva_propose_reference`,
-`pva_build_timeline`, `pva_check_episode`, `pva_compose_video`, `pva_compose_multitrack_video`,
+`pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet`, `pva_compose_video`, `pva_compose_multitrack_video`,
 `pva_probe_media`
 
 A tool whose capability is not ready will fail rather than silently degrade.
 `npm run doctor` tells you which are ready; `pva_capability_status` tells the
 agent the same thing from inside a session.
 
+### The layout sheet
+
+Before a render is spent, look at the **layout sheet**: small stills of the
+timeline a render would use, at the first and last frame, spread over its
+sections and at the instants its series' template declares, with one grid of
+them labelled by number, time and reason. Ask the agent for it
+(`pva_layout_sheet`; the `review-layout-sheet` skill reads it tile by tile),
+or let the `series-production` pipeline make it at its `sheet` stage. It is
+written to `artifacts/layout-sheet/` in the episode:
+
+- `sheet.jpg` — the grid to read;
+- `frames/NNN.jpg` — each still at a quarter of the video's size;
+- `sheet.json` — the timeline it shows (by hash), the rules, the kits and the
+  `inputsHash` that says when the sheet is stale.
+
+The pipeline's `render` stage refuses a sheet that is missing, whose image was
+replaced, or that no longer shows exactly the timeline it would render. To
+render any timeline at chosen times without an episode, the composer has a
+command of its own:
+
+```bash
+node packages/remotion-composer/dist/sheet-cli.js timeline.json out/ --assets episode/ --times 0,2.5,10
+```
+
 ### Speech: start the voice worker first
 
 `speech.synthesize` is the one capability that is a **separate long-running
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 7: The whole repository**

Run: `npm run check && npm run docs:build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add studio/agent/src/capability-tools.ts studio/agent/tests/layout-sheet.test.ts studio/agent/tests/extension.test.ts \
  studio/agent/tests/skill-discovery.test.ts skills/studio/review-layout-sheet.md docs/running.md \
  docs/adr/0037-series-templates-pin-editorial-standards.md
git commit -m "feat(agent): pva_layout_sheet and the review-layout-sheet skill; the layout sheet in ADR-0037 and running.md (avg-3th.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
