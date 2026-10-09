---
name: author-series
version: "0.1.0"
description: Decide what kind of product a person wants; for a spec-driven series, write everything it needs in its channel's library (template release, compiler, validator, kits, fixtures, its own skill), seal and verify it; other products go to their own pipelines and skills
inputs:
  - name: request
    type: string
    description: What the person wants to make, in their words; examples or references they gave
outputs:
  - library/<channel>/series/<series>/:
      kind: directory
      description: The series and its first sealed template release, its kits, fixtures and series-local skill, committed in the channel's repository
capabilities:
  - llm
---

# Author a Series

The application knows how to compile, check, draw and render. It knows nothing
about any particular channel or series. **Everything particular to a channel
or a series lives in that channel's library**, in its own git repository:
- its format: the template release, `FORMAT.md`, the episode schema;
- its code: the compiler, the validator and the kits;
- its look: the theme;
- its procedures: series-local skills.

Never add a channel's or a series' code or rules to `studio/` or `packages/`.
If something generic is missing from the application, say so and stop. Don't
work around it inside the application.

## 1. First, which kind of product?

Ask until you know. Don't assume Remotion or a series.

| The person wants… | It is | Go to |
|---|---|---|
| Many episodes in one fixed format, where only the content changes (a poem a week, a fact a day) | **a spec-driven series** | this skill, section 2 on |
| One narrated, illustrated video | a one-off | the `narrated-illustrated-video` pipeline; skills `write-brief`, `write-script`, `narration`, `compose-video` |
| 3D shots or an animation | Blender | the `blender-animation` pipeline; skill `blender-scene` |
| A video about a code repository, terminal demos | docs | the `repository-documentation` pipeline; skills `repo-analysis`, `vhs-terminal-recording` |
| A fairy tale adapted for an audience | adaptation | the `fairy-tale-adaptation` pipeline; skill `fairy-tale-ingest` |

A recurring product that isn't drawn as an edit timeline, such as a weekly
Blender short, is still a series, but not a spec-driven one. Create the series,
declare its pipeline in the series' `pipeline.yaml`, and write its procedure as
a series-local skill, as in step 3.10. Skip the template release.

Commands below run from the repository root. `vpr` is
`node studio/runtime/dist/src/cli.js`, and every command takes
`--library "$PWD/library"` unless `AVG_LIBRARY_ROOT` is set.

## 2. The shape of a spec-driven series

```
library/<channel>/                        its own git repository (vpr channel init)
  themes/<theme>/<x.y.z>/theme.json       the channel's look, sealed (optional)
  kits/<kit>/<x.y.z>/kit/index.tsx        kits every series of the channel may use
  series/<series>/
    series.json, pipeline.yaml            pipeline: series-production
    skills/<series>-episode.md            how to make one episode of THIS series
    kits/<kit>/<x.y.z>/kit/index.tsx      kits only this series uses
    templates/<template-id>/<x.y.z>/      a release: immutable once an episode pins it
      series-template.json                manifest: compiler, validator, kits, theme, sheet, hashes
      episode-spec.schema.json            what an episode may say, and what it must not
      episode-spec.template.json          the draft, with __FILL__ where content goes
      FORMAT.md                           the standard and the procedure, for people and for you
      compiler/index.ts                   spec + takes + timings + assets -> edit timeline
      validator/index.ts                  the series' rules on a timeline
      fixtures/<name>/input.json          real episodes held as tests
      fixtures/<name>/expected-timeline.json
    episodes/<episode>/                   episode-spec.json pins one exact release
```

**Everything above is specific to the series.** What the application lends
is listed here:
- **`series-production`**: the pipeline (spec → takes → timeline → sheet → render);
- **the types**: `import type {…} from "@studio/series"`;
- **the toolbox**: `@studio/series/toolbox/1.0.0`, with `frames`, `round3`,
  `tokens`, `normalizeWord`, `noise`, `lanes`, `findWord`, `kitsOf`, `problem`
  and `isObject`;
- **contract helpers**: `@studio/contracts/src/output-profiles.mjs`,
  `cues.mjs` and `narration-takes.mjs`;
- **the application's kits** (captions and others), and its kit libraries:
  `@av/remotion-composer/kits/lib/<lib>/<version>`, among them `fonts`,
  `font-metrics`, `stage-math`, `stage-props` and `look`.

## 3. Procedure

1. **Agree the format with the person, in writing.** Draft `FORMAT.md` first.
   - **Standard:** language, frame size and fps, duration range, structure,
     look, voices, what never changes.
   - **Procedure:** how an episode is made, step by step.

   Every "fixed" in it becomes a `const` in the schema or a rule in the
   validator. Every "depends on the episode" becomes a field to fill. Get the
   person's yes before writing code.
2. **The channel and the series.**
   - Create them with `pva_create_channel` (if new) and `pva_create_series`,
     with `pipelineYaml: "pipeline: series-production"`.
   - Make the channel a repository: `vpr channel init <channel> --commit`.
   - If it needs its own look, write `themes/<theme>/1.0.0/theme.json` and
     its files, then `vpr theme seal <channel>/<theme>/1.0.0`.
3. **The release `templates/<id>/1.0.0/`.** Start from a release that works.
   - **To copy:**
     - `studio/series/fixtures/release-code/poetry-short/` holds the compiler
       and the validator;
     - `studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/`
       holds the manifest, the schema, the template and `FORMAT.md`.
   - **Then rename and rewrite.** Rename every id to yours. Rewrite them for
     your format.
   - **The manifest.** In `series-template.json`:
     - `id` and `version` match the folder;
     - `compiler` and `validator` are `{"id": "<id>", "version": "1.0.0"}`,
       with no `bundle`;
     - `files` name the schema, the template and `FORMAT.md`, with any hash
       (sealing writes the real ones);
     - optionally `theme` (`{id, version, hash}` from `theme seal`), `kits`
       and `sheet.instants` (the moments the layout sheet must show).
   - **The schema.** It says, field by field, the content an episode gives,
     with its types and limits. The format goes under `const`: style, kits,
     voice profile, output profile. An episode can never change those.
