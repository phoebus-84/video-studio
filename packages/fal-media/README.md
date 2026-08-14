# fal-media-adapter

Tracked fal.ai production adapter for generated illustrations and image edits.

## Owns

Endpoint invocation, input validation, pricing checks, idempotency, asynchronous request persistence, polling, cancellation, resumption, output download, hashes, provenance, and cost reconciliation.

## MVP boundary

No fal MCP integration and no autonomous model marketplace. Pi records an approved endpoint binding; the adapter executes it reliably. A generic endpoint driver is paired with tested endpoint profiles for the image models selected by the built-in pipelines.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
