# video-workspace-contracts

Language-neutral contracts shared by every Agentic Video Studio module.

## Owns

- JSON Schemas for channels, series, episodes, pipelines, snapshots, artifacts, scenes, timelines, assets, provider jobs, reviews, events, budgets, and render reports.
- Stable IDs, revision references, content hashes, and error envelopes.
- Event vocabulary and compatibility policy.
- Golden valid/invalid fixtures.
- Generated TypeScript types/validators and Python Pydantic models.

## Does not own

Filesystem mutation, pipeline execution, creative skills, provider calls, rendering, or UI behavior.

## Release rule

Contracts use semantic versions. Readers must tolerate additive fields within a compatible version; breaking changes require migration fixtures and a new major contract version. Generated bindings are tested against the same fixtures to prevent cross-language drift.

## Plan

The detailed implementation graph is stored in Beads. Run `bd list`, `bd graph`, and `bd show <id>` from this directory.
