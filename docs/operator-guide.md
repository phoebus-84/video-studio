# Operator & contributor guide

## Quick start

```bash
npm install
npm test        # run all tests
npm run check   # type-check + tests
```

## Package layout

```
src/
  models/         GraphicRenderRequest, GraphicRenderResult, and content types
  pipeline/       SVGRenderPipeline — main render entry point
  resolver/       FontResolver and ImageResolver interfaces
  hashing/        SHA-256 content hashing and stable ID generation
test/
  models/         Request model validation tests
  pipeline/       Render pipeline tests (determinism, all kinds, failures)
  hashing/        Content hash tests
  harness/        Snapshot and pixel-diff test utilities
docs/
  contracts.md    Public API contract reference
  operator-guide.md  This file
```

## Running tests

```bash
# All tests
npm test

# Type checking only
npx tsc --noEmit

# Specific test file
node --import tsx --test test/pipeline/renderer.test.ts
```

## Test snapshots

Snapshot files are stored in `test/**/__snapshots__/` directories. To update all snapshots after an intentional output change:

```bash
# Delete snapshots and re-run tests to regenerate
find test -name '__snapshots__' -type d -exec rm -rf {} +
npm test
```

## Adding a new graphic kind

1. Add the kind to `GraphicKind` in `src/models/request.ts`
2. Add a content interface in the same file
3. Add a `renderXxx()` function in `src/pipeline/renderer.ts`
4. Add the kind to the `switch` statement in `renderByKind()`
5. Add validation in `validateRequest()`
6. Add a smoke test entry in `test/pipeline/renderer.test.ts` (`makeValidRequest`)
7. Add a dedicated test block
8. Update `docs/contracts.md`

## Determinism

The renderer must produce byte-identical output for the same inputs. Rules:

- No random identifiers in generated SVG
- No timestamps in the SVG `<metadata>` (timestamps go in the result envelope)
- All colors come from the theme, not computed randomly
- Font and image resolution must be deterministic

## Environment pinning

The `environmentId` constructor parameter ensures that content hashes include environment context. If the rendering logic changes in a way that could produce different SVG for the same request, increment the environment ID.

## Versioning

This package uses strict semver for the public API. The contracts in `docs/contracts.md` are the source of truth for what is considered public.
