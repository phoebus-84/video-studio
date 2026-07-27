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
test/
  fixtures/
    index.ts        FakeClock, FakeFileSystem, FakeLock, etc.
  unit/             One spec file per source module
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
