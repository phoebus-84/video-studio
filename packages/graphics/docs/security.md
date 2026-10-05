# Security and resource bounds

This is the security contract for `@av/graphics` and the hardening tracked by
`avg-ayx.1` (formerly `sgr-3i9.9`).

## What was still necessary

The original renderer escaped text, but trusted TypeScript types at runtime.
Malformed or cyclic input could throw before validation because canonical hashing
ran first. Canvas size and content collections were unbounded. Chart colors
could contain live SVG paint URLs. The lower-level SVG builder escaped attribute
values but accepted arbitrary tags and attribute names, including scripts,
`foreignObject`, event handlers and external image references.

Regression tests reproduced those defects before the changes. Existing valid
request fixtures and the code-frame SVG snapshot remain unchanged.

## Passive input only

`SVGRenderPipeline.render(input, { signal? })` takes untrusted data. It snapshots
and validates **before** hashing, theme/font resolution, or rendering:

- The request and each kind-specific content record have closed fields and
  checked scalar types, arrays and enum values. Safe areas must leave a positive
  inner frame; diagram node IDs must be non-empty and unique.
- Only plain records, dense arrays and passive scalar values are accepted.
  Cycles, accessors, class instances, symbol/prototype-related keys, non-finite
  numbers and invalid XML characters are rejected. Optional `undefined` fields
  retain their existing meaning.
- Text is XML-escaped; code is never evaluated. Text containing markup or an
  entity declaration remains text, not markup.
- Paint values are literal hex colors (3/4/6/8 digits) or alphabetic color names.
  CSS functions, including `url(...)`, are rejected even for local fragments.
  Font specifications allow only literal family-name lists, never CSS rules,
  escapes, remote sources or `@font-face`.

The low-level `renderSvg` builder accepts only passive shape/text/group elements:
`g`, `rect`, `line`, `text`, `circle`, `ellipse`, `path`, `polygon`, `polyline`.
Attributes are allowlisted per tag and their values validated. There is no
`style`, event handler, `href`, image, script, animation, `foreignObject`, or
external entity surface. Path/transform numeric arguments are finite and bounded.
Violations throw `GraphicsSafetyError` with a machine-readable `code`.

## Limits

`GRAPHICS_LIMITS` is exported from the package and its pipeline entry point.
These fixed ceilings are applied before content expansion:

| Resource | Ceiling |
|---|---:|
| Canvas dimension | 1–8192 pixels per axis |
| Canvas area | 16,777,216 pixels |
| Input nesting depth | 16 |
| Visited input values (including keys) | 16,384 |
| Record keys / array items | 128 / 1024 |
| Single string / total characters (including keys) | 65,536 / 131,072 UTF-16 units |
| Code lines | 1024 |
| Diagram nodes / edges | 256 / 1024 |
| Chart points / sections per column | 256 / 128 |
| Primitive SVG nodes | 4096 (the input complexity cap may reject earlier) |
| Output SVG | 2 MiB UTF-8 |
| Cooperative construction budget | 1000 ms |

Limits reject; they never silently truncate content or resize the frame. Output
size is checked after construction; the input ceilings bound allocations leading
up to that check, including escaping and per-node markup.

A pre-aborted `AbortSignal` fails before input inspection. The pipeline checks
cancellation/time at phase boundaries; `renderSvg` checks elapsed time before
returning. **Neither interrupts synchronous work mid-phase.** These are bounded
in-process operations, not a worker/process memory or time sandbox. For a hard
wall-clock deadline or RSS cap, run the package in an isolated worker/process
with host-enforced limits. The host must also bound transport bytes before JSON
parsing; this package cannot reclaim an already allocated oversized input.

## Failure and recovery

Malformed/security-rejected requests return `status: failed`, actionable
`validation.*`, `security.*` or `resource.*` diagnostics, and a fixed safe
400×200 diagnostic SVG (`kind: title-frame`, no theme provenance). Their IDs and
`requestHash` fingerprint the rejection diagnostics and environment, **not the
rejected request**; unvalidated input is never hashed or echoed into geometry.
Diagnostic messages are capped at 512 characters.

Kind-specific semantic errors on otherwise valid requests retain their usual
error SVG and request hash. A failed request does not poison a later render.
No jobs or persistent state exist here, so restart reconciliation is not needed.

## Files, images and networking

The active renderer constructs SVG strings only. It does not read or write
files, start processes, fetch URLs or rasterize images. It has **zero active
image inputs**: its injected `ImageResolver` and `FontResolver` are reserved and
are not called by current graphic kinds. Fonts come from registry metadata.
Image-related request fields and all primitive `image`/`href` inputs are rejected,
including traversal paths, absolute paths, file URLs and data URLs.

There is therefore no active image filesystem resolver to constrain to an allowed
root. Do not mistake the existing interface for an implemented secure loader.
Before adding image embedding, implement realpath-based root containment
(including symlink escape tests), byte/pixel/count ceilings and verified raster
MIME data; reject remote URLs and active SVG payloads. Keep host-provided resolver
implementations trusted and explicitly test them before wiring them in.

This package is not a sandbox against malicious JavaScript in the same process,
including proxies, compromised dependencies, modified theme objects or host
resolver code. Its boundary is untrusted passive request data.

## Verification

From the repository root:

```bash
npm run check --workspace @av/graphics
npm run build --workspace @av/graphics
```

`test/pipeline/security.test.ts` covers malformed requests, injection across every
supported kind, rejected URLs/traversal, unsafe font/paint values, shape and
resource limits, getter non-execution, cycles, cancellation, deterministic
clock-based deadline checks and seeded malformed-input fuzzing. The native
headless SVG rasterizer also parses/renders the injection corpus with system
font loading disabled. Fake resolvers throw if called, so tests cannot silently
read images or resolve external fonts.
