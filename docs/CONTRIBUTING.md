# Contributing to fal-media-adapter

## Development setup

```bash
# Install dependencies
npm install

# Typecheck
npm run typecheck

# Run tests
npm test

# Watch mode
npm run test:watch
```

## Architecture overview

```
src/
├── index.ts          Public API barrel
├── types.ts          All shared TypeScript interfaces
├── config.ts         Environment resolution + key redaction
├── errors.ts         Structured, typed error hierarchy
├── logger.ts         JSON-line logger with credential redaction
├── transport.ts      FetchTransport (injectable HTTP)
├── clock.ts          SystemClock + ManualClock (for tests)
├── sleeper.ts        SystemSleeper + NoopSleeper (for tests)
├── downloader.ts     HttpDownloader with hash validation
├── client.ts         FalClientImpl – wires everything together
└── contracts/
    └── v1.ts         V1BaseContract + EndpointContract interface
```

## Dependency injection

Every external side effect is behind an interface:

| Interface | Default | Test fake |
|---|---|---|
| `Transport` | `FetchTransport` | `MockServer` (test fixture) |
| `Clock` | `SystemClock` | `ManualClock` |
| `Sleeper` | `SystemSleeper` | `NoopSleeper` |
| `Logger` | `createLogger()` (stdout/stderr) | Capture writer |

This means **unit tests never hit the network, never wait for real time, and can inspect every log line.**

## Adding a new endpoint profile

1. Create a class extending `V1BaseContract` (or implement `EndpointContract` directly).
2. Override `validateParameters()` to validate and normalise the model-specific input.
3. Override `parseOutputs()` if the model returns a non-standard output shape.
4. Register it with the client:

```ts
const client = new FalClientImpl({
  config: myConfig,
  contracts: [new FluxContract(), new SdxlContract()],
});
```

## Running tests

```bash
# All tests (no real network)
npm test

# Specific test file
npx vitest run test/errors.test.ts
```

## Design rules

- **No real network in tests**: all HTTP goes through `MockServer`.
- **Credentials never in logs**: the logger redacts headers and key-like fields automatically. When adding new logging calls, pass the raw value and let the logger handle redaction.
- **Errors are typed**: every failure path returns an `FalAdapterError` subclass with a stable `code`, `retryable` flag, and `toJSON()` envelope.
- **Config returns unavailable state**: `resolveConfig()` returns `FalAdapterConfig | FalUnavailableError` — never throw from config resolution.
- **Contracts are versioned**: the `contractVersion` in the binding selects the parser. Unknown versions produce `FAL_UNKNOWN_CONTRACT`.

## Related modules

- `video-workspace-contracts`: canonical schemas (future dependency)
- `video-pipeline-runtime`: stage execution, leases, staleness
- `pi-video-agent`: executive producer that calls this adapter
