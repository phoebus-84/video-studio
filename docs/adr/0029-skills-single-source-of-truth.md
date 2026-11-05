# video-built-in-pipelines is the single source of truth for production skills

## Status

Accepted, amended. Skills live in `skills/shared/`, `skills/studio/` and `studio/agent/skills/`; `npm run compose` writes `.pi/skills/` and `.claude/skills/` from them ([ADR-0048](0048-tools-written-once-served-to-any-harness)).

## Decision

The canonical copies of all production skills (write-brief, write-script, art-direction, compose-video, safety-review, and the rest) live in `video-built-in-pipelines/skills/`. A sync script installs them into `.pi/skills/` and writes a checksum manifest so drift is detectable; the `.pi/skills/` copies are generated artifacts that must never be edited directly. The `pva-executive-producer` skill remains in `pi-video-agent` because it documents that package's own commands and tools. This eliminates the three divergent copies that previously contradicted each other (including the `final.mp4` versus `output.mp4` naming conflict).
