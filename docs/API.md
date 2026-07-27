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

### Types

See the full type definitions in `dist/index.d.ts` after building:

```bash
npm run build
cat dist/types.d.ts
```

Key types: `FfmpegInfo`, `CodecEntry`, `FilterEntry`, `ProcessOptions`, `ProcessResult`, `Workspace`, `LogEntry`, `Logger`, `DoctorReport`, `RequiredCapabilityReport`.
