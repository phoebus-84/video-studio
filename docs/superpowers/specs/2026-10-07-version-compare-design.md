# Version compare: two renders at identical instants

**Issue:** `avg-jao.5` — version compare: sheets at identical instants, pixel diff
**Epic:** `avg-jao` — data-driven series templates and series compilers (the `cs-port` plan); the last issue of the epic
**Builds on:** [layout sheet](2026-10-06-layout-sheet-design.md) (`avg-3th.1`, `sheetInstants`); [golden references](2026-10-06-series-references-design.md) (`avg-jao.6`); [series templates](../../adr/0037-series-templates-pin-editorial-standards.md) (ADR-0037); immutable renders (ADR-0036)
**Source:** `../CreativeStudio/formats/poesie-museo-long/compare.py`, `../CreativeStudio/docs/policies/user-preferences.md` UP-54 — read only
**Date:** 2026-10-07

## Problem

UP-54: a correction to a delivered episode changes only the part that was
asked for; everything else stays identical, and that is *shown*, not
claimed — a pixel comparison of the two versions at the same instants,
identical except where the correction was. CreativeStudio renders the layout
sheets of both versions at the new version's instants (with a manual
`--shift` when a block got longer), measures the mean difference per tile and
saves the differing pairs side by side.

This studio has the instants (`sheetInstants`) and immutable renders, but no
way to compare two versions. Its timelines and assets are not immutable: the
old timeline survives only as a `.bak.json` when it was replaced, and the old
pictures may have been overwritten. Re-rendering the old version, as
CreativeStudio does, is often impossible here.

## Decisions taken with the user

1. **Compare two renders, decoded with ffmpeg at the same instants.** The old
   side needs no old timeline and no old assets — the delivered video is
   enough; a golden reference's frozen render works the same way. Both sides
   are decoded alike, so unchanged frames compare equal.
2. **Align by section, automatically.** An instant is a section and an offset
   into it; in the old version it is the same section (by id) at the same
   offset, so a block that got longer does not make everything after it look
   changed. This needs each render's timeline: from now on `renderEpisode`
   keeps an immutable copy beside the video. Without timelines, the same
   time, plus optional manual shifts.
3. **A verdict against the sections expected to change.** With `expect`, the
   comparison concludes `ok` (every change inside them) or
   `unexpected-changes`; without it, it only lists what changed. No pipeline
   gate.

## Design

### Versions

```ts
type VersionRef = string;   // "<render-id>" of this episode, or "reference:<template-id>/<reference-id>"
interface Version {
  ref: VersionRef;
  video: { path: string; hash: string };          // path relative to the episode the version belongs to (a reference's own episode)
  timeline: { path: string; hash: string } | null;
  fps: number; width: number; height: number; durationInFrames: number;
  sections: { id: string; from: number; duration: number }[] | null;
  /** For a reference: its signature was not checked (the agent has no key). */
  notes: string[];
}
```

- **A render** (`render-…`, matching `^[a-z0-9]+(-[a-z0-9]+)*$`):
  `output/<id>.mp4` and `output/<id>.report.json` must exist. The video's
  hash must equal the report's `render.hash` (`render-changed`). The timeline
  is `output/<id>.timeline.json` when it exists and its sha256 equals the
  report's `timeline.hash`; otherwise none (a note says alignment fell back to
  time). `fps` and `durationInFrames` come from that timeline, or from
  `ffprobe` (counting frames) when there is none; `width` and `height` always
  from the video, with a note when the timeline says otherwise.
- **A reference** (`reference:<tid>/<rid>`): the descriptor
  `templates/<tid>/references/<rid>.json` of this episode's series, read,
  shape-checked with `validateSeriesReference`, and naming this episode's
  channel and series; its episode is
  `episodes/<episodeRef.episode>/` of the same series. Its `render.path` and
  `timeline.path` (relative to that episode, confined to it) must hash as the
  descriptor says (`reference-changed`). Note: `signature not checked: run
  vpr reference verify for trust`.
- **The new version** defaults to the current render (`output/current.json`
  → its `renderId`); no current render is `no-render`.
- Unknown render id → `no-such-render`; a reference that does not exist or
  does not parse → `no-such-reference`; a bad ref string → `bad-version`.

### Instants and alignment — `alignInstants` (pure, `@studio/episode`)

