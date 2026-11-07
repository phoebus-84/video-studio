# Multi-video requests spawn independent episodes

## Status

Accepted, partly implemented. The Content Plan is a stage of the `repository-documentation` pipeline; no tool spawns its episodes.

## Decision

A one-to-many request first creates a series-level Content Plan and then spawns one independently executable episode per planned video. Shared source analysis, terminology, examples, and visual conventions are reused through the plan, but every episode retains its own pipeline snapshot, artifacts, journal, failures, revisions, and deliverable so one problem does not invalidate an opaque batch.
