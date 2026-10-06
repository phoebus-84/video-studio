# Cut the studio over to the edit timeline

**Issue:** `avg-tk7.6` — cut studio over to timeline construction; delete `composeEpisodeVideo`
**Epic:** `avg-tk7` — Remotion composer for layered timelines (the `cs-port` plan)
**Builds on:** [Remotion composer design note](../../notes/remotion-composer-design.md), milestone M2; [Remotion composer](2026-10-06-remotion-composer-design.md); [kit registry](2026-10-06-kit-registry-design.md); [output profiles](2026-10-06-output-profiles-design.md); ADR-0009, ADR-0034
**Blocks:** `avg-lho.1` (fill the compiler seat)
**Related:** `avg-e7w` (the runtime's settings shape for the output profile)
**Date:** 2026-10-06

## Problem

Episodes are rendered by `composeEpisodeVideo()`, a private function in
`studio/agent/src/capability-tools.ts` that runs FFmpeg directly. It holds
each scene image for its length, lays the narration underneath and writes
`artifacts/final.mp4`. It burns no captions, makes no transitions, does not
normalise loudness, knows only 1920×1080, and leaves no record of how the
video was built — the arrangement ADR-0009 and ADR-0034 exist to prevent.
The Remotion composer, the kit registry and the output profiles are now in
place; nothing in the studio uses them.

## Decisions taken with the user

1. **The new path delivers what the `compose-video` skill always promised**:
   the same stills and narration, plus captions from the narration manifest
   (`captions@1.1.0`, inside the safe zone), short crossfades between scenes,
   and loudness from the output profile. Motion (Ken Burns, titles) needs
   new kits and is not this issue.
2. **Two tools and the canonical output.** `pva_build_timeline` writes the
   reviewable `artifacts/edit-timeline.json`; `pva_compose_video` renders it
   (building or rebuilding it when needed) to `output/<render-id>.mp4` with a
   report and `output/current.json`.

## Design

### Building the timeline — `buildEditTimeline` (`studio/agent/src/edit-timeline-builder.ts`)

`buildEditTimeline(episodeDir, { episodeRef, profile }) → { ok: true, timeline, warnings } | { ok: false, problems }`,
pure apart from reading files. It decides nothing today's path does not
already decide.

- **fps** 30. All times are integer frames, rounded on absolute times (as
  the v1alpha1 migration does), so scenes that touch never overlap.
- **Scenes:** `resolveSceneFrames(episodeDir)` as today (natural order
  `s1, s2, s4a, s10`; length from `timing.json` or the narration; 10 s
  default). Track `scenes` (visual, z 0): one `still@1.0.0` item per scene,
  `props: { src: { $asset }, fit: "contain" }` (black bands when the image's
  shape differs from the profile, as today's `pad`). No images: problem
  `no-scenes`.
- **Crossfades:** 12 frames between consecutive scenes, centred on the
  boundary — the incoming scene starts 6 frames before it, the outgoing
  ends 6 frames after it, and the incoming item has
  `transitionIn: { type: "crossfade", duration: 12 }`. The first and last
  scenes have none. A scene shorter than 13 frames gets no crossfade on
  either side.
- **Narration:**
  - with a narration manifest (`artifacts/narration/narration-manifest.json`):
    its final WAV (`canonicalNarrationPath`) on track `voice` from frame 0;
  - otherwise `artifacts/narration/narration-full.wav` if present;
  - otherwise, with a canonical manifest that has no final WAV, its entries'
    WAVs in order, after `leadInSilenceSeconds`, each followed by its
    `pauseAfterMs`;
  - otherwise the scene WAVs (`s1.wav`, `s4a.wav`, … as the old fallback
    matched them) one after another on `voice`, in natural order, each for
    its measured length (ffprobe) — the old concatenation, without writing a
    file; a deprecation warning, as today;
  - otherwise no audio track (the composer adds silence).
- **Captions:** when the manifest validates (the agent's
  `validateNarrationManifest`; the agent writes `narration-manifest/v1`, which
  `@av/video-composer`'s `narrationCompositionInput` — `schemaVersion 0.1.0`
  only — does not accept), its `captions` (`startSeconds`, `endSeconds`,
  `text`, already on the final WAV's clock); track `captions` (visual, z 10): one
  `captions@1.1.0` item per cue, `position: "bottom"`. A manifest that names
  a final WAV but does not validate gives narration without captions and a
  warning (as `canonicalNarrationPath` already warns).
- **Duration:** the longer of picture and narration; when the narration is
  longer, the last scene is held until it ends.
- **Assets:** every file in `assets`, path relative to the episode, `hash`
  its sha256, `kind` `image` or `audio`; ids `scene-<id>`, `narration`,
  `narration-<id>`.
- **Problems:** `no-scenes`, `unknown-profile`, `bad-manifest` (not JSON),
  `missing-narration` (the manifest names a final WAV that is not there),
  plus whatever the two validators report.
- **Profile:** a catalog id (`@studio/contracts` `outputProfile`), default
  `youtube-1920x1080`; the whole profile is copied in and `resolution` set
  from it. An unknown id is the problem `unknown-profile`. Reading the
  profile from series settings waits for `avg-e7w`.
- **Provenance:** `episodeRef` from the path, `revision` 1,
  `metadata: { builtBy: "studio/agent buildEditTimeline", inputs: { "<path>": "sha256:…" } }`
  listing every file read (images, `timing.json`, the manifest, the WAVs).
- **Validation:** the result must pass the contracts' `validateEditTimeline`
  and the composer's `validateTimeline`; their problems are returned and
  nothing is written.

### `pva_build_timeline { channel, series, episode, profile? }`

Builds and writes `artifacts/edit-timeline.json` atomically (temporary file,
then rename). Replies with the scene and caption counts, the duration, the
profile and the path to review. On problems: a tool error listing them.

### `pva_compose_video { channel, series, episode, profile?, label? }`

1. Read `artifacts/edit-timeline.json`. **Rebuild it** (as
   `pva_build_timeline`) when it is missing, when a file in
   `metadata.inputs` changed or disappeared, or when `profile` names a
   different profile than the timeline's. The reply says why
   (`rebuilt: assets/images/s3.png changed`). Otherwise the timeline is
   rendered **as it is**, including after a hand edit on the web or on disk:
   a deliberate change is never overwritten.
2. `renderTimeline({ timeline, assetRoot: episodeDir, outputPath })` to
   `output/.<render-id>.partial.mp4`, renamed to `output/<render-id>.mp4`
   when finished. `render-id` = `<label or "render">-<Date.now()>-<first 8
   hex of the timeline's sha256>`.
3. `output/<render-id>.report.json`: the composer's result (duration, size,
   sha256, kits, profile, loudness) plus `timeline: { path, hash }` and
   `createdAt`.
4. `output/current.json` (`{ renderId, path }`) written **last**, under the
   same `withFileMutationQueue` as the multitrack composer.

A failure leaves `output/` and `current.json` as they were and no
`.partial` file. The tool error carries the composer's `code` and its
problems. The `outputName` parameter is removed.

### What is deleted

From `studio/agent/src/capability-tools.ts`: `composeEpisodeVideo()`, its
FFmpeg calls, the `artifacts/frames/` normalisation, the concat script and
the scene-WAV concatenation. `resolveSceneFrames`, `canonicalNarrationPath`
and `naturalSegmentOrder` stay; `concatScript` goes if nothing else uses it.
`packages/video-composer` stays installed (QA, `media.probe`,
`narrationCompositionInput`).

### Wiring

- `studio/agent` depends on `@av/remotion-composer` (`workspace:*`);
  `packages/remotion-composer` joins `REQUIRED` in `tools/build-required.mjs`
  (it is consumed through `dist/`).
- `compose.config.json`: every profile that composes both providers sets
  `defaultProviders["video.compose"] = "remotion-composer"`; the `blender`
  profile, which composes the agent with `video-composer` only, gains
  `remotion-composer` and the same default.
- Headless Chrome: Remotion downloads it on the first render;
  `docs/install.md` and `npm run doctor` say so.

### ADR-0036 — "The studio renders episodes through the edit timeline"

The studio builds a v1alpha2 edit timeline from an episode's material and
renders it with `@av/remotion-composer`; no composition path runs FFmpeg
from the agent; the timeline is a reviewable artifact that a render can
always be traced back to (its hash is in the report); renders go to
`output/<render-id>.mp4` with a report and `output/current.json`.

### Docs and skills

`skills/studio/compose-video.md` rewritten (two tools, the timeline as the
artifact to review, when it is rebuilt, the canonical output);
`docs/notes/remotion-composer-design.md` marks M2 done; the agent's docs and
tool list updated.

## Testing

- **Builder** (vitest, temporary episodes, no render): natural order and
  lengths from `timing.json`; centred 12-frame crossfades, frames checked at
  the boundaries, no other overlap; no crossfade around a very short scene;
  captions as `captions@1.1.0` items; the final WAV on `voice`; the last
  scene held to the end of the narration; the scene-WAV fallback (in order,
  with the warning); `metadata.inputs` lists every file read; both profiles;
  the result passes both validators; problems `no-scenes`,
  `unknown-profile`; a non-canonical manifest gives narration and no
  captions.
- **Tools** (vitest, `renderTimeline` replaced by a fake writing a small
  file): `pva_build_timeline` writes atomically; `pva_compose_video` builds
  a missing timeline, rebuilds on a changed input (naming it) and on
  another profile, and **renders a hand-edited timeline without
  overwriting it**; layout `output/<id>.mp4` + report with the timeline hash
  + `current.json` last; a failing render leaves `output/` and
  `current.json` unchanged with no `.partial`; the composer's code in the
  error.
- **End to end** (`REMOTION_E2E=1`): a fixture episode (three images, a
  narration manifest with a measured WAV and captions) renders 16:9 with
  the expected length, captions visible in a frame, loudness within ±1 LU of
  −15, `current.json` right; 9:16 renders 1080×1920 at −14 LUFS. The checks
  of the old `compose-video.test.ts` (scene order, sync with the narration,
  no amputated last scene) are kept against the new path.
- Root: `npm run check` (with `check-boundaries` and `build-required`),
  `npm run compose -- --list`, `npm run docs:build`.

## Out of scope

Motion kits (Ken Burns, titles); series compilers (`avg-jao`); reading the
profile from settings (`avg-e7w`); the multitrack composer
(`pva_compose_multitrack_video`); the runtime's legacy path map
(`LEGACY_PATHS["output.mp4"]`); the segment cache (`avg-tk7.5`).
