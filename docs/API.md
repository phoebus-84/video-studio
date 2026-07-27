# API Reference — ffmpeg-video-composer

## Public Contract (v0.1)

All exports from the package root (`ffmpeg-video-composer`) are versioned and stable
within a major version. Internal modules are not part of the public contract.

### Discovery

```typescript
import {
  discoverFfmpeg,
  discoverFfmpegOrThrow,
  buildFfmpegInfo,
  parseVersion,
  parseCodecs,
  parseFilters,
} from "ffmpeg-video-composer";
```

- **`discoverFfmpeg(): Promise<FfmpegInfo | null>`** — search PATH for ffmpeg/ffprobe, return parsed info or null.
- **`discoverFfmpegOrThrow(): Promise<FfmpegInfo>`** — like above but throws `FfmpegNotFoundError` if not found.
- **`buildFfmpegInfo(ffmpegPath, ffprobePath): Promise<FfmpegInfo>`** — build info from known paths (calls `-version`, `-codecs`, `-filters`).
- **`parseVersion(raw): FfmpegParsedVersion | null`** — parse semver from version output.
- **`parseCodecs(raw): CodecEntry[]`** — parse `ffmpeg -codecs` output.
- **`parseFilters(raw): FilterEntry[]`** — parse `ffmpeg -filters` output.

### Process Runner

```typescript
import { runProcess } from "ffmpeg-video-composer";
```

- **`runProcess(command, args?, options?): Promise<ProcessResult>`** — spawn a child process with argv-only arguments (no shell interpolation). Supports cancellation via `AbortSignal`, timeout, environment overrides, cwd, and secret redaction.

#### ProcessOptions

| Field          | Type          | Default        | Description                              |
| -------------- | ------------- | -------------- | ---------------------------------------- |
| `cwd`          | `string`      | `process.cwd()`| Working directory                        |
| `env`          | `object`      | `process.env`  | Merged environment variables             |
| `timeoutMs`    | `number`      | —              | Kill process after timeout               |
| `signal`       | `AbortSignal` | —              | Cancellation signal (terminates tree)    |
| `captureStderr`| `boolean`     | `true`         | Whether to capture stderr                |
| `redact`       | `string[]`    | `[]`           | Secrets to replace with `[REDACTED]`     |

#### ProcessResult

| Field       | Type               | Description                              |
| ----------- | ------------------ | ---------------------------------------- |
| `exitCode`  | `number \| null`   | Exit code (null if killed by signal)     |
| `signal`    | `string \| null`   | Signal name if killed                    |
| `stdout`    | `string`           | Captured stdout (UTF-8)                  |
| `stderr`    | `string`           | Captured stderr (UTF-8)                  |
| `durationMs`| `number`           | Wall-clock duration                      |
| `cancelled` | `boolean`          | True if process was cancelled            |

### Workspace

```typescript
import { createWorkspace, workspaceSubdir } from "ffmpeg-video-composer";
```

- **`createWorkspace(): Promise<Workspace>`** — create a temporary directory under the OS temp dir. Call `workspace.cleanup()` to remove it.
- **`workspaceSubdir(workspace, ...segments): string`** — resolve a subdirectory path inside a workspace.

### Doctor

```typescript
import { runDoctor } from "ffmpeg-video-composer";
```

- **`runDoctor(logger?, requiredCodecs?, requiredFilters?): Promise<DoctorReport>`** — diagnostic that checks FFmpeg availability and reports which required codecs/filters are present or missing. Default required lists cover the composer's core needs (libx264, libx265, aac, scale, overlay, loudnorm, etc.).

### Logging

```typescript
import { createLogger } from "ffmpeg-video-composer";
```

- **`createLogger(minLevel?, redact?, write?): Logger & { setRedact }`** — creates a structured JSON-line logger with redaction support.

### Errors

```typescript
import {
  ComposerError,
  FfmpegNotFoundError,
  ProcessCancelledError,
  ProcessTimeoutError,
  WorkspaceError,
} from "ffmpeg-video-composer";
```

All errors extend `ComposerError` with a `code` field and optional `context` for machine-readable diagnostics.

### Timeline Validation

```typescript
import {
  validateTimeline,
  TimelineValidationError,
} from "ffmpeg-video-composer";
```

