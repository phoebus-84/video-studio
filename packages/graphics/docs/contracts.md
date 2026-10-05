# Graphics renderer contracts

This document describes the public API contracts for `@av/graphics`.

See [Security and resource bounds](security.md) for runtime validation, failure
fingerprints, the passive SVG subset, resource ceilings and host responsibilities.

## Capability

`graphics.render` — Deterministic headless rendering of text-critical visual assets to SVG.

## Models

### `GraphicRenderRequest`

The input to the render pipeline. Contains:

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `GraphicKind` | yes | Discriminator: `code-frame`, `architecture-diagram`, `title-frame`, `callout`, `comparison-layout`, `simple-chart`, `infographic-primitive` |
| `width` | `number` | yes | Output width in pixels (1–8192; total area capped) |
| `height` | `number` | yes | Output height in pixels (1–8192; total area capped) |
| `content` | `GraphicContent` | yes | Kind-specific content payload |
| `themeId` | `string` | no | Theme identifier; defaults to `visual-bible-dark` |
| `safeArea` | `SafeArea` | no | Safe area margins in pixels from each edge |
| `metadata` | `Record<string,string>` | no | Caller-supplied tags (not rendered) |
| `idempotencyKey` | `string` | no | Opaque key for renderer-level caching |

### `GraphicRenderResult`

The output of a render. Contains:

| Field | Type | Description |
|---|---|---|
| `stableId` | `string` | Opaque ID (`gr_` prefix + hash) |
| `requestHash` | `string` | Canonical `sha256:<lowercase-hex>` digest of the request and pinned environment |
| `svgContent` | `string` | Complete SVG document |
| `width` | `number` | Output width |
| `height` | `number` | Output height |
| `kind` | `GraphicKind` | Echo of request kind |
| `status` | `RenderStatus` | `success`, `partial`, or `failed` |
| `durationMs` | `number` | Wall-clock render time |
| `diagnostics` | `RenderDiagnostic[]` | Ordered diagnostics |
| `timestamp` | `string` | RFC 3339 UTC |
| `svgHash` | `string` | Canonical `sha256:<lowercase-hex>` digest of `svgContent` |
| `themeProvenance` | `ThemeProvenance \| null` | Resolved theme token set identity, version, and origin |

### `RenderStatus`

Closed vocabulary:
- `success` — Fully rendered with no degradation
- `partial` — Rendered with warnings or non-fatal fallbacks
- `failed` — Could not produce valid output

### `RenderDiagnostic`

| Field | Type | Description |
|---|---|---|
| `code` | `string` | Machine-readable code (e.g. `validation.missing-title`) |
| `level` | `DiagnosticLevel` | `info`, `warning`, or `error` |
| `message` | `string` | English, actionable description |
| `context` | `Record<string,unknown>` | Optional structured context |

## Pipeline

### `SVGRenderPipeline`

Main entry point. Constructed with injected `FontResolver`, `ImageResolver`, and optional `FontRegistry`.

```typescript
const pipeline = new SVGRenderPipeline({
  fontResolver: myFontResolver,
  imageResolver: myImageResolver,
  fontRegistry: myFontRegistry,   // defaults to bundled catalog
  environmentId: 'pinned-v1',
});

const result = await pipeline.render(request);
```

`render` validates untrusted input before hashing and accepts an optional second
argument `{ signal: AbortSignal }`. Invalid input returns a failed diagnostic
result, never a successful placeholder. See the [security contract](security.md)
for differences between rejection fingerprints and valid request hashes.

**Determinism guarantee**: The same request in the same pinned environment always produces byte-identical SVG.

**Font policy**: Fonts are resolved from the `FontRegistry` (bundled or injected). The pipeline never emits platform font fallbacks (`system-ui`, `-apple-system`, `Segoe UI`, etc.). Every font entry carries license metadata.

**Theme policy**: The default theme is `visual-bible-dark` (bundled). Unrecognized themes emit a `theme.unrecognized` warning and fall back to the default. Theme provenance is always attached to the result.

## Theme

### Design tokens

`@video-studio/studio-graphics-renderer/theme` exports:

| Export | Description |
|---|---|
| `VISUAL_BIBLE_DARK` | The bundled default `ResolvedDesignTokens` |
| `resolveTheme(themeId?)` | Resolve a theme; returns bundled default for unknown IDs |
| `checkPaletteContrast(palette)` | Computes WCAG contrast ratios for all semantic color pairs |
| `contrastDiagnostics(report)` | Converts contrast report to `DiagnosticLevel:info` diagnostics |
| `contrastRatio(fg, bg)` | Raw WCAG 2.1 contrast ratio (1.0–21.0) |
| `SAFE_AREA_PROFILES` | Catalog: `16:9`, `4:3`, `1:1`, `9:16` |
| `resolveProfile(id?)` | Resolve a safe area profile |
| `computePixelSafeArea(profile, w, h)` | Compute pixel insets from a profile |
| `bestFitProfile(w, h)` | Auto-detect the best-matching profile for given dimensions |

### `ResolvedDesignTokens`

A concrete, pinned token set:

```typescript
interface ResolvedDesignTokens {
  palette: Palette;        // Background, foreground, primary, etc.
  typeScale: TypeScale;    // xs through 3xl
  spacing: SpacingScale;   // 8px unit grid
  stroke: StrokeTokens;    // hairline, regular, emphasis
  corner: CornerTokens;    // none, sm, md, lg, full
  profile: SafeAreaProfile;
  provenance: ThemeProvenance;
}
```

### `ThemeProvenance`

| Field | Type | Description |
|---|---|---|
| `themeId` | `string` | Theme identifier (e.g. `visual-bible-dark`) |
| `version` | `string` | Token set version |
| `source` | `'bundled' \| 'injected'` | Origin |
| `pinnedAt` | `string` | ISO 8601 UTC when these tokens were pinned |

## Font

### FontRegistry

`@video-studio/studio-graphics-renderer/font` exports:

| Export | Description |
|---|---|
| `FontRegistry` | Class: register, resolve, and list fonts |
| `createFontRegistry(injected?)` | Factory with bundled catalog |
| `BUNDLED_FONTS` | Array of bundled `FontEntry` objects |
| `LICENSES` | Standard license catalog (`SIL-OFL-1.1`, `Apache-2.0`, `MIT`, `custom`) |
| `checkCoverage(text, entry)` | Check if a font covers all characters in text |
| `coverageRenderDiagnostics(results)` | Convert coverage gaps to render diagnostics |

### FontEntry

| Field | Description |
|---|---|
| `family` | Canonical family name |
| `displayName` | Human-readable name |
| `license` | `FontLicense` with SPDX-like ID, name, reference URL, and redistributable flag |
| `source` | `'bundled'` or `'injected'` |
| `variants` | Array of `{ weight, style, cssSpec }` |
| `coverage` | `{ glyphCount, blocks[], missingBlocks[] }` |
| `role` | `'body'`, `'heading'`, or `'mono'` |

**Platform font policy**: The registry never resolves to platform fonts. Unregistered families return `undefined`. Callers receive typed errors, not silent fallbacks.

## Resolvers

### `FontResolver`

```typescript
interface FontResolver {
  resolve(family: string, weight: number, style: 'normal' | 'italic'): FontResolveResult;
}
```

Resolves font family + weight + style to a concrete CSS `font-family` value.

### `ImageResolver`

```typescript
interface ImageResolver {
  resolve(uri: string): ImageResolveResult;
}
```

Reserved interface for image URIs; current graphic kinds never call it or
embed images. No allowed-root filesystem loader is implemented yet. A future
implementation must enforce realpath root containment, raster MIME and resource
limits and must not make network requests. See [Security](security.md#files-images-and-networking).

## Hashing

### `computeContentHash(value)` → `sha256:<lowercase-hex>`

Deterministic over key order. Undefined object values are normalized to `null` so callers cannot accidentally hash environment-specific omission behavior.

### `generateStableId(prefix, value)` → opaque ID

Format: `<prefix>_<32 hex chars>`.

## Test harness

### Snapshot testing

```typescript
import { assertSnapshot } from '@video-studio/studio-graphics-renderer/test/harness/snapshot.js';

const snap = assertSnapshot(import.meta.url, 'my-snapshot', actualSvg);
assert.ok(snap.matches);
```

### Structural and pixel diff

```typescript
import { svgPixelDiff, svgStructuralDiff } from '@video-studio/studio-graphics-renderer/test/harness/pixel-diff.js';

assert.ok(svgStructuralDiff(svgA, svgB).equivalent);
assert.ok(svgPixelDiff(svgA, svgB).equivalent);
```

The pixel harness rasterizes with pinned headless `resvg`, disables system-font loading, and never opens a browser or network connection. Text fixtures must embed pinned fonts. Unsupported chart types fail with `capability.unsupported-chart-type`; they never return successful placeholders.
