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
├── profiles.ts       EndpointProfile definitions, validation, fingerprinting
└── contracts/
    └── v1.ts         V1BaseContract, ProfileContract, EndpointContract interface
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

Endpoint profiles are **pure data** – they describe what parameters an endpoint accepts, its capabilities, pricing, and deprecation status. No pipeline behavior should be encoded in profiles.

### Step 1: Define the profile

Add an `EndpointProfile` to `src/profiles.ts` using `defineProfile()`:

```ts
export const myNewProfile: EndpointProfile = defineProfile({
  profileId: "fal-ai/my/model@v1",
  endpointId: "fal-ai/my/model",
  operation: "text-to-image",           // or "image-edit"
  contractVersion: "v1",
  parameterSchema: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Text prompt describing the desired image.",
    },
    {
      name: "image_size",
      type: "enum",
      required: false,
      defaultValue: "square",
      enumValues: ["square", "landscape", "portrait"],
      description: "Output image dimensions.",
    },
    // ... more parameters
  ],
  capabilities: {
    supportedAspectRatios: ["square", "landscape", "portrait"],
    supportsSeed: true,
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    supportsNegativePrompt: false,
    defaultImageSize: "square",
  },
  pricing: {
    unit: "inference",
    estimatedUnitCost: 0.005,
    currency: "USD",
  },
  // Optional: deprecation info
  deprecation: {
    message: "Use fal-ai/flux/dev@v1 instead.",
    migrationTarget: "fal-ai/flux/dev@v1",
    sunsetDate: "2025-06-01T00:00:00Z",
  },
});
```

The `schemaFingerprint` is computed automatically from the parameter schema.

### Step 2: Register the profile

Add the profile to the `PROFILES` array at the bottom of `src/profiles.ts`.

### Step 3: Use with ProfileContract

```ts
import { ProfileContract } from "fal-media-adapter";
import { myNewProfile } from "fal-media-adapter";

const client = new FalClientImpl({
  config: myConfig,
  contracts: [new ProfileContract(myNewProfile)],
});
```

The `ProfileContract` automatically validates parameters against the profile's schema before any HTTP request is made. Unknown parameters are rejected with a `FalValidationError`.

### Profile parameter types

| Type | Description |
|---|---|
| `string` | Any string value |
| `number` | Any finite number |
| `integer` | Whole numbers only |
| `boolean` | `true` or `false` |
| `enum` | String from a predefined set (`enumValues`) |

### Validation guarantees

- **Unknown parameters** are rejected before spend (no HTTP request occurs).
- **Missing required parameters** produce clear diagnostics.
- **Type mismatches** and **constraint violations** (min/max) are diagnosed individually.
- **Defaults** are applied for optional parameters with `defaultValue`.

### Advanced: custom contract with manual validation

For endpoints that need non-standard request building or response parsing, extend `V1BaseContract`:

```ts
class MyCustomContract extends V1BaseContract {
  readonly version = "v1";
  readonly endpointPath = "fal-ai/my/custom-endpoint";

  validateParameters(params: Record<string, unknown>): Record<string, unknown> {
    // Custom validation logic
    if (!params.prompt || typeof params.prompt !== "string") {
      throw new Error("prompt must be a non-empty string");
    }
    return { prompt: params.prompt };
  }

  // Override parseOutputs for non-standard output shapes
  protected parseOutputs(result: Record<string, unknown>): OutputAsset[] {
    // Custom output parsing
    return super.parseOutputs(result);
  }
}
```

## Schema fingerprint

Every profile has an immutable `schemaFingerprint` – a SHA-256 hash of the canonical parameter schema. This is used to:

- Detect schema changes: any modification to the parameter schema changes the fingerprint.
- Persist profile identity: every `GenerationResult` records the fingerprint, so jobs are always traceable to the exact profile version used.
- Verify reproducibility: different environments or builds can confirm they're using the same profile definition.

## Running tests

```bash
# All tests (no real network)
npm test

# Specific test file
npx vitest run test/profiles.test.ts
```

## Design rules

- **Profiles are data, not code**: `EndpointProfile` objects are pure, frozen data. Parameter validation is handled by pure functions (`validateParameters`, `requireValidParameters`), not profile methods.
- **No real network in tests**: all HTTP goes through `MockServer`.
- **Unknown inputs fail before spend**: validation runs before any HTTP request. The mock server's `received` array can be inspected to confirm no requests were made on invalid input.
- **Credentials never in logs**: the logger redacts headers and key-like fields automatically. When adding new logging calls, pass the raw value and let the logger handle redaction.
- **Errors are typed**: every failure path returns an `FalAdapterError` subclass with a stable `code`, `retryable` flag, and `toJSON()` envelope.
- **Config returns unavailable state**: `resolveConfig()` returns `FalAdapterConfig | FalUnavailableError` — never throw from config resolution.
- **Contracts are versioned**: the `contractVersion` in the binding selects the parser. Unknown versions produce `FAL_UNKNOWN_CONTRACT`.
- **Profiles are immutable**: all profile objects and their nested properties are frozen with `Object.freeze()`. The `schemaFingerprint` is computed once at definition time.

## Related modules

- `video-workspace-contracts`: canonical schemas (future dependency)
- `video-pipeline-runtime`: stage execution, leases, staleness
- `pi-video-agent`: executive producer that calls this adapter
