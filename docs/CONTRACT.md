# Contract: fal-media-adapter

## Version

`0.1.0` — foundation scaffold with versioned endpoint profiles.

## What this package owns

- Typed client for fal.ai queue REST API (`FalClient`)
- Configuration resolution from environment (`FAL_KEY`, `FAL_BASE_URL`, …)
- Versioned endpoint profiles as pure data (parameter schemas, capabilities, pricing, deprecation)
- Profile-backed contracts that validate unknown parameters before any spend
- Structured errors for every failure path
- Injectable transport, clock, sleeper, and downloader
- Logging with automatic credential redaction

## What this package does **not** own

- Endpoint selection (Pi chooses and records the binding)
- Autonomous model discovery or marketplace
- MCP protocol integration
- Pipeline orchestration or snapshot resolution (see `video-pipeline-runtime`)
- Workspace storage or artifact CAS
- Calling the fal API directly from profiles (profiles are data, not drivers)

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
  // Profile types
  type EndpointProfile,
  type ParameterField,
  type EndpointCapabilities,
  type PricingMetadata,
  type DeprecationInfo,
  type ProfileOperation,

  // Errors (all extend FalAdapterError)
  FalAdapterError,
  FalUnavailableError,        // missing FAL_KEY → typed unavailable state
  FalHttpError,               // non-2xx response
  FalNetworkError,            // DNS, TCP, TLS failure
  FalCancelledError,          // AbortSignal fired
  FalTimeoutError,            // deadline exceeded
  FalContractError,           // response shape mismatch
  FalValidationError,         // unknown/invalid parameters (before spend)
  FalDeprecatedProfileError,  // deprecated profile requested
  FalDownloadError,           // download or hash validation failure

  // Configuration
  resolveConfig,              // returns FalAdapterConfig | FalUnavailableError
  requireConfig,              // throws on missing key
  redactKey,                  // "fal-<prefix>...<suffix>"

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
  ProfileContract,

  // Profiles
  getProfile,
  listProfiles,
  computeSchemaFingerprint,
  validateParameters,
  requireValidParameters,
  deprecationDiagnostic,
  fluxDevV1,
  fluxFillV1,

  // Client
  FalClientImpl,
  createFalClient,
  type FalClient,
} from "fal-media-adapter";
```

## Endpoint profiles

Profiles are **immutable data objects** that describe a tested fal.ai endpoint. They are not classes with behavior – parameter validation is delegated to pure functions.

### Predefined profiles

| Profile ID | Operation | Description |
|---|---|---|
| `fal-ai/flux/dev@v1` | `text-to-image` | FLUX.1 [dev] text-to-image generation |
| `fal-ai/flux/fill@v1` | `image-edit` | FLUX.1 [fill] inpainting / image editing |

### Profile structure

```ts
interface EndpointProfile {
  readonly profileId: string;          // e.g. "fal-ai/flux/dev@v1"
  readonly endpointId: string;         // e.g. "fal-ai/flux/dev"
  readonly operation: "text-to-image" | "image-edit";
  readonly contractVersion: string;    // "v1"
  readonly schemaFingerprint: string;  // SHA-256 hex of the canonical parameter schema
  readonly parameterSchema: readonly ParameterField[];
  readonly capabilities: EndpointCapabilities;
  readonly pricing: PricingMetadata;
  readonly deprecation: DeprecationInfo | null;
}
```

### Parameter validation

Validation runs **before any HTTP request** – no spend occurs on invalid input:

- **Unknown parameters** are rejected with a diagnostic listing accepted parameters.
- **Missing required parameters** produce distinct errors.
- **Type mismatches** (e.g. string where integer is expected) are diagnosed individually.
- **Constraint violations** (min/max, enum values) are reported with allowed ranges.

```ts
const result = validateParameters(fluxDevV1, { prompt: "test", bad_param: true });
// result.errors: ['Unknown parameter "bad_param" is not accepted by profile "fal-ai/flux/dev@v1". Accepted parameters: prompt, image_size, ...']
```

### Schema fingerprint

Every profile carries an immutable `schemaFingerprint` – a SHA-256 hex digest of the canonical JSON representation of its parameter schema. This fingerprint is:

- **Deterministic**: re-computing yields the same hash.
- **Persisted in every job result**: `GenerationResult.schemaFingerprint` records the exact schema version used.
- **Changed by any schema modification**: adding/removing fields, changing defaults, or altering constraints all produce a different fingerprint.

### Deprecation

Profiles can carry deprecation information. When a deprecated profile is used, the client emits a warning log entry with the deprecation message, migration target, and sunset date. Callers can inspect `deprecationDiagnostic(profile)` for a human-readable diagnostic.

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
6. **Unknown inputs fail before spend**: parameter validation runs in-memory before any HTTP request. Unknown parameters, type mismatches, and constraint violations are rejected with typed `FalValidationError` diagnostics.
7. **Profile identity in every job**: `GenerationResult` records `profileId` and `schemaFingerprint` so the exact endpoint and schema version are always visible in job history.

## Error codes

| Code | Retryable | Meaning |
|---|---|---|
| `FAL_UNAVAILABLE` | No | `FAL_KEY` missing or empty |
| `FAL_HTTP_ERROR` | Depends on status | Server returned non-2xx |
| `FAL_NETWORK_ERROR` | Yes | DNS / TCP / TLS failure |
| `FAL_CANCELLED` | No | AbortSignal triggered |
| `FAL_TIMEOUT` | Yes | Deadline elapsed |
| `FAL_CONTRACT_ERROR` | No | Response shape mismatch |
| `FAL_VALIDATION_ERROR` | No | Unknown/invalid parameters rejected before spend |
| `FAL_DEPRECATED_PROFILE` | No | The requested profile is deprecated |
| `FAL_DOWNLOAD_ERROR` | Usually yes | Download or hash failure |
| `FAL_UNKNOWN_CONTRACT` | No | No contract registered for version |

## Versioning policy

Contracts use semantic versions. Readers must tolerate additive fields within a compatible version; breaking changes require a new contract version and migration fixtures. Profile schema fingerprints provide an additional immutability check independent of the contract version.
