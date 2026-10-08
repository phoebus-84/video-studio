# @studio/episode

An episode on disk, produced (ADR-0036, ADR-0037): its narration manifest and
scene images, its edit timeline — built from its material, or compiled from
its `episode-spec.json` by its series template's compiler — checked against its
series' rules, shown on a layout sheet and rendered with `@av/remotion-composer`.

The agent's tools (`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`,
`pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, `pva_align_take`, the narration tools) and the `series-production` stage
adapters both call this package, so a tool and a stage never disagree.

## What it offers

| Module | |
|---|---|
| `narration-manifest.ts` | The canonical `artifacts/narration/narration-manifest.json`: build, measure, validate, write |
| `scene-images.ts` | Scene images in reading order and their lengths (legacy episodes) |
| `edit-timeline-builder.ts` | `buildEditTimeline`: the timeline of an episode without a spec |
| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules; offers `assets/images/*` as `image-<name>` and `assets/sounds/*` as `sound-<name>`; reads the channel theme the release pins (ADR-0040), every file inside that release, and offers its rooms as `theme-<room>`; reads the episodes it pins (`source/pins/<id>.json`, ADR-0035), held to each pin's inventory (`pin-mismatch`), and offers their pictures as `source-<pin>-image-<name>`, their takes as `source-<pin>-narration-<take>` and their takes and timings as `sources`; `sharedRootsOf`: that theme release and the pinned episodes, which renders and layout sheets may take assets from |
| `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
| `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |
| `references.ts` | `proposeReference`: freeze an episode as a proposed golden reference |
| `sheet-instants.ts` | `sheetInstants`: the frames a layout sheet shows, from the timeline and the release's `sheet` rules (pure) |
| `layout-sheet.ts` | `makeLayoutSheet`, `layoutSheetStatus`: `artifacts/layout-sheet/`, and whether it still shows what a render would use |
| `version-diff.ts` | `alignInstants`, `measure`, `judge`: which frames two versions compare, how different they are, the verdict (pure) |
| `speech-align.ts` | `mapToText`, `snapToSilences`, `measureSilences`, `measureEnergy`: a provider's words made into a take's words, and the take's energy (ADR-0038) |
| `take-align.ts` | `alignTake`: a take's WordTiming by forced alignment, local or ElevenLabs, written beside it and named in `takes.json` |
| `version-compare.ts` | `compareVersions`: two renders, or a render and a golden reference, decoded with ffmpeg at the same instants, into `reviews/compare/<old>--<new>/` |

`@studio/episode/testing` exports `specEpisode`, `editSpec` and `sha256`: a
complete poetry-short episode on disk, from `@studio/series`'s golden fixture,
for tests.

## Commands

```
npm run build       # tsc to dist/ (the agent and the adapters import it from there)
npm run typecheck
npm test            # vitest; the version comparison tests need ffmpeg and ffprobe on PATH
REMOTION_E2E=1 npm test   # also one real layout sheet (build @av/remotion-composer first)
```
