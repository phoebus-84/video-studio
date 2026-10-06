# Versioned kit registry with one-frame tests and previews

**Issue:** `avg-tk7.3` — versioned kit registry with one-frame tests and previews
**Epic:** `avg-tk7` — Remotion composer for layered timelines (the `cs-port` plan)
**Builds on:** [Remotion composer](2026-10-06-remotion-composer-design.md) (`avg-tk7.1`); design note M3 ("the kit extension mechanism"); ADR-0034 (kits live in the repository, never in `library/`)
**Blocks:** `avg-dcf.3`, `avg-dcf.4` (Dentro i versi kits), `avg-8xq.2` (web catalog)
**Date:** 2026-10-06

## Problem

`@av/remotion-composer` has a minimal registry: one version per kit, no
metadata, no test that a kit actually renders, no picture of what it draws.
Kits are about to multiply (the "Dentro i versi" channel needs ~25), and the
rules have to be in place first: a delivered episode must re-render as it was,
a broken kit must fail the checks rather than a production render, and the
web catalog and the agent need to see what each kit is.

Also found: `packages/remotion-composer` is not in the CI module matrix, so
its tests have never run in CI.

## Decisions taken with the user

1. **Released versions are frozen and coexist; exact match.** A timeline gets
   exactly the version it names. A change is a new version file; the old one
   stays. (CreativeStudio UP-52/UP-54: approved episodes are fixed references;
   change only what was asked.)
2. **A real one-frame render per kit example, in `npm test` and CI**, with
   Remotion's headless Chrome.
3. **Registry only — no new kits.** The three existing kits move to the new
   layout unchanged, as `1.0.0`.

## Design

### Layout (in `packages/remotion-composer/`)

```
src/kits/
  types.ts            KitVersion, KitExample
  index.ts            the registry: resolveKit, listKits, KIT_VERSIONS
  still/1.0.0.tsx     export const kit: KitVersion
  clip/1.0.0.tsx
  captions/1.0.0.tsx
kits/samples/         sample assets for examples: sample.png, sample.mp4
kits.lock.json        { "still@1.0.0": "sha256:…", … }
previews/             <name>@<version>.png, 640×360, committed
src/preview-entry.ts  one Remotion composition per kit example
scripts/kits.mjs      kits:lock and kits:previews
```

### `KitVersion` (`src/kits/types.ts`)

```ts
interface KitExample {
  id: string;                         // ^[a-z0-9]+(-[a-z0-9]+)*$
  props: Record<string, unknown>;     // as a timeline writes them; $asset ids name samples
  durationInFrames: number;           // integer ≥ 1
  frame: number;                      // the preview frame, 0 ≤ frame < durationInFrames
  samples?: Record<string, string>;   // $asset id → file in kits/samples/
}
interface KitVersion {
  name: string;                       // ^[a-z][a-z0-9]*(-[a-z0-9]+)*$
  version: string;                    // semver x.y.z
  description: string;                // one sentence, non-empty
  props: ZodTypeAny;                  // validates props as a timeline writes them
  component: React.FC<{props: Record<string, unknown>; context: KitContext}>;
  examples: KitExample[];             // at least one
}
```

### Version files

- One file per version: `src/kits/<name>/<version>.tsx`, exporting `kit`.
- **Self-contained**: it may import only `react`, `remotion`, `zod` and
  `../types.js`. A shared helper changing would silently change old versions.
- `kits.lock.json` records the sha256 of every released version file. A test
  fails when a locked file's hash differs ("released version: add
  `<name>/<next>.tsx` instead") or when a version file is not in the lock.
  `npm run kits:lock` adds new versions to the lock and never rewrites an
  existing entry.

### Registry (`src/kits/index.ts`)

- `KIT_VERSIONS`: every `KitVersion`, imported explicitly (no filesystem
  scanning at runtime, so the Remotion bundle includes them).
- `resolveKit(name, version)` → the exact `KitVersion` or `undefined`.
- `listKits()` → `[{ name, version, description, examples: [ids], preview: "previews/<name>@<version>.png" }]`, sorted by name then version.
- `validateTimeline`'s `unknown-kit` message lists the versions available,
  e.g. `still@2.0.0: available still@1.0.0`.
- `Timeline.tsx` renders `resolveKit(item.kit.name, item.kit.version)`.

### Examples and samples

`kits/samples/sample.png` (a 1280×720 gradient) and `sample.mp4` (1 s,
320×180, H.264) are small committed files. An example's `$asset` ids map to
them through `samples`. Every kit has at least one example:
`still/cover`, `still/contain`, `clip/plays`, `captions/bottom`,
`captions/top`.

### One-frame render test (`test/kits-render.test.ts`, in `npm test`)

- `src/preview-entry.ts` registers one composition per example of every
  version, id `<name>-<version-with-dashes>-<example>`, 1920×1080, 30 fps,
  `durationInFrames` from the example, props resolved against the samples
  (`staticFile`).
- One `bundle({ entryPoint: src/preview-entry.ts, publicDir: kits/samples, outDir: <tmp> })`,
  then `renderStill` of each composition at the example's `frame`, to a
  temporary PNG.
- Each still must exist, be 1920×1080, and not be blank: `signalstats`
  `YMAX − YMIN > 16`.
- Temporary bundle and stills are removed after the suite.

### Metadata test (`test/kits.test.ts`, no browser)

For every `KitVersion`: name and semver patterns; the file path matches
`<name>/<version>.tsx`; non-empty description; ≥ 1 example; unique example
ids; every example's props pass the kit's own schema; `frame` within the
duration; every sample file exists; the file's imports are only the allowed
ones; the file's hash equals `kits.lock.json` (and no version is missing from
the lock); `previews/<name>@<version>.png` exists.

### Previews

`npm run kits:previews` renders each version's **first** example at its frame
with `scale: 1/3` (640×360) to `previews/<name>@<version>.png`. Committed;
not compared pixel by pixel in tests (fonts differ between macOS and Linux).

### CI

`.github/workflows/ci.yml`: `packages/remotion-composer` joins the module
matrix (typecheck and test on Ubuntu, with FFmpeg already installed).
Remotion downloads its headless Chrome on the first render; if Ubuntu needs
extra system libraries, they are added to that job's install step.

### Guide and docs

The package README gains "Adding a kit or a version": the version file and
its import rule, examples and samples, `kits:lock`, `kits:previews`, and that
a released version never changes. Docs regenerated with
`node tools/gen-docs.mjs`. Package version `0.1.0` → `0.2.0`.

## Testing

- The new tests above.
- The existing package tests keep passing unchanged (validation, assets,
  layers, volume, probe), including the end-to-end renders with
  `REMOTION_E2E=1`.
- A deliberately edited locked file fails the metadata test (checked once by
  hand during implementation, then reverted).
- Root `npm run check`; CI green including the new matrix entry.

## Out of scope

New kits (`title`, `lower-third`, Dentro i versi: `avg-dcf.3`, `avg-dcf.4`);
the web catalog (`avg-8xq.2`); exposing `chromiumOptions` (benchmark
follow-up).
