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

Contracts use semantic package versions and explicit resource `apiVersion` values. Canonical records are closed by default; extensibility uses preserved `metadata`, namespaced `extensions`, and open-vocabulary identifiers. Breaking changes require a new resource version and migration fixtures. Generated bindings are tested against the same fixtures to prevent cross-language drift.

## Contract documentation

- [`docs/contract-catalog.md`](docs/contract-catalog.md)
- [`docs/compatibility-policy.md`](docs/compatibility-policy.md)
- [`docs/wire-conventions.md`](docs/wire-conventions.md)
- [`docs/identity-and-provenance.md`](docs/identity-and-provenance.md)

Run `npm run check` to validate schemas and execute the compatibility examples and policy tests.

## Plan

The detailed implementation graph is stored in Beads. Run `bd list`, `bd graph`, and `bd show <id>` from this directory.
