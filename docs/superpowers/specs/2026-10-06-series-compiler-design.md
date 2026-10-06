# Series compiler: episode spec and timing to edit timeline

**Issue:** `avg-jao.2` — series compiler: spec + timing → edit timeline
**Epic:** `avg-jao` — data-driven series templates and series compilers (the `cs-port` plan)
**Builds on:** [series templates](../../adr/0037-series-templates-pin-editorial-standards.md) (ADR-0037, `avg-jao.1`); [cues](2026-10-05-cues-design.md) (`avg-7zp.2`); [narration takes](2026-10-05-narration-takes-design.md) (`avg-7zp.4`); [edit timeline v2](2026-10-05-edit-timeline-v2-design.md) (ADR-0034); [timeline cutover](2026-10-06-timeline-cutover-design.md) (ADR-0036, `avg-tk7.6`)
**Closes also:** `avg-lho.1` (fill the compiler seat)
**Blocks:** `avg-jao.4` (pipeline manifest family)
**Reference:** CreativeStudio `formats/poesie-museo-long/timeline.py`, `cues.py` (read only)
**Date:** 2026-10-06

## Problem

ADR-0037 gives a series a pinned template release whose manifest names a
`compiler: { id, version }`, and an episode an `EpisodeSpec` pinned to that
release. Nothing resolves that name, and nothing turns a spec plus the
measured narration into an edit timeline. The studio's only timeline
producer is tk7.6's `buildEditTimeline`, which reads scene images and a
narration manifest and knows nothing about specs, cues or templates.

## Decisions taken with the user

1. **The compiler seat plus one real compiler, for the contract's example
   template `poetry-short@1.0.0`.** It uses only the kits that exist
   (`still`, `captions`), proving the chain end to end. The real "Dentro i
   versi" compilers come with their kits (`avg-dcf`).
2. **A released compiler version is frozen by a golden output.** A fixture
   (spec, release, takes, timing, asset hashes) must compile to a
   byte-identical timeline. A behaviour change — including one coming from a
   shared contract helper — is a new version file. No file-hash lock.
3. **A new workspace `studio/series`, pure compilers, a loader in the
   agent.** Compilers read no files; the agent's loader reads, checks and
   hashes everything and hands it over.
4. **jao.2 ends at "valid spec + takes → timeline".** Creating or filling a
   spec, series validators, golden references and pipeline stages are
   `avg-jao.3` and `avg-jao.4`.

## Design

### Workspace — `studio/series` (`@studio/series` 0.1.0)

Depends on `@studio/contracts` and `@av/remotion-composer` (for
`validateTimeline`), both `workspace:*`; exports `.` (from `dist/`) and
`./fixtures/*` (so the agent's tests can build an episode from the golden
fixture). TypeScript built with `tsc` to `dist/`
(the agent consumes it there, like `@av/remotion-composer`), tests with
`node --import tsx --test`; joins the root workspaces and
`tools/build-required.mjs`. Imports nothing from `studio/agent` or
`studio/runtime`.

```
src/
  types.ts                      CompileInput, CompileResult, SeriesCompiler, CompileProblem
  registry.ts                   COMPILERS, resolveCompiler, listCompilers
  compile.ts                    compileSpec(input): dispatch + both timeline validators
  compilers/poetry-short/1.0.0.ts
  index.ts
scripts/golden.ts               writes a new version's expected-timeline.json, never overwrites
fixtures/poetry-short/1.0.0/    input.json (a whole CompileInput) and expected-timeline.json
test/
```

A version file may import `@studio/contracts` helpers (`resolveCues`,
`layoutUnit`, `outputProfile`) and `../../types.js`; it keeps its own
helpers (caption grouping, crossfades) inside the file, so editing a helper
for a later version cannot reach it. The golden test is what catches a
change in a contract helper.

### Interface (`src/types.ts`)

