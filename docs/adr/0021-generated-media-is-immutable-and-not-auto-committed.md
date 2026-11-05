# Generated media is immutable and not auto-committed

## Status

Accepted. Extended by [ADR-0045](0045-a-channel-is-its-own-repository) (media named by hash) and [ADR-0049](0049-channel-media-use-a-content-addressed-s3-remote) (a content-addressed remote).

## Decision

Every generated media result is an immutable Asset Attempt named by stable identity and content hash, while selection and current-deliverable pointers remain small textual records. Workspace text is Git-friendly, but large media is not committed automatically; manifests make missing blobs detectable and leave remote media storage and backup as an explicit later policy instead of silently bloating repositories.
