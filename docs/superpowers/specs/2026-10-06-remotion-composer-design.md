# Remotion composer: render a layered timeline

**Issue:** `avg-tk7.1` — `@av/remotion-composer`: render layered timelines + loudnorm pass
**Epic:** `avg-tk7` — Remotion composer for layered timelines (the `cs-port` plan; fills avg-lho.1's compiler seat)
**Builds on:** [Remotion composer design note](../../notes/remotion-composer-design.md) (approved 2026-08-29); [edit timeline v2](2026-10-05-edit-timeline-v2-design.md) and ADR-0034
**Blocks:** `avg-tk7.2` (benchmark), `avg-tk7.3` (kit registry), `avg-tk7.4` (output profiles), `avg-3th.1` (contact sheet), `avg-3th.3` (render audit)
**Date:** 2026-10-06

## Problem

The edit timeline is now layered and kit-based (`studio.video/v1alpha2`), but
nothing renders it. The design note chose Remotion as the compiler: React
kits, frame-exact, the engine `packages/infographics` already proves in this
repository. This issue builds the package and registers it, without switching
anything over.

## Decisions taken with the user

1. **A minimal kit registry and three kits — `still`, `clip`, `captions`** —
   exactly what the v1alpha1 migration produces, so the repository's
   `explainer` fixture renders end to end. Versioning policy, previews,
   per-kit test conventions and further kits are `avg-tk7.3`.
2. **All audio in Remotion; FFmpeg only for loudness.** Each audio item is an
   `<Audio>` with a per-frame volume (gain × fades × ducking); a two-pass
   `loudnorm` runs on the finished file.

## Design

### Package — `packages/remotion-composer` (`@av/remotion-composer`)

Built like `packages/infographics` (same Remotion **4.0.505**, React 19.2.4,
zod 3.25.76, `tsc` to `dist/`, tests with `node --import tsx --test`).

```
src/
  schema.ts       zod mirror of the v1alpha2 EditTimeline (structure only)
  kits/           registry.ts, Still.tsx, Clip.tsx, Captions.tsx
  volume.ts       per-frame audio volume (pure)
  Timeline.tsx    root composition
  Root.tsx, remotion-entry.ts
  assets.ts       verify hashes, stage a public directory
  loudness.ts     two-pass ffmpeg loudnorm
  render.ts       renderTimeline
  cli.ts          render-timeline <timeline.json> <out.mp4> --assets <dir>
  index.ts        renderTimeline, validateTimeline, listKits, ComposerError
```

The package imports nothing from `studio/` (`npm run check:boundaries`).

### Validation — two levels (ADR-0034)

`validateTimeline(doc)` → `{ ok: true, timeline } | { ok: false, problems }`
with `{ code, message, path }`:

- `invalid-timeline` — the zod mirror rejects the shape. The mirror covers
  structure only; overlaps, crossfades and references are the contracts'
  `validateEditTimeline`, which the studio side runs before calling the
  composer.
- `unknown-kit` — `kit.name` not in the registry, or `kit.version` not the
  registered version.
- `bad-props` — props fail the kit's zod schema (paths like
  `$.tracks[1].items[0].props.fit`).

`renderTimeline` adds, before bundling:

- `missing-asset` — a declared asset file does not exist under `assetRoot`.
- `hash-mismatch` — its sha256 differs from `assets[id].hash`.

### Kits (registry: `name → { version, props, component }`, all `1.0.0`)

- `still`: `{ src: {$asset}, fit?: "cover" | "contain" (default cover), scale?: number > 0 }` — an image filling the frame.
- `clip`: `{ src: {$asset}, fit?: … }` — a video, muted (its sound belongs on an audio track), frozen on its last frame when the item outlasts it.
- `captions`: `{ text, position?: "top" | "bottom" | "center" (default bottom), fontSize?: number > 0, color?, backgroundColor?, font? }` — a text block in the frame's safe area.

A kit's `$asset` props arrive resolved to a staged URL; kits never see paths
or hashes.

### Composition — `Timeline.tsx`

- Composition id `Timeline`; `calculateMetadata` takes `fps`,
  `durationInFrames`, `width`, `height` from the timeline.
