# Video Studio Gateway — Public API Contract

Version: 0.1.0 | OpenAPI: `GET /openapi.json`

## Overview

The Video Studio Gateway is a trusted local backend that connects browser
clients, the Pi coding agent RPC, and filesystem production state.

- **Default**: loopback-only (`127.0.0.1`), ephemeral port
- **Auth**: Bearer token (auto-generated on first start, stored in `.gateway-token`)
- **Transport**: REST + WebSocket + SSE
- **Content-Type**: `application/json`

## Authentication

All endpoints except `/health` and `/openapi.json` require a Bearer token
in the `Authorization` header:

```
Authorization: Bearer <token>
```

The token is generated on first start and written to `.gateway-token` with
`0o600` permissions. Use the token from that file.

WebSocket connections pass the token as a query parameter:
```
ws://127.0.0.1:{port}/ws?token=<token>
```

## Endpoints

### `GET /health` — Health Check (public)

Reports independent readiness of four components:

```json
{
  "overall": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "gateway": {
    "status": "ready",
    "detail": "HTTP server accepting connections",
    "lastChecked": "2024-01-01T00:00:00.000Z"
  },
  "runtime": {
    "status": "unknown",
    "detail": "Runtime connection not yet wired",
    "lastChecked": "2024-01-01T00:00:00.000Z"
  },
  "pi": {
    "status": "unknown",
    "detail": "Pi RPC not yet wired",
    "lastChecked": "2024-01-01T00:00:00.000Z"
  },
  "adapter": {
    "status": "unknown",
    "detail": "Adapter bridge not yet wired",
    "lastChecked": "2024-01-01T00:00:00.000Z"
  }
}
```

**Status values:** `ready` | `degraded` | `down` | `unknown`

**Overall:** `healthy` when no component is `down`, otherwise `unhealthy`.

### `GET /` — API Root (authenticated)

Returns service metadata and endpoint links.

### `GET /openapi.json` — OpenAPI Spec (public)

Returns the full OpenAPI 3.0.3 specification including all route schemas
and the bearer token security definition.

### `GET /ws` — WebSocket (authenticated via query param)

Real-time event stream. Messages are JSON-encoded, newline-delimited (JSONL).

Initial message after connection:
```json
{"type": "connected", "timestamp": "..."}
```

Client-initiated ping/pong:
```json
{"type": "ping"}
{"type": "pong"}
```

### `GET /events` — Server-Sent Events (authenticated via Bearer header)

SSE stream for simpler clients. Requires `Authorization: Bearer <token>`.

## Error Responses

All errors follow a consistent envelope:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "correlationId": "uuid-v4",
  "details": {}
}
```

**Error codes:**

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer token |
| `NOT_FOUND` | 404 | Unknown route |
| `VALIDATION` | 400 | Request body/param validation failure |
| `BAD_REQUEST` | 400 | Invalid request (e.g. path outside library roots) |
| `GATEWAY_NOT_READY` | 503 | Server not fully initialized |
| `RUNTIME_UNREACHABLE` | 503 | Video pipeline runtime unavailable |
| `PI_DISCONNECTED` | 503 | Pi RPC process disconnected |
| `PI_RPC_ERROR` | 503 | Pi RPC returned an error |
| `PI_TIMEOUT` | 503 | Pi RPC timed out |
| `ADAPTER_UNREACHABLE` | 503 | Extension bridge disconnected |
| `INTERNAL` | 500 | Unexpected server error (details never leaked) |
| `CONFIG_ERROR` | 500 | Configuration error (at startup) |
| `TOKEN_ERROR` | 500 | Token file error (at startup) |

## Security Properties

- **Loopback-only by default.** Binding to `0.0.0.0`, `::`, or any
  non-loopback address requires `allowNonLoopback: true` AND a valid
  `tls` configuration (cert + key). Wildcard binds are rejected without
  both settings.
- **Cryptographically generated token.** `crypto.randomBytes(32)` as
  base64url, stored with `0o600` permissions.
- **Constant-time token comparison.** Prevents timing side-channel attacks
  on the Bearer token.
- **Log redaction.** Authorization headers, API keys, passwords, tokens,
  secrets, and provider credentials are replaced with `[REDACTED]` in
  all log output.
- **No credential exposure.** The browser never receives Pi credentials,
  provider secrets, or unrestricted filesystem access.
- **Library root confinement.** File access is restricted to configured
  library roots. Symlink traversal is resolved before comparison.
