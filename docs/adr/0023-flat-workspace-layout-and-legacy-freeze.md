# Workspace layout is flat channel/series/episode nesting; the existing library is frozen as legacy

## Status

Superseded. The workspace has explicit `series/` and `episodes/` containers (layout 2: the [workspace contract](../workspace), `studio/contracts/src/layout.mjs`); `tools/migrate-library-layout.mjs` moves a layout-1 library.

## Decision

The canonical workspace layout is `library/<channel-slug>/<series-slug>/<episode-slug>` with no intermediate `series/` or `episodes/` container directories, matching what `video-pipeline-runtime` already creates. WORKSPACE.md is rewritten to match. The pre-conformance content in `library/` is renamed to `library-legacy/` and frozen read-only as reference material; it is never migrated. All new production starts in a fresh `library/` initialized and validated by the runtime, accepting the loss of continuity for old episodes in exchange for a single enforced layout with no migrator to maintain.
