# Video Studio Gateway — Contributor Guide

## Architecture

```
src/
├── index.ts              # Entry point (CLI bootstrap)
├── server.ts             # Fastify assembly and lifecycle
├── config/
│   ├── schema.ts         # Zod schema, bind-address validation
│   ├── defaults.ts       # Secure defaults
│   └── index.ts          # Config loader with merge logic
├── auth/
│   ├── token.ts          # Crypto token generation & file persistence
│   ├── middleware.ts      # Bearer token auth (constant-time compare)
│   └── index.ts          # Public exports
├── health/
│   └── index.ts          # Four-component health model + collector
├── errors/
│   ├── index.ts          # Structured GatewayError + error codes
│   └── middleware.ts      # Fastify error handler registration
├── logging/
│   └── index.ts          # Pino secret-redacting serializers
├── routes/
│   └── index.ts          # REST route registration
├── ws/
│   └── index.ts          # WebSocket and SSE registration
├── contract/
│   ├── index.ts          # OpenAPI spec builder
│   └── generate.ts       # CLI script for spec generation
└── lib/
    └── roots.ts          # Library root confinement
```

## Design Principles

### Typed Ports and Versioned Contracts

Every module boundary is typed. The OpenAPI spec is the canonical API
contract and can be generated with `bun run contract:generate`. Route
schemas in Fastify serve double duty: request validation and OpenAPI
documentation.

### Security by Default

- Loopback-only binding, rejected at config validation time
- Cryptographically random token with `0o600` file permissions
- Constant-time token comparison
- Comprehensive log redaction for secrets, tokens, and credentials
- Library root confinement with symlink resolution

### Structured Errors

All errors use the `GatewayError` class with:
- Machine-readable `code` (enum, not string literal)
- User-actionable `message`
- `correlationId` (UUID v4) for tracing
- Optional `details` (never contains secrets)
- Correct HTTP status code mapping

### Deterministic Testing

Tests must be deterministic:
- No randomness in test assertions (token generation tests verify structure,
  not specific values)
- No time-based fragility (timestamps verified as valid ISO-8601, not exact)
- No external services (health checkers use stubs, not real Pi/runtime)
- No Pi processes started (component health reports `unknown` with
  descriptive detail)
- Ephemeral ports (`port: 0`) avoid port conflicts

## Development

### Prerequisites

- Node.js >= 22 or Bun >= 1.2
- No external services needed for tests

### Setup

```bash
bun install
bun run typecheck    # TypeScript check
bun run test         # Run tests
bun run dev          # Start with auto-reload
```

### Running Tests

```bash
# All tests
bun run test

# Watch mode
bun run test:watch

# Specific test file
bun run test test/config.test.ts
```

### Test Structure

```
test/
├── config.test.ts       # Config loading, bind validation
├── auth.test.ts         # Token generation, file persistence, permissions
├── errors.test.ts       # Error classes, HTTP mapping, error middleware
├── health.test.ts       # Health model, collector, composite states
├── logging.test.ts      # Redaction functions, sensitive patterns
├── roots.test.ts        # Library root checks, symlink safety
└── integration.test.ts  # Full server lifecycle, endpoints, auth, CORS
```

### Adding a New Route

1. Define the route schema (Fastify JSON Schema) for request validation
   and OpenAPI generation
2. Add the handler in `src/routes/index.ts`
3. Add a test in `test/integration.test.ts`
4. Update `docs/API.md` with the new endpoint
5. Run `bun run typecheck && bun run test`

### Code Style

- TypeScript strict mode
- ESM modules (`"type": "module"`)
- No `any` types; prefer `unknown` and type guards
- Error handling: throw `GatewayError` for expected failures, let the
  error middleware handle unknown errors
- Logging: use `request.log` for request-scoped logs; secrets are
  automatically redacted

## Contract Generation

```bash
# Generate OpenAPI spec to stdout
bun run contract:generate

# Save to file
bun run contract:generate > openapi/gateway.yaml
```

## Future Work (tracked in Beads)

| Issue | Description |
|-------|-------------|
| vsg-e57.2 | Workspace discovery and read projections |
| vsg-e57.3 | Watch workspace changes |
| vsg-e57.4 | Revision-safe endpoints |
| vsg-e57.6 | Strict Pi RPC JSONL client |
| vsg-e57.7 | Pi process lifecycle management |
| vsg-e57.8 | GUI intent routing |
| vsg-e57.9 | Extension UI bridging |
| vsg-e57.10 | Unified Pi/runtime/provider health |
| vsg-e57.11 | Trust and authentication hardening |
| vsg-e57.12 | Gateway integration tests |
