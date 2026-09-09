# ADR-0033: Blender is a reusable scene provider with editable handoffs

## Status

Accepted for the initial Pi-directed Blender integration. Durable job dispatch and
revision-bound policy enforcement remain separate harness work.

## Context

3D production needs native scene sources, procedural geometry, animation, preview
review and optional artist edits. Treating Blender as an image generator loses
those sources; adding a Blender-only executor to the gateway duplicates control.

## Decision

- `packages/blender` is `@av/blender`, independent of studio concepts. TypeScript
  controls processes/jobs; a small Python worker runs inside Blender's matching
  runtime using bpy. This extends ADR-0018's Python isolation beyond MLX without
  moving studio orchestration into Python.
- Use `scene.create` for editable sources and `scene.render` for saved-scene
  previews/animation. Rendering is not `video.generate` (prompt-based footage)
  or `video.compose` (editing existing clips).
- Studio tools own episode paths and workflow integration. Do not add gateway
  production handlers. Native sources, scripts, settings, hashes, logs and output
  media are kept in new attempt directories. Completion is not approval.
- Support Blender 4.2–4.x and 5.2.x LTS, rejecting other unverified release
  families. The initial 4.x-only restriction was extended after live testing
  Blender 5.2.1 and adapting Eevee identifiers and layered-action keyframes.
  Eevee and Cycles are explicit choices; no automatic quality/device fallback.
- Render PNG frames before MP4 encoding. Output is silent footage for reuse in a
  typed edit timeline or explicitly silent delivery.
- Poly Haven acquisition is explicit and bounded, with license/checksum receipts;
  Asset Browser uses Blender's native asset marking and artist-configured library.
- Python and native scene inputs require trust. Disable embedded autoexec, but
  make no sandbox claim. Artist edits use Save As into a new revision.

## Consequences

Automated creation and human-native editing share the same source/render contract.
The package is useful outside video-studio and testable with fake processes.
Long-lived workers, simulation baking, complete external dependency packaging,
frame-resume and revision-bound human approval are not implemented by this ADR.
See the [harness review](../harness-review.md) for the integration gaps and priorities.
