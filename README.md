# video-pipeline-runtime

Deterministic filesystem runtime for agent-directed video pipelines.

## Owns

Workspace initialization, configuration inheritance, pipeline resolution and snapshotting, artifact validation, atomic revision writes, stage leases, immutable attempts, append-only journals, approval and budget policy, dependency staleness, resume, rerun planning, and a CLI/library API.

## Boundary

This runtime is the production clerk, not the director. It never adapts a story, writes a script, chooses a visual style, or silently selects a provider. Pi performs those decisions using skills.

## Primary consumers

`pi-video-agent`, `video-studio-gateway`, and tests in `video-built-in-pipelines`.

## Quick start

```bash
npm install
npm run build
npm test
```

## Package structure

```text
src/
  index.ts          Public API barrel
  result.ts         Result<T,E> type and combinators
  errors.ts         RuntimeError and factory functions
  logging.ts        Logger port, ConsoleLogger, NoopLogger
  cli.ts            CLI entry point (bin: vpr)
  ports/
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

## Documentation

- [Public contracts](./docs/CONTRACTS.md) — exported API and versioning
- [Contributing](./docs/CONTRIBUTING.md) — setup, architecture, conventions

## Plan

Use `bd list`, `bd graph`, and `bd show <id>` for the detailed dependency-aware plan.
