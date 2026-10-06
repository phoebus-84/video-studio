# Layout sheet at deterministic instants

**Issue:** `avg-3th.1` — layout contact sheet at deterministic instants
**Epic:** `avg-3th` — QA, signed review and direct edits (the `cs-port` plan)
**Builds on:** [series templates](../../adr/0037-series-templates-pin-editorial-standards.md) (ADR-0037); [Remotion composer](2026-10-06-remotion-composer-design.md) (`avg-tk7.1`); [kit registry](2026-10-06-kit-registry-design.md) (`avg-tk7.3`); [series pipeline](2026-10-06-series-pipeline-design.md) (`avg-jao.4`)
**Blocks:** `avg-3th.2` (signed sheet review), `avg-jao.5` (version compare)
**Source:** `../CreativeStudio/docs/workflow/quality.md` §2–3, `../CreativeStudio/engine/remotion/qa/sheet.mjs`, `../CreativeStudio/formats/poesie-museo-long/cli.py` (`sheet-times`) — read only
**Date:** 2026-10-06

## Problem

A render costs minutes; a layout mistake — text over a face, a title out of
the margin, two captions overlapping — is visible in a still. CreativeStudio
makes a *layout sheet* before every render: 20–30 small frames at instants
chosen the same way every time, one image a person reads frame by frame, and
an `inputsHash` that says when the sheet no longer describes the episode. The
render refuses a missing or stale sheet. This studio has none of it: a series
episode goes from the series check straight to the render.

The sheet is also the evidence two later issues need: `avg-3th.2` signs a
review bound to the sheet's hash, and `avg-jao.5` compares two versions of an
episode pixel by pixel at identical instants.

## Decisions taken with the user

1. **A series declares its own instants in its template release** — an
   optional `sheet` field in `series-template.json`, rules relative to the
   timeline's sections. Data, pinned like the rest of the release; not code
   on the compiler, not hard-coded per format as in CreativeStudio.
2. **The sheet gates the series render, and is also a tool.** The
   `series-production` pipeline gets a `sheet` stage between `check` and
   `render`; `render` refuses a sheet that is missing or not made from the
   timeline it is about to render. The agent can make a sheet at any time
   (`pva_layout_sheet`). The signed review is `avg-3th.2`.
3. **Stills plus a labelled grid, both rendered by Remotion.** Each instant is
   a small JPEG (what `avg-jao.5` diffs); a `Sheet` composition draws them in
   a grid with number, time and label under each tile (what a person reads).
   No ffmpeg text drawing, whose availability depends on the ffmpeg build.
4. **No `vpr` command.** `@studio/runtime` deliberately does not depend on
   Remotion (`check-boundaries`), and the operator's CLI should not need
   Chrome. The per-episode sheet is made by the pipeline stage or the agent;
   the composer's own CLI gains a low-level `layout-sheet` command that
   renders a timeline at given times.

## Design

### Choosing the instants

#### The template's `sheet` field

`SeriesTemplate` gains an optional member (schema
`studio/contracts/schemas/v1alpha1/series-template.schema.json`, binding and
`.d.mts` regenerated):

```json
"sheet": {
  "instants": [
    { "at": "start", "offsetSeconds": 2 },
    { "at": "middle" },
    { "at": "end", "offsetSeconds": -1, "sections": ["opening", "block-*"] }
  ]
}
```

- `instants`: 1–32 rules, `additionalProperties: false` everywhere.
- `at`: `"start" | "middle" | "end"` of a section — `from`, `from +
  floor(duration / 2)`, `from + duration - 1`.
- `offsetSeconds`: optional number (may be negative), converted with
  `Math.round(offsetSeconds * fps)` frames.
- `sections`: optional, 1–32 patterns. A pattern is a section id, which
  matches exactly, or a prefix ending in a single `*` (`block-*`), which
  matches every id starting with that prefix; schema pattern
  `^[a-z0-9][a-z0-9-]*\*?$`. Absent: every section.

A release is immutable: adding `sheet` to a series means a new release.
`poetry-short@1.0.0` stays as it is and gets the default instants.

#### `sheetInstants(timeline, rules?)` — pure, in `@studio/episode`

