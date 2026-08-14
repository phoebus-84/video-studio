# Contributing to ffmpeg-video-composer

## Prerequisites

- Node.js 18+
- FFmpeg 6+ (for integration testing; unit tests use fakes)

## Setup

```bash
npm install
npm run build
npm test
```

## Project Structure

```
src/
  index.ts              — Public API surface (versioned exports)
  types.ts              — All shared types and error classes
  discovery.ts          — FFmpeg/ffprobe discovery and output parsing
  process-runner.ts     — Argv-only process runner with cancellation
  process-factory.ts    — Injectable spawn (real or fake)
  process-factory-types.ts — SpawnFn type
  workspace.ts          — Temporary workspace lifecycle
  doctor.ts             — Diagnostic tool
  logging.ts            — Structured JSON-line logger with redaction
  validator.ts          — Timeline semantic validator (pre-FFmpeg checks)
tests/
  fixtures/
    fake-ffmpeg.ts      — Fake process system (state + FakeChildProcess)
  *.test.ts             — Vitest test suites
docs/
  API.md                — Public contract
  CONTRIBUTING.md       — This file
```

## Design Decisions

### Pre-FFmpeg validation

The validator (`src/validator.ts`) enforces editorial constraints before any
FFmpeg process is spawned. It detects:
- Impossible timing (duration mismatches, overlaps, negative in-points)
- Out-of-bounds captions/transitions/audio fades
- Stale dependency markers from upstream systems
- Missing or hash-mismatched assets (via injectable `AssetProbe`)

The validator never silently clamps, reorders, or repairs editorial timing.
Every rejection is a typed, machine-readable `ValidationMessage` with a code,
JSON-Path location, and contextual diagnostics.

### No shell interpolation

All process execution uses argv arrays. This eliminates quoting bugs with paths containing spaces or Unicode characters, and prevents shell injection.

### Injectable spawn

The `process-factory.ts` module provides a `setSpawn()` / `getSpawn()` injection point. Tests swap the real `child_process.spawn` for a fake implementation that returns pre-configured output without executing real binaries. This makes tests deterministic and fast.

### Cancellation

When an `AbortSignal` fires, the process tree is terminated:
1. `childProcess.kill(signal)` — terminates the Node.js child process handle (works with fakes)
2. `process.kill(-pid, signal)` — OS-level process group kill (Unix only; best-effort)

### Types over schemas

All public types are defined in `types.ts` and versioned within the package's major version. This ensures downstream consumers can rely on stable contracts.

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Type check only
npm run typecheck
```

## Fake Process System

Tests use `tests/fixtures/fake-ffmpeg.ts` which provides:

- `installFakeSpawn()` / `uninstallFakeSpawn()` — swap the process factory
- `setFake(command, response)` — configure a fake response for a command
- `setFake("", response)` — catch-all for any command
- `clearFakes()` / `clearRecordedCalls()` — reset state
- `getRecordedCalls()` — inspect what was spawned

Example:

```typescript
beforeEach(() => {
  installFakeSpawn();
  clearFakes();
});

afterEach(() => {
  uninstallFakeSpawn();
});

it("example", async () => {
  setFake("ffmpeg", { stdout: "v6.0", exitCode: 0 });
  const result = await runProcess("ffmpeg", ["-version"]);
  expect(result.exitCode).toBe(0);
});
```

## Adding New Features

1. Add types in `src/types.ts`
2. Implement in the appropriate module
3. Export from `src/index.ts`
4. Write tests with fake processes
5. Update `docs/API.md`
6. Run `npm test && npm run build`
