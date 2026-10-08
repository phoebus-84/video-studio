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
version's description, layer, profiles, examples and a preview per profile
it is drawn for (`previews/<name>@<version>.<profile>.png`).

The Dentro i versi short's kits (CreativeStudio's `sala8`, drawn for
`vertical-1080x1920` only; ADR-0039):

| Kit | Layer | What it draws |
|---|---|---|
| `museum-hall@1.0.0` | fill | The hall: room image, the screen with its pictures, their camera moves and picture effects, lightning, lights and spill, wind, shatter, pedestal, blackout and its bolt |
| `room-effect@1.0.0` | fill | One effect in the room, inside the camera: `nebbia-sala`, `vapore`, `note`, `uccelli`, `foglie`, `incanto`, `apparizione` (a cut-out figure), `fantasma` |
| `verse-plate@1.0.0` | overlay | A verse on its plate, words lit as they are said, strong words bold, the paraphrase under it |
| `interprete@1.0.0` | fill | The actor: poses, expressions, gaze, blinks, the mouth from the voice's energy, teleport in and out, the bow |
| `lower-third@1.0.0` | overlay | The title card: kicker, Anton title on one or two lines, growing cyan rule, author |
| `title-chip@1.0.0` | overlay | The compact title · author chip |
| `brand-mark@1.0.0` | overlay | The «DENTRO I VERSI» mark |

They share frozen library modules in `src/kits/lib/` — `stage-math`,
`fonts`, `stage-props`, `hall-fx`, `interprete`, `dentro-i-versi` (the
palette) — and load Anton, Fraunces and Inter from `@fontsource` 5.3.0
before the first frame.

The lesson stage's kits are channel-neutral (ADR-0040): each takes `look` —
colour roles, font roles by family, shared measures (`lib/look/1.0.0.ts`) —
from the channel theme the compiler passes through, and the puppet takes a
theme `character`. They are drawn for `youtube-1920x1080`; their examples use
a demo look with no channel in it. `room`, `panel` and `interprete` share an
optional `camera` (a close-up moves them together).