```ts
interface ComparePick {
  index: number;
  label: string;                  // from sheetInstants, or "<t>s"
  section: string | null;         // the new version's section containing the frame
  newFrame: number;
  oldFrame: number | null;        // null when it cannot be mapped
  reason?: "beyond-old-section" | "new-section" | "missing-in-old";
}
alignInstants(newer: AlignSide, older: AlignSide, options?: { times?: number[]; shifts?: { from: number; by: number }[] }): ComparePick[]
// AlignSide = { fps, durationInFrames, sections: {id, from, duration}[] | null }
```

1. **The instants** are `sheetInstants(newer)` (its sections, or one section
   over the whole video; no series rules — the comparison is of what both
   videos show, not of the series' standard), or, with `times`, those
   seconds (`Math.round(t * fps)`, deduplicated, inside the video).
2. **Mapping**, for each new frame:
   - Both sides have sections: the new section containing the frame
     (`from ≤ f < from + duration`) and the offset `f - from`. The old
     section with the same id: `oldFrame = old.from + round(offset ×
     oldFps / newFps)`. No such section → `new-section`; the offset falls
     at or past the old section's end → `beyond-old-section`.
   - Otherwise: the time `t = f / newFps`, plus the `by` of every shift
     whose `from ≤ t` (seconds; shifts may be negative), then
     `oldFrame = round(t × oldFps)`.
   - `oldFrame` outside `[0, old.durationInFrames)` → `missing-in-old`.
3. Shifts are ignored when both sides have sections (a warning says so).

### Decoding and measuring — `@studio/episode`

- **Refusal first:** different `width`/`height` → `resolution-differs`.
- **Decoding:** one ffmpeg pass per video:
  `-vf "select='eq(n\,F1)+eq(n\,F2)+…',scale=iw/4:ih/4" -vsync 0`, written
  twice from the same pass — grey raw frames (`-pix_fmt gray -f rawvideo`,
  read in Node) and JPEG files (`-q:v 3`) for people. Frames are emitted in
  ascending order; the code maps them back to picks. A video that yields
  fewer frames than asked is `decode-failed`.
- **Measure (pure, Node):** for each mapped pair of grey buffers,
  `meanDiff` = mean |a − b| (0–255, one decimal) and `changedShare` = share
  of pixels with |a − b| > 16 (three decimals). A pair is **changed** when
  `meanDiff > threshold` (default `1.0`), when `changedShare ≥ 0.002`
  (`MIN_CHANGED_SHARE`: a word in a caption barely moves a whole frame's
  mean), or when it has a `reason`.
- **Shape (`structure`):** what no sampled frame can show. Aligning by
  sections: every old section absent from the new version (`removed`), every
  new one absent from the old (`added`), every common one whose length
  changed (`resized`, compared in time). Aligning by time: a difference in
  length (`length`, section `null`). The sheet's own warnings (instants
  dropped past 120) are passed on.
- **Sampling:** only the compared instants are seen — about 24, or the
  `times` asked; the reply says how many.
- **Pictures, changed pairs only:** `pairs/NNN.jpg` — old | new | difference
  side by side, the difference drawn by ffmpeg (`blend=all_mode=difference`
  then `eq` brightening, so small changes are visible); a missing side is
  black. `changed.jpg` — every changed pair stacked, in order. None when
  nothing changed.

### Verdict