- **`validateTimeline(timeline, options?): Promise<ValidationResult>`** — validate a typed edit timeline against editorial semantics **before** any FFmpeg invocation. Returns a `ValidationResult` with `valid`, `errors`, and `warnings`. The validator never silently clamps, reorders, or repairs editorial timing.

#### ValidationOptions

| Field       | Type         | Default | Description                                      |
| ----------- | ------------ | ------- | ------------------------------------------------ |
| `assetProbe`| `AssetProbe` | —       | Injectable function for asset existence/hash/revision checks. Omit to skip asset-level validation. |
| `strict`    | `boolean`    | `false` | Promote all warnings to errors (rejects on any diagnostic). |

#### ValidationResult

| Field      | Type                  | Description                               |
| ---------- | --------------------- | ----------------------------------------- |
| `valid`    | `boolean`             | `true` if no errors (warnings allowed unless `strict`) |
| `errors`   | `ValidationMessage[]` | Rejection-level diagnostics               |
| `warnings` | `ValidationMessage[]` | Advisory diagnostics                      |

#### ValidationMessage

| Field     | Type                    | Description                                          |
| --------- | ----------------------- | ---------------------------------------------------- |
| `code`    | `string`                | Machine-readable error code (e.g. `SCENE_OVERLAP`)   |
| `message` | `string`                | Human-readable description                            |
| `path`    | `string`                | JSON-Path-style location in the timeline              |
| `context` | `Record<string, unknown>` | Diagnostic context (received values, constraints)  |

#### Checks performed

- **Canvas**: positive width/height, safe-area margin fractions in [0,1) with no overlap
- **Profile**: positive FPS, string codec/pixelFormat when present
- **Scenes**: unique IDs, non-empty asset path, inPoint ≥ 0, outPoint > inPoint, timelineStart ≥ 0
- **Duration**: if explicit `duration` is provided it MUST equal `outPoint − inPoint` — mismatches are hard errors, never silently clamped
- **Ordering**: non-decreasing timelineStart; decreasing order is rejected
- **Overlap**: scenes must not overlap in timeline space (hard error); gaps produce warnings
- **Transitions**: valid type, positive duration ≤ scene duration, must not exceed adjacent scene durations
- **Captions**: non-empty text, in-bounds start+duration, valid position/font fields
- **Audio**: non-negative volume/fadeIn/fadeOut, fades must fit within scene duration
- **Transform**: valid fit mode, positive scale, valid crop rectangle
- **Filters**: array of objects with non-empty `name`
- **Stale marker**: when a valid `stale` object (with source+reason) is present, a hard error is raised to block rendering of stale inputs
- **Asset probe**: when `assetProbe` is provided, validates asset existence, hash match/mismatch, and revision drift

#### AssetProbe

```typescript
type AssetProbe = (path: string) => Promise<AssetProbeResult | null>;

interface AssetProbeResult {
  hash?: string;      // Content hash for integrity verification
  revision?: string;   // Opaque revision stamp from metadata store
  size?: number;       // File size in bytes
}
```

The probe is called once per unique asset path (deduped). Returning `null` signals
that the asset cannot be found or read, producing an `ASSET_NOT_FOUND` error.

### Timeline Types

```typescript
import type {
  Timeline,
  Canvas,
  SafeArea,
  OutputProfile,
  Scene,
  AssetRef,
  Transition,
  Caption,
  AudioConfig,
  VisualTransform,
  Crop,
  VideoFilter,
  StaleMarker,
} from "ffmpeg-video-composer";
```

The `Timeline` type is the canonical representation of editorial intent:
- `version`: always `"1.0"`
- `canvas`: dimensions and safe-area constraints
- `scenes`: ordered array of timed scene references with optional per-scene config
- `profile`: output encoding parameters (fps, codec, pixel format)
- `stale`: optional marker attached by upstream dependency trackers

### Types

See the full type definitions in `dist/index.d.ts` after building:

```bash
npm run build
cat dist/types.d.ts
```

Key types: `FfmpegInfo`, `CodecEntry`, `FilterEntry`, `ProcessOptions`, `ProcessResult`, `Workspace`, `LogEntry`, `Logger`, `DoctorReport`, `RequiredCapabilityReport`.
