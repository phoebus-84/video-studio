# ADR-0049: Channel media use a content-addressed S3 remote

## Status

Proposed in the implementation of [issue #74](https://github.com/phoebus-84/video-studio/issues/74).
Extends [ADR-0045](0045-a-channel-is-its-own-repository.md); it does not replace
its lock format, union merges, or local-only commands.

## Context

A lock identifies missing media but cannot recover their bytes. Collaborators
need a way to restore paid generations, approved assets and archive originals
without putting them in git. Deliveries and rebuildable intermediates should
not silently dominate the backup. The remote must not become an approval
service or a source of filesystem writes outside a channel.

## Decision

- A channel versions `media.remote.json`, with kind `MediaRemote` and
  `apiVersion: studio.video/v1alpha1`. It names an S3 bucket/prefix, region,
  optional endpoint, and retention-selection policy. Credentials come only
  from the AWS SDK's standard credential chain, not this file. Unknown
  configuration fields are rejected. See [the workspace contract](../workspace.md#git-and-storage).
- Objects live at `<prefix>/sha256/<first-two-hex>/<full-hex>`. Identical
  content shares an object **within one bucket/prefix**. Channels deduplicate
  across each other only when configured with the same namespace; a
  channel-specific prefix deliberately isolates them.
- The AWS S3 SDK supplies signing, credential profiles, retries and streaming.
  The transport has no channel policy. There is no dependency on a particular
  self-hosted server, an external `rclone`, or a production gateway.
- `vpr channel media push|pull <channel>` takes `--episode <series>/<episode>`,
  `--tier <comma-separated-tiers>` (repeatable; `all` selects everything),
  `--concurrency <1..16>` (default 4), and `--dry-run`.
- Push verifies local bytes against the lock, snapshots them into a private
  temporary file, verifies that snapshot, and uploads only that snapshot.
  Hash names must never receive bytes read from a concurrently changing source.
  HEAD avoids redundant uploads. Conditional `If-None-Match: *` on PUT **and
  multipart completion** prevents a competing writer being overwritten.
  A provider without those conditions is unsupported; there is no unconditional
  write fallback. A provider that ignores them instead of refusing them is not
  detected: Garage answers 200 to both writers (it has no consensus to decide
  between them). There a duplicate upload rewrites the same verified bytes,
  and pull still rejects any object whose bytes do not match the lock. Remote HEAD length must match the lock, but HEAD is not a
  full remote-content audit.
- Pull streams into an exclusive temporary file beside the destination,
  verifies both SHA-256 and size, then publishes with an exclusive hard link
  and removes the temporary name. Unlike ordinary rename, this publication
  cannot overwrite a destination created while the request was in flight.
  The destination filesystem must support hard links. Existing changed files,
  directories and symlinks are preserved and reported, never replaced.
- Uploads larger than 8 MiB use multipart, sequential parts inside each worker.
  SHA-256 request checksums are enabled by default; a compatible server lacking
  them can use `checksum: false`. Snapshot and download verification remain
  mandatory. Errors abort multipart uploads best-effort. Bucket lifecycle
  should clean incomplete uploads left by a hard kill. Reruns resume at
  **object/file granularity**, not at an interrupted part or byte offset.
- Shared locks are untrusted write instructions: refuse absolute/traversing
  paths, control characters, non-media paths, metadata/cache destinations,
  malformed hashes/sizes, symlinked parent directories and escaping/cyclic
  links. A relative symlink must name another locked path. Episode scope
  includes that link's transitive locked targets, even in channel sources.
  It is not a dependency resolver for arbitrary paths in specs or source pins.
  Concurrent hostile directory replacement by a same-user process is outside
  this boundary; these checks are not an OS sandbox.
- Union merges may name two versions of one path. Transfer reports it as
  `ambiguous` and does not choose either. Remote check also reports ambiguity.
  The original offline check continues to accept either version (ADR-0045).
  The operator resolves the desired bytes and refreshes the lock deliberately.
- With a remote configured, `--check` separates `remote` (missing locally,
  available to restore) from `missing` (unavailable remotely too). Links whose
  locked targets are available are restorable from their git metadata. Remote
  availability is not local readiness: check still exits nonzero until the
  selected local media match. Auth/service failures are errors, not absence.
  `--offline` preserves the original network-free check; without a remote,
  checks remain local. Neither kind of check writes the lock or hash cache.

### Tier attribution

Keep the lock unchanged. Tier policy lives beside the remote, not in a tool's
implementation or a guessed approval record:

- `rules` are ordered `{prefix, tier}` pairs. The first match wins; prefixes
  match a whole file or a directory boundary, without globs or trailing `/`.
- The names `paid`, `approved`, `archive`, `masters`, `derived` and `deliveries`
  are policy labels, **not proof** of generation, licence or approval. No HMAC
  key is read and no approval is granted or trusted by classifying a file.
- Without a rule, `output/final-*` and `output/long-*` are `deliveries`;
  everything else is `other`. Unknown assets must not silently disappear from
  the default backup. In particular, nothing is declared rebuildable without
  an explicit channel rule. Configure receipt-backed loop/atlas/soundtrack
  directories as `derived` to avoid uploading their many objects.
- Default `keep` is `paid, approved, archive, masters, other`; explicitly
  configured `keep` replaces it. `derived` and `deliveries` are opt-in.
  Reports count excluded files/bytes by tier. `--tier all` bypasses selection,
  not integrity, path or conflict checks. Dry runs perform HEADs and local
  verification but no PUTs, GETs, filesystem writes or lock/cache changes.

This is intentionally conservative and transparent. A later record-driven
classifier can propose rules without extending the lock's merge semantics.

## Consequences

- The implementation has an in-memory fake and an HTTP S3 fake, exercising the
  real SDK and compiled CLI, including corruption, conditional writes,
  multipart failure cleanup, dry runs, scopes, symlinks and filesystem races.
- Production validation is still a separate operator step: configure the
  chosen server, push the channel, restore an episode in a fresh clone, run
  `--check --verify`, and verify its existing signed layout review. The test
  suite does not claim this has been done on a real channel.
- To satisfy an **all-files-matching** check after cloning, upload and pull
  `--tier all` or rebuild the excluded derived media and deliveries. Default
  selective backup alone cannot satisfy that stronger criterion. Shared media
  referenced only by specs/pins, rather than symlinks, may need a broader pull.
- There is no remote garbage collector or deletion command. Local lock
  `--prune` does not delete remote objects. Remote lifecycle deletion of
  completed objects requires a future retention decision.
- Read-only collaborators can use read-only S3 credentials. Writers additionally
  need upload/multipart-abort permissions. Bucket policy determines access;
  the application neither creates credentials nor grants access.
- Sharing approval HMAC keys is still ADR-0045's separate problem. Render-cache
  sharing, packed small objects, per-person approval keys and agent-tool wrappers
  are outside this change.
