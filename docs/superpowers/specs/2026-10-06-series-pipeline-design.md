# The series-production pipeline family

**Issue:** `avg-jao.4` — data-driven pipeline manifest family
**Epic:** `avg-jao` — data-driven series templates and series compilers (the `cs-port` plan)
**Builds on:** [series templates](../../adr/0037-series-templates-pin-editorial-standards.md) (ADR-0037); [series compiler](2026-10-06-series-compiler-design.md) (`avg-jao.2`); [series validators](2026-10-06-series-validators-design.md) (`avg-jao.3`); ADR-0001 (explicit inheritance), ADR-0015 (capabilities, not providers), ADR-0024 (canonical pipeline manifest), ADR-0025 (editorial and capability stages), ADR-0027 (the gateway never produces artifacts)
**Blocks:** `avg-dcf.2`, `avg-dcf.6`, `avg-dcf.7`
**Date:** 2026-10-06

## Problem

A spec-driven episode can be compiled, checked and rendered through the
agent's tools, but no pipeline knows those steps: the runtime cannot run a
series episode stage by stage, gate the spec or the timeline for a person's
review, or resume it. Nothing creates an episode's spec either:
`instantiateEpisodeSpec` exists in the contracts, unused. The stages the bead
lists (source → lines → spec → assets → takes → verify → timing → cue check →
timeline → sheet → review → render → QA → package) mostly depend on work not
done yet (`avg-dcf.2` source, `avg-8hs.*` takes, alignment and verification,
`avg-3th.1` sheet, `avg-3th.3` audit, `avg-3th.5` package).

## Decisions taken with the user

1. **The family with only what runs.** A base manifest `series-production`
   with the stages the studio can perform now; the others are inserted by
   their own issues as new versions of the base.
2. **Spec creation is in scope:** a tool `pva_init_spec` and a skill
   `fill-episode-spec`.
3. **A new workspace `@studio/episode`** holds the code that produces an
   episode on disk (build or compile, check, render, the narration manifest
   and scene images), moved unchanged from `studio/agent`; the agent's tools
   and the new stage adapters both import it.

## Design

### The base manifest — `studio/pipelines/pipelines/series-production.yaml` (1.0.0)

One manifest for every series with a template: the compiler and validator are
the ones the spec's pinned release names, not the pipeline's.

| Stage | Type | Inputs | Outputs | Performed by | Gates |
|---|---|---|---|---|---|
| `spec` | editorial | — | `episode-spec.json` | Pi: `pva_init_spec`, then skill `fill-episode-spec` | autopilot false, review human |
| `pictures` | editorial | `episode-spec.json` | `images/` | the person or Pi: the pictures the spec names, in `assets/images` | autopilot false, review human |
| `takes` | editorial | `episode-spec.json` | `takes.json` | the person or Pi: narration takes and their word timing, provided until `avg-8hs.*` | autopilot false, review human |
| `timeline` | editorial | `episode-spec.json`, `images/`, `takes.json` | `edit-timeline.json` | adapter `series-timeline` | autopilot true, review none |
| `check` | editorial | `edit-timeline.json` | `series-check.json` | adapter `series-check` | autopilot false, review human |
| `render` | capability `video.compose` | `edit-timeline.json`, `series-check.json` | `output.mp4` | adapter `series-render` | autopilot false, review human |

- Contract versions `1.0.0`; `capabilities: [video.compose 1.0.0]`;
  `retry_on_failure` 1 for derivations and render, 2 for editorial stages;
  `depends_on` follows the inputs. `render`'s budget: `wall_time: "15m"`,
  `tokens: 0`.
- `check` is the review gate before a render is spent. When `avg-3th.1`
  lands, a `sheet` stage goes between `check` and `render` in a new version of
  the base; `takes` becomes a capability stage with `avg-8hs.1`; and so on.
- The runtime's artifact discovery (`studio/runtime/src/artifacts/discovery.ts`)
  learns `episode-spec.json` → `episode-spec.json` (the episode root) and
  `takes.json` → `artifacts/narration/takes.json`. The others already resolve:
  `artifacts/edit-timeline.json`, `artifacts/series-check.json`,
  `assets/images`, `output/current.json`.

### A series-local manifest — the `poetry-short` example

`studio/pipelines/fixtures/valid/series-local/poetry-short.yaml`: `extends:
{ pipeline: series-production, version: "1.0.0" }` and replaces the `takes`
stage (same id, same contracts) with the poem's instructions ("one recital
take of the whole poem; word timing from forced alignment"). It is the
example `docs/pipelines.md` shows and the fixture the resolver test uses. Real
series manifests live in the library (`avg-dcf`).

### `@studio/episode` — `studio/episode`

TypeScript built with `tsc` to `dist/` (consumed through `dist/`, so in
`tools/build-required.mjs`), tests with vitest. Depends on
`@studio/contracts`, `@studio/series`, `@av/remotion-composer`. Imports
nothing from `studio/agent`, `studio/runtime` or `studio/adapters`.

- **Moved unchanged from `studio/agent/src`:** `narration-manifest.ts`,
  `scene-images.ts`, `edit-timeline-builder.ts`, `series-compile.ts`,
  `episode-render.ts`, with their tests (`narration-manifest.test.ts`,
  `scene-images.test.ts`, `edit-timeline-builder.test.ts`,
  `series-compile.test.ts`, the `spec-episode.ts` helper). Exported from
  `src/index.ts`. The agent imports them from `@studio/episode`; the tests
  that exercise the agent's tools stay in the agent and import the helper
  from `@studio/episode`'s exported test helper path
  (`@studio/episode/testing`, which exports `specEpisode`, `editSpec`,
  `sha256`).
