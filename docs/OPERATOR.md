# Qwen TTS Worker — Operator Guide

> Target audience: operators, SREs, and anyone deploying or monitoring the worker.

## Prerequisites

- Python 3.10 or later
- macOS with Apple Silicon (M1/M2/M3/M4) for production; any platform for development/testing
- pip 23+

## Installation

```bash
cd qwen-tts-worker
pip install -e ".[dev]"
```

For production deployment, install without dev dependencies:

```bash
pip install .
```

## Configuration

All settings are read from environment variables with the `QTW_` prefix.
A `.env` file in the working directory is also supported.

| Variable | Default | Description |
|----------|---------|-------------|
| `QTW_HOST` | `127.0.0.1` | IP to bind |
| `QTW_PORT` | `8000` | TCP port |
| `QTW_UNIX_SOCKET` | *(none)* | Path to Unix socket (takes priority over host/port) |
| `QTW_LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error`, or `critical` |
| `QTW_LOG_FORMAT` | `json` | `json` (machine-readable) or `console` (human-readable) |
| `QTW_TTS_MODE` | `live` | `live` fails closed; set `fake` explicitly for CI-only silent fixtures |
| `QTW_MODEL_PATH` | *(installed CustomVoice profile)* | Exact Qwen3-TTS CustomVoice directory for `/synthesize` |
| `QTW_MODEL_IDLE_TIMEOUT_SECONDS` | *(disabled)* | Unload the warm model after this many idle seconds; minimum 1 |
| `QTW_WORKERS` | `1` | Uvicorn worker processes (keep at 1 until the job queue supports concurrency) |
| `QTW_GRACEFUL_TIMEOUT` | `30.0` | Max seconds to drain in-flight requests on shutdown |
| `QTW_MODELS_DIR` | `models` | Directory for downloaded model files |
| `QTW_VOICES_DIR` | `voices` | Directory for voice profiles |
| `QTW_OUTPUTS_DIR` | `outputs` | Directory for synthesized WAV outputs |
| `QTW_ATTEMPT_STORE_DIR` | `QTW_OUTPUTS_DIR/attempt-store` | Durable jobs, immutable attempts/raw WAVs, and verified cache index |
| `QTW_ATTEMPT_MAX_RETRIES` | `2` | Maximum retries after the initial failed attempt |
| `QTW_ATTEMPT_RETRY_SEED_STEP` | `1` | Deterministic uint32 seed increment per retry |

### Unix socket example

```bash
export QTW_UNIX_SOCKET=/var/run/qtw/worker.sock
qwen-tts-worker
```

When a Unix socket is set, the server binds only to the socket — `HOST` and `PORT` are ignored.

## Running

### Direct

```bash
python -m qwen_tts_worker
```

### After pip install

```bash
qwen-tts-worker
```

The server starts without loading a TTS model. Model readiness is visible via the health endpoint and transitions through `none` → `loading` → `ready` as the model lifecycle manager operates.

## Model management

### Supported models

The worker serves two Qwen3-TTS MLX model sizes:

| Size | Files | Profile support |
|------|-------|----------------|
| 0.6B | `model.safetensors`, `config.json` | base, custom_voice, voice_design |
| 1.7B | `model.safetensors`, `config.json` | base, custom_voice, voice_design |

Each combination of size × profile is a separate entry. The registry
only reports on combinations it knows — it never invents or claims
unsupported configurations.

### Checking model status

```bash
# List all known models and their installation readiness
curl -s http://127.0.0.1:8000/models | jq .

# Check a single combination
curl -s http://127.0.0.1:8000/models/0.6B/base | jq .
```

Statuses:

| Status | Meaning |
|--------|---------|
| `not_installed` | No model directory exists |
| `partial` | Directory exists but is missing required safetensors files |
| `complete` | All required files present |
| `corrupt` | Files exist but cannot be read or hash mismatch |

### Downloading models

Model downloads are **explicit** — the worker never downloads anything
automatically. Use the CLI:

```bash
python -m qwen_tts_worker.cli.download 0.6B
python -m qwen_tts_worker.cli.download 1.7B --models-dir /cache/models
```

The download command:

1. Checks available disk space before starting any transfer (requires 2× expected size).
2. Verifies SHA-256 hashes of every downloaded file.
3. Writes a `.download.json` audit manifest alongside the model.
4. Supports cancellation via `SIGINT` (Ctrl+C).

### Diagnostics

Check external tool availability:

```bash
curl -s http://127.0.0.1:8000/models/diagnostics | jq .
```

This probes:

- **ffmpeg** — required for audio transcoding and WAV validation. Install via `brew install ffmpeg`.
- **mlx-audio** — the MLX TTS runtime. Install via `pip install mlx-audio`.

Both probes also appear in the `/health` endpoint dependency list.

## Health monitoring

### Quick liveness check

```bash
curl -s http://127.0.0.1:8000/health | jq .
```

A healthy service responds with:

```json
{
  "service": "healthy",
  "model": "none",
  "dependencies": [...],
  "uptime_seconds": 123.4,
  "timestamp": "2026-07-27T12:00:00Z",
  "version": "0.1.0"
}
```

### Interpreting the three tiers

