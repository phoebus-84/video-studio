# Compatibility policy

## Two version axes

### Package version

The npm/Python distribution uses semantic versions:

- **Patch**: documentation, diagnostics, generator fixes, or schema corrections that do not change the accepted or emitted instance set.
- **Minor**: a new contract kind, a new explicitly optional extension point, generated helper additions, or other changes accepted by existing readers and writers.
- **Major**: removal, rename, type/unit/meaning change, newly required data, closed-enum change, or any change that makes a previously valid durable document invalid or changes its interpretation.

The MVP starts below 1.0, but applies these stricter rules anyway. Pre-1.0 is not permission for untracked breakage.

### Resource `apiVersion`

Durable top-level YAML/JSON resources use:

```yaml
apiVersion: studio.video/v1alpha1
kind: Pipeline
```

Schema IDs use `https://schemas.studio.video/v1alpha1/<kind>.schema.json`. A breaking shape or semantic change requires a new `apiVersion`, even when a package major release also occurs. Event payloads and embedded records carry an explicit `schemaVersion` or are versioned by their containing resource and event type.

`kind` and `apiVersion` are required before a document is admitted to canonical state. Readers reject unsupported versions with a structured migration-required error; they never guess.

## Closed records and extension points

Canonical records are closed by default (`additionalProperties: false`). Unknown top-level fields are rejected at write/validation boundaries because silently dropping them would destroy GUI or future-writer edits.

Extensibility is explicit:

- `metadata` is for non-semantic annotations and must be preserved byte-for-value by read/write cycles.
- `extensions` contains reverse-DNS or package-namespaced keys, for example `com.example.watercolor`, whose values are opaque JSON to consumers that do not own that namespace.
- Open vocabulary string fields accept new provider/model/capability identifiers without schema changes.

Adding a normal optional field to a closed record is still breaking for old strict readers. Use an existing extension point, add a new Kind, or bump `apiVersion`.

## Enum policy

Closed enums control branching and state. Adding, removing, or renaming a closed-enum value is breaking unless the schema already defines an explicit unknown/other branch with documented preservation behavior. Descriptive ecosystems such as providers and model IDs are never modeled as closed enums.

## Reader and writer obligations

- Readers validate before interpretation and report JSON Pointer/YAML path, expected version, and migration action.
- Writers emit the oldest supported `apiVersion` that faithfully represents requested semantics.
- Read/modify/write operations preserve `metadata` and unowned `extensions`.
- Writers never coerce units, timestamps, money, paths, or enum values silently.
- A consumer may display an unsupported resource read-only, but may not rewrite it as though understood.

## Migration

Every breaking change ships:

1. a new resource `apiVersion`;
2. before/after golden fixtures;
3. an idempotent migration or an explicit non-migratable diagnostic;
4. loss and default disclosures;
5. cross-language tests proving the migrated output validates;
6. release notes identifying affected producer and consumer versions.

Migrations write a new revision or snapshot and retain the source. They do not mutate immutable Asset Attempts, Stage Attempts, Pipeline Snapshots, journal events, or render evidence in place.

## Executable examples

`fixtures/compatibility/cases.json` records additive, patch, compatible-data, and breaking examples. `npm run check:compatibility` applies the policy classifier and fails if package bump, `apiVersion`, or migration expectations drift from this document.