```ts
interface CompileInput {
  spec: EpisodeSpec;                     // already passed validateEpisodeSpec
  template: SeriesTemplate;              // the pinned release's manifest
  narration: NarrationTakes;             // artifacts/narration/takes.json, valid
  timings: Record<string, WordTiming>;   // take id → valid WordTiming (audio hash checked)
  assets: Record<string, { path: string; hash: string; kind: "image" | "audio" }>;
                                         // id → file relative to the episode
  inputs: Record<string, string>;        // relative path → "sha256:…" of every file read
}
interface CompileProblem { code: string; message: string; path: string }
type CompileResult =
  | { ok: true; timeline: EditTimeline; warnings: string[] }
  | { ok: false; problems: CompileProblem[] };
interface SeriesCompiler {
  id: string;                            // ^[a-z0-9]+(-[a-z0-9]+)*$
  version: string;                       // x.y.z
  description: string;
  compile(input: CompileInput): CompileResult;
}
```

Asset ids the loader produces: `image-<assetId>` for `assets/images/<assetId>.<ext>`,
`narration-<take>` for each take's audio.

- `resolveCompiler(id, version)` → the exact compiler or `undefined`.
- `listCompilers()` → `[{ id, version, description }]`, sorted.
- `compileSpec(input)`:
  - `unknown-compiler` (path `$.template.compiler`) when the manifest names
    a compiler not registered, listing the available versions of that id
    (`poetry-short@2.0.0: available poetry-short@1.0.0`);
  - otherwise calls it; a successful result must pass the contracts'
    `validateEditTimeline` and the composer's `validateTimeline`, whose
    problems are returned (codes prefixed `timeline:` so a compiler bug is
    distinguishable from bad input).

Compilers are deterministic: no clock, no randomness, no environment,
object keys written in a fixed order.

### The `poetry-short@1.0.0` compiler

The spec's data (from the fixture schema): `title`, `narration`,
`holdSeconds`, `panels[{ assetId, cue }]`, `style { fontFamily, captionKit,
voiceProfile, outputProfile }`.

- **Clock and profile:** fps 30. `profile` is the catalog's
  `outputProfile(style.outputProfile)` copied whole; `resolution` from it.
  Not in the catalog: `unknown-profile` (path `$.data.style.outputProfile`).
- **Narration:** the unit `narration` of `takes.json`, laid out with
  `layoutUnit`; missing unit: `missing-unit` (path `$.units`). The unit
  starts at frame 0. The takes' written `text`, joined by single spaces in
  sequence order, must equal `data.narration` (whitespace collapsed);
  otherwise `narration-mismatch` (path `$.data.narration`). Each
  `LayoutPiece` becomes an item on audio track `voice`: `from` =
  round(at × 30), `duration` = round(duration × 30), `trimStart` =
  round(from × 30) (omitted when 0), asset `narration-<take>`, item `source`
  `narration`. `layoutUnit` problems are returned with their paths.
- **Duration:** `durationInFrames` = ceil((unit duration + `holdSeconds`) × 30),
  computed with a 10⁻⁶ tolerance so 7.5 s is 225 frames, not 226, and never
  less than the end of the last voice item.
- **Panels:** every `panels[i].cue` is resolved by `resolveCues` against the
  unit's timing (`startSeconds` 0, fps 30); its problems carry the path
  `$.data.panels[i].cue`. Cue frames must be strictly increasing:
  `cue-order` (path of the first offending cue). A panel cued at or after
  the end of the video is `cue-after-end` — unreachable with this template's
  word-only cues, but a compiler does not re-validate its input. Panel i covers
  [cue_i, cue_{i+1}); the first panel starts at frame 0 whatever its cue
  (the cue must still resolve); the last runs to the end. Each panel is a
  `still@1.0.0` item on visual track `panels` (z 0), props
  `{ src: { $asset: "image-<assetId>" }, fit: "cover" }`, `source`
  `panels[i]`. An `assetId` the loader did not find: `missing-asset` (path
  `$.data.panels[i].assetId`).
