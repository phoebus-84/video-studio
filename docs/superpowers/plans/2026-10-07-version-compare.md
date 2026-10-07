# Version Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version compare (avg-jao.5, UP-54): renders keep the timeline they rendered; `alignInstants` / `measure` / `judge` (pure) and `compareVersions` (ffmpeg) in `@studio/episode` compare two renders — or a render and a golden reference — at the same instants, aligned section by section, into `reviews/compare/<old>--<new>/` with a verdict against the sections expected to change; the agent's `pva_compare_versions` and the `compare-versions` skill.

**Architecture:** Videos are compared, never re-rendered: both are decoded by ffmpeg in one pass each at the instants, as grey bytes (measured in Node) and JPEGs (drawn old | new | difference). The instants are the layout sheet's of the new version, carried into the old one by section id and offset through the timeline snapshot every render now keeps; without one, by time with optional shifts. The result is written through a temporary directory and a whole-directory swap.

**Tech Stack:** TypeScript (episode, agent; vitest), ffmpeg/ffprobe 9 (already required), contracts' `validateSeriesReference`.

**Spec:** `docs/superpowers/specs/2026-10-07-version-compare-design.md`

Every line of code below was run in a scratch worktree before this plan was written: the episode and agent suites, the whole repository's checks (all but `check:paths`, which only the scratch worktree's symlinks trip) and `npm run docs:build`. The comparison tests make real videos with ffmpeg; a look at a real `changed.jpg` caught a bug (grey pictures from a shared ffmpeg format negotiation) that the colour test in Task 3 now pins.

## Global Constraints

- Branch `feat/version-compare` (holds the spec commit). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit paths only; never stage `.beads/`; never run `bd`.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- No dependency changes; no lockfile change.
- Rebuild `@studio/episode` after changing it (`npm run build --workspace @studio/episode`): the agent imports its `dist/`.
- ffmpeg and ffprobe must be on PATH for the episode's and the agent's comparison tests (they already are for the studio).
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.

## Review Focus

- The comparison's pictures losing their colour (ffmpeg negotiating one pixel format for both decode branches) → the pair must show old and new in colour (Task 3 test "shows a correction stayed in its section…", the colour checks).
- A block made longer by the correction → later sections compared at their own offsets, not flagged (Task 2 test "keeps later sections aligned…", Task 3 test "keeps later sections aligned when a section got longer").
- A render whose video was replaced after its report → `render-changed`, nothing written (Task 3 test "refuses what it cannot compare…").
- ffmpeg failing halfway → a previous comparison of the same pair untouched, no temporary directory left (Task 3 test "keeps a previous comparison…").
- An expected section that did not change at all (the wrong render compared) → a warning, in the report and the tool's reply (Task 2 test "warns about an expected section…", Task 4 test "flags every change…").

---

### Task 1: Renders keep the timeline they rendered

**Files:**
- Modify: `studio/episode/src/episode-render.ts`, `studio/agent/tests/compose-video.test.ts`
- Test: `studio/episode/tests/render-snapshot.test.ts`

**Interfaces:**
- Consumes: `renderEpisode`'s existing `decision` (`TimelineDecision`, whose `text` is the exact timeline rendered) and `writeAtomically`.
- Produces: `output/<render-id>.timeline.json` beside every new render, written after the video and before the report; the report's `timeline` gains `snapshot: "<render-id>.timeline.json"`. Its sha256 is the report's `timeline.hash`.

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/render-snapshot.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderEpisode } from "../src/episode-render.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * Every render keeps the exact timeline it rendered beside its video
 * (avg-jao.5): a later version can then be compared with it section by
 * section. The render itself is faked; @av/remotion-composer renders for real.
 */

