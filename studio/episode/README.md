# @studio/episode

An episode on disk, produced (ADR-0036, ADR-0037): its narration manifest and
scene images, its edit timeline — built from its material, or compiled from
its `episode-spec.json` by its series template's compiler — checked against its
series' rules, and rendered with `@av/remotion-composer`.

The agent's tools (`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`,
`pva_compose_video`, the narration tools) and the `series-production` stage
adapters both call this package, so a tool and a stage never disagree.

## What it offers

| Module | |
|---|---|
| `narration-manifest.ts` | The canonical `artifacts/narration/narration-manifest.json`: build, measure, validate, write |
| `scene-images.ts` | Scene images in reading order and their lengths (legacy episodes) |
| `edit-timeline-builder.ts` | `buildEditTimeline`: the timeline of an episode without a spec |
| `series-compile.ts` | `loadEpisode`, `compileEpisode`, `checkEpisode`: a spec-driven episode, read, checked, compiled, held to its series' rules |
| `episode-render.ts` | `writeEditTimeline`, `decideEditTimeline`, `currentEditTimeline`, `renderEpisode` |
| `spec-init.ts` | `initEpisodeSpec`: a draft spec pinned to an exact template release; never replaces one |

`@studio/episode/testing` exports `specEpisode`, `editSpec` and `sha256`: a
complete poetry-short episode on disk, from `@studio/series`'s golden fixture,
for tests.

## Commands

```
npm run build       # tsc to dist/ (the agent and the adapters import it from there)
npm run typecheck
npm test            # vitest
```
