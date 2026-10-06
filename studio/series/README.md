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
`narration-<take>` for each take's audio). A timeline the validators refuse
comes back with problem codes prefixed `timeline:` — a compiler bug, not bad
input.

## Compilers

| Compiler | What it makes |
|---|---|
| `poetry-short@1.0.0` | A vertical poem: pictures changing on cued words (`still@1.0.0`, `fit: cover`, 12-frame crossfades centred on each cue), the `narration` unit of `takes.json` on the voice track, captions grouped from the measured words (at `. ! ? ; :` and before 42 characters), `holdSeconds` of picture after the voice, the title as the chapter of one section. |

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
