# Remotion composer

Renders a layered, kit-based edit timeline (`studio.video/v1alpha2`, ADR-0034)
with Remotion, then normalises loudness with a two-pass FFmpeg `loudnorm`. It
knows timelines, kits and files — not episodes, pipelines or the studio.

## Scope

- **Validates** the timeline's structure (a zod mirror of the canonical
  schema), every kit's name, version and props, and every asset file against
  its hash, before anything renders. Semantic rules — overlaps, crossfades,
  references — are the contracts' `validateEditTimeline`, which the caller
  runs first.
- **Renders** visual tracks in `z` order, one kit instance per item, with
  fades and crossfades; audio items as `<Audio>` with a per-frame volume
  (gain × fades × ducking under other tracks).
- **Normalises** loudness to the timeline's output profile (`profile.loudness`:
  −15 LUFS for `youtube-1920x1080`, −14 for `vertical-1080x1920`, −1 dBTP
  true peak) and returns a result record: path, duration, size, sha256, kits
  used, profile, loudness.

The timeline carries a whole copy of its output profile — size, safe zone,
loudness — taken from the contracts' catalog
(`studio/contracts/src/output-profiles.json`); this package never reads the
catalog, only the timeline. Kits receive the profile in `context.profile`.

Kits in this version: `still@1.0.0`, `clip@1.0.0`, `captions@1.0.0`, and
`captions@1.1.0`, which keeps its text inside the profile's safe zone. A
timeline gets exactly the version it names; `listKits(profileIds)` gives each
version's description, layer, examples and a preview per profile
(`previews/<name>@<version>.<profile>.png`).

## Adding a kit or a version

A released version never changes: a delivered episode must re-render as it
was. A change — even a fix — is a new version next to the old one.

1. Write `src/kits/<name>/<version>.tsx` exporting `kit: KitVersion` (name,
   version, one-sentence description, zod `props`, `component`, `examples`).
   It may import only `react`, `remotion`, `zod`, and types (`import type`)
   from `../types.js`: shared runtime code changing would silently change old
   versions. For a new version, copy the previous file and edit the copy.
   A kit that draws text or graphics over the picture declares
   `layer: "overlay"` and lays itself out inside `context.profile.safeZone`.
2. Give it at least one example: props as a timeline writes them, a
   `durationInFrames`, the `frame` to preview, and `samples` mapping its
   `$asset` ids to files in `kits/samples/`.
3. Add it to `KIT_VERSIONS` in `src/kits/index.ts`.
4. `npm run kits:lock` records the file's sha256 in `kits.lock.json` (it
   never rewrites an existing entry); `npm run kits:previews` renders the
   first example in every output profile to
   `previews/<name>@<version>.<profile>.png` (a third of the size: 640×360,
   360×640). Commit both.
5. `npm test` checks the metadata, the self-contained imports and the lock
   — including that every version locked on `origin/main` (or
   `$KITS_LOCK_BASE`) is still there, unchanged — and renders one real frame
   of every example in every output profile. An overlay kit is drawn on a
   transparent background, and the box of what it drew must lie inside the
   profile's safe zone; the failure says by how many pixels and on which side.

## API

```ts
import {renderTimeline, validateTimeline, listKits} from '@av/remotion-composer';

const result = await renderTimeline({
  timeline,            // a studio.video/v1alpha2 EditTimeline
  assetRoot,           // the directory asset paths are relative to
  outputPath: 'out.mp4',
});
```

Failures throw `ComposerError` with a `code` (`invalid-timeline`,
`unknown-kit`, `bad-props`, `missing-asset`, `hash-mismatch`,
`render-failed`, `loudness-failed`) and, for validation, `problems` with JSON
paths.

## CLI

```bash
npm run build --workspace @av/remotion-composer
node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <episode-dir>
```

## Tests

```bash
npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example and profile
npm run build --workspace @av/remotion-composer && \
  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also three real renders (16:9, audio, 9:16)
```

The first render downloads Remotion's headless Chrome.
