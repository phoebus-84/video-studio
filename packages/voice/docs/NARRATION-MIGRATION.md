# Canonical narration migration

The canonical cross-module schema is now owned by `video-workspace-contracts/schemas/v1alpha1/narration.schema.json`. Worker-internal Pydantic contracts remain snake_case implementation artifacts; `workspace_contracts.py` projects them to the canonical camelCase wire shape with `sha256:` content hashes.

## New writer path

1. Create source-mapped semantic `NarrationSegment` records.
2. Persist immutable `SynthesisAttempt` and `SegmentQualityReport` records.
3. Select accepted attempts and process linked speech/pause artifacts.
4. Master explicit order into `NarrationManifest`.
5. Fetch `GET /narrations/{assembly_id}/workspace-manifest` and write it to the episode as `artifacts/narration/narration-manifest.json` alongside the manifest's measured final WAV.
6. Generate timing/captions from manifest order, entry WAV duration, and pause intent.

## Compatibility window

- `POST /synthesize` remains available for legacy callers but creates no canonical episode manifest by itself.
- Gateway readers accept canonical camelCase and worker snake_case mastering manifests during migration.
- Historical `sN.json`/`sN.wav` sidecars remain readable and are labeled `legacy-sidecar`/deprecated.
- Filename sorting is prohibited on the canonical path. Legacy fallback uses natural numeric ordering only.
- New pipeline writers emit `narration-manifest.json` and `narration-full.wav`; `narration.mp3` is no longer a stage contract.

## Staleness

Replacing one accepted segment attempt invalidates only that selection plus derived narration manifest, final master/report, and final render. Neighbor raw attempts, quality reports, and transforms remain current. If measured duration changes, timing and caption cues from the changed segment onward are affected; earlier cues remain current.

## Caption/timing ownership

Caption cue text comes from segment display text. Cue speech duration comes from the selected measured WAV; pause advances the next cue start but is not captioned. Final timing must agree with measured final WAV within one sample. Stale scene-sidecar duration is never preferred over canonical measured metadata or an available WAV probe.