let failRender = false;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      if (failRender) throw new actual.ComposerError("render-failed", "Remotion could not render the timeline: out of memory");
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: sha256("fake mp4"),
        kits: [],
        profile: options.timeline.profile.id,
        loudness: null,
      };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-snapshot-"));
  specEpisode(dir(), REF);
  failRender = false;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("renderEpisode keeps the timeline it rendered", () => {
  it("writes output/<render-id>.timeline.json, the exact text the report's hash names", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF });
    const snapshot = at(`output/${render.renderId}.timeline.json`);
    const report = JSON.parse(readFileSync(render.reportPath, "utf-8"));
    expect(report.timeline.snapshot).toBe(`${render.renderId}.timeline.json`);
    expect(sha256(readFileSync(snapshot))).toBe(report.timeline.hash);
    expect(readFileSync(snapshot, "utf-8")).toBe(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
  });

  it("keeps it unchanged when the episode's timeline is edited afterwards", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF });
    const before = readFileSync(at(`output/${render.renderId}.timeline.json`), "utf-8");
    writeFileSync(at("artifacts/edit-timeline.json"), "{}");
    expect(readFileSync(at(`output/${render.renderId}.timeline.json`), "utf-8")).toBe(before);
  });

  it("writes no snapshot when the render fails", async () => {
    failRender = true;
    await expect(renderEpisode(dir(), { episodeRef: REF })).rejects.toThrow(/out of memory/);
    expect(existsSync(at("output")) ? readdirSync(at("output")).filter((n) => n.endsWith(".timeline.json")) : []).toEqual([]);
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/render-snapshot.test.ts`
Expected: 2 failed (no `snapshot` in the report, no file), 1 passed (a failed render writes none — true already).

- [ ] **Step 3: Implement**

````diff
diff --git a/studio/episode/src/episode-render.ts b/studio/episode/src/episode-render.ts
index e37f3c7..85cb0c1 100644
--- a/studio/episode/src/episode-render.ts
+++ b/studio/episode/src/episode-render.ts
@@ -5,7 +5,8 @@
 // rebuilt from the episode's material when that material changed, and is
 // otherwise rendered exactly as it stands — a hand edit, on the web or on
 // disk, is never overwritten. Renders are immutable: output/<render-id>.mp4
-// with a sibling report, and output/current.json moved last.
+// with the timeline it rendered (<render-id>.timeline.json, avg-jao.5) and a
+// report beside it, and output/current.json moved last.
 // ---------------------------------------------------------------------------
 
 import { createHash } from "node:crypto";
@@ -347,6 +348,7 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
   const outputPath = join(outputDir, `${renderId}.mp4`);
   const partialPath = join(outputDir, `.${renderId}.partial.mp4`);
   const reportPath = join(outputDir, `${renderId}.report.json`);
+  const snapshot = `${renderId}.timeline.json`;
 
   let result: RenderResult;
   try {
@@ -364,10 +366,12 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
   }
   result = { ...result, path: outputPath };
 
+  // The exact text rendered: a later version is compared with it section by section.
+  writeAtomically(join(outputDir, snapshot), decision.text);
   writeAtomically(reportPath, serialize({
     renderId,
     createdAt: new Date().toISOString(),
-    timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${current.hash}` },
+    timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${current.hash}`, snapshot },
     ...(current.compiledBy ? { compiledBy: current.compiledBy } : {}),
     ...(current.validation ? { validation: current.validation } : {}),
     ...(current.rebuilt ? { rebuilt: current.rebuilt } : {}),
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: Run them to see them pass, and the agent's render test**

The agent's `compose-video` test pins the report's `timeline` exactly; it now has `snapshot`:

````diff
diff --git a/studio/agent/tests/compose-video.test.ts b/studio/agent/tests/compose-video.test.ts
index 37df1eb..3ac68d9 100644
--- a/studio/agent/tests/compose-video.test.ts
+++ b/studio/agent/tests/compose-video.test.ts
@@ -118,7 +118,12 @@ describe("pva_compose_video", () => {
     expect(current.path).toBe(`${current.renderId}.mp4`);
     expect(existsSync(at(`output/${current.path}`))).toBe(true);
     const report = readJson(`output/${current.renderId}.report.json`);
-    expect(report.timeline).toEqual({ path: "artifacts/edit-timeline.json", hash: sha256("artifacts/edit-timeline.json") });
+    expect(report.timeline).toEqual({
+      path: "artifacts/edit-timeline.json",
+      hash: sha256("artifacts/edit-timeline.json"),
+      snapshot: `${current.renderId}.timeline.json`,
+    });
+    expect(sha256(`output/${current.renderId}.timeline.json`)).toBe(report.timeline.hash);
     expect(report.render).toMatchObject({ path: current.path, profile: "youtube-1920x1080", cache: { segmentsRendered: 5 } });
     expect(renders[0]!.cacheDir).toBe(at(".cache/remotion"));
     expect(current.renderId.endsWith(report.timeline.hash.slice(7, 15))).toBe(true);
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Run: `cd studio/episode && npx vitest run && npx tsc --noEmit && cd ../.. && npm run build --workspace @studio/episode && cd studio/agent && npx vitest run tests/compose-video.test.ts`
Expected: episode 130 passed, 1 skipped; agent compose-video all passed.

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/episode-render.ts studio/episode/tests/render-snapshot.test.ts studio/agent/tests/compose-video.test.ts
git commit -m "feat(episode): every render keeps the timeline it rendered (avg-jao.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Alignment, measure and verdict (pure)

**Files:**
- Create: `studio/episode/src/version-diff.ts`
- Modify: `studio/episode/src/sheet-instants.ts` (export the section pattern matcher), `studio/episode/src/index.ts`
- Test: `studio/episode/tests/version-diff.test.ts`

**Interfaces:**
- Consumes: `sheetInstants` (`sheet-instants.ts`).
- Produces: `matchesSection(pattern, id): boolean` (exported from `sheet-instants.ts`); from `version-diff.ts`: `CompareError { code: CompareErrorCode; message }` with codes `bad-version | no-such-render | no-render | render-changed | no-such-reference | reference-changed | resolution-differs | decode-failed | bad-options`; `AlignSide { fps; durationInFrames; sections: AlignSection[] | null }`; `AlignSection { id; from; duration }`; `Shift { from; by }`; `ComparePick { index; label; section: string | null; newFrame; oldFrame: number | null; reason?: "beyond-old-section" | "new-section" | "missing-in-old" }`; `alignInstants(newer, older, { times?, shifts? }) → { picks; alignment: "sections" | "time"; warnings }`; `measure(a: Uint8Array, b: Uint8Array) → { meanDiff; changedShare }`; `Verdict = "ok" | "unexpected-changes" | "listed"`; `judge(pairs: {index, section, changed}[], expect?) → { verdict; changed: number[]; unexpected: number[]; warnings }`.

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/version-diff.test.ts` (new):

````ts
import { describe, expect, it } from "vitest";
import { alignInstants, CompareError, judge, measure, type AlignSide } from "../src/version-diff.js";

/**
 * The pure half of a version comparison (avg-jao.5): which frames of the two
 * versions are compared, how different two frames are, and what the
 * differences mean against the sections a correction was expected to touch.
 */

const side = (sections: AlignSide["sections"], durationInFrames = 300, fps = 30): AlignSide => ({ fps, durationInFrames, sections });
const three = (b = 100) => [
  { id: "intro", from: 0, duration: 100 },
  { id: "block-1", from: 100, duration: b },
  { id: "block-2", from: 100 + b, duration: 100 },
];
const pairs = (r: ReturnType<typeof alignInstants>) => r.picks.map((p) => [p.newFrame, p.oldFrame, p.reason ?? null]);

describe("alignInstants", () => {
  it("compares the same frames when nothing moved", () => {
    const r = alignInstants(side(three()), side(three()));
    expect(r.alignment).toBe("sections");
    expect(r.picks.length).toBeGreaterThanOrEqual(20);
    for (const p of r.picks) expect(p.oldFrame).toBe(p.newFrame);
  });

  it("keeps later sections aligned when one got longer, by section and offset", () => {
    // block-1 is 30 frames longer in the new version: block-2 starts at 230, not 200.
    const r = alignInstants(side(three(130), 330), side(three(100), 300));
    const late = r.picks.filter((p) => p.section === "block-2");
    expect(late.length).toBeGreaterThan(0);
    for (const p of late) expect(p.oldFrame).toBe(p.newFrame - 30);
    // Inside block-1, past the old length, there is nothing to compare with.
    const beyond = r.picks.filter((p) => p.section === "block-1" && p.newFrame - 100 >= 100);
    expect(beyond.length).toBeGreaterThan(0);
    for (const p of beyond) expect([p.oldFrame, p.reason]).toEqual([null, "beyond-old-section"]);
  });

  it("says a section the old version did not have is new", () => {
    const newer = [...three(), { id: "coda", from: 300, duration: 60 }];
    const r = alignInstants(side(newer, 360), side(three(), 300));
    const coda = r.picks.filter((p) => p.section === "coda");
    expect(coda.length).toBeGreaterThan(0);
    for (const p of coda) expect([p.oldFrame, p.reason]).toEqual([null, "new-section"]);
  });

  it("falls back to time without timelines, with shifts, and says when the old video is too short", () => {
    const r = alignInstants(side(null, 300), side(null, 260), { times: [1, 5, 9.5], shifts: [{ from: 4, by: -0.5 }] });
    expect(r.alignment).toBe("time");
    expect(pairs(r)).toEqual([[30, 30, null], [150, 135, null], [285, null, "missing-in-old"]]);
    expect(r.picks.map((p) => p.label)).toEqual(["1s", "5s", "9.5s"]);
    expect(r.picks[0]!.section).toBeNull();
  });

  it("applies every shift whose start has passed", () => {
    const r = alignInstants(side(null), side(null, 400), { times: [2, 6], shifts: [{ from: 1, by: 1 }, { from: 5, by: 2 }] });
    expect(pairs(r)).toEqual([[60, 90, null], [180, 270, null]]);
  });

  it("ignores shifts, with a warning, when both versions have sections", () => {
    const r = alignInstants(side(three()), side(three()), { shifts: [{ from: 0, by: 3 }] });
    expect(r.warnings).toEqual(["shifts ignored: both versions have sections, aligned by section"]);
    for (const p of r.picks) expect(p.oldFrame).toBe(p.newFrame);
  });

  it("maps by time across frame rates", () => {
    const r = alignInstants(side(null, 300, 30), side(null, 250, 25), { times: [4] });
    expect(pairs(r)).toEqual([[120, 100, null]]);
    const s = alignInstants(side([{ id: "a", from: 0, duration: 300 }], 300, 30), side([{ id: "a", from: 0, duration: 250 }], 250, 25), { times: [4] });
    expect(pairs(s)).toEqual([[120, 100, null]]);
  });

  it("refuses times outside the new video, and bad shifts", () => {
    expect(() => alignInstants(side(null), side(null), { times: [10] })).toThrow(CompareError);
    expect(() => alignInstants(side(null), side(null), { times: [-1] })).toThrow(/bad-options|not inside/);
    expect(() => alignInstants(side(null), side(null), { times: [] })).toThrow(/at least one time/);
    expect(() => alignInstants(side(null), side(null), { shifts: [{ from: Number.NaN, by: 1 }] })).toThrow(/shift/);
  });

  it("numbers picks in order and deduplicates repeated times", () => {
    const r = alignInstants(side(null), side(null), { times: [2, 1, 2.01] });
    expect(r.picks.map((p) => [p.index, p.newFrame])).toEqual([[0, 30], [1, 60]]);
  });
});

describe("measure", () => {
  it("is zero for identical frames", () => {
    const a = new Uint8Array(100).fill(40);
    expect(measure(a, a.slice())).toEqual({ meanDiff: 0, changedShare: 0 });
  });

  it("averages the absolute difference and counts the pixels that changed by more than 16", () => {
    const a = new Uint8Array(100).fill(100);
    const b = a.slice();
    b.fill(200, 0, 10);  // 10 pixels by 100
    b.fill(110, 10, 20); // 10 pixels by 10: changed, but not past 16
    expect(measure(a, b)).toEqual({ meanDiff: 11, changedShare: 0.1 });
  });

  it("refuses frames of different sizes", () => {
    expect(() => measure(new Uint8Array(4), new Uint8Array(5))).toThrow(/sizes/);
  });
});

describe("judge", () => {
  const p = (index: number, section: string | null, changed: boolean) => ({ index, section, changed });

  it("is ok when every change is in an expected section", () => {
    expect(judge([p(0, "intro", false), p(1, "block-3", true), p(2, "block-4", true)], ["block-*"]))
      .toEqual({ verdict: "ok", changed: [1, 2], unexpected: [], warnings: [] });
  });

  it("names the unexpected changes, a sectionless one included", () => {
    expect(judge([p(0, "intro", true), p(1, "block-3", true), p(2, null, true)], ["block-3"]))
      .toEqual({ verdict: "unexpected-changes", changed: [0, 1, 2], unexpected: [0, 2], warnings: [] });
  });

  it("warns about an expected section that did not change", () => {
    expect(judge([p(0, "intro", false), p(1, "block-3", false)], ["block-3", "coda"]).warnings).toEqual([
      "block-3 was expected to change and did not",
      "coda was expected to change and did not",
    ]);
  });

  it("only lists without an expectation", () => {
    expect(judge([p(0, "intro", true)], undefined)).toEqual({ verdict: "listed", changed: [0], unexpected: [], warnings: [] });
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/version-diff.test.ts`
Expected: FAIL — cannot resolve `../src/version-diff.js`.

- [ ] **Step 3: Implement**

Export the pattern matcher the layout sheet's rules already use:

````diff
diff --git a/studio/episode/src/sheet-instants.ts b/studio/episode/src/sheet-instants.ts
index d842027..50131ed 100644
--- a/studio/episode/src/sheet-instants.ts
+++ b/studio/episode/src/sheet-instants.ts
@@ -38,7 +38,8 @@ export const SHEET_TARGET = 24;
 /** The most frames one sheet holds: @av/remotion-composer's MAX_SHEET_PICKS. */
 export const SHEET_MAX_PICKS = 120;
 
-const matches = (pattern: string, id: string) =>
+/** A section pattern: an exact id, or a prefix ending in `*` (`block-*`). */
+export const matchesSection = (pattern: string, id: string) =>
   pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
 
 const seconds = (value: number) => `${value > 0 ? "+" : "-"}${Math.abs(value)}s`;
@@ -79,7 +80,7 @@ export function sheetInstants(timeline: SheetTimeline, rules?: SheetRules, targe
   const warnings: string[] = [];
   (rules?.instants ?? []).forEach((rule, index) => {
     const name = `rule ${index + 1} (${describeRule(rule)})`;
-    const matching = sections.filter((s) => rule.sections === undefined || rule.sections.some((p) => matches(p, s.id)));
+    const matching = sections.filter((s) => rule.sections === undefined || rule.sections.some((p) => matchesSection(p, s.id)));
     if (matching.length === 0) {
       warnings.push(`${name} matches no section`);
       return;
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

`studio/episode/src/version-diff.ts` (new):

````ts
// ---------------------------------------------------------------------------
// Comparing two versions of an episode: the pure half (avg-jao.5, UP-54)
// ---------------------------------------------------------------------------
// Which frames of the two versions are compared — the layout sheet's instants
// of the new version, carried into the old one by section and offset, so a
// block that got longer does not make everything after it look changed — how
// different two frames are, and what the differences mean against the
// sections a correction was expected to touch.
// ---------------------------------------------------------------------------

import { matchesSection, sheetInstants } from "./sheet-instants.js";

export type CompareErrorCode =
  | "bad-version"
  | "no-such-render"
  | "no-render"
  | "render-changed"
  | "no-such-reference"
  | "reference-changed"
  | "resolution-differs"
  | "decode-failed"
  | "bad-options";

/** Why a comparison could not be made; nothing was written. */
export class CompareError extends Error {
  constructor(readonly code: CompareErrorCode, message: string) {
    super(message);
    this.name = "CompareError";
  }
}

export interface AlignSection {
  id: string;
  from: number;
  duration: number;
}

/** What alignment needs of a version: its timing and, when its timeline is known, its sections. */
export interface AlignSide {
  fps: number;
  durationInFrames: number;
  sections: AlignSection[] | null;
}

export type UnmappedReason = "beyond-old-section" | "new-section" | "missing-in-old";

export interface ComparePick {
  index: number;
  /** From sheetInstants, or "<t>s" for an explicit time. */
  label: string;
  /** The new version's section containing the frame, when its timeline is known. */
  section: string | null;
  newFrame: number;
  /** null when the instant has no counterpart in the old version. */
  oldFrame: number | null;
  reason?: UnmappedReason;
}

export interface Shift {
  /** Seconds of the new version from which the old one is `by` seconds later (negative: earlier). */
  from: number;
  by: number;
}

export interface Alignment {
  picks: ComparePick[];
  /** "sections" when both versions have sections; otherwise "time". */
  alignment: "sections" | "time";
  warnings: string[];
}

const usable = (sections: AlignSection[] | null) => (sections ?? []).filter((s) => s.duration > 0);
const containing = (sections: AlignSection[], frame: number) =>
  sections.find((s) => s.from <= frame && frame < s.from + s.duration) ?? null;

/** The new version's instants, and where each one is in the old version. */
export function alignInstants(newer: AlignSide, older: AlignSide, options: { times?: number[]; shifts?: Shift[] } = {}): Alignment {
  const shifts = options.shifts ?? [];
  for (const s of shifts) {
    if (!Number.isFinite(s.from) || !Number.isFinite(s.by) || s.from < 0) {
      throw new CompareError("bad-options", `shift ${JSON.stringify(s)} is not {from ≥ 0, by} in seconds`);
    }
  }

  let instants: { frame: number; label: string }[];
  if (options.times !== undefined) {
    if (options.times.length === 0) throw new CompareError("bad-options", "give at least one time, or none for the sheet's instants");
    const seen = new Map<number, string>();
    for (const t of options.times) {
      const frame = Math.round(t * newer.fps);
      if (!Number.isFinite(t) || frame < 0 || frame >= newer.durationInFrames) {
        throw new CompareError("bad-options", `time ${t}s is not inside the new version (0–${((newer.durationInFrames - 1) / newer.fps).toFixed(2)}s)`);
      }
      if (!seen.has(frame)) seen.set(frame, `${t}s`);
    }
    instants = [...seen.entries()].sort(([a], [b]) => a - b).map(([frame, label]) => ({ frame, label }));
  } else {
    const sections = usable(newer.sections);
    instants = sheetInstants({ fps: newer.fps, durationInFrames: newer.durationInFrames, ...(sections.length > 0 ? { sections } : {}) }).picks;
  }

  const newSections = usable(newer.sections);
  const oldSections = usable(older.sections);
  const bySections = newSections.length > 0 && oldSections.length > 0;
  const warnings = bySections && shifts.length > 0 ? ["shifts ignored: both versions have sections, aligned by section"] : [];

  const picks = instants.map(({ frame, label }, index): ComparePick => {
    const section = containing(newSections, frame);
    const pick = { index, label, section: section?.id ?? null, newFrame: frame };
    let oldFrame: number;
    if (bySections && section) {
      const counterpart = oldSections.find((s) => s.id === section.id);
      if (!counterpart) return { ...pick, oldFrame: null, reason: "new-section" };
      const offset = Math.round(((frame - section.from) * older.fps) / newer.fps);
      if (offset >= counterpart.duration) return { ...pick, oldFrame: null, reason: "beyond-old-section" };
      oldFrame = counterpart.from + offset;
    } else {
      const t = frame / newer.fps + shifts.filter((s) => s.from <= frame / newer.fps).reduce((sum, s) => sum + s.by, 0);
      oldFrame = Math.round(t * older.fps);
    }
    if (oldFrame < 0 || oldFrame >= older.durationInFrames) return { ...pick, oldFrame: null, reason: "missing-in-old" };
    return { ...pick, oldFrame };
  });
  return { picks, alignment: bySections ? "sections" : "time", warnings };
}

/** How different two grey frames of the same size are. */
export function measure(a: Uint8Array, b: Uint8Array): { meanDiff: number; changedShare: number } {
  if (a.length !== b.length) throw new Error(`frames of different sizes (${a.length} and ${b.length} pixels)`);
  let total = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    total += d;
    if (d > 16) changed++;
  }
  const n = a.length || 1;
  return { meanDiff: Math.round((total / n) * 10) / 10, changedShare: Math.round((changed / n) * 1000) / 1000 };
}

export type Verdict = "ok" | "unexpected-changes" | "listed";

/** What the changed pairs mean against the sections expected to change. */
export function judge(
  pairs: { index: number; section: string | null; changed: boolean }[],
  expect: string[] | undefined,
): { verdict: Verdict; changed: number[]; unexpected: number[]; warnings: string[] } {
  const changed = pairs.filter((p) => p.changed);
  const indexes = changed.map((p) => p.index);
  if (expect === undefined) return { verdict: "listed", changed: indexes, unexpected: [], warnings: [] };
  const expected = (section: string | null) => section !== null && expect.some((pattern) => matchesSection(pattern, section));
  const unexpected = changed.filter((p) => !expected(p.section)).map((p) => p.index);
  const warnings = expect
    .filter((pattern) => !changed.some((p) => p.section !== null && matchesSection(pattern, p.section)))
    .map((pattern) => `${pattern} was expected to change and did not`);
  return { verdict: unexpected.length > 0 ? "unexpected-changes" : "ok", changed: indexes, unexpected, warnings };
}
````

Append to `studio/episode/src/index.ts`:

```ts
export * from "./version-diff.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd studio/episode && npx vitest run tests/version-diff.test.ts tests/sheet-instants.test.ts && npx tsc --noEmit`
Expected: 25 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/version-diff.ts studio/episode/src/sheet-instants.ts studio/episode/src/index.ts studio/episode/tests/version-diff.test.ts
git commit -m "feat(episode): align two versions' instants by section, measure frames, judge against the expected sections (avg-jao.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `compareVersions` — two renders decoded at the same instants

**Files:**
- Create: `studio/episode/src/version-compare.ts`
- Modify: `studio/episode/src/index.ts`, `studio/episode/README.md`
- Test: `studio/episode/tests/version-compare.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `validateSeriesReference` (`@studio/contracts/src/series-templates.mjs`); `sha256` from `../src/testing.js` (tests).
- Produces: `COMPARE_DIR = "reviews/compare"`; `VersionRef` (string); `Version { ref; episodeDir; video: {path, hash}; timeline: {path, hash} | null; side: AlignSide; width; height; notes }`; `resolveVersion(episodeDir, ref): Promise<Version>`; `CompareOptions { old; new?; expect?; threshold?; times?; shifts? }`; `ComparedPair extends ComparePick { seconds; meanDiff: number | null; changedShare: number | null; changed }`; `CompareReport { createdAt; old; new; alignment; threshold; shifts; expect: string[] | null; verdict; pairs; changed; unexpected; warnings }`; `compareVersions(episodeDir, options: CompareOptions): Promise<VersionComparison>` with `VersionComparison { report; dir; reportPath; changedPath: string | null }` (absolute paths).

- [ ] **Step 1: Write the failing tests**

They make real videos with ffmpeg (about 4 s for the file):

`studio/episode/tests/version-compare.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compareVersions, COMPARE_DIR } from "../src/version-compare.js";
import { CompareError } from "../src/version-diff.js";
import { sha256 } from "../src/testing.js";

/**
 * compareVersions (avg-jao.5) on real videos: small renders made with ffmpeg
 * (already required by the studio), each a run of flat-colour sections, with
 * the report and timeline snapshot renderEpisode writes beside them.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

interface Segment { id: string; color: string; seconds: number }
const FPS = 30;

/** A render of `segments`, as renderEpisode leaves it: video, timeline snapshot (unless `timeline: false`), report. */
function render(id: string, segments: Segment[], options: { timeline?: boolean; size?: string; episodeDir?: string } = {}): void {
  const base = options.episodeDir ?? dir();
  const size = options.size ?? "320x180";
  mkdirSync(join(base, "output"), { recursive: true });
  const video = join(base, "output", `${id}.mp4`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    ...segments.flatMap((s) => ["-f", "lavfi", "-i", `color=c=${s.color}:s=${size}:r=${FPS}:d=${s.seconds}`]),
    "-filter_complex", `${segments.map((_, i) => `[${i}:v]`).join("")}concat=n=${segments.length}:v=1[v]`,
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", video]);
  let from = 0;
  const sections = segments.map((s) => {
    const section = { id: s.id, from, duration: s.seconds * FPS };
    from += section.duration;
    return section;
  });
  const [width, height] = size.split("x").map(Number);
  const timelineText = `${JSON.stringify({ fps: FPS, durationInFrames: from, resolution: { width, height }, sections }, null, 2)}\n`;
  if (options.timeline !== false) writeFileSync(join(base, "output", `${id}.timeline.json`), timelineText);
  writeFileSync(join(base, "output", `${id}.report.json`), JSON.stringify({
    renderId: id,
    timeline: { path: "artifacts/edit-timeline.json", hash: sha256(timelineText), snapshot: `${id}.timeline.json` },
    render: { path: `${id}.mp4`, hash: sha256(readFileSync(video)) },
  }));
}
/** The mean colour of a 10×10 patch of an image, as [r, g, b]. */
const colour = (file: string, x: number, y: number) =>
  [...execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `crop=10:10:${x}:${y},scale=1:1,format=rgb24`, "-f", "rawvideo", "-"])];
const near = (actual: number[], expected: number[]) => actual.every((v, i) => Math.abs(v - expected[i]!) <= 24);

const current = (id: string) => writeFileSync(at("output/current.json"), JSON.stringify({ renderId: id, path: `${id}.mp4` }));

const ORIGINAL: Segment[] = [
  { id: "intro", color: "red", seconds: 2 },
  { id: "block-1", color: "green", seconds: 2 },
  { id: "block-2", color: "blue", seconds: 2 },
];
const withBlock1 = (change: Partial<Segment>) => ORIGINAL.map((s) => (s.id === "block-1" ? { ...s, ...change } : s));
const changedSections = (r: Awaited<ReturnType<typeof compareVersions>>) =>
  [...new Set(r.report.pairs.filter((p) => p.changed).map((p) => p.section))];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "version-compare-"));
  mkdirSync(dir(), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("compareVersions", () => {
  it("finds nothing changed between two renders of the same thing", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", ORIGINAL);
    current("render-2-bbbbbbbb");
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa" });
    expect(r.report.alignment).toBe("sections");
    expect(r.report.verdict).toBe("listed");
    expect(r.report.changed).toEqual([]);
    expect(r.changedPath).toBeNull();
    expect(r.dir).toBe(at(`${COMPARE_DIR}/render-1-aaaaaaaa--render-2-bbbbbbbb`));
    expect(JSON.parse(readFileSync(r.reportPath, "utf-8"))).toEqual(r.report);
    expect(existsSync(join(r.dir, "pairs"))).toBe(false);
  });

  it("shows a correction stayed in its section: ok when expected, unexpected otherwise", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", withBlock1({ color: "yellow" }));
    const ok = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["block-*"] });
    expect(changedSections(ok)).toEqual(["block-1"]);
    expect(ok.report.verdict).toBe("ok");
    expect(ok.report.warnings).toEqual([]);
    for (const p of ok.report.pairs.filter((x) => x.changed)) {
      expect(p.meanDiff!).toBeGreaterThan(10);
      expect(existsSync(join(ok.dir, "pairs", `${String(p.index).padStart(3, "0")}.jpg`))).toBe(true);
    }
    expect(ok.changedPath).toBe(join(ok.dir, "changed.jpg"));
    // old | new | difference, in colour: green, yellow, and grey heat (white where it changed).
    const pair = join(ok.dir, "pairs", `${String(ok.report.changed[0]).padStart(3, "0")}.jpg`);
    expect(near(colour(pair, 30, 20), [0, 128, 0]), String(colour(pair, 30, 20))).toBe(true);
    expect(near(colour(pair, 110, 20), [255, 255, 0]), String(colour(pair, 110, 20))).toBe(true);
    const heat = colour(pair, 190, 20);
    expect(heat[0] === heat[1] && heat[1] === heat[2] && heat[0]! > 200, String(heat)).toBe(true);

    const wrong = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["intro"] });
    expect(wrong.report.verdict).toBe("unexpected-changes");
    expect(wrong.report.unexpected).toEqual(wrong.report.changed);
    expect(wrong.report.warnings).toEqual(["intro was expected to change and did not"]);
  });

  it("keeps later sections aligned when a section got longer", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", withBlock1({ seconds: 3 }));
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb", expect: ["block-1"] });
    expect(changedSections(r)).toEqual(["block-1"]);
    expect(r.report.pairs.filter((p) => p.changed).every((p) => p.reason === "beyond-old-section")).toBe(true);
    expect(r.report.pairs.filter((p) => p.section === "block-2").every((p) => p.oldFrame === p.newFrame - 30 && !p.changed)).toBe(true);
    expect(r.report.verdict).toBe("ok");
  });

  it("falls back to time for a render that kept no timeline, and says so", async () => {
    render("render-1-aaaaaaaa", ORIGINAL, { timeline: false });
    render("render-2-bbbbbbbb", ORIGINAL);
    const r = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" });
    expect(r.report.alignment).toBe("time");
    expect(r.report.old.notes).toEqual(["render-1-aaaaaaaa kept no timeline: aligned by time"]);
    expect(r.report.changed).toEqual([]);
  });

  it("compares with a golden reference of the series", async () => {
    const other = join(dirname(dir()), "evening");
    render("render-9-cccccccc", ORIGINAL, { episodeDir: other });
    render("render-2-bbbbbbbb", withBlock1({ color: "yellow" }));
    const require = createRequire(import.meta.url);
    const descriptor = JSON.parse(readFileSync(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/references/morning-v1.json"), "utf-8"));
    // A descriptor whose shape validateSeriesReference accepts: frozen
    // snapshots, the render and its report, all bound by the approval.
    const snap = join(other, "reviews/references/evening-v1");
    mkdirSync(snap, { recursive: true });
    cpSync(join(other, "output/render-9-cccccccc.timeline.json"), join(snap, "edit-timeline.json"));
    writeFileSync(join(snap, "episode-spec.json"), "{}");
    const file = (path: string) => ({ path, hash: sha256(readFileSync(join(other, path))) });
    const files = {
      spec: file("reviews/references/evening-v1/episode-spec.json"),
      timeline: file("reviews/references/evening-v1/edit-timeline.json"),
      render: file("output/render-9-cccccccc.mp4"),
      report: file("output/render-9-cccccccc.report.json"),
    };
    const bound = (f: { path: string; hash: string }) => ({ path: f.path, sha256: f.hash.slice(7) });
    const reference = {
      ...descriptor,
      id: "evening-v1",
      episodeRef: { ...REF, episode: "evening" },
      ...files,
      approval: {
        ...descriptor.approval,
        episode: `${REF.channel}/${REF.series}/evening`,
        binding: { ...descriptor.approval.binding, inputs: [bound(files.spec), bound(files.timeline)], outputs: [bound(files.render), bound(files.report)] },
      },
    };
    const descriptorPath = join(dirname(dirname(dir())), "templates/poetry-short/references/evening-v1.json");
    mkdirSync(dirname(descriptorPath), { recursive: true });
    writeFileSync(descriptorPath, JSON.stringify(reference));

    const r = await compareVersions(dir(), { old: "reference:poetry-short/evening-v1", new: "render-2-bbbbbbbb", expect: ["block-1"] });
    expect(r.report.verdict).toBe("ok");
    expect(r.report.old.notes).toEqual(["signature not checked: run vpr reference verify for trust"]);
    expect(r.dir).toBe(at(`${COMPARE_DIR}/reference-poetry-short-evening-v1--render-2-bbbbbbbb`));

    writeFileSync(join(other, "output/render-9-cccccccc.mp4"), "not the reference any more");
    await expect(compareVersions(dir(), { old: "reference:poetry-short/evening-v1", new: "render-2-bbbbbbbb" }))
      .rejects.toMatchObject({ code: "reference-changed" });
  });

  it("refuses what it cannot compare, writing nothing", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-3-dddddddd", ORIGINAL, { size: "160x90" });
    const code = (options: Parameters<typeof compareVersions>[1]) =>
      compareVersions(dir(), options).then(() => "none", (e) => (e instanceof CompareError ? e.code : String(e)));
    expect(await code({ old: "render-1-aaaaaaaa" })).toBe("no-render");
    expect(await code({ old: "../escape", new: "render-1-aaaaaaaa" })).toBe("bad-version");
    expect(await code({ old: "render-7-eeeeeeee", new: "render-1-aaaaaaaa" })).toBe("no-such-render");
    expect(await code({ old: "reference:poetry-short/none", new: "render-1-aaaaaaaa" })).toBe("no-such-reference");
    expect(await code({ old: "render-3-dddddddd", new: "render-1-aaaaaaaa" })).toBe("resolution-differs");
    expect(await code({ old: "render-1-aaaaaaaa", new: "render-1-aaaaaaaa", threshold: 0 })).toBe("bad-options");
    writeFileSync(at("output/render-3-dddddddd.mp4"), "edited by hand");
    expect(await code({ old: "render-3-dddddddd", new: "render-1-aaaaaaaa" })).toBe("render-changed");
    expect(existsSync(at(COMPARE_DIR)) ? readdirSync(at(COMPARE_DIR)) : []).toEqual([]);
  });

  it("keeps a previous comparison of the same pair, and leaves nothing behind, when decoding fails", async () => {
    render("render-1-aaaaaaaa", ORIGINAL);
    render("render-2-bbbbbbbb", ORIGINAL);
    const first = await compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" });
    const before = readFileSync(first.reportPath, "utf-8");
    // A video that is not a video, but matches its report: decoding fails.
    writeFileSync(at("output/render-1-aaaaaaaa.mp4"), "not a video");
    const report = JSON.parse(readFileSync(at("output/render-1-aaaaaaaa.report.json"), "utf-8"));
    report.render.hash = sha256("not a video");
    writeFileSync(at("output/render-1-aaaaaaaa.report.json"), JSON.stringify(report));
    await expect(compareVersions(dir(), { old: "render-1-aaaaaaaa", new: "render-2-bbbbbbbb" })).rejects.toMatchObject({ code: "decode-failed" });
    expect(readFileSync(first.reportPath, "utf-8")).toBe(before);
    expect(readdirSync(at(COMPARE_DIR))).toEqual(["render-1-aaaaaaaa--render-2-bbbbbbbb"]);
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/version-compare.test.ts`
Expected: FAIL — cannot resolve `../src/version-compare.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/version-compare.ts` (new):

````ts
// ---------------------------------------------------------------------------
// Comparing two versions of an episode (avg-jao.5, UP-54)
// ---------------------------------------------------------------------------
// A correction changes only the part that was asked for, and that is shown:
// two renders — of this episode, or a golden reference — decoded by ffmpeg at
// the same instants (version-diff.ts aligns them), every pair measured, the
// changed ones drawn side by side with their difference, and a verdict
// against the sections expected to change. Written whole to
// reviews/compare/<old>--<new>/ in the new version's episode.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { validateSeriesReference } from "@studio/contracts/src/series-templates.mjs";
import { alignInstants, CompareError, judge, measure, type AlignSide, type ComparePick, type Shift, type Verdict } from "./version-diff.js";

const exec = promisify(execFile);

export const COMPARE_DIR = "reviews/compare";
const RENDER_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REFERENCE = /^reference:([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** "<render-id>" of this episode, or "reference:<template-id>/<reference-id>" of its series. */
export type VersionRef = string;

export interface Version {
  ref: VersionRef;
  /** The episode directory the version's files belong to. */
  episodeDir: string;
  /** Paths relative to episodeDir; hashes "sha256:…". */
  video: { path: string; hash: string };
  timeline: { path: string; hash: string } | null;
  side: AlignSide;
  width: number;
  height: number;
  notes: string[];
}

const sha256Text = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
};

/** A path a document names, confined to `base`; null when it points outside. */
function inside(base: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  const full = resolve(base, path);
  const rel = relative(base, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : full;
}

/** Timing, size and sections from a timeline document; null when it has none of them. */
function fromTimeline(doc: any): { side: AlignSide; width: number; height: number } | null {
  const fps = doc?.fps;
  const durationInFrames = doc?.durationInFrames;
  const width = doc?.resolution?.width;
  const height = doc?.resolution?.height;
  if (![fps, durationInFrames, width, height].every((n) => typeof n === "number" && n > 0)) return null;
  const sections = Array.isArray(doc.sections)
    ? doc.sections
      .filter((s: any) => typeof s?.id === "string" && Number.isInteger(s?.from) && Number.isInteger(s?.duration))
      .map((s: any) => ({ id: s.id, from: s.from, duration: s.duration }))
    : null;
  return { side: { fps, durationInFrames, sections }, width, height };
}

/** What ffprobe says of a video: its rate, its frames and its size. */
async function probe(video: string): Promise<{ side: AlignSide; width: number; height: number }> {
  let out: string;
  try {
    ({ stdout: out } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
      "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", video]));
  } catch (error) {
    throw new CompareError("decode-failed", `ffprobe could not read ${video}: ${(error as Error).message}`);
  }
  const stream = JSON.parse(out).streams?.[0];
  const [num, den] = String(stream?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = num! / (den || 1);
  const durationInFrames = Number(stream?.nb_read_frames);
  if (!stream || !(fps > 0) || !(durationInFrames > 0)) throw new CompareError("decode-failed", `${video} has no video stream ffprobe can measure`);
  return { side: { fps, durationInFrames, sections: null }, width: stream.width, height: stream.height };
}

async function renderVersion(episodeDir: string, renderId: string): Promise<Version> {
  const video = join(episodeDir, "output", `${renderId}.mp4`);
  const report = readJson(join(episodeDir, "output", `${renderId}.report.json`));
  if (!existsSync(video) || report === undefined) {
    throw new CompareError("no-such-render", `output/${renderId}.mp4 and its report are not both in this episode`);
  }
  const hash = await sha256File(video);
  if (hash !== report?.render?.hash) {
    throw new CompareError("render-changed", `output/${renderId}.mp4 is not the video its report describes (${hash}, the report says ${report?.render?.hash})`);
  }
  const notes: string[] = [];
  const snapshotPath = `output/${renderId}.timeline.json`;
  let timeline: Version["timeline"] = null;
  let measured: ReturnType<typeof fromTimeline> = null;
  if (existsSync(join(episodeDir, snapshotPath))) {
    const text = readFileSync(join(episodeDir, snapshotPath));
    if (sha256Text(text) === report?.timeline?.hash) {
      timeline = { path: snapshotPath, hash: sha256Text(text) };
      measured = fromTimeline(readJson(join(episodeDir, snapshotPath)));
    } else {
      notes.push(`${snapshotPath} is not the timeline the report names: aligned by time`);
    }
  } else {
    notes.push(`${renderId} kept no timeline: aligned by time`);
  }
  return { ref: renderId, episodeDir, video: { path: `output/${renderId}.mp4`, hash }, timeline, ...(measured ?? await probe(video)), notes };
}

async function referenceVersion(episodeDir: string, ref: string, templateId: string, referenceId: string): Promise<Version> {
  const seriesDir = dirname(dirname(episodeDir));
  const descriptor = readJson(join(seriesDir, "templates", templateId, "references", `${referenceId}.json`));
  if (descriptor === undefined || validateSeriesReference(descriptor).length > 0) {
    throw new CompareError("no-such-reference", `templates/${templateId}/references/${referenceId}.json is not a reference of this series`);
  }
  const refEpisode = join(seriesDir, "episodes", descriptor.episodeRef.episode);
  const video = inside(refEpisode, descriptor.render.path);
  const timelinePath = inside(refEpisode, descriptor.timeline.path);
  if (!video || !timelinePath || !existsSync(video) || !existsSync(timelinePath)) {
    throw new CompareError("reference-changed", `the files of reference ${referenceId} are not in its episode`);
  }
  const hash = await sha256File(video);
  const timelineText = readFileSync(timelinePath);
  if (hash !== descriptor.render.hash || sha256Text(timelineText) !== descriptor.timeline.hash) {
    throw new CompareError("reference-changed", `the render or timeline of reference ${referenceId} is not what its descriptor says`);
  }
  const measured = fromTimeline(readJson(timelinePath)) ?? await probe(video);
  return {
    ref,
    episodeDir: refEpisode,
    video: { path: descriptor.render.path, hash },
    timeline: { path: descriptor.timeline.path, hash: descriptor.timeline.hash },
    ...measured,
    notes: [`signature not checked: run vpr reference verify for trust`],
  };
}

/** Find a version and check its files are the ones recorded. */
export async function resolveVersion(episodeDir: string, ref: VersionRef): Promise<Version> {
  const reference = REFERENCE.exec(ref);
  if (reference) return referenceVersion(episodeDir, ref, reference[1]!, reference[2]!);
  if (!RENDER_ID.test(ref)) throw new CompareError("bad-version", `"${ref}" is neither a render id nor reference:<template>/<reference>`);
  return renderVersion(episodeDir, ref);
}

/** The render output/current.json points at. */
function currentRender(episodeDir: string): string {
  const current = readJson(join(episodeDir, "output", "current.json"));
  if (typeof current?.renderId !== "string") throw new CompareError("no-render", "this episode has no current render (output/current.json) to compare");
  return current.renderId;
}

const dirName = (ref: VersionRef) => ref.replace(/^reference:/, "reference-").replace("/", "-");

/**
 * Decode `frames` of `video` in one ffmpeg pass, at `width`×`height`: each as
 * grey bytes (for measuring) and as `<dir>/<prefix>-<frame>.jpg` (for people).
 */
async function decode(video: string, frames: number[], width: number, height: number, dir: string, prefix: string): Promise<Map<number, Uint8Array>> {
  const unique = [...new Set(frames)].sort((a, b) => a - b);
  const result = new Map<number, Uint8Array>();
  if (unique.length === 0) return result;
  const select = unique.map((f) => `eq(n\\,${f})`).join("+");
  const raw = join(dir, `${prefix}.gray`);
  const jpgs = join(dir, `${prefix}-%04d.jpg`);
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video,
      // Split before scaling: split's outputs share one pixel format, so a
      // split after it would make the JPEGs grey too. Each scaler converts.
      "-filter_complex", `[0:v]split=2[a][b];[a]select='${select}',scale=${width}:${height},format=gray[g];`
        + `[b]select='${select}',scale=${width}:${height},format=yuvj420p[j]`,
      "-map", "[g]", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", raw,
      "-map", "[j]", "-fps_mode", "passthrough", "-q:v", "3", jpgs], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new CompareError("decode-failed", `ffmpeg could not decode ${video}: ${(error as Error).message}`);
  }
  const bytes = readFileSync(raw);
  const size = width * height;
  if (bytes.length < size * unique.length) {
    throw new CompareError("decode-failed", `${video} gave ${Math.floor(bytes.length / size)} of the ${unique.length} frames asked for`);
  }
  unique.forEach((frame, i) => {
    result.set(frame, new Uint8Array(bytes.subarray(i * size, (i + 1) * size)));
    renameSync(join(dir, `${prefix}-${String(i + 1).padStart(4, "0")}.jpg`), join(dir, `${prefix}-${frame}.jpg`));
  });
  rmSync(raw, { force: true });
  return result;
}

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new CompareError("decode-failed", `ffmpeg could not draw the comparison: ${(error as Error).message}`);
  }
}

/**
 * old | new | where they differ, side by side: the difference as grey heat,
 * amplified four times so a small change shows. A missing side is black.
 */
async function drawPair(oldJpg: string | null, newJpg: string, width: number, height: number, out: string): Promise<void> {
  const oldInput = oldJpg ? ["-i", oldJpg] : ["-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=1`];
  await ffmpeg([...oldInput, "-i", newJpg, "-filter_complex",
    "[0:v]format=rgb24,split=2[o1][o2];[1:v]format=rgb24,split=2[n1][n2];"
    + "[o2][n2]blend=all_mode=difference,format=gray,lut=y='min(val*4\\,255)',format=rgb24[d];"
    + "[o1][n1][d]hstack=inputs=3",
    "-frames:v", "1", "-q:v", "3", out]);
}

export interface ComparedPair extends ComparePick {
  seconds: number;
  meanDiff: number | null;
  changedShare: number | null;
  changed: boolean;
}

export interface CompareReport {
  createdAt: string;
  old: Omit<Version, "episodeDir" | "side" | "width" | "height">;
  new: Omit<Version, "episodeDir" | "side" | "width" | "height">;
  alignment: "sections" | "time";
  threshold: number;
  shifts: Shift[];
  expect: string[] | null;
  verdict: Verdict;
  pairs: ComparedPair[];
  changed: number[];
  unexpected: number[];
  warnings: string[];
}

export interface VersionComparison {
  report: CompareReport;
  /** Absolute paths. */
  dir: string;
  reportPath: string;
  /** null when nothing changed. */
  changedPath: string | null;
}

export interface CompareOptions {
  old: VersionRef;
  /** Default: the current render. */
  new?: VersionRef;
  expect?: string[];
  /** Mean grey difference (0–255) above which a pair has changed; default 1.0. */
  threshold?: number;
  times?: number[];
  shifts?: Shift[];
}

let temporaries = 0;

/**
 * Compare two versions at the same instants and write the comparison to
 * reviews/compare/<old>--<new>/ of this episode, replacing a previous one of
 * the same pair whole. Nothing is written unless every pair was measured.
 */
export async function compareVersions(episodeDir: string, options: CompareOptions): Promise<VersionComparison> {
  const threshold = options.threshold ?? 1;
  if (!(Number.isFinite(threshold) && threshold > 0)) throw new CompareError("bad-options", `threshold ${threshold} is not a positive number`);
  if (options.expect !== undefined && (!Array.isArray(options.expect) || options.expect.some((p) => typeof p !== "string" || p === ""))) {
    throw new CompareError("bad-options", "expect is a list of section ids or prefixes ending in *");
  }
  const older = await resolveVersion(episodeDir, options.old);
  const newer = await resolveVersion(episodeDir, options.new ?? currentRender(episodeDir));
  if (older.width !== newer.width || older.height !== newer.height) {
    throw new CompareError("resolution-differs", `${older.ref} is ${older.width}x${older.height}, ${newer.ref} is ${newer.width}x${newer.height}: nothing would be comparable`);
  }
  const { picks, alignment, warnings } = alignInstants(newer.side, older.side, {
    ...(options.times ? { times: options.times } : {}),
    ...(options.shifts ? { shifts: options.shifts } : {}),
  });

  const compareDir = join(episodeDir, COMPARE_DIR);
  mkdirSync(compareDir, { recursive: true });
  const name = `${dirName(older.ref)}--${dirName(newer.ref)}`;
  const suffix = `${process.pid}.${temporaries++}`;
  const temp = join(compareDir, `.${name}.${suffix}.tmp`);
  const old = join(compareDir, `.${name}.${suffix}.old`);
  const final = join(compareDir, name);
  const width = Math.max(2, Math.round(newer.width / 4));
  const height = Math.max(2, Math.round(newer.height / 4));
  let report: CompareReport;
  let changedPath: string | null = null;
  try {
    const frames = join(temp, "frames");
    mkdirSync(frames, { recursive: true });
    const newFrames = await decode(join(newer.episodeDir, newer.video.path), picks.map((p) => p.newFrame), width, height, frames, "new");
    const oldFrames = await decode(join(older.episodeDir, older.video.path), picks.flatMap((p) => p.oldFrame === null ? [] : [p.oldFrame]), width, height, frames, "old");

    const pairs: ComparedPair[] = picks.map((p) => {
      const seconds = Math.round((p.newFrame / newer.side.fps) * 1000) / 1000;
      if (p.oldFrame === null) return { ...p, seconds, meanDiff: null, changedShare: null, changed: true };
      const m = measure(oldFrames.get(p.oldFrame)!, newFrames.get(p.newFrame)!);
      return { ...p, seconds, ...m, changed: m.meanDiff > threshold };
    });
    const judged = judge(pairs, options.expect);

    const changed = pairs.filter((p) => p.changed);
    if (changed.length > 0) {
      mkdirSync(join(temp, "pairs"), { recursive: true });
      const drawn: string[] = [];
      for (const p of changed) {
        const out = join(temp, "pairs", `${String(p.index).padStart(3, "0")}.jpg`);
        await drawPair(p.oldFrame === null ? null : join(frames, `old-${p.oldFrame}.jpg`), join(frames, `new-${p.newFrame}.jpg`), width, height, out);
        drawn.push(out);
      }
      const stacked = join(temp, "changed.jpg");
      if (drawn.length === 1) writeFileSync(stacked, readFileSync(drawn[0]!));
      else await ffmpeg([...drawn.flatMap((d) => ["-i", d]), "-filter_complex", `vstack=inputs=${drawn.length}`, "-frames:v", "1", "-q:v", "3", stacked]);
    }
    rmSync(frames, { recursive: true, force: true });

    const describe = (v: Version) => ({ ref: v.ref, video: v.video, timeline: v.timeline, notes: v.notes });
    report = {
      createdAt: new Date().toISOString(),
      old: describe(older),
      new: describe(newer),
      alignment,
      threshold,
      shifts: options.shifts ?? [],
      expect: options.expect ?? null,
      verdict: judged.verdict,
      pairs,
      changed: judged.changed,
      unexpected: judged.unexpected,
      warnings: [...warnings, ...judged.warnings],
    };
    writeFileSync(join(temp, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    if (existsSync(final)) renameSync(final, old);
    renameSync(temp, final);
    if (changed.length > 0) changedPath = join(final, "changed.jpg");
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (!existsSync(final) && existsSync(old)) renameSync(old, final);
    throw error;
  }
  try {
    rmSync(old, { recursive: true, force: true });
  } catch {
    /* a leftover .old, harmless */
  }
  return { report, dir: final, reportPath: join(final, "report.json"), changedPath };
}
````

Append to `studio/episode/src/index.ts`:

```ts
export * from "./version-compare.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd studio/episode && npx vitest run tests/version-compare.test.ts && npx tsc --noEmit`
Expected: 7 passed. If "shows a correction stayed in its section" fails on a colour check, the decode filter is not the one above (each branch must be split *before* `select`/`scale`).

- [ ] **Step 5: Document, build, commit**

````diff
diff --git a/studio/episode/README.md b/studio/episode/README.md
index cba6b08..5200c44 100644
--- a/studio/episode/README.md
+++ b/studio/episode/README.md
@@ -6,7 +6,7 @@ its `episode-spec.json` by its series template's compiler — checked against it
 series' rules, shown on a layout sheet and rendered with `@av/remotion-composer`.
 
 The agent's tools (`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`,
-`pva_layout_sheet`, `pva_compose_video`, the narration tools) and the `series-production` stage
+`pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, the narration tools) and the `series-production` stage
 adapters both call this package, so a tool and a stage never disagree.
 
 ## What it offers
@@ -22,6 +22,8 @@ adapters both call this package, so a tool and a stage never disagree.
 | `references.ts` | `proposeReference`: freeze an episode as a proposed golden reference |
 | `sheet-instants.ts` | `sheetInstants`: the frames a layout sheet shows, from the timeline and the release's `sheet` rules (pure) |
 | `layout-sheet.ts` | `makeLayoutSheet`, `layoutSheetStatus`: `artifacts/layout-sheet/`, and whether it still shows what a render would use |
+| `version-diff.ts` | `alignInstants`, `measure`, `judge`: which frames two versions compare, how different they are, the verdict (pure) |
+| `version-compare.ts` | `compareVersions`: two renders, or a render and a golden reference, decoded with ffmpeg at the same instants, into `reviews/compare/<old>--<new>/` |
 
 `@studio/episode/testing` exports `specEpisode`, `editSpec` and `sha256`: a
 complete poetry-short episode on disk, from `@studio/series`'s golden fixture,
@@ -32,6 +34,6 @@ for tests.
 ```
 npm run build       # tsc to dist/ (the agent and the adapters import it from there)
 npm run typecheck
-npm test            # vitest
+npm test            # vitest; the version comparison tests need ffmpeg and ffprobe on PATH
 REMOTION_E2E=1 npm test   # also one real layout sheet (build @av/remotion-composer first)
 ```
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Run: `npm run build --workspace @studio/episode && npm test --workspace @studio/episode`
Expected: 152 passed, 1 skipped.

```bash
git add studio/episode/src/version-compare.ts studio/episode/src/index.ts studio/episode/tests/version-compare.test.ts studio/episode/README.md
git commit -m "feat(episode): compareVersions — two renders, or a render and a golden reference, at the same instants (avg-jao.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Agent — `pva_compare_versions`, the `compare-versions` skill, the docs

**Files:**
- Create: `studio/agent/tests/compare-versions.test.ts`, `skills/studio/compare-versions.md`
- Modify: `studio/agent/src/capability-tools.ts`, `studio/agent/tests/extension.test.ts`, `studio/agent/tests/skill-discovery.test.ts`, `docs/adr/0037-series-templates-pin-editorial-standards.md`, `docs/running.md`

**Interfaces:**
- Consumes: `compareVersions` from `@studio/episode` (Task 3, through its `dist/`); `sha256` from `@studio/episode/testing` (tests).
- Produces: tool `pva_compare_versions { channel, series, episode, old, new?, expect?, threshold?, shifts? }` (48 tools); skill `compare-versions@0.1.0`.

- [ ] **Step 1: Write the failing tests**

`studio/agent/tests/compare-versions.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@studio/episode/testing";

/**
 * pva_compare_versions (avg-jao.5): Pi proves a correction stayed where it
 * was asked. Two small real renders, made with ffmpeg, as renderEpisode
 * leaves them; @studio/episode tests the comparison itself.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let previousRoot: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

/** A render of flat-colour sections (1 s each, 30 fps), with its timeline snapshot and report. */
function render(id: string, colors: [string, string, string]): void {
  const out = join(dir(), "output");
  mkdirSync(out, { recursive: true });
  const video = join(out, `${id}.mp4`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    ...colors.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${c}:s=320x180:r=30:d=1`]),
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const sections = ["intro", "block-1", "block-2"].map((sid, i) => ({ id: sid, from: i * 30, duration: 30 }));
  const timeline = `${JSON.stringify({ fps: 30, durationInFrames: 90, resolution: { width: 320, height: 180 }, sections })}\n`;
  writeFileSync(join(out, `${id}.timeline.json`), timeline);
  writeFileSync(join(out, `${id}.report.json`), JSON.stringify({
    renderId: id, timeline: { hash: sha256(timeline) }, render: { hash: sha256(readFileSync(video)) },
  }));
  writeFileSync(join(out, "current.json"), JSON.stringify({ renderId: id, path: `${id}.mp4` }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-compare-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  render("render-1-aaaaaaaa", ["red", "green", "blue"]);
  render("render-2-bbbbbbbb", ["red", "yellow", "blue"]);
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
  return tools.get("pva_compare_versions")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_compare_versions", () => {
  it("says the correction stayed in its section, against the current render", async () => {
    const result = await tool({ old: "render-1-aaaaaaaa", expect: ["block-1"] });
    expect(result.isError).toBeFalsy();
    const text: string = result.content[0].text;
    expect(text).toMatch(/^✅ ok: every difference is inside block-1 — render-1-aaaaaaaa → render-2-bbbbbbbb, aligned by sections/);
    expect(text).toMatch(/· #\d\d · \d+\.\d\ds · block-1 · diff \d+(\.\d)? \(\d+%\)/);
    expect(text).toContain(`open: ${join(dir(), "reviews/compare/render-1-aaaaaaaa--render-2-bbbbbbbb/changed.jpg")}`);
  });

  it("flags every change outside the expected sections", async () => {
    const result = await tool({ old: "render-1-aaaaaaaa", expect: ["intro"] });
    const text: string = result.content[0].text;
    expect(text).toMatch(/^❌ unexpected changes outside intro: \d+ frame\(s\)/);
    expect(text).toMatch(/❌ #\d\d · \d+\.\d\ds · block-1 · /);
    expect(text).toContain("⚠️ intro was expected to change and did not");
  });

  it("replies with the error's code", async () => {
    const result = await tool({ old: "not a render" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ bad-version: "not a render" is neither a render id nor reference:<template>\/<reference>/);
    expect(result.details.code).toBe("bad-version");
  });
});
````

````diff
diff --git a/studio/agent/tests/extension.test.ts b/studio/agent/tests/extension.test.ts
index 15c197c..ff7b2f4 100644
--- a/studio/agent/tests/extension.test.ts
+++ b/studio/agent/tests/extension.test.ts
@@ -129,7 +129,7 @@ describe("extensions/index.ts — tool registration", () => {
   });
 
   it("registers the expected suite of production tools", () => {
-    expect(mockPi.tools.length).toBe(47);
+    expect(mockPi.tools.length).toBe(48);
     const names = mockPi.tools.map((t) => t.name).sort();
     expect(names).toEqual([
       "pva_blender_create_scene",
@@ -142,6 +142,7 @@ describe("extensions/index.ts — tool registration", () => {
       "pva_check_episode",
       "pva_check_staleness",
       "pva_claim_stage",
+      "pva_compare_versions",
       "pva_complete_stage",
       "pva_compose_multitrack_video",
       "pva_compose_video",
diff --git a/studio/agent/tests/skill-discovery.test.ts b/studio/agent/tests/skill-discovery.test.ts
index b7db165..f9aa96e 100644
--- a/studio/agent/tests/skill-discovery.test.ts
+++ b/studio/agent/tests/skill-discovery.test.ts
@@ -57,6 +57,19 @@ it("discovers the review-layout-sheet skill the series-production pipeline names
   } finally { await rm(root, { recursive: true, force: true }); }
 });
 
+it("discovers the compare-versions skill: a correction changes only what was asked", async () => {
+  const root = await mkdtemp(join(tmpdir(), "compare-versions-skill-"));
+  try {
+    const builtInPath = fileURLToPath(new URL("../../../skills/studio/", import.meta.url));
+    const catalog = await discoverSkills({ libraryRoot: root, builtInPath });
+    expect(catalog.list({ source: "built-in" }).find(s => s.id === "compare-versions")?.description).toContain("only the requested part");
+    const skill = await catalog.load("compare-versions");
+    expect(skill).toContain("pva_compare_versions");
+    expect(skill).toContain("UP-54");
+    expect(skill).toContain("Never wave an unexpected change through");
+  } finally { await rm(root, { recursive: true, force: true }); }
+});
+
 it("discovers composed flat/folder skills and scopes layout-2 series overrides", async () => {
   const root = await mkdtemp(join(tmpdir(), "skills-discovery-"));
   try {
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/agent && npx vitest run tests/compare-versions.test.ts tests/extension.test.ts tests/skill-discovery.test.ts`
Expected: FAIL — no `pva_compare_versions` (47 tools), no `compare-versions` skill.

- [ ] **Step 3: The tool**

````diff
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index 8a686f8..ea875d1 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -45,6 +45,7 @@ import {
   type NarrationSegmentInput,
   decideEditTimeline,
   EDIT_TIMELINE_PATH,
+  compareVersions,
   initEpisodeSpec,
   makeLayoutSheet,
   proposeReference,
@@ -1150,6 +1151,55 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
+  pi.registerTool({
+    name: "pva_compare_versions",
+    label: "Compare Versions",
+    description: "Prove a correction touched only what was asked (UP-54): compare two renders of the episode — or a golden reference of its series — at the same instants, aligned section by section, and report every frame that differs. Name the sections the correction should change in `expect`; the verdict is ok when every difference is inside them. Writes reviews/compare/<old>--<new>/ with changed.jpg (old | new | difference) to open.",
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+      old: Type.String({ description: "The version delivered before the correction: a render id (output/<render-id>.mp4) or reference:<template-id>/<reference-id>" }),
+      new: Type.Optional(Type.String({ description: "The corrected version; default the current render" })),
+      expect: Type.Optional(Type.Array(Type.String(), { description: "Section ids the correction should change; a trailing * matches a prefix (block-*)" })),
+      threshold: Type.Optional(Type.Number({ description: "Mean grey difference (0–255) above which a frame has changed; default 1" })),
+      shifts: Type.Optional(Type.Array(Type.Object({ from: Type.Number(), by: Type.Number() }), { description: "Only for renders without a timeline: from <from> seconds on, the old version is <by> seconds later" })),
+    }),
+    async execute(_toolCallId, params) {
+      const dir = episodeDir(params.channel, params.series, params.episode);
+      try {
+        const { report, changedPath } = await compareVersions(dir, {
+          old: params.old,
+          ...(params.new ? { new: params.new } : {}),
+          ...(params.expect ? { expect: params.expect } : {}),
+          ...(params.threshold !== undefined ? { threshold: params.threshold } : {}),
+          ...(params.shifts ? { shifts: params.shifts } : {}),
+        });
+        const verdict = report.verdict === "ok"
+          ? `✅ ok: every difference is inside ${report.expect!.join(", ")}`
+          : report.verdict === "unexpected-changes"
+            ? `❌ unexpected changes outside ${report.expect!.join(", ")}: ${report.unexpected.length} frame(s)`
+            : `${report.changed.length} of ${report.pairs.length} frames differ (no expectation given)`;
+        const lines = [
+          `${verdict} — ${report.old.ref} → ${report.new.ref}, aligned by ${report.alignment}`,
+          ...report.pairs.filter((p) => p.changed).map((p) =>
+            `  ${report.unexpected.includes(p.index) ? "❌" : "·"} #${String(p.index).padStart(2, "0")} · ${p.seconds.toFixed(2)}s · ${p.section ?? "no section"} · `
+            + (p.reason ?? `diff ${p.meanDiff} (${Math.round((p.changedShare ?? 0) * 100)}%)`)),
+          ...(changedPath ? [`open: ${changedPath}`] : []),
+          ...[...report.old.notes, ...report.new.notes, ...report.warnings].map((w) => `⚠️ ${w}`),
+        ];
+        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { report, changedPath } as Record<string, unknown> };
+      } catch (err) {
+        const e = err as { message?: string; code?: string };
+        return {
+          content: [{ type: "text" as const, text: `❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}` }],
+          details: { code: e.code ?? null } as Record<string, unknown>,
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

`skills/studio/compare-versions.md` (new):

````markdown
---
name: compare-versions
version: "0.1.0"
description: After a correction to a rendered episode, prove by pixel comparison that only the requested part changed
inputs:
  - name: episode
    type: string
    description: The channel/series/episode that was corrected and rendered again
  - name: old
    type: string
    description: The render the person received before the correction (its render id), or a golden reference of the series
  - name: sections
    type: string
    description: The sections the correction was meant to change
outputs:
  - reviews/compare/<old>--<new>/:
      kind: directory
      description: report.json with every pair measured and the verdict, pairs/ and changed.jpg (old | new | difference)
capabilities:
  - llm
---

# Compare Versions

A correction to an episode the person has already seen changes **only** what
they asked for; everything else stays identical (UP-54). That is shown, not
claimed: the new render is compared with the old one at the same instants —
the layout sheet's instants, carried section by section, so a block that got
longer does not make everything after it look different — and every frame
that differs is listed with its section.

## Steps

1. **Correct only the part asked for**, in the spec or the timeline, and
   render the new version (the render keeps its timeline beside the video).
2. **Compare** with `pva_compare_versions { channel, series, episode, old,
   expect }`: `old` is the render id the person received (from
   `output/`, or the render they named), `expect` the sections the
   correction should change — section ids, or a prefix with `*`.
3. **Read the verdict.**
   - `ok`: every difference is inside the expected sections. Open
     `changed.jpg` and check the differences are the ones asked for.
   - `unexpected changes`: the correction touched more than it should. Each
     `❌` line names the frame, its time and its section. Undo or narrow the
     change, render again, compare again.
   - A warning that an expected section did not change usually means the
     wrong render was compared, or the correction did not take.
4. **Report** to the person: the verdict, the frames that changed, and the
   path of `changed.jpg`.

## Never

- Never wave an unexpected change through, or widen `expect` to make one
  disappear: an improvement nobody asked for is proposed separately.
- Never compare against anything but the version the person received.
- Never raise the threshold to hide a difference; ask the person if a
  difference is noise.
````

- [ ] **Step 5: Run the agent's tests to see them pass**

Run: `cd studio/agent && npx vitest run`
Expected: 203 passed, 3 skipped.

- [ ] **Step 6: The docs**

````diff
diff --git a/docs/adr/0037-series-templates-pin-editorial-standards.md b/docs/adr/0037-series-templates-pin-editorial-standards.md
index 507ccfb..bce4124 100644
--- a/docs/adr/0037-series-templates-pin-editorial-standards.md
+++ b/docs/adr/0037-series-templates-pin-editorial-standards.md
@@ -52,7 +52,9 @@ episodes/<episode>/
     episode-spec.json             # frozen editorial snapshot for the reference
     edit-timeline.json            # frozen derived snapshot
   output/<render-id>.mp4
+  output/<render-id>.timeline.json  # the exact timeline rendered (avg-jao.5)
   output/<render-id>.report.json
+  reviews/compare/<old>--<new>/   # version comparisons (avg-jao.5)
 ```
 
 `layout.mjs` owns the path builders and names. IDs are slugs; versions are
@@ -170,8 +172,33 @@ replaced, or whose inputs hash no longer matches what it would render.
 A sheet holds at most 120 frames: the defaults first, then the release's
 rules in order; instants past the limit are dropped with a warning, so no
 release can make a sheet impossible. Signing
-the sheet's review is `avg-3th.2`; comparing two versions at the same instants
-is `avg-jao.5`.
+the sheet's review is `avg-3th.2`.
+
+### Corrections are proven by comparison
+
+A correction to a rendered episode changes only what was asked for, and that
+is shown (`avg-jao.5`, CreativeStudio's UP-54): the new render is compared
+with the old one — or with a golden reference — at the same instants, and
+every frame that differs is listed with its section.
+
+Renders are compared, not re-rendered: an old timeline's assets may no longer
+exist, but its video does, and both videos are decoded alike. Each render
+keeps the exact timeline it rendered beside it
+(`output/<render-id>.timeline.json`, hashed in its report), so the instants —
+the layout sheet's, of the new version — are carried into the old version
+section by section, at the same offset: a block that got longer does not make
+everything after it look changed. A render without a timeline is aligned by
+time, with optional shifts. A frame differs when its mean grey difference
+exceeds a threshold (1.0 of 255 by default); one with no counterpart (a new
+section, a section that got shorter, a video that ends earlier) differs by
+definition.
+
+Given the sections the correction was meant to change, the verdict is `ok`
+when every difference is inside them and `unexpected-changes` otherwise; an
+unexpected change is undone or narrowed, never waved through. The comparison
+is evidence for a person (`reviews/compare/<old>--<new>/`, with each changed
+frame drawn old | new | difference), not a pipeline gate. A reference's
+signature is not checked here — that is the operator's `vpr reference verify`.
 
 ### Golden references are evidence, not live pointers
 
@@ -257,7 +284,7 @@ before it is promoted; afterwards only a signed withdrawal ends a reference.
   the layout sheet, which the series rules block.
 - `avg-jao.4` owns pipeline wiring: the `series-production` family (spec,
   pictures, takes, timeline, check, render), its stage adapters and
-  `pva_init_spec`; `avg-jao.5` owns identical-instant visual
-  comparisons. Real channel templates and approved reference media belong to
+  `pva_init_spec`; `avg-jao.5` made the identical-instant comparison of
+  two versions. Real channel templates and approved reference media belong to
   `avg-dcf`, not contract fixtures. No CreativeStudio runtime or production
   content is copied into this repository.
diff --git a/docs/running.md b/docs/running.md
index 6b29096..4ad7278 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -96,7 +96,7 @@ Production: `pva_generate_image`, `pva_synthesize_speech`,
 `pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
 `pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`,
 `pva_propose_reference`,
-`pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet`, `pva_compose_video`, `pva_compose_multitrack_video`,
+`pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, `pva_compose_multitrack_video`,
 `pva_probe_media`
 
 A tool whose capability is not ready will fail rather than silently degrade.
@@ -128,6 +128,23 @@ command of its own:
 node packages/remotion-composer/dist/sheet-cli.js timeline.json out/ --assets episode/ --times 0,2.5,10
 ```
 
+### Comparing two versions
+
+After a correction, prove it changed only what was asked: render the new
+version, then ask the agent to compare it with the render the person received
+(`pva_compare_versions`, with `old` that render's id — or
+`reference:<template>/<id>` for a golden reference — and `expect` the
+sections the correction should touch; the `compare-versions` skill walks it).
+Both videos are decoded with ffmpeg at the same instants, aligned section by
+section through the timeline every render keeps beside it
+(`output/<render-id>.timeline.json`). The result is in
+`reviews/compare/<old>--<new>/`:
+
+- `report.json` — every pair of frames measured, the verdict (`ok`,
+  `unexpected-changes`, or `listed` without an expectation) and warnings;
+- `pairs/NNN.jpg` and `changed.jpg` — each changed frame as old | new |
+  difference.
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
git add studio/agent/src/capability-tools.ts studio/agent/tests/compare-versions.test.ts studio/agent/tests/extension.test.ts \
  studio/agent/tests/skill-discovery.test.ts skills/studio/compare-versions.md \
  docs/adr/0037-series-templates-pin-editorial-standards.md docs/running.md
git commit -m "feat(agent): pva_compare_versions and the compare-versions skill; corrections proven by comparison in ADR-0037 (avg-jao.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
