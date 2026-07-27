# Public contracts

## Package identity

| Field | Value |
|-------|-------|
| Package | `video-pipeline-runtime` |
| Version | `0.1.0` |
| Module kind | ESM only |
| Entry point | `dist/index.js` |
| Types | `dist/index.d.ts` |
| CLI binary | `vpr` (`dist/cli.js`) |
| Node.js | >= 20.0.0 |

## Exported API

### Result / error conventions (`src/result.ts`, `src/errors.ts`)

Every recoverable operation returns `Result<T, E>`, a discriminated union with
`.ok`, `.value`, and `.error` fields.

- **Constructors**: `ok(value)`, `err(error)`
- **Guards**: `isOk(result)`, `isErr(result)`
- **Combinators**: `map`, `mapErr`, `andThen`, `unwrapOr`, `unwrap`

Errors extend `RuntimeError` and carry a machine-readable `code` from the
`ErrorCode` enum. Factory helpers (`invalidArgument`, `notFound`,
`leaseConflict`, etc.) create pre-coded instances.

### Ports (`src/ports/`)

Every external concern is behind a typed interface; no concrete implementation
lives in the core package except `SystemClock` (the process boundary).

| Port | Purpose | Test fake |
|------|---------|-----------|
| `Clock` | Time access and sleep | `FakeClock` |
| `FileSystem` | File I/O | `FakeFileSystem` |
| `Lock` | Exclusive leases | `FakeLock` |
| `IdGenerator` | Unique identifiers | `FakeIdGenerator` |
| `EventSink` | Append-only journal | `FakeEventSink` |
| `Logger` | Structured logging | `SpyLogger`, `NoopLogger` |

All fakes are exported from `test/fixtures/index.ts` (reachable via
`video-pipeline-runtime/test-fixtures`).

### Workspace lifecycle (`src/workspace/`)

The workspace module manages channel, series, and episode directory trees.

#### Slug validation (`validateSlug`)

Slugs serve as URL-safe directory names.  Rules:

- Non-empty, maximum 64 characters.
- Lowercase ASCII letters, digits, and single hyphens only.
- Must start and end with an alphanumeric character.
- No consecutive hyphens (`--`) or leading/trailing hyphens.

Returns `Ok<slug>` or `Err<E_INVALID_ARGUMENT>` with a machine-readable
`reason` (`empty`, `too-long`, `uppercase`, `leading-trailing-hyphen`,
`consecutive-hyphens`, `invalid-char`).

#### Path guard (`guardPath`, `resolveGuardedPath`, `validateRootPath`)

Every filesystem path is verified against an allowed root:

1. **Lexical check**: `path.resolve(root, candidate)` must start with the
   normalised root.  Rejects `../` escapes and absolute paths to other
   locations with `E_PERMISSION_DENIED`.
2. **Symlink-aware check** (when `FileSystem` is injected): calls `stat` on
   the candidate and re-validates.  For production use with the real
   Node.js `fs`, the adapter MUST resolve the candidate's real path via
   `fs.realpath` and verify it against the root's real path.

`validateRootPath` rejects relative paths and the filesystem root `/`.

#### Contract adapter boundary (`src/workspace/contracts.ts`)

Contract documents (`contract.json`) are written into each workspace's
`.workspace/` directory.  The runtime:

- Performs **structural validation** (required fields, correct types)
  via `validateContractStructure`.
- Defines a `ContractValidator` adapter interface for full JSON Schema
  validation.  A concrete implementation lives in `video-workspace-contracts`
  and is injected at the process boundary.
- Treats contract documents as opaque, schema-versioned inputs.
  Schema ownership stays in `video-workspace-contracts`.

**Contract document format:**

```json
{
  "schema": "video-workspace-contracts/workspace-v1",
  "version": "0.1.0",
  "type": "channel|series|episode",
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>"
}
```

#### Initialization (`initChannel`, `initSeries`, `initEpisode`)

Creates the canonical workspace tree:

```
<slug>/
  .workspace/
    contract.json    -- schema version marker (never overwritten on re-init)
    metadata.json    -- user-editable metadata (never overwritten on re-init)
```

All init operations are **idempotent**: re-running init on an existing
workspace preserves user edits to both `contract.json` and `metadata.json`,
only filling in missing template files.

`ensureDefaultChannel(root, opts)` creates a channel with slug `"default"`
if none exists, enabling a zero-config first-run experience.

**Collision behaviour:**

- If a non-workspace file or directory exists at the slug path, init returns
  `E_ALREADY_EXISTS` with reason `path-collision`.
- If a workspace of a different kind exists (e.g. an episode where a series
  was expected), init returns `E_ALREADY_EXISTS` with reason `kind-mismatch`.

#### Discovery (`discoverChannels`, `discoverSeries`, `discoverEpisodes`)

Scans a parent directory and returns `DiscoveryResult`:

- `workspaces[]`: valid workspaces with slug, path, kind, schema, and version.
- `diagnostics[]`: skipped paths with machine-readable reason codes
  (`missing-contract`, `invalid-contract-json`,
  `invalid-contract-structure`, `untrusted-path`, `not-a-directory`,
  `read-error`, `permission-denied`).

Hidden directories (starting with `.`) and regular files are silently skipped.
Invalid library roots (relative paths, filesystem root `/`) return an error.

### CLI (`src/cli.ts`)

`vpr` prints help and version. Subcommands (`init`, `resolve`, `run`, `status`)
are reserved for later phases.

## Package structure

```text
src/
  index.ts          Public API barrel
  result.ts         Result<T,E> type and combinators
  errors.ts         RuntimeError and factory functions
  logging.ts        Logger port, ConsoleLogger, NoopLogger
  cli.ts            CLI entry point (bin: vpr)
  ports/
    index.ts        Re-exports
    clock.ts        Clock, SystemClock
    filesystem.ts   FileSystem, FsError
    lock.ts         Lock, Lease, LockError
    id-generator.ts IdGenerator
    event-sink.ts   EventSink, Event, EventSinkError
  workspace/
    index.ts        Re-exports
    types.ts        WorkspaceKind, WorkspaceDescriptor, WorkspaceMeta
    slugs.ts        Slug validation
    path-guard.ts   Allowed-root and symlink-aware path defense
    contracts.ts    Contract document type and adapter boundary
    init.ts         Workspace initialization (channel, series, episode)
    discover.ts     Workspace discovery from library roots
test/
  fixtures/
    index.ts        FakeClock, FakeFileSystem, FakeLock, etc.
  unit/
    workspace/      One spec file per workspace module
    ...             One spec file per source module
  integration/
    cli.test.ts     CLI smoke test
```

## Versioning

The runtime's public surface follows semantic versioning. Patch versions are
backward-compatible; minor versions may add optional fields or new port
methods; major versions may remove or re-shape exported symbols.

Contract schemas (workspace, pipeline, timeline, etc.) are owned by
`video-workspace-contracts`, not by this package. This package consumes those
schemas and enforces them at runtime.
