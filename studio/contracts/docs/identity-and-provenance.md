# Identity, revisions, hashes, and provenance

Canonical definitions live in [`schemas/v1alpha1/identity.schema.json`](../schemas/v1alpha1/identity.schema.json).

## Stable identity versus names

A durable entity receives one opaque ID when created. The type prefix helps diagnostics; the 26-character canonical ULID payload supplies practical uniqueness and sortable creation order. Consumers must compare the whole string and must not derive timestamps, paths, ownership, or authorization from it.

| Entity | Prefix | Example |
|---|---|---|
| Channel | `chn_` | `chn_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Series | `ser_` | `ser_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Episode | `ep_` | `ep_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Artifact | `art_` | `art_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Stage/asset attempt | `att_` | `att_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Asset | `ast_` | `ast_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Provider/local job | `job_` | `job_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Review thread | `rth_` | `rth_01ARZ3NDEKTSV4RRFFQ69G5FAV` |
| Journal event | `evt_` | `evt_01ARZ3NDEKTSV4RRFFQ69G5FAV` |

Slugs are lowercase, human-facing labels used in URLs and workspace paths. Renaming “Frog Prince” changes `frog-prince` to another slug but does not change its `ep_…` ID, review anchors, provenance, or dependencies. IDs are never recycled.

## Revisions

Revision numbers are one-based safe integers. A revision identifies a committed semantic state of a revisioned resource:

```json
{
  "id": "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "revision": 3,
  "contentHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

- Creating a revisioned entity writes revision 1.
- An accepted text edit, structured-field edit, migration, or resolved regeneration writes the next revision.
- Reformatting that changes canonical bytes but not semantics should be avoided; if persisted as a new canonical artifact, it is still a new revision.
- Revision numbers are scoped to one stable ID and never decrease or get reused.
- Immutable records—Pipeline Snapshots, Stage Attempts, Asset Attempts, journal events, and render evidence—receive new IDs rather than in-place revisions.
- References to mutable artifacts pin both ID and revision. A hash may be added to detect corruption or wrong-byte substitution.

## Hashes

The v1alpha1 digest is `sha256:` followed by 64 lowercase hexadecimal characters. Hashes identify bytes, not business entities.

- Text and structured resources hash their contract-defined canonical UTF-8 serialization.
- Media hashes cover the complete file bytes. `MediaHash.byteLength` prevents accidental truncation ambiguity and supports diagnostics.
- A hash changing does not allocate a new business ID; it normally accompanies a new revision or a new immutable attempt.
- Two independently generated assets may share bytes and therefore a hash while retaining distinct IDs and provenance.

Canonical serialization rules for each resource family must be published with that family before hashes are used as cache or stale-input keys.

## Sources and provider provenance

External inputs use a normalized absolute URI plus an immutable source revision. Git inputs use a resolved full commit SHA, never a branch name. Web/file sources use a provider-defined immutable revision token and should include a content hash when the source cannot prove immutability.

Generated outputs record the open-vocabulary provider and model/endpoint identity, request hash, creation time, and pinned input revisions. Credentials, signed URLs, request authorization, local absolute paths, and raw secret-bearing responses are prohibited from provenance.

## Paths

`PortableRelativePath` values use `/` and are relative to an already-authorized workspace root. Validators reject absolute paths, Windows drive paths, backslashes, empty segments, `.` and `..` traversal. Filesystem implementations must additionally resolve symlinks beneath the allowed root before access; regex validation alone is not a sandbox.

## Validation

```bash
npm run check:schemas
```

The command uses a JSON Schema Draft 2020-12 validator against checked-in valid and invalid fixtures. Invalid fixtures are required to include the reason they must fail.