```ts
export interface SheetPick { frame: number; label: string }
export interface SheetInstants { picks: SheetPick[]; warnings: string[] }
export function sheetInstants(timeline: EditTimeline, rules?: SheetRules, target = 24): SheetInstants;
```

1. `first` at frame 0 and `last` at `durationInFrames - 1`.
2. The sections (`timeline.sections`, sorted by `from`; a timeline without
   sections counts as one section `timeline` covering everything). Over
   them, `target - 2` frames spread by length: section `s` of length `len`
   gets `k = max(1, round((target - 2) * len / total))` frames at
   `from + floor(len * (i + 0.6) / k)` for `i < k` — CreativeStudio's
   placement, so every section is seen at least once and never on its cut.
   Label: `<section id>`.
3. Each rule, for each matching section: the anchor plus the offset. Label
   `<section id> · <at><±offset>s` (e.g. `poem · start+2s`). A frame outside
   the section or the timeline is dropped with a warning
   (`rule 2 (end-1s) falls outside section intro`), never an error: a
   hand-shortened section is not a reason to refuse a sheet. A rule that
   matches no section is a warning too.
4. Picks on the same frame merge into one, labels joined with ` / ` in the
   order above. The result is sorted by frame.

The same function gives `avg-jao.5` its instants: the sheet of the new
version decides where both versions are rendered.

### Rendering — `@av/remotion-composer`

```ts
export interface LayoutSheetOptions {
  timeline: unknown;              // passed validateEditTimeline
  assetRoot: string;
  picks: {frame: number; label: string}[];
  outDir: string;                 // created; frames/ and sheet.jpg written inside
  scale?: number;                 // default 0.25
  columns?: number;               // default: 6 for landscape, 8 for portrait or square
  parallel?: number;              // default 6
}
export interface LayoutSheetResult {
  frames: {index: number; frame: number; seconds: number; label: string; path: string; hash: string}[];
  sheet: {path: string; hash: string; columns: number; rows: number; width: number; height: number};
  kits: {name: string; version: string; hash: string}[];   // hash: the kits.lock.json entry
}
export function renderLayoutSheet(options: LayoutSheetOptions): Promise<LayoutSheetResult>;
```

- Validates the timeline and verifies/stages the assets exactly as
  `renderTimeline` does (same `ComposerError` codes).
- Refuses, before writing anything, `picks` that are empty, more than 120,
  repeat a frame, or have a frame outside `[0, durationInFrames)` or not an
  integer; a scale outside `(0, 1]`; a column count that is not a positive
  integer: `ComposerError('bad-sheet')`.
- Bundles once (both compositions are in `remotion-entry`), opens one
  browser, renders each pick of the `Timeline` composition with
  `renderStill` (`scale`, JPEG quality 80) into `frames/NNN.jpg`
  (three digits, pick order), `parallel` at a time.
- The `Sheet` composition (`src/Sheet.tsx`, id `Sheet`) receives the stills
  as `data:image/jpeg;base64` URLs plus the labels in `inputProps`;
  `calculateMetadata` sizes it `columns × tileWidth` by
  `rows × (tileHeight + 40)`, one frame. Under each tile: `#NN · mm:ss.ff ·
  label`, ellipsised to the tile width; a dark background, a light rule
  between tiles. Rendered once with `renderStill` (JPEG quality 85) to
  `sheet.jpg`.
- Paths in the result are absolute; `path.relative` is the caller's
  business. Hashes are `sha256:<hex>` of the files written.
- `kits`: each kit the timeline uses, with its `kits.lock.json` hash —
  `timelineKits(timeline)` (sorted by name then version; null for a kit the
  lock does not know) over `kitLockHash(name, version)`, both new exports
  reading the lock at the package root.
- Temporary work (bundle, staging) is removed on success and on failure;
  `outDir` is left as far as it got — the caller writes into a temporary
  directory and swaps (below). Remotion failures become
  `ComposerError('sheet-failed')`.
- CLI: a second bin, `layout-sheet` (`dist/sheet-cli.js`):
  `layout-sheet <timeline.json> <out-dir> --assets <dir> --times <s,s,…>
  [--scale 0.25] [--columns n]` — times in seconds, labels `<t>s`; prints the
  result as JSON; exit 2 on a `ComposerError`.

