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
`captions@1.1.0`, which keeps its text inside the profile's safe zone and cuts
text that does not fit at the zone's edge (keep captions short). A
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
  cacheDir: '.cache/remotion', // optional; omit for the original full-render path
});
```

Failures throw `ComposerError` with a `code` (`invalid-timeline`,
`unknown-kit`, `bad-props`, `missing-asset`, `hash-mismatch`,
`render-failed`, `loudness-failed`, `bad-sheet`, `sheet-failed`) and, for
validation, `problems` with JSON paths.

### Layout sheet

`renderLayoutSheet` renders a timeline's stills at the frames the caller
picks, then one labelled grid of them (the `Sheet` composition), from one
bundle in one browser (avg-3th.1):

```ts
const sheet = await renderLayoutSheet({
  timeline, assetRoot,
  picks: [{frame: 0, label: 'first'}, {frame: 300, label: 'poem · start+2s'}],
  outDir: 'sheet/',    // frames/000.jpg … and sheet.jpg
  scale: 0.25,         // default; columns default to 6 (landscape) or 8
});
// sheet.frames[i] = {index, frame, seconds, label, path, hash}
// sheet.sheet = {path, hash, columns, rows, width, height}
// sheet.kits = [{name, version, hash}] — code hashes from kits.lock.json
```

Each tile is captioned `#NN · mm:ss.ff · label`. At most 120 distinct whole
frames inside the timeline; anything else is `bad-sheet`, refused before
anything is written. Which frames to pick, and where an episode keeps its
sheet, are the studio's (`@studio/episode`). `timelineKits(timeline)` lists
the kits a timeline draws with and their code hashes without rendering. `drawingCodeHash()` names the rest of what draws the pictures —
this package's built code and its Remotion and React versions — so a sheet
made before a composer upgrade can be told apart from one made after.

## Partial render cache

With `cacheDir`, the composer keeps **silent, independently encoded one-second
H.264 segments**, plus their concatenated video. A short last segment retains
its exact frame count. The studio opts in at `<episode>/.cache/remotion`;
the package knows only the caller's directory.

- Narration/music edits (bytes, timing, gain, fades, ducking, mute) reuse the
  whole video. Audio is mixed afresh by Remotion to a lossless WAV, muxed with
  copied video, then normalised to the requested loudness. No picture is encoded.
- Visual changes invalidate only seconds intersecting the changed items. Both
  sides of crossfades, captions and overlays participate. Original frame ranges
  are rendered against the full timeline, preserving clip and animation clocks.
- Keys include referenced asset hashes, item props/kit versions, drawing order,
  frame range, fps, duration, profile, video lengths, bundled code, node-side
  renderer code, dependency versions, Chrome binary, FFmpeg version and encoding
  settings. Global changes invalidate conservatively. Revision numbers, source
  pointers and editorial metadata are not visual inputs.
- Every declared source asset is still hash-verified **before cache lookup**.
  Cache entries are copied and digest-checked before reuse; incomplete or corrupt
  entries miss. Writes use unique temporary files and atomic renames. Only
  complete video segments/assemblies are published; a later audio or delivery
  failure may leave valid video to reuse on retry. Cache I/O failures fall back to rendering and
  appear in `result.cache.warnings`.
- `result.cache` reports `wholeVideoReused`, `segmentsReused`,
  `segmentsRendered`, `totalSegments` and warnings (also in studio render reports).
  A whole-video hit reports zero segment reads/renders.

The cache is disposable, machine-local working data, not a delivery artifact.
Delete its directory to reclaim space or force a clean render; there is no
automatic eviction. Clear it after changing system fonts. Cold cached renders
pay per-segment encoding overhead; the uncached path remains available by
omitting `cacheDir`. Both paths produce the same frames/timing, not necessarily
identical lossy H.264 bytes. Bundling, asset verification and loudness still run
on a warm cache. Kits must remain deterministic and use declared assets; no
network or wall-clock inputs.

## CLI

```bash
npm run build --workspace @av/remotion-composer
node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <episode-dir> --cache <cache-dir>
node packages/remotion-composer/dist/sheet-cli.js timeline.json out-dir/ --assets <episode-dir> --times 0,2.5,10 [--scale 0.25] [--columns 6]
```

## Tests

```bash
npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example and profile
npm run build --workspace @av/remotion-composer && \
  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also real renders, a real layout sheet and cache recovery/reuse checks
```

The first render downloads Remotion's headless Chrome.