- **Crossfades:** 12 frames centred on each boundary — the incoming panel
  starts 6 frames early with `transitionIn: { type: "crossfade",
  duration: 12 }`, the outgoing one ends 6 frames late. A panel shorter
  than 13 frames gets none on either side (as tk7.6).
- **Captions:** from the unit's words, in order. A group closes after a
  word ending in `. ! ? ; :`, or before a word that would take it past 42
  characters (words joined by spaces). A cue runs from its first word's
  `start` to its last word's `end`, in frames, trimmed so it ends no later
  than the next cue starts; an empty cue is dropped with a warning. Each is
  an item of kit `style.captionKit` on visual track `captions` (z 10),
  props `{ text, position: "bottom", font: style.fontFamily }`, `source`
  `narration`.
- **Section:** one section `poem` covering the whole timeline, `source`
  `title`, `chapter: { title: data.title }` — the only place the title goes;
  there is no title kit yet.
- **Provenance:** `episodeRef` from the spec, `revision` 1,
  `derivedFrom: { spec: { path: "episode-spec.json", hash: inputs["episode-spec.json"], revision: spec.revision }, compiler: { id, version } }`,
  `metadata: { builtBy: "@studio/series poetry-short@1.0.0", template: spec.template, inputs }`.

### Loader — `compileEpisode(episodeDir, { episodeRef })` (`studio/agent/src/series-compile.ts`)

The only code that touches files. Each step stops with problems located as
`<file relative to the episode>#<JSON path>` (e.g.
`episode-spec.json#$.data.panels[1].cue`,
`artifacts/narration/takes.json#$.takes[1].audio.hash`); the compiler's own
paths are mapped to the file they point into. `isSpecDriven(episodeDir)`
tells whether `episode-spec.json` exists.

1. Read `episode-spec.json` as bytes; not JSON: `bad-spec`. Its
   `episodeRef` must be this episode, field by field: `episode-mismatch`,
   reported before the template is looked up.
2. The series directory from the episode's location; the release
   `seriesTemplatePath(…, spec.template.id, spec.template.version)`; absent:
   `missing-template`. Read the manifest and its three files as exact
   UTF-8 text into a `SeriesTemplateBundle`; `validateTemplateBundle`, then
   `validateEpisodeSpec(spec, bundle)` (exact pin, no `__FILL__`, data
   schema). Every path is resolved with `realpath` and must stay inside the
   series (templates) or the episode (everything else): `path-escape`.
3. `artifacts/narration/takes.json`: absent `missing-narration`;
   `validateNarrationTakes`. For each take: its audio and its `timing` file
   exist and hash as declared (`hash-mismatch`), and the timing passes
   `validateWordTiming(…, { audioHash })` (`bad-timing` when not JSON). A
   path that names a directory is `not-a-file`. A
   take without `timing`: `missing-timing`. A take path that is absolute or
   climbs out: `path-escape`.
4. Images: every `.png`, `.jpg`, `.jpeg`, `.webp` in `assets/images` (hidden
   files and other files ignored) is offered as `image-<name>`; the compiler
   decides which it needs, and reports a missing one (`missing-asset`). Two
   files with one name is `ambiguous-asset`. The loader stays independent of
   any spec's shape.
5. Hash every file read into `inputs` (spec, manifest, three release files,
   `takes.json`, timings, audio, images).
6. `compileSpec(input)`.

Returns `{ ok: true, timeline, warnings, compiler: "<id>@<version>", template, revision }`
or `{ ok: false, problems }`. No file is written here.

### Tools

- **`pva_build_timeline`**: an episode with `episode-spec.json` goes through
  `compileEpisode`; without one, tk7.6's `buildEditTimeline` as today. A
  spec that fails is a tool error listing the problems — never a fallback to
  the legacy builder. The picture count in the reply names the lowest visual
  track (`2 scenes`, `3 panels`). The reply adds the compiler, the template pin and the
  spec revision. Writing stays atomic.
