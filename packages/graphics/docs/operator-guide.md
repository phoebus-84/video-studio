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
  theme/          Design tokens, contrast checking, safe area profiles
  font/           Font registry with license metadata and diagnostics
test/
  models/         Request model validation tests
  pipeline/       Render pipeline tests (determinism, all kinds, failures)
  theme/          Theme token, contrast, and profile tests
  font/           Font registry and diagnostics tests
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
node --import tsx --test test/theme/tokens.test.ts
node --import tsx --test test/font/registry.test.ts
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

## Design tokens

The theme system maps Visual Bible design tokens into reproducible graphic styles. The default bundled theme is `visual-bible-dark`.

### Token structure

Tokens are organized into:
- **Palette**: Background, foreground, primary, secondary, accent, muted, border, and semantic colors (success, warning, error, info, highlight, dimmed, surface)
- **Type scale**: xs (10px) through 3xl (48px) on a major third scale
- **Spacing**: 8px unit grid with named steps (xs through 2xl)
- **Stroke**: hairline (0.5px), regular (1px), emphasis (2px)
- **Corner**: none (0), sm (3px), md (6px), lg (12px), full (9999px)
- **Profile**: Safe area profiles for 16:9, 4:3, 1:1, and 9:16 aspect ratios

### Adding a new theme

To add a new theme, create a new `ResolvedDesignTokens` object in `src/theme/tokens.ts` and register it in `resolveTheme()`. A theme variant is under consideration for the next milestone.

## Font registry

Fonts are resolved from a typed registry. There are three roles: `body`, `heading`, and `mono`. The bundled catalog includes:

| Font | Role | License | Glyphs |
|---|---|---|---|
| Inter | body | SIL OFL 1.1 | ~2,548 |
| Source Serif 4 | heading | SIL OFL 1.1 | ~1,894 |
| JetBrains Mono | mono | SIL OFL 1.1 | ~1,394 |

### Adding a font

1. Add a `FontEntry` to the `BUNDLED_FONTS` array in `src/font/registry.ts`
2. Ensure the license is open and redistribution is permitted
3. Declare Unicode block coverage for diagnostics
4. Add a CSS `font-family` spec that includes the generic fallback (e.g. `monospace`)
5. Add tests verifying license, coverage, and resolution

### Font policy

- Fonts must be bundlable or injectable — no platform font resolution
- Every font entry must carry a license with `redistributable: true`
- The registry returns `undefined` for unregistered fonts — callers receive typed errors
- Missing-glyph diagnostics use Unicode block coverage to detect characters the font cannot render

## Determinism

The renderer must produce byte-identical output for the same inputs. Rules:

- No random identifiers in generated SVG
- No timestamps in the SVG `<metadata>` (timestamps go in the result envelope)
- All colors come from the theme, not computed randomly
- Font and image resolution must be deterministic
- No platform font fallback in SVG output (must use registry fonts)

## Contrast checking

WCAG 2.1 contrast ratio calculations are available via `checkPaletteContrast()` and `contrastRatio()`. The pipeline automatically checks the palette and emits `info`-level diagnostics for pairs below WCAG AA (4.5:1). These are advisory and do not block rendering.

To check contrast manually:

```typescript
import { checkPaletteContrast, contrastDiagnostics, VISUAL_BIBLE_DARK } from '@video-studio/studio-graphics-renderer';

const report = checkPaletteContrast(VISUAL_BIBLE_DARK.palette);
const diags = contrastDiagnostics(report);
for (const d of diags) {
  console.log(`${d.level}: ${d.message}`);
}
```

## Environment pinning

The `environmentId` constructor parameter ensures that content hashes include environment context. If the rendering logic changes in a way that could produce different SVG for the same request, increment the environment ID.

## Versioning

This package uses strict semver for the public API. The contracts in `docs/contracts.md` are the source of truth for what is considered public.