- **New: `initEpisodeSpec(episodeDir, { episodeRef, template: { id, version } })`**
  → `{ ok: true, path, spec, placeholders } | { ok: false, problems }`:
  reads the release from the series (`seriesTemplatePath`, exact UTF-8 bytes
  of the manifest and its three files, realpath containment as the loader
  does), calls `instantiateEpisodeSpec`, writes `episode-spec.json`
  atomically. Problems: `spec-exists` (never overwrites), `missing-template`,
  `bad-template` (the bundle's own problems), `bad-version` (not an exact
  `x.y.z`). `placeholders` is `placeholderPaths(spec.data, "$.data")`.

### Stage adapters — `studio/adapters/src/adapters/series.ts`

`studio/adapters` gains a dependency on `@studio/episode`. Three adapters,
registered in the studio registry:

| Adapter | Capability | Provider | Consumes | Produces | Does |
|---|---|---|---|---|---|
| `series-timeline` | none (derivation) | `studio` | `episode-spec.json`, `images/`, `takes.json` | `edit-timeline.json` | `writeEditTimeline` |
| `series-check` | none (derivation) | `studio` | `edit-timeline.json` | `series-check.json` | `decideEditTimeline`, writes the report |
| `series-render` | `video.compose` | `remotion-composer` (`requires.system: ffmpeg`) | `edit-timeline.json`, `series-check.json` | `output.mp4` | `renderEpisode` |

- Each refuses an episode without `episode-spec.json` (`this pipeline needs
  an episode-spec.json; run the spec stage`) by throwing; a thrown error or
  problems fail the stage, with every located problem in the log.
- `series-check.json` (`artifacts/series-check.json`):
  `{ checkedAt, validator, decision: { rebuilt: string | null }, timeline: { path, hash }, findings }`.
  It is written even when there are errors — the reviewer needs it — and then
  the adapter throws so the stage fails.
- `series-render` refuses on errors exactly as the tool does (it calls
  `renderEpisode`) and returns the rendered file's path.
- Signatures are unique: no existing adapter produces `edit-timeline.json`,
  `series-check.json`, or serves `video.compose`. The existing pipelines'
  compose stages declare other inputs, so `series-render` never matches them.

### Agent

- Imports moved modules from `@studio/episode`; behaviour unchanged.
- **`pva_init_spec { channel, series, episode, template, version }`**: calls
  `initEpisodeSpec`; replies with the path, the pin (`template id@version`,
  hash) and every placeholder to fill; a problem is a tool error. Queued on
  `episode-spec.json` with `withFileMutationQueue`.
- Tool count 44 → 45; `docs/running.md` lists it.

### Skill — `skills/studio/fill-episode-spec.md` (0.1.0)

Front matter like the others (`name`, `version`, `description`, `inputs`:
the release's `FORMAT.md`, schema and template; `outputs`: `episode-spec.json`).
Body: create the draft with `pva_init_spec` (an existing spec is never
replaced), read `FORMAT.md` (the standard and procedure) and the schema,
replace every `__FILL__` with a value of the right type (a number where the
schema says number), never change a value the schema fixes (`const`, the
style), never change or copy the release, raise `revision` for every edit
after approval, then run `pva_check_episode` — `unfilled` and schema problems
come first — and hand the spec to the person at the stage's review gate. The
skill passes `studio/pipelines/lint/validate-skill.js` and is synced like the
others.

### Docs

- `compose.config.json`: component `episode` (`studio/episode`, not
  standalone) in the profiles that hold the agent; generated page; README and
  `docs/index.md` rows.
- `docs/pipelines.md`: "The series-production family" — the stages, what
  performs each, how a series extends it (the `poetry-short` example), and
  which stages future issues insert.
- ADR-0037: a line under Consequences — the pipeline family is
  `series-production` (`avg-jao.4`).
- `skills/studio/compose-video.md` (0.5.0): a spec is created with
  `pva_init_spec` and filled with `fill-episode-spec`.

## Testing

- **`@studio/episode`**: the moved tests pass with only their imports
  changed; `initEpisodeSpec` writes a draft pinned to the exact release (hash
  of the manifest bytes) with its placeholders listed, refuses an existing
  spec (the file byte-identical after), a missing release, a version that is
  not exact, a release edited in place; the draft, once filled with the
  golden fixture's data, compiles.
- **Adapters** (vitest, temporary episodes from the fixture, `renderTimeline`
  faked): the registry accepts all adapters; each new adapter matches its
  `series-production` stage and no stage of the existing pipelines;
  `series-timeline` writes the timeline and fails on a spec whose video is
  too short (`duration-range`); `series-check` writes the report, and on a
  hand edit that rewrites a caption writes it with `text-not-voice` and fails;
  `series-render` renders and fails on series errors without writing
  `output/`; each fails on an episode without a spec.
- **Pipelines**: `series-production.yaml` passes `check:pipelines`; the
  runtime resolver resolves it with no `UNMET_ARTIFACT`/ordering errors, and
  resolves the `poetry-short` fixture with `takes` replaced; discovery finds
  `episode-spec.json` and `takes.json`.
- **Agent**: `pva_init_spec` writes the draft and lists the placeholders,
  refuses an existing spec; the tool list is 45; every existing test passes.
- **Skill**: `validate-skill.js` and the skills sync check.
- End to end (`REMOTION_E2E=1`): the existing renders. Root `npm run check`,
  `npm run docs:build`.

## Out of scope

The stages that depend on unfinished work (source, verify, timing as a
capability, sheet, QA, package); real series manifests and templates
(`avg-dcf`); golden references (`avg-jao.6`); a web UI for the spec.
