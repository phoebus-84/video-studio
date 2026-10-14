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

## Recovering an exhausted retry limit

An operator can authorize **one** further attempt, without deleting failures,
changing the global cap, selecting an old take, or accepting any output:

```bash
vpr retry channel/series/episode animatic --after-attempt 5 \
  --note 'Generation repaired; the pose is now accepted' --library /path/to/library
```

Run this in the operator's own terminal, not Pi's headless shell. The normal
operator credential is required, including for `--dry-run`. The signed
`stage-retry-granted` journal record binds the episode, stage definition,
last lease and next attempt. A second grant for the same attempt is idempotent;
claiming consumes it even if that attempt later fails or times out. Review,
dependency, attendance and budget checks still run normally. `--after-attempt`
refuses a stale operator decision. Restart a gateway already running older
runtime code before asking it to claim the newly authorized attempt.

This is recovery, **not** a pause command: do not report a successful pose test
as a failed animatic merely to end a review conversation. Prepare/review the pose
before claiming the full animatic stage. Never invent a successful completion
to reset retries. Existing erroneous failures remain in history; explain them
in the operator's retry note.

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