- **`profile`**: for a spec-driven episode the template sets it; a
  different `profile` argument is the error `profile-fixed-by-template`, the
  same one is accepted.
- **`pva_compose_video`**: the rebuild decision is tk7.6's, driven by
  `metadata.inputs`, which for a spec-driven timeline lists the spec, the
  release files, `takes.json`, timings, audio and images. Editing the spec
  rebuilds and names it; a hand-edited timeline whose inputs did not change
  renders as it is (ADR-0036). Unlike a legacy episode, a spec-driven one
  whose spec no longer compiles is an error even when a valid timeline from
  before is on disk: the spec is the editor's intent, and rendering the
  timeline it replaced would ignore it.
- The render report and both replies name the compiler, the template pin and
  the spec revision (`compiledBy`); when the timeline rendered as it stands
  differs from what the compiler makes of the same inputs, `editedByHand` is
  true and the reply says "then edited by hand".

### Docs

- ADR-0037 status: compiler seat implemented (`@studio/series`), first
  compiler `poetry-short@1.0.0`.
- ADR-0036 gains a note: two timeline producers, chosen by the presence of
  `episode-spec.json`.
- `studio/series/README.md` with "Adding a compiler or a version" (the
  version file, its import rule, the golden fixture, never edit a released
  version); `docs/` regenerated; `skills/studio/compose-video.md` gains a
  paragraph on spec-driven episodes. The contract fixture under
  `studio/contracts/fixtures/series-template/` is not edited (its hashes
  are pinned by the contract tests); the golden fixture in `studio/series`
  is its own copy of that release, plus takes, timing and asset hashes.

## Testing

- **`@studio/series`** (`node:test`), also in the CI module matrix:
  - golden: `fixtures/poetry-short/1.0.0/` compiles to
    `expected-timeline.json` byte for byte (canonical JSON, two-space
    indent); the failure message says to add a new version;
  - panels on their cues with centred crossfades; first panel from 0; last
    panel held for `holdSeconds`; no crossfade around a short panel;
    captions grouped by punctuation and by 42 characters and trimmed;
    voice pieces honour pauses and holds; the profile copied whole;
    `derivedFrom` and item `source` set;
  - problems: `narration-mismatch`, `cue-order`, an unknown word at
    `$.data.panels[1].cue`, `missing-asset`, `unknown-profile`,
    `missing-unit`, a `layoutUnit` problem with its path, `unknown-compiler`
    with the available list; two panels sharing a picture;
  - the result passes both timeline validators; determinism (two runs equal).
- **Loader** (vitest, temporary series and episodes built from the
  fixture): a complete episode compiles; `missing-template`; a release
  file edited in place; a spec still holding `__FILL__`; a missing timing;
  a timing for another audio hash; `ambiguous-asset`; a symlink leaving the
  episode and a take path climbing out (`path-escape`); a spec for another
  episode; hidden and non-picture files ignored.
- **Tools** (vitest, fake renderer as tk7.6): spec present → compiler, absent
  → legacy builder; a failing spec gives an error and writes nothing;
  `profile-fixed-by-template`; editing the spec rebuilds naming it; a
  hand-edited spec-driven timeline is rendered, not overwritten; a spec
  that stops compiling is an error even with a valid older timeline; the
  report records `compiledBy`.
- **End to end** (`REMOTION_E2E=1`): the fixture episode with a real WAV
  renders 1080×1920 within ±1 LU of −14 LUFS, captions visible in a frame.
- Root: `npm run check` (with `check-boundaries` and `build-required`),
  `npm run docs:build`.

## Out of scope

Creating and filling specs (a tool or stage: `avg-jao.4`); series validators,
golden-reference promotion and trust (`avg-jao.3`); version comparison
(`avg-jao.5`); "Dentro i versi" compilers and kits (`avg-dcf`); reading the
output profile from settings (`avg-e7w`); a title kit.
