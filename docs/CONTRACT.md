# Contract: fal-media-adapter

## Version

`0.1.0` — foundation scaffold.

## What this package owns

- Typed client for fal.ai queue REST API (`FalClient`)
- Configuration resolution from environment (`FAL_KEY`, `FAL_BASE_URL`, …)
- Versioned endpoint contracts
- Structured errors for every failure path
- Injectable transport, clock, sleeper, and downloader
- Logging with automatic credential redaction

## What this package does **not** own

- Endpoint selection (Pi chooses and records the binding)
- Autonomous model discovery or marketplace
- MCP protocol integration
- Pipeline orchestration or snapshot resolution (see `video-pipeline-runtime`)
- Workspace storage or artifact CAS

## Public API surface

Everything exported from the package entry point:

```ts
import {
  // Types
  type EndpointBinding,
  type GenerationInput,
  type GenerationResult,
  type OutputAsset,
  type CostBreakdown,
  type Transport, HttpRequest, HttpResponse,
  type Clock, type Sleeper, type Downloader, type DownloadResult,
  type FalAdapterConfig,

  // Errors (all extend FalAdapterError)
  FalAdapterError,
  FalUnavailableError,   // missing FAL_KEY → typed unavailable state
  FalHttpError,          // non-2xx response
  FalNetworkError,       // DNS, TCP, TLS failure
  FalCancelledError,     // AbortSignal fired
  FalTimeoutError,       // deadline exceeded
  FalContractError,      // response shape mismatch
  FalDownloadError,      // download or hash validation failure

  // Configuration
  resolveConfig,         // returns FalAdapterConfig | FalUnavailableError
  requireConfig,         // throws on missing key
  redactKey,             // "fal-<prefix>...<suffix>"

  // Logger
  createLogger,
  redactRecord,
  redactHeaders,
  type Logger, type LogEntry, type LogLevel,

  // Implementations
  FetchTransport,
  SystemClock, ManualClock,
  SystemSleeper, NoopSleeper,
  HttpDownloader,

  // Contracts
  type EndpointContract,
  V1BaseContract,

  // Client
  FalClientImpl,
  createFalClient,
  type FalClient,
} from "fal-media-adapter";
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `FAL_KEY` | Yes | — | fal.ai API key. Missing → `FalUnavailableError` |
| `FAL_BASE_URL` | No | `https://queue.fal.run` | API base URL |
| `FAL_DEFAULT_TIMEOUT_MS` | No | `300000` (5 min) | Default per-request timeout |
| `FAL_MAX_RETRIES` | No | `3` | Reserved for future retry policy |

## Key guarantees

1. **No silent network**: transport is injectable. Unit tests use a mock server.
2. **Typed unavailability**: `resolveConfig()` returns a `FalUnavailableError` instead of `null` or throwing, so callers can branch.
3. **Log safety**: `createLogger()` automatically redacts `authorization`, `proxy-authorization`, `x-api-key`, `cookie`, `set-cookie` headers, plus key-like fields (`falKey`, `apiKey`, `secret`, `token`, `password`). Raw secret values never appear in log output.
4. **Deterministic tests**: `ManualClock` and `NoopSleeper` eliminate wall-clock dependence.
5. **Versioned contracts**: every endpoint binding carries a `contractVersion`. The client resolves the correct `EndpointContract` at submit time and throws `FAL_UNKNOWN_CONTRACT` for unknown versions.

## Error codes

| Code | Retryable | Meaning |
|---|---|---|
| `FAL_UNAVAILABLE` | No | `FAL_KEY` missing or empty |
| `FAL_HTTP_ERROR` | Depends on status | Server returned non-2xx |
| `FAL_NETWORK_ERROR` | Yes | DNS / TCP / TLS failure |
| `FAL_CANCELLED` | No | AbortSignal triggered |
| `FAL_TIMEOUT` | Yes | Deadline elapsed |
| `FAL_CONTRACT_ERROR` | No | Response shape mismatch |
| `FAL_DOWNLOAD_ERROR` | Usually yes | Download or hash failure |
| `FAL_UNKNOWN_CONTRACT` | No | No contract registered for version |

## Versioning policy

Contracts use semantic versions. Readers must tolerate additive fields within a compatible version; breaking changes require a new contract version and migration fixtures.
