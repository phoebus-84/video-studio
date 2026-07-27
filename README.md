# ffmpeg-video-composer

Compiler and validator for typed video edit timelines.

## Owns

Timeline validation, media normalization, deterministic FFmpeg filter-graph compilation, image motion, transitions, overlays, caption burn-in, narration/music mixing, loudness normalization, encoding profiles, ffprobe reports, frame sampling, audio QA, cancellation, and reproducibility bundles.

## Boundary

The edit timeline is canonical editorial intent. Generated shell commands are preserved diagnostics, not editable production state. Arbitrary shell fragments are rejected.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