| Kit | Layer | What it draws |
|---|---|---|
| `room@1.0.0` | fill | A room: its picture under a slow drift (or a push towards a point), a distant storm in its sky polygons (quiet over given windows, as at a loop's edges), windows and floor lit by a flash, glowing doors, a monitor playing a clip |
| `panel@1.0.0` | fill | The glass panel, phase by phase: a picture framed on its focus with a slow push, two pictures with labels, or a clip; it turns between phases, materialises, lights with a flash, carries an AI credit |
| `interprete@1.1.0` | fill | A theme character: poses, expressions, gaze, blinks, mouth from the voice's energy, shadow and reflection, teleport in and out (the hologram exit), a costume change on a flash |
| `verse-bar@1.0.0` | overlay | Verses heard or discussed on a full plate: unsaid words dimmed, said and strong words highlighted, a kicker |
| `block-title@1.0.0` | overlay | Opens a block: kicker, title, growing rule, one line of information, bottom left |
| `figure-title@1.0.0` | overlay | A rhetorical figure's or keyword's name on a dark plate, fitted to its width |
| `chapter-opener@1.0.0` | fill | Between chapters: flash, veil, kicker, title closing in, rule, subtitle |
| `cover@1.0.0` | fill | The cover a video opens and closes on: kicker, huge title with an icon, hook lines, a dark gradient |
| `warp@1.0.0` | fill | The passage between rooms: a flash with radial streaks |
| `brand-mark@2.0.0` | overlay | A channel's mark from its theme's brand |

They share `lib/look`, `lib/fonts/1.1.0.ts` (every bundled face, loaded by
the families a look names), `lib/font-metrics/1.0.0.ts` (the faces' advance
widths: every single line of text is fitted to the room it has, never
wrapped) and `lib/lesson-stage/1.0.0.tsx` (glass, cover framing, a clip that
loops, storm, live bolt, teleport, warp). A look's fonts must be bundled
families with the faces their role is drawn with (display 400, serif 400
italic, sans 400 and 600).

The lesson's teaching tools are channel-neutral in the same way, drawn for
`youtube-1920x1080` with times in seconds from the item's start and every text
a prop. Narrative tools are layers the compiler places over and under the
panel; the figure tools and the metre kits draw their own glass panel
(default box 440/150/1060×596), because their effects work on the picture.

| Kit | Layer | What it draws |
|---|---|---|
| `panel@1.1.0` | fill | The glass panel as stacked layers per phase: a picture, 2–4 pictures side by side, a clip, a grid of light, a darkening, a portrait beside a dark grid, a framed picture; each shaded or dimmed |
| `text-stack@1.0.0` | overlay | A column of texts — big numbers, years, titles, chips, quotes, kickers, notes, rows, spaces — each at its time, room reserved so nothing overlaps |
| `timeline@1.0.0` | fill | An axis of years whose stops light up (labels on as many lines as they need), or a row of dated stops |
| `story-fx@1.0.0` | fill | Story effects over the panel: people lighting up, a curving arrow, a badge, a live bolt, a line of light |
| `word-tracks@1.0.0` | fill | One track per verse, one pill per word, punctuation as light, a reading cursor, the tracks merging into one sentence |
| `interlinear@1.0.0` | overlay | A translation word under word; struck words crossed out in the signal colour and closed up |
| `monitor-wall@1.0.0` | fill | A grid of 1–8 glass monitors appearing one after another, a caption on a plate under them |
| `summary@1.0.0` | fill | One row per picture (thumbnail, keyword, figure), a closing line, a flash lighting them all |
| `progress@1.0.0` | overlay | Where the lesson is among its pictures, on a plate above the panel |
| `merge@1.0.0` | fill | Two things fused into one: the dark tears along a line of light, bolts strike, the two words meet in the result |
| `cards@1.0.0` | fill | A thing given a body: wind, up to three cards (icon, word, meaning), the last jolting the picture, the human words stacked |
| `stack@1.0.0` | fill | A climax: three words in a row, a staircase of growing weight with its gauge, the picture shattering, smoke, the glass rebuilt dimmed |
| `oxymoron@1.0.0` | fill | A glow on a point of the picture, calm and agitated halves, the picture lit and darkened, the missing conjunction struck out |
| `simile@1.0.0` | fill | The frame closing in on an eye whose iris lives, an etymology plate, the bridge with "like", eyelids opening and closing, the frame going dark |
| `syllables@1.0.0` | fill | A verse's syllables as tiles, arcs over meeting vowels, the rule, the tiles closing up, the count falling to the metric syllables |
| `rhymes@1.0.0` | fill | The verses' last words with their scheme letters, a rhyming pair joined by an arc, an eye closing |

They draw with `lib/lesson-tools/1.0.0.tsx`: glass chips and tags, titles
that light up, SVG text with a dark outline, waves, eyelids, the living iris,
shards, wind, smoke, lines of light, `coverPoint` (where a point of a picture
lands once framed: the figure tools take the picture's `aspect`), `fitLine`
(a line fitted with its plate's room) and the figure tools' `PictureSchema`.

## Adding a kit or a version

A released version never changes: a delivered episode must re-render as it
was. A change — even a fix — is a new version next to the old one.

1. Write `src/kits/<name>/<version>.tsx` exporting `kit: KitVersion` (name,
   version, one-sentence description, zod `props`, `component`, `examples`).
   It may import only `react`, `remotion`, `zod`, types (`import type`)
   from `../types.js`, and frozen library modules by exact version
   (`../lib/<name>/<x.y.z>.js`, ADR-0039): ordinary shared code changing would
   silently change old versions. A library module keeps the same rule (and
   may load an `@fontsource` font file with a dynamic `import()`); a change
   to one is a new module version. For a new version, copy the previous file
   and edit the copy. A kit drawn for some output profiles only lists them
   in `profiles`; elsewhere a timeline using it is refused (`wrong-profile`).
   A kit that draws text or graphics over the picture declares
   `layer: "overlay"` and lays itself out inside `context.profile.safeZone`.
2. Give it at least one example: props as a timeline writes them, a
   `durationInFrames`, the `frame` to preview, and `samples` mapping its
   `$asset` ids to files in `kits/samples/`.
3. Add it to `KIT_VERSIONS` in `src/kits/index.ts`.
4. `npm run kits:lock` records the kit's hash in `kits.lock.json` — the
   file's sha256, or, when it imports library modules, the sha256 over the
   file and every module it reaches, path and bytes in sorted order (it
   never rewrites an existing entry); `npm run kits:previews` renders the
   first example in every output profile the kit is drawn for to
   `previews/<name>@<version>.<profile>.png` (a third of the size: 640×360,
   360×640). Commit both.
5. `npm test` checks the metadata, the self-contained imports and the lock
   — including that every version locked on `origin/main` (or
   `$KITS_LOCK_BASE`) is still there, unchanged — and renders one real frame
   of every example in every output profile it is drawn for. An overlay kit is drawn on a
   transparent background, and the box of what it drew must lie inside the
   profile's safe zone; the failure says by how many pixels and on which side.

## API

```ts
import {renderTimeline, validateTimeline, listKits} from '@av/remotion-composer';

const result = await renderTimeline({
  timeline,            // a studio.video/v1alpha2 EditTimeline
  assetRoot,           // the directory asset paths are relative to
  sharedRoots,         // optional: folders outside it assets may come from (a channel's themes, ADR-0040)
  outputPath: 'out.mp4',
  cacheDir: '.cache/remotion', // optional; omit for the original full-render path
});
```

Failures throw `ComposerError` with a `code` (`invalid-timeline`,
`unknown-kit`, `bad-props`, `wrong-profile`, `missing-asset`, `hash-mismatch`,
`render-failed`, `loudness-failed`, `bad-sheet`, `sheet-failed`) and, for
validation, `problems` with JSON paths.

### Render audit

`auditRender(file, expectation)` says whether a rendered file is what its
timeline promised (avg-3th.3); `auditExpectation(timeline)` reads that promise
from a validated timeline:

```ts
const audit = await auditRender('out.mp4', auditExpectation(timeline));
// audit = {passed, checks: ['decode', 'streams', 'duration', 'loudness'?, 'loop'?], findings}
```

| Check | Finding | Passes when |
|---|---|---|
| decode | `decode-errors` | FFmpeg decodes the whole file without an error (nothing else is checked otherwise) |
| streams | `wrong-video`, `wrong-audio` | H.264 `yuv420p` at the timeline's size and frame rate; AAC at 48 kHz when the timeline has sound |
| duration | `wrong-duration` | the video lasts the timeline's frames, ± 1; with sound, the sound lasts as long, ± 0.2 s |
| loudness | `loudness-off` | with sound: integrated loudness within 1 LU of the profile's target, true peak at most 0.3 dB over it (silence says so) |
| loop | `loop-broken` | when the timeline sets `loop: true`: first and last frame, at 64×36 grey, differ by at most 2 levels on average |

A bad file gives findings, never an exception; it throws only when FFmpeg or
FFprobe cannot run. Their paths are the optional third argument, by default
the ones every other step of a render uses (`FFMPEG_PATH`, `FFPROBE_PATH`,
else on the PATH). What a
failed audit means is the caller's: `@studio/episode` never makes such a
render current.

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
node packages/remotion-composer/dist/cli.js timeline.json out.mp4 --assets <episode-dir> [--shared <theme-release-dir>] --cache <cache-dir>
node packages/remotion-composer/dist/sheet-cli.js timeline.json out-dir/ --assets <episode-dir> --times 0,2.5,10 [--shared <theme-release-dir>] [--scale 0.25] [--columns 6]
```

## Tests

```bash
npm test --workspace @av/remotion-composer                     # schema, kits, volume, assets, one frame per kit example and profile
npm run build --workspace @av/remotion-composer && \
  REMOTION_E2E=1 npm test --workspace @av/remotion-composer    # also real renders, a real layout sheet and cache recovery/reuse checks
```

The first render downloads Remotion's headless Chrome.
