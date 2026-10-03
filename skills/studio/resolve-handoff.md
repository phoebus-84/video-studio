---
name: resolve-handoff
version: "0.1.0"
description: Hand reviewed episode media and narration revisions to DaVinci Resolve through the optional upstream davinci-resolve-mcp integration, preserving originals and verifying editable timelines
---

# DaVinci Resolve editorial handoff

Use when the operator asks to bring rendered assets, revision assemblies, final
masters or revised narration into Resolve. This is an **optional editorial
workflow**, not a built-in runtime capability, installation command or approval.

Use the actively maintained upstream
[**samuelgursky/davinci-resolve-mcp**](https://github.com/samuelgursky/davinci-resolve-mcp)
for live control. Do not vendor its bridge, write a competing SDK client, or
assume the same tool prefixes/version/edition support on every machine.

## Plan before editing

1. Gather episode context, current render pointer and accepted take manifests.
   Ask which revisions/assets and target project the operator wants. Do not
   scan/import everything, assume newest means accepted, or bypass a review gate.
2. Retain texts/voice identity unless a change was requested. Identify separate
   picture, narration, music, Foley, bumper, subtitle and final-master media.
   A final MP4 with old baked speech is **not** a silent picture reference.
3. Write a versioned explicit request under `artifacts/resolve/`. The full
   format and example are in repository `docs/resolve-handoff.md` and
   `docs/public/resolve-handoff.example.json`. Run from the repository root:

   ```bash
   npm run resolve:plan -- --manifest <request.json> --media-root <episode-root> --out <new-plan.json>
   ```

   The offline planner uses ffprobe, file hashes, explicit ranges/tracks and
   bounded batches. It does **not** connect to Resolve or authorize project
   edits. Do not claim `planned-not-imported` is imported/delivered.
4. Review the plan with the operator. Preserve full spoken endings; if a cue
   needs frame padding, make a new silence-padded WAV. No unrequested speeding,
   pitch shifting, speech cropping, canonical promotion or acceptance changes.

## Establish a live connection

Discover/describe the client's installed MCP tools. Query live Resolve version,
edition and current project. A running app or connected MCP server alone is not
readiness. If unavailable, stop with upstream install/bridge guidance. Changing
client configuration, Python or GUI environment requires separate permission.
Never log tokens or copy a workstation's credential-bearing MCP config.

Check project name, FPS and dimensions against the plan. Existing settings must
match; stop on mismatches rather than silently resetting a project's timebase.
Ask before leaving an unrelated unsaved edit. Require permission for writes,
create a pre-change saved/exported backup in an authorized output root, and
refuse **any existing destination timeline name before starting the import**.
Do not consume a destructive confirmation token to replace/delete original
media or timelines without a specific operator decision.

## Import and assemble

- Create/reuse the plan's folder tree. Import assets to explicit bins. Single
  still-image imports prevent numbered images being grouped into sequences.
  Verify all files imported; stale or partial imports stop the handoff.
- Verify unchanged media hashes and map each symbolic `assetId` to a fresh Media
  Pool ID by bin **and file path**. Names alone are ambiguous; session-scoped
  bridge handles are not durable IDs and never belong in a stored request.
- Select `Master/Timelines` **right before every timeline creation**: even read
  queries may change current-folder state. Create with `if_exists: fail`, set
  the intended timeline current, create/name/read back its tracks, including
  mono/stereo type. Never accidentally append into whatever timeline was open.
- Fill the plan's `clipInfo` with the fresh `clip_id` and use the installed
  `media_pool.append_to_timeline` positioned form. Discover its actual schema.
  In the verified upstream wrapper `recordFrameMode: relative` normalizes the
  offset to the live start frame. If absent, explicitly convert to the raw
  API's absolute record frame; do not silently drop the mode.
- Treat source ranges as half-open: `endFrame - startFrame` is the duration in
  the verified exclusive-end host/wrapper. Probe/read back this on the current
  build; do not shave one frame from every clip by assuming inclusive ends.
  Use `mediaType: 1` for picture-only and `2` for audio-only placements.
- Start with at most three append items per call (one for large pools). After
  each call, query actual tracks/items/start/end/duration. On `stale_handle`,
  inspect partial results before re-fetching IDs and retrying **only missing
  work**. Never blindly re-append, enlarge the bridge table or count a generic
  success/unverified operation response as proof.
- Stills/subtitles are import-only in planner v1. Do not report synchronized
  caption tracks or editable native graphics/rigs unless separately created
  and verified. Rendered footage does not reconstruct its authoring source.

## Narration review

Use new revision bins and new timelines, retain all originals, and provide
individual cue clips plus separated full-length stems. Do not mix revised
narration over the old baked voice. Source cue timing is explicit: never invent
retiming silently. Mark authorized shifted entries in yellow and record their
offsets. Add a level-matched original/new A/B finale when useful. Keep subtitle
texts intact and update their timing only when authorized.

ASR/text, pitch and release checks are technical triage, **not listening or
artistic approval**. Do not state that you listened when you did not. Ask the
operator to listen to the new performance, especially the ending.

## Verify and report

Read back project identity/settings, each timeline's duration as
`end_frame - start_frame`, item counts, per-track ranges/source paths and channel
layout. Save/reopen or re-query to verify persistence. Original cuts and source
files must remain intact. Distinguish upstream `_archived_vNN` safety snapshots
from new review cuts; do not delete them just to make counts look right.

Write a versioned handoff report/journal with plan hashes, Resolve/MCP versions,
actual IDs, completed/failed imports, readback checks, timing shifts, editable
limits and pending human listening. Partial failure is **partial**, not success.
Only after readback give the operator the project/bin/timeline names. A `.drp`
usually references local media and is not a self-contained archive.

This workflow never approves a human gate, changes accepted takes, overwrites
existing audio/masters, updates `output/current.json`, or publishes a video.
