# Video Studio Gateway — Operator Guide

## Quick Start

```bash
# Install dependencies
bun install

# Start the gateway (development, with auto-reload)
bun run dev

# Start the gateway (production)
bun run build
bun run start

# Run tests
bun run test
```

The gateway starts on `127.0.0.1` with an ephemeral port (OS-assigned).
The port is printed to stderr at startup:
```
[gateway] Listening on http://127.0.0.1:46231
```

## Configuration

Create a `gateway.json` file and pass it as an argument:

```bash
bun run start gateway.json
```

Or set the `VSG_CONFIG_PATH` environment variable:

```bash
VSG_CONFIG_PATH=./gateway.json bun run start
```

### Configuration Reference

```jsonc
{
  // Host to bind to. Default: "127.0.0.1"
  "host": "127.0.0.1",

  // Port to bind to. Default: 0 (ephemeral, OS-assigned)
  "port": 0,

  // Must be true AND tls must be configured to bind to non-loopback.
  // WARNING: Only enable after reviewing security implications.
  "allowNonLoopback": false,

  // TLS configuration (required for non-loopback)
  "tls": {
    "cert": "/path/to/cert.pem",
    "key": "/path/to/key.pem"
  },

  // Token configuration
  "token": {
    // File path for the auto-generated token. Default: ".gateway-token"
    "file": ".gateway-token",
    // Pre-shared token. If set, no file is created.
    // Use only if you manage tokens externally.
    "preShared": null
  },

  // CORS allowed origins. Default: [] (loopback only, no CORS)
  "allowedOrigins": [],

  // Workspace directories the gateway can read from.
  // Default: ["."] (current directory)
  "libraryRoots": ["."],

  // Logging configuration
  "logging": {
    // Level: "fatal" | "error" | "warn" | "info" | "debug" | "trace"
    "level": "info",
    // Pretty-print for terminal output
    "pretty": false,
    // Redact secrets in log output (strongly recommended)
    "redactSecrets": true
  },

  // Runtime configuration
  "runtime": {
    // Pi RPC socket path. Auto-discovered if omitted.
    "piRpcSocket": null,
    // Max runtime restarts before giving up
    "maxRuntimeRestarts": 3
  },

  // Custom correlation ID header name
  "correlationIdHeader": "x-correlation-id"
}
```

## Security

### Token Management

On first start, the gateway generates a 32-byte cryptographically random token,
base64url-encoded, and writes it to `.gateway-token` with `0o600` permissions.

To rotate the token:
```bash
rm .gateway-token
# Restart the gateway – a new token will be generated
```

### Binding Policy

- **Default: loopback only.** The gateway refuses to start if you configure
  `host` to a non-loopback address without explicitly setting
  `allowNonLoopback: true` and providing `tls` configuration.
- Wildcard binds (`0.0.0.0`, `::`) and LAN addresses (`192.168.x.x`,
  `10.x.x.x`) are treated as non-loopback and require the same explicit
  secure configuration.
- Loopback addresses that are always allowed: `127.0.0.1`, `::1`, `localhost`,
  and any `127.x.x.x`.

### Library Roots

The gateway restricts filesystem access to configured `libraryRoots`.
Symlinks are resolved before comparison to prevent escape via symlink
traversal. Requests for paths outside these roots are rejected with
a `BAD_REQUEST` error.

## Health Monitoring

The `/health` endpoint is unauthenticated and reports the readiness of
four independent components:

| Component | Meaning |
|-----------|---------|
| `gateway` | HTTP/WS server is accepting connections |
| `runtime` | Video pipeline runtime process |
| `pi` | Pi coding agent RPC process |
| `adapter` | Extension UI bridge |

Monitor with:
```bash
curl http://127.0.0.1:{port}/health
```

## Logging

Logs are written to stderr via pino. Secrets in log output are replaced with
`[REDACTED]` including:

- Authorization headers
- API keys
- Passwords
- Tokens
- Provider credentials
- Nested secrets in objects

Set `logging.pretty: true` for human-readable terminal output during
development. Set `logging.level: "debug"` for detailed diagnostics.

## Signals

The gateway handles:
- `SIGINT` / `SIGTERM` — graceful shutdown

## Troubleshooting

### Port already in use
Set `port: 0` for ephemeral assignment, or choose a free port.

### "Non-loopback bind rejected"
If you need remote access, set both `allowNonLoopback: true` and provide
valid `tls` certificate and key paths.

### "Library root does not exist"
Ensure every path in `libraryRoots` exists and is accessible.

### "Missing Authorization header"
Clients must include the token from `.gateway-token` in the
`Authorization: Bearer <token>` header.