- Visual tracks render in ascending `z` (ties in array order), each item in a
  `<Sequence from duration>` with its kit; `hidden` tracks are skipped.
- `transitionIn`/`transitionOut` of type `fade`: opacity ramps over their
  duration. `crossfade`: the incoming item's opacity ramps 0 → 1 over the
  overlap, drawn above the outgoing one (later items draw on top).
- Audio: each item of each non-`muted` audio track is an `<Audio>` in a
  `<Sequence>`, `startFrom` = `trimStart`, `volume` a function of the frame
  (`volume.ts`):
  `gain × fadeIn ramp × fadeOut ramp × duck(frame)`, where `duck` is the
  track's `duck.gain` while any item on an `under` track is sounding, ramping
  in over `attack` frames before it starts and out over `release` frames after
  it ends (1 when the track has no `duck`). Defaults: `gain` 1, no fades.

### Assets

Every asset path is resolved against `assetRoot` (the episode directory);
paths escaping it are `missing-asset`. Verified files are hard-linked (copied
when linking fails) into a temporary public directory named by asset id,
which is given to `bundle({ publicDir })`; kits read them with
`staticFile()`. The temporary directory is removed after the render.

### Render and loudness — `renderTimeline(options)`

`{ timeline, assetRoot, outputPath, concurrency?, onProgress?, loudness? }`:
validate → verify and stage assets → `bundle` → `selectComposition` →
`renderMedia` (H.264, yuv420p, bt709, AAC) to a temporary file →
`loudnorm` two-pass (default `I=-15:TP=-1:LRA=11`, measured first, applied
with `linear=true` and the measured values) to `outputPath`; video stream
copied. A timeline with no audio track skips loudness and gets a silent AAC
track so the output always has audio.

Result: `{ path, durationSeconds, sizeBytes, hash: "sha256:…", kits: [{ name, version }], loudness: { inputI, outputI, truePeak } | null }`.
Failures throw `ComposerError` with `code` (`invalid-timeline`, `unknown-kit`,
`bad-props`, `missing-asset`, `hash-mismatch`, `render-failed`,
`loudness-failed`) and, for validation, `problems`.

### Registration

- Root `package.json` workspaces gain `packages/remotion-composer`.
- `compose.config.json`: component `remotion-composer` (`kind: node`,
  `standalone`, capability `video.compose`, `requires.system: ["ffmpeg"]`,
  docs `docs/packages/remotion-composer.md`), added to profiles `full`,
  `studio`, `headless` and `render`; each of them sets
  `defaultProviders["video.compose"] = "video-composer"`. Nothing renders
  through Remotion until `avg-tk7.6`.
- `docs/packages/remotion-composer.md` and the package `README.md`.

## Testing

`node --import tsx --test` in the package:

- Mirror conformance: the zod schema accepts `studio/contracts/fixtures/timeline/v1alpha2/valid/*.json` and rejects a non-integer frame, a wrong `apiVersion` and an item with both `kit` and `asset` (fixtures read as files, not imported).
- Validation: `unknown-kit` (name, version), `bad-props` with its path, `missing-asset`, `hash-mismatch`, a path escaping `assetRoot`.
- `volume.ts`: gain, fade-in, fade-out, ducking with attack and release, frames outside the item, a track without `duck`.
- `listKits()` returns the three kits with versions.
- End-to-end, only with `REMOTION_E2E=1` (needs headless Chrome and an encode; not in `npm run check`):
  - the v1alpha2 `explainer` fixture with three solid-colour PNGs generated by ffmpeg: output 1920×1080, 30 fps, 765 frames, H.264, an audio stream present (silent);
  - a 4-second timeline with a sine tone on a `voice` track and a second tone ducked under it: integrated loudness within ±1 LU of −15, true peak ≤ −1 dBTP, result `loudness` filled.
- Root: `npm run check` (including `check:boundaries`) and `npm run compose -- --list` resolving every profile.

## Out of scope

Speed benchmark (`avg-tk7.2`); registry versioning, previews and further kits
(`avg-tk7.3`); 9:16 profiles and safe zones (`avg-tk7.4`); segment cache
(`avg-tk7.5`); building timelines on the studio side and switching
`composeEpisodeVideo` off (`avg-tk7.6`).
