# Contracts are versioned in a dedicated module

## Status

Accepted, amended by [ADR-0028](0028-contracts-scope-six-schema-families-with-typescript-bindings): bindings are TypeScript only. The module is `studio/contracts` ([ADR-0032](0032-single-repository-with-reusable-packages)).

## Decision

Workspace, pipeline, provider-job, timeline, event, and RPC payload schemas live in a dedicated language-neutral contracts module with semantic versions, compatibility fixtures, and generated TypeScript and Python bindings. This adds release discipline but prevents independently versioned modules from drifting into mutually unreadable files or events.
