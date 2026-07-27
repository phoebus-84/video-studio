# Graphics renderer contracts

This document describes the public API contracts for `@video-studio/studio-graphics-renderer`.

## Capability

`graphics.render` — Deterministic headless rendering of text-critical visual assets to SVG.

## Models

### `GraphicRenderRequest`

The input to the render pipeline. Contains:

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `GraphicKind` | yes | Discriminator: `code-frame`, `architecture-diagram`, `title-frame`, `callout`, `comparison-layout`, `simple-chart`, `infographic-primitive` |
| `width` | `number` | yes | Output width in device-independent pixels (> 0) |
| `height` | `number` | yes | Output height in device-independent pixels (> 0) |
| `content` | `GraphicContent` | yes | Kind-specific content payload |
| `themeId` | `string` | no | Theme identifier; defaults to `default-dark` |
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

Main entry point. Constructed with injected `FontResolver` and `ImageResolver`.

```typescript
const pipeline = new SVGRenderPipeline({
  fontResolver: myFontResolver,
  imageResolver: myImageResolver,
  environmentId: 'pinned-v1',
});

const result = await pipeline.render(request);
```

**Determinism guarantee**: The same request in the same pinned environment always produces byte-identical SVG.

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

Resolves image URIs to embeddable data. Must not make network requests.

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