| Field | Values | Meaning |
|-------|--------|---------|
| `service` | `healthy`, `degraded`, `unhealthy` | Overall service health |
| `model` | `none`, `loading`, `ready`, `error` | TTS model readiness |
| `dependencies` | `ok`, `unavailable`, `unknown` | Per-dependency status |

- `service: degraded` — at least one dependency is unavailable but the service itself is running. Investigate the dependency list.
- `service: unhealthy` — all dependencies are unavailable. The service cannot function.
- `model: none` — normal when the service starts. Load a model via the API (future) or wait for the lifecycle manager.
- `model: error` — model loading failed. Check the logs for the specific error.

### Log-based monitoring

When `QTW_LOG_FORMAT=json`, every log line is a JSON object with `timestamp`, `level`, `event`, and `logger` fields. Pipe to your log aggregator:

```bash
QTW_LOG_FORMAT=json qwen-tts-worker 2>&1 | tee /var/log/qtw/worker.log
```

## Warm model operation

The first live synthesis validates and hashes the exact checkpoint, loads it once, and leases it for the active request. Later requests for the same identity reuse that model. Check state and resource evidence with:

```bash
curl http://127.0.0.1:8000/models/runtime
```

The response includes the exact identity SHA-256, active lease count, load/attempt/unload counts, load and synthesis latency, active/peak MLX memory, and the last load diagnostic. To unload an idle model:

```bash
curl -X DELETE http://127.0.0.1:8000/models/runtime
```

Unload returns `409` while any synthesis request holds a lease; it never interrupts an active generation. Set `QTW_MODEL_IDLE_TIMEOUT_SECONDS` for automatic idle unload. Failed loads leave the lifecycle in `error`, are visible in runtime/health diagnostics, and may be retried by the next request.

## Durable attempts and recovery

New integrations submit complete segment/profile contracts to `POST /attempt-jobs`, then execute or poll by UUID. Runtime data is partitioned under the attempt store:

```text
jobs/       # atomically replaced lifecycle state
attempts/        # immutable terminal JSON manifests
raw-wav/         # immutable successful generation output
quality-reports/  # immutable signal metrics/checks/decisions
processed/        # transformed speech and exact pause WAVs
transform-reports/# immutable transform provenance
cache/            # rebuildable verified fingerprint index
```

On restart, an interrupted `running` job returns to `queued` and is marked recovered. Completed cache entries are reused only after attempt/fingerprint/segment/provider identity and WAV SHA-256 verification. Deleting the cache directory causes regeneration but does not delete provenance. Never edit attempt manifests or raw WAV files in place.

Cancellation is cooperative: queued work cancels immediately; MLX generation may finish internally, but bytes are discarded if cancellation was requested before persistence. Retry creates a new attempt with a deterministically advanced seed and never replaces its parent.

Validate every successful raw attempt before publication with `POST /attempt-jobs/{id}/validate`. Reject decisions block assembly. Review decisions require an explicit reviewed disposition. Fake mode produces silence by design and therefore always fails the speech-presence gate.

After acceptance, `POST /attempt-jobs/{id}/process` creates linked speech/pause artifacts without touching raw WAVs. Current policy trims only threshold-silent edges, retains 80 ms margins, and applies no micro-fade. Duplicate transform identity fails instead of overwriting prior output.

## Graceful shutdown

Send `SIGTERM` or `SIGINT` (Ctrl+C) to the worker process. The server will:

1. Stop accepting new connections.
2. Wait up to `QTW_GRACEFUL_TIMEOUT` seconds for in-flight requests to complete.
3. Exit.

```bash
kill -TERM $(pgrep -f qwen_tts_worker)
```

A forced exit occurs if in-flight requests do not complete within the graceful timeout.

## Filesystem layout

```
QTW_MODELS_DIR/    # Downloaded model weights, tokenizers, configs
QTW_VOICES_DIR/    # Voice profile JSON files, reference embeddings
QTW_OUTPUTS_DIR/   # Synthesized WAVs and default durable attempt store
```

All directories are created automatically on startup if they do not exist.

## Development mode

```bash
pip install -e ".[dev]"
QTW_LOG_LEVEL=debug QTW_LOG_FORMAT=console python -m qwen_tts_worker
```

The interactive API docs are available at `http://127.0.0.1:8000/docs`.

## Running tests

```bash
pytest
```

Tests run without MLX hardware — they use the real application factory with in-memory state and require no GPU.

```bash
pytest --cov=src/qwen_tts_worker --cov-report=term
```

## Troubleshooting

### Port already in use

```bash
QTW_PORT=8001 qwen-tts-worker
```

### Permission denied on Unix socket

Ensure the socket directory is writable by the worker process:

```bash
mkdir -p /var/run/qtw
chown $USER /var/run/qtw
export QTW_UNIX_SOCKET=/var/run/qtw/worker.sock
```

### No models directory

The directories are created automatically. If creation fails, check filesystem permissions or set explicit writable paths:

```bash
export QTW_MODELS_DIR=$HOME/.cache/qtw/models
export QTW_VOICES_DIR=$HOME/.cache/qtw/voices
export QTW_OUTPUTS_DIR=$HOME/.cache/qtw/outputs
```
