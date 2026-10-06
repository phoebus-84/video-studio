# ADR-0034: A layered, kit-based edit timeline

## Status

Accepted. Supersedes [ADR-0009](0009-ffmpeg-compiles-a-typed-edit-timeline).
Contract: `studio.video/v1alpha2` in `studio/contracts`. The Remotion composer
that renders it is `avg-tk7`; the series compilers that produce it are
`avg-jao`.

## Context

ADR-0009 made the edit timeline the declarative source of a render and kept
agent-authored shell out of production. Its timeline is a sequence of
segments in seconds: one asset each, an optional caption, a transition. Nothing
compiles it, and it cannot describe layered productions: a persistent verse
bar, a character gesturing on a word, an apparition over a panel, sound
effects, music ducked under the voice — all at once.

## Decision

- **The timeline is derived, never edited.** A deterministic series compiler
  produces it from the episode spec, which is what people edit. The timeline
  records what it was derived from (`derivedFrom`: spec hash, compiler and
  version), so a change to either makes it stale.
- **Tracks, as in an NLE.** Visual tracks have a `z`; audio tracks may duck
  under others. Items never overlap within a track, except a declared
  crossfade of exactly its duration. Richer transitions are kits on a higher
  track.
- **Visual items are versioned kit instances** (`kit: {name, version}`,
  `props`). Kits are React components that live in the repository, never in
  `library/`; a timeline references them by name and version.
- **Every file is declared once** in `assets` with a content hash; props
  reference one with `{ "$asset": "<id>" }`.
- **Integer frames everywhere.** Seconds exist only in the spec and the
  compiler.
- **Sections with provenance.** Spans map back to the part of the spec they
  came from (`source`, a JSON path), and so may items. This is what partial
  staleness, partial rendering, version comparison, anchored feedback and
  chapters are built on.
- **Loudness is not in the timeline.** Targets belong to the output profile
  and the post-render FFmpeg pass.
- **Validation is split.** The contract checks structure (`validateEditTimeline`
  in `studio/contracts/src/edit-timeline.mjs`); the composer checks kits, props
  and asset files.

## Consequences

The agent still never emits executable render instructions: it writes a spec,
a compiler writes the timeline, a reviewed kit library renders it. A new
visual needs a new kit through the normal review path. v1alpha1 stays frozen
for migration (`migrateEditTimelineV1alpha1`), and `packages/video-composer`
keeps reading it until the cutover (`avg-tk7.6`).

## Amendment — output profiles (avg-tk7.4, 2026-10-06)

The output profile now travels inside the timeline: `profile` (required) is a
whole copy of the profile the timeline renders to — id, size, safe zone and
loudness target — taken from the catalog in
`studio/contracts/src/output-profiles.json` by the series compiler. Loudness
is still not a property of tracks or items; the post-render FFmpeg pass
reads it from `profile.loudness`. A copy, not a reference, so a delivered
episode re-renders as it was if the catalog changes.
