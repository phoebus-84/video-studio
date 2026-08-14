# Contributing

## Setup

```bash
npm install
npm run build
npm test
```

For a complete check before pushing:

```bash
npm run check
```

## Development loop

```bash
npm run test:watch      # vitest watch mode
npm run build:watch     # tsc --watch
npm run lint:fix        # auto-fix lint issues
```

## Architecture principles

### Port-first design

Every external concern (filesystem, time, locking, IDs, journal storage)
is accessed through a typed **port** interface. The core package contains
**zero** concrete provider implementations except `SystemClock`, which is
the process boundary.

This means:

- **Tests inject fakes** (`FakeClock`, `FakeFileSystem`, etc.) instead of
  mocking `fs` or `Date`.
- **Production adapters** (Node.js `fs`, file-based locks, UUID v7) live in
  separate modules or are injected at the process entry point.
- **No Pi dependency** enters the core package. The runtime is consumed by
  Pi, not coupled to it.

### Result type

Every recoverable operation returns `Result<T, E>`, never throws for
expected failures. Unrecoverable invariants (programmer errors) use standard
`throw`. Consumers **must** inspect `.ok` before accessing `.value`.

### Error codes

All errors carry a machine-readable `code` so callers (CLI, gateway) can
branch without matching error message strings. Add new codes to `ErrorCode`
in `src/errors.ts` and use the corresponding factory function.

### Logging

Logger calls accept an optional `meta` bag for structured context. The
default `ConsoleLogger` writes to stderr so stdout is free for
machine-readable output (JSON, version strings).

## Adding a port

1. Define the interface in `src/ports/<name>.ts`.
2. Re-export from `src/ports/index.ts` and `src/index.ts`.
3. Create a fake in `test/fixtures/index.ts`.
4. Write unit tests in `test/unit/ports/<name>.test.ts`.
5. Update `docs/CONTRACTS.md`.

## Adding workspace logic

Workspace code lives in `src/workspace/`.  Follow these patterns:

### Contract adapter boundary

Contract document schemas are owned by `video-workspace-contracts`, not by
this runtime.  When adding contract-dependent behaviour:

1. Define the contract document type in `src/workspace/contracts.ts`.
2. Perform **structural validation only** (required fields, correct types).
3. Expose a `ContractValidator` adapter interface for full schema validation.
4. Do NOT duplicate schema definitions from the contracts module.
5. Document the adapter boundary in `docs/CONTRACTS.md`.

### Path safety

Every filesystem path the runtime touches MUST pass through
`guardPath` or `resolveGuardedPath`.  These perform:

- Lexical escape detection (`../`, absolute paths to other roots).
- Symlink-aware verification (when a `FileSystem` port is available).

For production wiring with the real Node.js `fs`, the adapter MUST:

```typescript
// Production path guard (not in this module — lives in the adapter)
import { realpath } from "node:fs/promises";
const realRoot = await realpath(allowedRoot);
const realCandidate = await realpath(candidatePath);
if (!realCandidate.startsWith(realRoot + path.sep) && realCandidate !== realRoot) {
  throw new PermissionDeniedError("Symlink escapes allowed root");
}
```

### Idempotent initialization

Init operations (`initChannel`, `initSeries`, `initEpisode`) must:

- Never overwrite existing `contract.json` or `metadata.json`.
- Only create template files when they do not exist.
- Return `existed: true` on re-init so callers can distinguish creation
  from no-op.

### Slug conventions

- Use `validateSlug` for all user-provided directory names.
- Slugs are lowercase, alphanumeric + single hyphens, max 64 chars.
- The `"default"` slug is reserved for `ensureDefaultChannel`.

## Test conventions

| Layer | Location | Purpose |
|-------|----------|---------|
| Unit | `test/unit/` | One file per source module, pure logic |
| Integration | `test/integration/` | End-to-end through the CLI or process boundary |
| Fixtures | `test/fixtures/` | Reusable fakes exported for sibling packages |

### Deterministic tests

- Use `FakeClock` instead of `Date.now()`.
- Use `FakeFileSystem` instead of `fs.promises`.
- Avoid real network or external processes in unit tests.
- Integration tests that use the real filesystem MUST create a temporary
  directory and tear it down.

## Code style

- ESM only (`import`/`export`, no `require`).
- Strict TypeScript with `noUnusedLocals`, `noUnusedParameters`.
- Prefer `type` imports for type-only references.
- All public exports carry JSDoc comments.

## Release process

1. `npm run check` passes (build + lint + test).
2. Update `VERSION` in `src/index.ts` and `package.json`.
3. Tag the commit: `v<version>`.
4. No npm publish until MVP acceptance.
