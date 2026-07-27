# video-pipeline-runtime

Deterministic filesystem runtime for agent-directed video pipelines.

## Owns

Workspace initialization, configuration inheritance, pipeline resolution and snapshotting, artifact validation, atomic revision writes, stage leases, immutable attempts, append-only journals, approval and budget policy, dependency staleness, resume, rerun planning, and a CLI/library API.

## Boundary

This runtime is the production clerk, not the director. It never adapts a story, writes a script, chooses a visual style, or silently selects a provider. Pi performs those decisions using skills.

## Primary consumers

`pi-video-agent`, `video-studio-gateway`, and tests in `video-built-in-pipelines`.

## Plan

Use `bd list`, `bd graph`, and `bd show <id>` for the detailed dependency-aware plan.