- `expect`: section patterns (exact id, or prefix ending in `*`, as in the
  template's `sheet` rules).
- With `expect`: `ok` when every changed pair's section, and every change
  of shape's section, matches a pattern; otherwise `unexpected-changes`
  (`unexpected` and `unexpectedStructure` name them). A change with no
  section (no timelines) is unexpected. A pattern matching no change adds a
  warning (`block-3 was expected to change and did not`).
- Without `expect`: `listed`.

### The comparison — `compareVersions`

```ts
compareVersions(episodeDir: string, options: {
  episodeRef: EpisodeRef;
  old: VersionRef;
  new?: VersionRef;
  expect?: string[];
  threshold?: number;          // > 0, default 1.0
  times?: number[];
  shifts?: { from: number; by: number }[];
}): Promise<VersionComparison>
```

Writes `reviews/compare/<old>--<new>/` in this episode (a reference's ref is
written `reference_<tid>_<rid>`: `_` is in no id, so two refs never share a
name), through `reviews/compare/.<dir>.<pid>.<n>.tmp`
and a whole-directory swap, as the layout sheet does: a failure leaves a
previous comparison of the same pair as it was. `report.json`:

```json
{
  "createdAt": "…",
  "old": { "ref": "render-1700000000000-ab12cd34", "video": {…}, "timeline": {…} | null, "notes": [] },
  "new": { "ref": "render-1700000500000-ef56ab78", "video": {…}, "timeline": {…}, "notes": [] },
  "alignment": "sections" | "time",
  "threshold": 1,
  "shifts": [],
  "expect": ["block-3"],
  "verdict": "ok" | "unexpected-changes" | "listed",
  "structure": [{ "section": "block-1", "change": "removed", "oldFrames": 60, "newFrames": 0 }],
  "unexpectedStructure": [],
  "pairs": [{ "index": 0, "label": "first", "section": "intro", "newFrame": 0, "oldFrame": 0,
              "seconds": 0, "meanDiff": 0, "changedShare": 0, "changed": false }],
  "changed": [3, 4],
  "unexpected": [],
  "warnings": []
}
```

### Renders keep their timeline — `renderEpisode`

After the video is renamed into place and before the report, the exact
timeline text rendered is written to `output/<render-id>.timeline.json`
(atomically, as the report). Its sha256 is the report's `timeline.hash`. The
report gains `timeline.snapshot: "<render-id>.timeline.json"`. A failure
leaves `output/` as before (the render's files appear in order: video,
timeline, report, `current.json`).

### Agent — `pva_compare_versions`

- Parameters: `channel, series, episode, old, new?, expect?, threshold?,
  times?, shifts?` (`shifts` as `[{from, by}]` in seconds).
- Replies: the verdict and how many instants were compared; each change of
  shape (`block-1 removed (60 → 0 frames)`); each changed frame as
  `#NN · <seconds>s · <section> · diff <meanDiff> (<changedShare×100>%)`
  with its reason if any; the path of
  `changed.jpg` to open; notes and warnings. Errors reply with their code.
- Skill `skills/studio/compare-versions.md` (`0.1.0`): after a correction to
  a rendered episode, render the new version, compare it with the delivered
  one naming the sections the correction should touch, open `changed.jpg`,
  and report the verdict; `unexpected-changes` means the correction touched
  more than it should — undo or narrow it, never wave it through. Never
  compare against anything but the version the person received.

No `vpr` command: `@studio/runtime` does not depend on ffmpeg or on
`@studio/episode`.

### Documentation

ADR-0037 ("Corrections are proven by comparison"), `docs/running.md`, the
episode README, the agent's tool list.

## Error handling

| Situation | Outcome |
|---|---|
| Bad version string | `bad-version` |
| Render id not in `output/`, or no report | `no-such-render` |
| No current render for the default new version | `no-render` |
| Video differs from its report's hash | `render-changed` |
| Reference missing or not a reference | `no-such-reference` |
| Reference files differ from the descriptor | `reference-changed` |
| Resolutions differ | `resolution-differs` |
| ffmpeg fails or yields too few frames | `decode-failed`; nothing written |
| Threshold not a positive number, bad shifts or times | `bad-options` |

All are `CompareError { code, message }`; nothing is written before the
comparison has measured every pair.

## Testing

- `alignInstants` (unit): same sections → same frames; a section lengthened
  in the new version → later sections still aligned; a section shortened →
  `beyond-old-section`; a new section → `new-section`; no timelines with and
  without shifts (negative too); `missing-in-old`; different fps; `times`.
- Measure (unit): identical buffers → 0; one changed block → expected
  `meanDiff` and `changedShare`; threshold boundary.
- Verdict (unit): ok, unexpected, listed, expected-but-unchanged warning,
  sectionless change with `expect`.
- `compareVersions` (integration, real ffmpeg on small generated videos —
  ffmpeg is already required by the test suites): two identical renders → no
  change, `ok`; a render whose one section's picture changed → only that
  section's pairs changed, `ok` with `expect` of it and `unexpected-changes`
  without it in `expect`; a section lengthened → aligned by section;
  `render-changed`, `resolution-differs`, `no-such-render`; the swap keeps a
  previous comparison on failure; a reference as the old version.
- `renderEpisode`: the timeline snapshot exists, hashes as the report says,
  and is written before the report.
- Agent: `pva_compare_versions` registered (48 tools), its reply, an error
  reply; the skill is discovered.

## Out of scope

- A pipeline stage or gate for comparisons.
- Comparing audio.
- Reusing unchanged segments at render (the render cache does it already).
- Signature verification of a reference (the operator's `vpr reference verify`).