### The episode's sheet — `@studio/episode`

```ts
export const LAYOUT_SHEET_DIR = "artifacts/layout-sheet";
export const LAYOUT_SHEET_REPORT = "artifacts/layout-sheet/sheet.json";
export function makeLayoutSheet(episodeDir: string, options: {episodeRef: EpisodeRef}): Promise<LayoutSheet>;
export function layoutSheetStatus(episodeDir: string, options: {episodeRef: EpisodeRef}): LayoutSheetStatus;
```

`makeLayoutSheet`:

1. `decideEditTimeline(episodeDir, options)` — the timeline a render would
   use, read only. If its series validation has errors, throw
   `SeriesRulesError` and write nothing (ADR-0037: the rules block the
   sheet). A rebuilt timeline is *not* written: the sheet records the hash
   of the timeline it shows, and `render` writes it.
2. The rules: for a spec-driven episode, the pinned release's `sheet` field
   (via `loadEpisode`'s template); otherwise none. `rules` in the report is
   `{source, instants}`: `source` is `"<template id>@<version>"` or
   `"default"`, `instants` the rules applied (empty for none).
3. `sheetInstants(timeline, rules)`, then `renderLayoutSheet` into
   `artifacts/.layout-sheet.<pid>.<n>.tmp/`.
4. Write `sheet.json` into the temporary directory, then swap: an existing
   `layout-sheet/` is renamed to `.layout-sheet.<pid>.<n>.old`, the new
   directory renamed into place, the old one removed. A failure at any step
   removes the temporary directory and leaves the previous sheet as it was.

`sheet.json`:

```json
{
  "createdAt": "2026-10-06T…Z",
  "timeline": { "path": "artifacts/edit-timeline.json", "hash": "sha256:…" },
  "rebuilt": "spec changed",
  "rules": { "source": "poetry-short@1.1.0", "instants": [{ "at": "start", "offsetSeconds": 2 }] },
  "scale": 0.25,
  "kits": [{ "name": "still", "version": "1.0.0", "hash": "sha256:…" }],
  "inputsHash": "sha256:…",
  "frames": [{ "index": 0, "frame": 0, "seconds": 0, "label": "first", "path": "frames/000.jpg", "hash": "sha256:…" }],
  "sheet": { "path": "sheet.jpg", "hash": "sha256:…", "columns": 6, "rows": 4, "width": 2880, "height": 1240 },
  "warnings": []
}
```

`rebuilt` is present only when the stored timeline would be replaced at
render. `inputsHash` is `sha256` of the canonical JSON
`{"kits":[…],"rules":{…},"scale":…,"timeline":"sha256:…"}` (contracts'
`canonicalJson`: keys sorted; kits sorted by name then version). The timeline names every asset with its hash,
every kit with its version, and all timing in frames; with the kits' code
hashes and the instants' rules, nothing else decides what the sheet shows.

`layoutSheetStatus` reads only:

- `{state: "missing", reason}` — no readable `sheet.json`, or its `sheet.jpg`
  is gone or its hash no longer matches the file (an edited image is not
  evidence).
- `{state: "stale", reasons: [...]}` — the inputs hash recomputed for the
  timeline a render would use differs; `reasons` name which parts changed
  (`the timeline changed`, `the kits changed`, `the sheet's rules changed`,
  `the scale changed`). A timeline that
  cannot be decided (a broken spec) is `stale` with that problem as reason.
- `{state: "current", inputsHash, sheetHash}`.

### Pipeline — `series-production` 1.1.0

- A new stage `sheet` (type `editorial`, `autopilot: false`, `review: human`,
  `retry_on_failure: 1`), consuming `edit-timeline.json` and
  `series-check.json`, producing `layout-sheet.json`, depending on `check`.
  Description: *"Render the layout sheet of the checked timeline; a person
  reads it frame by frame before a render is spent."* Skill: `review-layout-sheet@0.1.0`.
- `render` consumes `layout-sheet.json` too and depends on `sheet`.
- Adapter `series-sheet` (in `studio/adapters/src/adapters/series.ts`):
  requires a spec; refuses a missing or stale check report (same comparison
  `series-render` makes) so a sheet is never made of an unchecked timeline;
  calls `makeLayoutSheet`; logs frames, warnings and the path of
  `sheet.jpg`; returns `[sheet.json, sheet.jpg]`. `requires: {}` — Remotion brings its
  own browser.
- `series-render` additionally calls `layoutSheetStatus` and refuses
  anything but `current`: *"the layout sheet is <missing|stale: reasons>:
  run the sheet stage again (artifacts/layout-sheet/sheet.json)"*.
- Episodes already resolved keep their 1.0.0 snapshot (ADR-0001); the
  contract name `layout-sheet.json` is registered wherever contract names are
  listed for the other series contracts.

### Agent — `pva_layout_sheet`

- Parameters: none beyond the episode the session is bound to.
- Calls `makeLayoutSheet`; replies with the path of `sheet.jpg` (absolute,
  so the agent can open it), frame count, grid, rules, `inputsHash`, and the
  warnings. A `SeriesRulesError` replies with the findings, as
  `pva_render_episode` does.
- Skill `skills/studio/review-layout-sheet.md`: open the sheet, read it tile
  by tile, with CreativeStudio's checklist — no text on faces or the
  subject, no overlapping or out-of-margin text, figures not covering text,
  hands and objects inside the frame, titles at their size — and report
  each problem with its tile number and time. The agent never approves its
  own sheet; approval is the stage's human gate (and, signed, `avg-3th.2`).
- `pva_render_episode` does not require a sheet; only the pipeline does.

### Documentation

ADR-0037 (the `sheet` field; the rules block the sheet; the sheet gates the
series render), `docs/pipelines.md` (the 1.1.0 stage list),
`docs/running.md` (making and reading a sheet), the composer README
(`renderLayoutSheet`, the CLI), the contracts catalog (the new field),
regenerated docs.

## Error handling

| Situation | Outcome |
|---|---|
| Series rules have errors | `SeriesRulesError`; nothing written |
| Timeline cannot be decided (spec broken, bad JSON) | `TimelineBuildError`, as for render |
| An asset's hash differs from the timeline | `ComposerError` from staging; previous sheet kept |
| A rule's instant falls outside its section | warning in `sheet.json`, pick dropped |
| Remotion fails mid-way | `ComposerError('sheet-failed')`; temporary directory removed |
| Bad picks, scale or columns | `ComposerError('bad-sheet')`, before anything is written |
| `sheet.jpg` edited after the fact | status `missing` |
| Timeline, kits or rules changed after the sheet | status `stale` with reasons; `series-render` refuses |

## Testing

- `sheetInstants` (unit, `@studio/episode`): first/last; spread with at
  least one per section; a timeline without sections; each anchor with
  positive and negative offsets; `sections` exact and prefix patterns;
  out-of-section and no-match warnings; same-frame merge; determinism
  (same input, same output).
- Template schema (`@studio/contracts`): the field accepted; unknown keys,
  bad `at`, empty `instants`, more than 32 rules, bad patterns refused.
- `renderLayoutSheet` (composer, opt-in real render like the other render
  tests): the `explainer` fixture at three picks — files exist, JPEG size is
  the scaled resolution, the grid's size matches `columns`/`rows`, hashes
  match the files; `bad-sheet` for every bad pick, scale and column count
  (no render needed).
- `makeLayoutSheet` / `layoutSheetStatus` (`@studio/episode`, with the
  composer mocked for the swap and failure paths, one real render):
  `sheet.json` contents and `inputsHash`; status `current` → `stale` after a
  timeline edit, after a different rules release; `missing` after
  `sheet.jpg` is altered; a failing render leaves the previous sheet
  untouched and no temporary directory; series-rule errors write nothing.
- Adapters: `series-sheet` refuses without a current check; `series-render`
  refuses with a missing or stale sheet and renders with a current one.
- Agent: `pva_layout_sheet` is registered (tool count +1), replies with the
  path and warnings, and turns `SeriesRulesError` into findings; the skill
  is discovered.

## Out of scope

- Signing the review of a sheet (`avg-3th.2`).
- Comparing two versions (`avg-jao.5`), beyond giving it `sheetInstants` and
  the stills.
- Automatic visual checks (face detection, OCR of overlaps).
- A sheet for the non-series pipelines.
