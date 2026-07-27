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
| 204 | Resource deleted (no body) |
| 404 | Resource not found |
| 405 | Method not allowed |
| 422 | Validation error |
| 500 | Internal error (redacted) |

## Future endpoints (planned)

The following endpoints will be added in subsequent issues:

- `POST /jobs` — Submit a narration segment for synthesis (qtw-2af.4)
- `GET /jobs/{job_id}` — Poll job status
- `DELETE /jobs/{job_id}` — Cancel a job
- `GET /models` — List available and installed models (qtw-2af.2)
- `POST /models/load` — Load a model (qtw-2af.3)
- `POST /models/unload` — Unload the current model
