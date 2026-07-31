# Qwen TTS Worker — Public API Contract

> **Version**: 0.1.0
> **Base URL**: `http://127.0.0.1:8000` (or Unix socket)
> **OpenAPI**: `GET /openapi.json`
> **Interactive docs**: `GET /docs`

## Overview

The qwen-tts-worker exposes a typed HTTP/1.1 API for speech synthesis. It is a persistent, long-lived service that keeps TTS models warm between synthesis requests. The API is versioned, and the OpenAPI 3.1 schema at `/openapi.json` is the authoritative contract.

## Content type

All request and response bodies use `application/json`. The server does not accept or return plain text or HTML on API paths.

```http
Content-Type: application/json
Accept: application/json
```

## Request identification

Every response carries an `X-Request-ID` header containing a server-generated UUIDv4. Include this ID when reporting issues.

```http
HTTP/1.1 200 OK
X-Request-ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

## Health

### `GET /health`

Returns a three-tier health report.

**Service health** (`healthy` | `degraded` | `unhealthy`):
Whether the HTTP server and its immediate dependencies are operational.

**Model readiness** (`none` | `loading` | `ready` | `error`):
Whether a TTS model is loaded and accepting synthesis requests. Starts
as `none` — the service starts without loading a model.

**Dependencies**:
Per-dependency probe results (e.g. filesystem, model registry).

#### Response `200 OK`

```json
{
  "service": "healthy",
  "model": "none",
  "dependencies": [
    {
      "name": "filesystem",
      "status": "ok",
      "detail": null,
      "latency_ms": 0.12
    }
  ],
  "uptime_seconds": 42.0,
  "timestamp": "2026-07-27T12:00:00Z",
  "version": "0.1.0"
}
```

## Model registry

### `GET /models`

List every known Qwen3-TTS MLX model size/profile combination and its
installation readiness.  The registry is the authoritative catalogue —
combinations that are **not** supported are never listed.

#### Response `200 OK`

```json
[
  {
    "size": "0.6B",
    "profile": "base",
    "status": "not_installed",
    "path": "./models/qwen3-tts-0.6B/base",
    "missing_files": [],
    "installed_size_bytes": null,
    "detail": "Directory does not exist."
  },
  {
    "size": "0.6B",
    "profile": "custom_voice",
    "status": "complete",
    "path": "./models/qwen3-tts-0.6B/custom_voice",
    "missing_files": [],
    "installed_size_bytes": 1300000000,
    "detail": "All required files present."
  }
]
```

### `GET /models/{size}/{profile}`

Get installation status for a single model size/profile combination.

#### Response `200 OK`

```json
{
  "size": "0.6B",
  "profile": "base",
  "status": "complete",
  "path": "./models/qwen3-tts-0.6B/base",
  "missing_files": [],
  "installed_size_bytes": 1300000000,
  "detail": "All required files present."
}
```

#### Response `404 Not Found`

Returned when the size, profile, or combination is unknown.

```json
{
  "error": "Unknown model size: '3B'. Known sizes: 0.6B, 1.7B",
  "detail": [],
  "request_id": "..."
}
```

### `GET /models/diagnostics`

Run mlx-audio and FFmpeg dependency probes. Returns status for each
external tool required by the TTS pipeline. Does **not** load any model.

#### Response `200 OK`

```json
{
  "dependencies": [
    {
      "name": "ffmpeg",
      "status": "ok",
      "version": "6.1.1",
      "detail": "Found at /usr/local/bin/ffmpeg"
    },
    {
      "name": "mlx-audio",
      "status": "ok",
      "version": "0.1.0",
      "detail": "Importable; no model loaded."
    }
  ]
}
```

### `GET /models/runtime`

Report the live warm-model state. Fields include `state`, exact `identity_sha256`, `active_references`, load attempt/success/unload counts, synthesis count and latency, active/peak MLX memory, timestamps, and `last_error`. The first live synthesis transitions `unloaded → loading → ready`; repeated requests for the same identity reuse the loaded object.

### `DELETE /models/runtime`

Unload the current model and release MLX cache memory. Returns `200` when already unloaded or successfully unloaded. Returns `409` while any synthesis request holds an active model lease, so an operator or idle policy cannot interrupt generation.

## Voice profiles

Voice profiles describe how a narrator should sound. They are persistent
and identify a voice independently of any generated audio file.

### `GET /voices`

List all voice profiles (previews).

#### Response `200 OK`

```json
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Narrator",
    "mode": "preset",
    "language": "en",
    "updated_at": "2026-07-27T12:00:00Z"
  }
]
```

### `POST /voices`

Create a new voice profile.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-128) | yes | Human-readable label |
| `mode` | `"preset"` \| `"clone"` \| `"design"` | yes | Synthesis method |
| `preset_name` | string | when mode=preset | Qwen3-TTS preset |
| `reference_audio_path` | string | when mode=clone | Path to reference audio |
| `description` | string | when mode=design | VoiceDesign description |
| `language` | string (2-8) | no (default "en") | BCP-47 tag |
| `speed` | float (0.5-2.0) | no (default 1.0) | Speed multiplier |

#### Response `201 Created`

Returns the full `VoiceProfile` object.

### `GET /voices/{voice_id}`

Get a single voice profile by UUID.

#### Response `200 OK`

Returns the full `VoiceProfile` object.

#### Response `404 Not Found`

```json
{
  "error": "Voice profile 'uuid' not found.",
  "detail": [],
  "request_id": "..."
}
```

### `PATCH /voices/{voice_id}`

Update an existing voice profile. Only provided fields are changed.

#### Request body

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (1-128) | New label |
| `speed` | float (0.5-2.0) | New speed |
| `language` | string (2-8) | New language |

#### Response `200 OK`

Returns the updated `VoiceProfile`.

### `DELETE /voices/{voice_id}`

Delete a voice profile.

#### Response `204 No Content`

## Compatibility synthesis

### `POST /synthesize`

Synchronous compatibility endpoint for one Qwen3-TTS **CustomVoice** segment. New pipeline integrations should use the durable attempt-job API below.

Live mode is fail-closed. Set `QTW_TTS_MODE=live` (the default) to use MLX or explicitly set `QTW_TTS_MODE=fake` for CI. A live model/import/generation/output failure returns a terminal failed result; it is never replaced by fake or silent audio. Fake responses are labeled with `provider_mode: "fake"`.

#### Request body

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string (1–5000) | required | One prepared semantic segment |
| `voice` | string | `serena` | Speaker from the model config or a documented alias |
| `language` | backend language name | `auto` | Passed exactly as MLX `lang_code`; BCP-47 aliases are not accepted |
| `instruct` | string or null | null | CustomVoice delivery instruction |
| `temperature` | float (0, 2] | 0.7 | Sampling temperature |
| `top_k` | integer 0–10000 | 50 | Sampling top-k |
| `top_p` | float (0, 1] | 1.0 | Nucleus sampling |
| `repetition_penalty` | float 1–3 | 1.05 | Repetition penalty |
| `max_tokens` | integer 1–8192 | 1200 | Generation ceiling |
| `seed` | uint32 | 42 | Applied to `mx.random` before generation |
| `speed` | exactly 1.0 | 1.0 | Other values are rejected because mlx-audio 0.4.6 does not support Qwen speed control |

`voice_description` and `ref_audio` remain recognizable compatibility fields but are rejected with `422`: they require VoiceDesign and Base voice-cloning models, respectively. Unknown speakers and unavailable model profiles fail before generation.

#### Response `202 Accepted`

The compatibility route currently completes inline but retains its historical `202` response. Inspect both `ok` and `result.status`.

```json
{
  "ok": false,
  "result": {
    "job_id": "tts-0123456789ab",
    "status": "failed",
    "provider_mode": "live",
    "actual_speaker": null,
    "model_path": null,
    "wav_path": null,
    "error": "FileNotFoundError: CustomVoice model directory not found: ..."
  }
}
```

A live result is completed only after the output is verified as uncompressed mono PCM16 at 24 kHz with non-empty frames and RMS above -50 dBFS. Failed output is not persisted.

### `GET /synthesize/{job_id}`

Returns the in-memory compatibility result. Both `completed` and `failed` jobs are terminal and include `result`; this compatibility store does not survive worker restart.

## Durable attempt jobs

### `POST /attempt-jobs`

Submit one complete `SegmentPlan` and `SynthesisProfile`. The response is a durable job with `provider_mode`, full request fingerprint, retry lineage, and cache status. Exact completed segment/fingerprint/provider matches return immediately with `phase=completed` and `cache_hit=true`; otherwise the job is queued.

### `POST /attempt-jobs/{job_id}/execute`

Execute a queued job synchronously through the warm-model lifecycle. Each terminal outcome creates an immutable attempt manifest. Successful raw WAVs are content-hashed and retained; failed/cancelled attempts never receive a WAV. A provider-mode change after submission fails rather than crossing live/fake cache identity.

### `GET /attempt-jobs` and `GET /attempt-jobs/{job_id}`

List or poll durable jobs. A job found in `running` state after process restart is recovered to `queued` with `recovered_after_restart=true`.

### `GET /attempt-jobs/{job_id}/attempt`

Return the immutable terminal `SynthesisAttempt`, including exact profile, direction, fingerprint, raw WAV metadata or reason-coded failure, retry parent, timestamps, and processing duration.

### `POST /attempt-jobs/{job_id}/cancel`

Request cooperative cancellation. Queued cancellation is immediate. Running generation output is discarded if cancellation arrives before persistence.

### `POST /attempt-jobs/{job_id}/retry`

Create a new queued job for a retryable failed attempt. Retry never overwrites the prior attempt, increments the seed deterministically, records `retry_of`, bypasses cache, and enforces the configured retry bound.

### `POST /attempt-jobs/{job_id}/validate`

Measure artifact integrity, canonical format, duration, speech presence, clipping, DC offset, edge silence, and optional words/minute. The immutable response includes the complete policy fingerprint, metrics, reason-coded checks, and `accept`, `review`, or `reject` decision.

### `GET /attempt-jobs/quality-reports/{report_id}`

Retrieve persisted validation evidence.

### `POST /attempt-jobs/{job_id}/retry-quality`

Create a bounded retry for retryable signal/rate rejection checks. Integrity/decode/format rejection requires operator correction rather than repeated sampling.

## Errors

All non-2xx responses follow a uniform envelope:

```json
{
  "error": "Human-readable description",
  "detail": [
    {
      "loc": ["body", "field"],
      "msg": "Field required",
      "type": "missing"
    }
  ],
  "request_id": "uuid"
}
```

- `error` is always safe for display — it never contains stack traces, internal paths, or sensitive data.
- `detail` is present for validation errors (422) and may be empty for other status codes.
- `request_id` matches the `X-Request-ID` response header.

## Status codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Resource created |
| 202 | Durable job accepted/queued |
| 204 | Resource deleted (no body) |
| 404 | Resource not found |
| 409 | Durable lifecycle conflict or retry/cancellation invariant |
| 405 | Method not allowed |
| 422 | Validation error |
| 500 | Internal error (redacted) |

## Future endpoints (planned)

The following endpoints will be added in subsequent issues:

- `POST /models/load` — Load a model explicitly
- `POST /models/unload` — Unload the current model
