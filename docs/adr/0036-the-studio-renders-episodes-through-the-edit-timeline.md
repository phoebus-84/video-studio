# ADR-0036: The studio renders episodes through the edit timeline

## Status

Accepted. `studio/agent/src/edit-timeline-builder.ts` and
`studio/agent/src/episode-render.ts`; tools `pva_build_timeline` and
`pva_compose_video`; renderer `@av/remotion-composer`. Completes what ADR-0009
and ADR-0034 required.

## Context

ADR-0009 and ADR-0034 say an episode's editorial intent is a declarative,
reviewable timeline, never render commands written in the agent. What actually
rendered episodes was `composeEpisodeVideo()`, a private function in the agent
that ran FFmpeg directly: it held each scene image for its length, laid the
narration underneath and wrote `artifacts/final.mp4`, with no captions, no
transitions, no loudness target, one frame size, and no record of how the
video was built. The Remotion composer, the kit registry and the output
profiles were in place, and nothing in the studio used them.

## Decision

- The studio **builds** a `studio.video/v1alpha2` edit timeline from an
  episode's material — scene images, timing, narration and its captions — and
  writes it to `artifacts/edit-timeline.json`. It must pass both the contracts'
  `validateEditTimeline` and the composer's `validateTimeline` before it is
  written. The timeline lists the hash of every file it was built from.
- `@av/remotion-composer` **renders** it. No composition path runs FFmpeg from
  the agent; FFmpeg remains the composer's loudness pass and the QA probe.
- The timeline is the **artifact to review**. A render rebuilds it only when
  the material it was built from changed, or another output profile is asked
  for; otherwise it renders the timeline as it stands, so a deliberate hand
  edit is never overwritten.
- Renders are **immutable**: `output/<render-id>.mp4`, a sibling
  `<render-id>.report.json` naming the hash of the timeline that was rendered,
  and `output/current.json` moved last. A failed render leaves `output/` as it
  was.
- `remotion-composer` is the default `video.compose` provider in every profile
  that composes the agent.

## Consequences

Every delivered video can be traced to the exact timeline that produced it,
and that timeline can be read, commented on and edited before rendering.
Captions, crossfades and the profile's loudness and safe zone come with every
render. Headless Chrome becomes a runtime requirement (Remotion downloads it
on the first render), and renders are slower than FFmpeg's concatenation
(the benchmark of `avg-tk7.2` measured 383 s against 270 s for eight minutes
at 1080p30). `artifacts/final.mp4` is no longer written; readers use
`output/current.json`.