4. **The compiler** (`compiler/index.ts`).
   - **Export.** It exports `compiler: SeriesCompiler`, whose `id` and
     `version` are the manifest's.
   - **Input.**
     - The spec's `data`.
     - The takes: `narration`, each with its audio.
     - Their word `timings`, in seconds.
     - The `assets` by id: `image-<assetId>` and `narration-<take>`.
     - The manifest (`template`).
   - **Output.** It returns `{ok: true, timeline, warnings}` with an
     `EditTimeline`, or `{ok: false, problems}`.
   - **Purity.** It must be pure and deterministic:
     - no clock, no randomness (use `noise(i)`), no file reading;
     - every time comes from the takes' timings, every picture from the
       assets;
     - it only imports what section 2 lists.
5. **The validator** (`validator/index.ts`).
   - It exports `validator: SeriesValidator`.
   - It turns each rule of the standard into a finding, each with a `code`,
     a JSON `path` and `severity: "error"` (it blocks a render) or
     `"warning"`.
   - It receives the timeline about to be rendered, which may be hand-edited,
     and `compiled`, the compiler's reference.
   - Check what a person would notice: text over a face, words shown before
     they are said, a duration out of range, a missing loop frame.
6. **Kits, only for what no application kit draws.**
   - **Where:** `kits/<name>/1.0.0/kit/index.tsx`, at channel or series
     level.
   - **What it exports:** `kit: KitVersion`, with:
     - `name` and `version` equal to the folder;
     - a one-sentence `description`;
     - `layer`;
     - `profiles`;
     - zod `props` (`.strict()`);
     - `component`;
     - `examples`, whose props `kit verify` checks.
   - **Imports:** React, Remotion, `@remotion/*`, zod, the kit libraries
     above by version, `import type` from `@av/remotion-composer`, and files
     under its own `kit/` folder. Nothing else from the composer.
   - **Seal and verify:**
     - `vpr kit seal <channel>[/<series>] <name> 1.0.0`;
     - then `vpr kit verify …`.
   - **Pin it.** List it in the manifest's `kits` as
     `{"name", "version", "level": "channel"|"series"}`.
   - **Order matters.** Seal and verify a kit before a release pins it: a
     pinned kit is never resealed. To change it, make the next kit version.
7. **Seal and verify the release.**
   - `vpr template seal <channel>/<series> <id> 1.0.0` builds the bundles,
     pins the kits' hashes and writes the files' hashes.
   - `vpr template verify <channel>/<series> <id> 1.0.0` checks them.
   - Fix the source and seal again until verify passes. Sealing is refused
     once an episode pins the release.
   - With no fixtures, verify checks the bundles but never runs the
     compiler. Before the first episode, you may write a small synthetic
     `fixtures/<name>/input.json` (spec, takes, word timings, assets) to run
     it; replace it with a real episode in step 9.
8. **The first episode**, as any episode of the series:
   - `pva_create_episode`;
   - `pva_init_spec` with the exact release, then the `fill-episode-spec`
     skill;
   - pictures and sounds (`pva_generate_image`, `pva_synthesize_sound`);
   - takes (`pva_synthesize_speech` or a recording, then `pva_register_take`
     and `pva_align_take`);
   - `pva_build_timeline`, then `pva_check_episode`;
   - `pva_layout_sheet`, read with the `review-layout-sheet` skill.

   **The person approves the sheet. You never do.** Render with
   `pva_compose_video` only after their approval.
9. **Hold it as a fixture** once the person accepts the episode.
   - `vpr template fixture <channel>/<series>/<episode> <episode>` keeps its
     compile input in the release.
   - `vpr template verify <channel>/<series> <id> 1.0.0 --update` writes its
     golden. On a pinned release it adds new goldens only, never rewriting
     one.
   - Run `verify` once more. From now on, a code change that moves a frame of
     that episode fails verify.
10. **The series' own skill.** Write `series/<series>/skills/<series>-episode.md`
    in this file's format (frontmatter with name, version, description, inputs,
    outputs and capabilities). It says how to make one episode of this series:
    - what to ask the person;
    - where content comes from;
    - which voices;
    - how pictures are prompted;
    - which checks matter most.

    Pi finds it next time, for this series only. Keep series-specific advice
    here, never in a built-in skill.
11. **Commit in the channel's repository.**
    - Run `vpr channel media <channel>` to name any new media by hash.
    - Then `git -C library/<channel> add -A && git -C library/<channel> commit`,
      with a message saying what the release is.
    - Pushing, or adding a remote, is the person's call.

## Changing a series later

- **A released template is never edited**, nor a sealed kit or theme.
  - **A new format** is a new release: `vpr template release <channel>/<series> <id> <next> --from <current>`,
    then change its source, seal it, verify it, and record the reason in its
    `FORMAT.md`.
  - **A kit change** is a new kit version, pinned by a new release.
- **Moving an episode** onto a new release is `pva_upgrade_spec`. Its fixtures
  and the layout sheet show what moved.

## Never

- Never put a channel's or a series' rules, code or names in the application.
- Never edit a sealed release, kit or theme, or a golden of a pinned release.
- Never approve a layout sheet or a golden reference, and never sign anything.
  Only the person does.
- Never pick "the latest" release for an episode. Name an exact `x.y.z`.
- Never invent the format. A standard the person did not agree to is a
  question.
