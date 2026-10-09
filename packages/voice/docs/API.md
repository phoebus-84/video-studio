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

Create a preset or VoiceDesign descriptor. Clone profiles cannot be created through this shortcut: use consent-gated enrollment below. `speed` is exactly `1.0` because this backend has no supported Qwen speed control.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-128) | yes | Human-readable label |
| `mode` | `"preset"` \| `"design"` | yes | Checkpoint synthesis method |
| `preset_name` | string | when mode=preset | CustomVoice preset |
| `description` | string (10-1000) | when mode=design | VoiceDesign description |
| `language` | string (2-35) | no (default `en-US`) | BCP-47 metadata |
| `speed` | exactly `1.0` | no | Unsupported values fail validation |

#### Response `201 Created`

Returns the full `VoiceProfile` object.

### `POST /voices/enroll`

Create a consented clone profile. The worker reads the explicitly named local source, converts it to mono 24 kHz PCM, validates 3-30 seconds of non-silent speech, hashes it, and privately copies it into the voice store. The supplied transcript must be the exact spoken content; the worker never guesses it.

Required body fields are `name`, `reference_audio_path`, `reference_text`, `language`, and `consent`. Consent requires `confirmed: true`, `source` (`self_recorded`, `licensed`, or `synthetic`), a human statement, and `license_or_terms`.

### `POST /voices/{voice_id}/synthesize`

Synthesize with an enrolled clone through a verified **Base** checkpoint. This never routes reference audio to CustomVoice. The request accepts prepared `text`, backend `language`, `model_size`, sampling controls, token ceiling, and seed. The response records the immutable voice revision, Base model revision/identity, reference hashes, output hash, measured WAV properties, and provider mode. A tampered or missing reference, wrong profile, missing verified Base installation, malformed WAV, or live generation failure returns an error rather than fallback audio.

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
| `language` | string (2-35) | New language metadata |

#### Response `200 OK`

Returns the updated `VoiceProfile`.

### `DELETE /voices/{voice_id}`

Revoke a voice profile by atomically removing its metadata and privately stored reference audio. Existing generated outputs remain separately auditable and must be deleted by the operator if desired.

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

### `POST /attempt-jobs/{job_id}/process`

For an accepted quality report, verify raw integrity, conservatively trim only threshold-silent edges while preserving an 80 ms margin, and realize the requested pause as a separate exact silence WAV. Returns and persists a policy-fingerprinted transform report. No fades or destructive in-place changes occur.

### `GET /attempt-jobs/transforms/{transform_id}`

Retrieve an immutable transform report linking raw attempt, quality evidence, transformed speech, pause artifact, trim positions, and active-sequence hash.

## Narration mastering

### `POST /narrations/master`

Assemble an explicit ordered `AssemblyPlan`, verify all speech/pause hashes and boundaries, and run two-pass FFmpeg loudness mastering. Returns the canonical `NarrationManifest`, premaster/final WAV metadata, order, durations, boundary report, complete profile fingerprint, FFmpeg version, integrated LUFS, true peak, and loudness range.

### `GET /narrations/{assembly_id}`

Retrieve the persisted mastering report. Identical assembly identity is immutable and cannot overwrite prior output.

### `GET /narrations/{assembly_id}/workspace-manifest`

Retrieve the canonical camelCase `video-workspace-contracts` narration manifest. The projection includes `sha256:` hashes and caption cues derived from segment display text, selected measured WAV durations, explicit pauses, and exact manifest order.

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
| 409 | Durable lifecycle conflict, disk/concurrency preflight, or retry/cancellation invariant |
| 405 | Method not allowed |
| 413 | Declared request body exceeds configured local limit |
| 422 | Validation error |
| 500 | Internal error (redacted) |

## Future endpoints (planned)

The following endpoints will be added in subsequent issues:

- `POST /models/load` — Load a model explicitly
- `POST /models/unload` — Unload the current model

## Forced alignment

When each word of a known text is said in an audio file (avg-8hs.2). The
model (`QTW_ALIGN_MODEL`, default `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`)
is loaded on first use and kept. Under `QTW_TTS_MODE=fake` alignment is fake
too: the words spread evenly over the audio.

### `GET /align`

```json
{ "model": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", "loaded": false, "maxSeconds": 300 }
```

### `POST /align`

```json
{ "audio_path": "/abs/path/take.wav", "text": "La nebbia a gl'irti colli", "language": "it" }
```

`language` is an ISO 639-1 code, with or without a region (`it`, `it-IT`,
`en_US`), or a name: Chinese, English, Cantonese, French, German, Italian,
Japanese, Korean, Portuguese, Russian, Spanish.

#### Response `200 OK`

```json
{
  "words": [{ "text": "La", "start": 0.0, "end": 0.24 }, { "text": "nebbia", "start": 0.24, "end": 0.72 }],
  "model": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
  "language": "Italian"
}
```

The model's own words and seconds (80 ms resolution), unprocessed: mapping
them onto the written text and onto the measured silences is the studio's
work.

#### Response `422`

The error envelope, `detail[0].type` one of `too-long` (over 300 s),
`unsupported-language`, `bad-audio` (not an absolute path to readable
audio), `empty-text`.

#### Response `503`

`detail[0].type` `model-unavailable`: the aligner could not be loaded (a
first download without network, a wrong `QTW_ALIGN_MODEL`).

#### Response `500`

`detail[0].type` `aligner-failed`: the model itself failed while aligning.

## Transcription

What a take actually says, word by word (avg-8hs.3).
- **Why it exists:** forced alignment places every word of the text even
  when it was never said. A transcription made without the text does not.
- **Model:** `QTW_TRANSCRIBE_MODEL`, by default
  `mlx-community/whisper-large-v3-turbo` through mlx-whisper. It is downloaded
  on first use and kept, and takes about 8 s for 40 s of Italian on Apple
  silicon.
- **Fake mode:** under `QTW_TTS_MODE=fake` it hears nothing and says so.

### `GET /transcribe`

```json
{ "model": "mlx-community/whisper-large-v3-turbo", "loaded": false, "maxSeconds": 600 }
```

### `POST /transcribe`

```json
{ "audio_path": "/abs/path/take.wav", "language": "it" }
```

#### Response `200 OK`

```json
{
  "text": "La nebbia glirti colli, pioviginando sale",
  "words": [{ "text": "La", "start": 0.0, "end": 0.3, "probability": 0.98 }],
  "model": "mlx-community/whisper-large-v3-turbo",
  "language": "it"
}
```

It does not use the earlier text as a prompt, so a missing or repeated line
is heard as it is, not as expected.

#### Response `422`

`detail[0].type` is one of:
- `too-long`: over 600 s;
- `unsupported-language`;
- `bad-audio`.

#### Response `503`

`detail[0].type` `transcriber-failed`: the model could not be loaded or
failed.

