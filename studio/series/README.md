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
`compileEpisode` in `@studio/episode` (`studio/episode/src/series-compile.ts`), which also decides
the asset ids (`image-<name>` for `assets/images/<name>.<ext>`,
`sound-<name>` for `assets/sounds/<name>.<ext>`, `narration-<take>` for each
take's audio, `theme-<room>` for the rooms of the channel theme the release
pins). With a pinned theme, `input.theme` is the `ChannelTheme` (ADR-0040):
a compiler passes its `look` and characters through to channel-neutral kits
untouched; `test/theme-alignment.test.ts` holds the contract and the kits'
props schemas together. A timeline the validators refuse
comes back with problem codes prefixed `timeline:` — a compiler bug, not bad
input.

## Compilers

| Compiler | What it makes |
|---|---|
| `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |
| `dentro-i-versi-short@1.0.0` | Dentro i versi · short (CreativeStudio's `sala8`): the `recital` unit — the title take, then the poem — from 0.3 s; the video lasts until 6 s after `voiceEndWord`. From the spec's data and the measured words it computes the camera's breathing, pushes and shakes, lightning at each picture change, lights, wind, shatter, blackout, the actor's poses, expressions, gazes, blinks, mouth (from the voice's energy), live and bow windows, and the title card's fit; it lays out the museum kits (`museum-hall`, `room-effect`, `verse-plate`, `interprete`, `lower-third`, `title-chip`, `brand-mark`), the sounds, applause and music. Times are seconds or `verse:N`, `verseEnd:N`, `word:parola`, `end`, `picture:N`, ± seconds. Items that overlap go on separate lanes (`verses-1`, `verses-2`, `room-1`…, `sfx-1`…). Sections: `title`, `verse-N`, `bow`. |
| `dentro-i-versi-short@1.1.0` | 1.0.0 with its loop declared (`avg-z7f`): the timeline says `loop: true`, so the render audit checks that the last frame is the first — the empty hall with the title, the opening picture back for the bow. Everything else as 1.0.0. |
| `dentro-i-versi-long@1.0.0` | Dentro i versi · long (CreativeStudio's `poesie-museo-long`, runtime v10): the lesson's blocks in order — `opening` (the atrio, the cover, the warp into the hall), `announcement`, `recital` (the pinned source's takes; `annotated` adds each verse's figure), `story`, `note`, `specimen` (one figure tool per painting), `meter`, `invite`, `summary`, `end` — each lasting its guide take (0.4 s before, 0.6 s after) plus its gap, with a 4 s chapter card after `chapterAfter`. Every time in a block is a cue: seconds, `end`, or `{word, n?, offset?}` on its take (elided words found: «L'Italia» answers `italia`); a cue that finds nothing stops with `cue-not-found`. The look, rooms and characters are the pinned theme's; the paintings and recitals are `source-<pin>-…` from the pinned source episode. Draws the channel-neutral lesson kits; the last frame is the first (`loop: true`). Sections: `block-<id>`, `chapter-N`. |
| `dentro-i-versi-long@1.1.0` | 1.0.0, from the lesson's first real layout sheet (`avg-dcf.6.9`): the panel's box is the theme's `layout.panel` (1.0.0's without one); writing stays on the glass — a text stack (story texts, a note's counts, the quote's title) off the panel stops with `text-off-panel`, fixed in the data, never clamped; the note's tracks and counts get the glass behind them; headlines and the annotated recital's figure titles sit in the panel's lower band, clear of the painting's subject; the guide stands at x 1650 (1700 in 1.0.0), so a wide pose keeps its hand in the frame. |

## Validators

A template release may also name a **validator**: the series' mechanical
rules, checked on the timeline about to be rendered — hand edits included —
against what the compiler makes of the same inputs.

```ts
import { checkSeries } from "@studio/series";

const { validator, findings } = checkSeries({ ...input, timeline, compiled });
// findings: [{ code, severity: "error" | "warning", path, message }]
```

| Validator | Rules |
|---|---|
| `poetry-short@1.0.0` | Errors: a track missing, `profile-changed`, `fps-changed`, `duration-range` (10–60 s), `extra-track`, `hidden-track`, `stacking-changed`, `forbidden-kit`, `forbidden-transition` (only a 12-frame crossfade in), `altered-voice` (takes never cut, moved or reworked), `asset-changed` (no picture or take swapped, added or removed by hand), `text-not-voice` (the captions say exactly what the compiler captioned from the voice), `missing-picture`, `uncovered-frames`. Warnings: `panel-flash` (under 1 s), `panel-long` (over 7 s), `caption-long` (over 42 characters). |
| `dentro-i-versi-short@1.0.0` | Errors: `profile-changed`, `fps-changed`, `duration-range` (25–90 s), `hidden-track`, `forbidden-kit` (only the seven museum kits at 1.0.0), `verse-text` (a plate that is not a verse of the spec), `missing-verse` (counted), `missing-actor`, `missing-teleport` and `loop-broken` (the first and last frame are the empty hall), `altered-voice` (takes, and the voice track's gain and ducking). Warnings: `apparitions` (not 2), `apparition-short` (under 5 s), `title-pause` (not 0.8–1.4 s between the title and the poem). |
| `dentro-i-versi-long@1.0.0` | Errors: `profile-changed`, `loop-broken`, `duration` (240–600 s), `unknown-kit` (only the lesson kits at their versions), `look-changed` (every kit in the theme's look), `voice-missing` and `voice-changed` (the guide's and the source's voices untouched), `missing-teleport` (the guide arrives at the opening and leaves at the exit). Warnings: `chapters` (not 5), `specimen-without-tool`, `no-theme-sound`. |

Like compilers, validators are pure, one file per version
(`src/validators/<id>/<version>.ts`, registered in `src/validators.ts`, the
same import rule), and frozen: `fixtures/validators/<id>/<version>/cases.json`
lists edits of a compiler fixture's golden timeline (`set`, and `setInput`
for the compile input) with the exact findings — code, severity, path, in
order. `test/validators-golden.test.ts` holds every version to them; a new
rule is a new version, never a changed case.

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
