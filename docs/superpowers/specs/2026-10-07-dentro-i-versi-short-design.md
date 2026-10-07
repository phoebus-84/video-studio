# Dentro i versi · short: the museum-hall kits and the series compiler

**Issues:** `avg-dcf.3` and its children `avg-dcf.3.1`–`.6` — rewrite the short-room kits (from CreativeStudio's `sala8`) as clean kits, and the short's compiler, validator and template release
**Epic:** `avg-dcf` — test channel "Dentro i versi" (the `cs-port` plan)
**Builds on:** the kit registry (`avg-tk7.3`), output profiles (`avg-tk7.4`), the Remotion composer (`avg-tk7.1`), series templates and compilers (ADR-0037, `avg-jao.*`), word timing (`avg-7zp.1`, ADR-0038), the layout sheet (`avg-3th.1`)
**Unblocks:** `avg-dcf.1` (the channel's series templates), `avg-dcf.4` (the long lesson reuses these kits), `avg-dcf.7` (San Martino short end to end)
**Source:** `../CreativeStudio/formats/poesie-museo-short/` (`FORMAT.md`, `runtime/sala8.tsx`), `../CreativeStudio/formats/poesie-museo-long/runtime/v10/{ui,fx7}.tsx`, `../CreativeStudio/formats/poesie-museo/runtime/{fx,presets}.tsx`, `../CreativeStudio/characters/interprete/` — read only; nothing copied
**Date:** 2026-10-07

## Problem

"Dentro i versi · short" is a poem recited in a science-fiction museum hall:
the title said, the whole poem, applause; an installation screen with the
poem's pictures and a slow camera; the verses on a light plate with their
paraphrase; an SVG actor (the *interprete*) with poses, expressions and a
mouth driven by the voice; titles in the long's style; effects that come
out of the pictures into the hall. In CreativeStudio it is one ~380-line
Remotion stage (`sala8`) on ~3,300 lines of runtime, computing everything
from global time and one data file (`museo.json`).

This studio renders layered, kit-based edit timelines: every item drawn by a
versioned kit with validated props, reviewable, editable by hand, checked by
the layout sheet. None of the short's elements exists as a kit, and without
them the channel's series template (`avg-dcf.1`) cannot exist.

## Decisions taken with the user

1. **Composite kits, one per coherent layer** — hall, actor, verse plate,
   titles, room effects — not fine-grained kits with a new timeline version,
   nor one monolithic stage kit. What acts across layers (camera, lightning
   flash, blackout) is computed once by the compiler and passed identically
   to every kit that needs it.
2. **Fonts from `@fontsource`** (Anton, Fraunces, Inter; OFL), bundled with
   the composer: no network at render time.
3. **One run:** one spec, one plan, one branch and PR, one commit per piece.
4. **Overlays adapt to the output profile's safe zone** (top 120, right 140,
   bottom 380, left 60 in `vertical-1080x1920`), not CreativeStudio's
   positions: plates and the title card at x 90, their bottom at y 1500
   (growing upwards), the chip 140 from the right, shadows `0 10px 24px`.
5. **The look was checked before the plan** on the San Martino episode
   rendered end to end (real takes aligned by Qwen, stand-in pictures:
   CreativeStudio's pictures and its delivered short are not in this
   checkout) — approved by the user on 2026-10-07.
6. **Channel specifics in code are accepted for this format** (palette,
   costumes, poses, a series-specific compiler); the boundary is restored by
   `avg-d1x`.

## Scope of 1.0.0

What the two approved CreativeStudio references (San Martino short, Il lampo
short) use, and nothing else:

- hall: closed white hall (`outside: null`), installation screen, pedestal,
  lightning at picture changes (`strikes: "pictures"`), wind, shake,
  shatter, blackout with bolt, lights per stanza, teleport in and out;
- picture effects: `nebbia`, `vento`, `acqua`, `bagliore`, `fuoco`,
  `riflesso`, `uccelli`, `fulmini`, `sussulto`;
- room effects: `nebbia-sala`, `vapore`, `note`, `uccelli`, `foglie`,
  `incanto`, `apparizione`, `fantasma`;
- verse text mode `sober` only.

Out of 1.0.0: the outside window and its rain and clips, verse mode
`reveal`, the other ~10 catalogue effects, the long lesson's components
(`avg-dcf.4`), importing CreativeStudio's real assets (`avg-dcf.5`), the
channel itself (`avg-dcf.1`).

## Design

### 1. Kits share frozen libraries (ADR-0039)

Today a kit version may import only types: `kits.lock.json` hashes the kit's
own file, so a shared module could change a released kit's pictures
unnoticed. Seven kits sharing a palette, fonts, maths, effects and an actor
need more:

- **Frozen library modules** at `packages/remotion-composer/src/kits/lib/<name>/<version>.tsx`
  (or `.ts`). Released like kit versions: never edited; a change is a new
  version file. 1.0.0 adds:
  - `stage-math/1.0.0.ts` — `clamp`, `smoothstep`, `ease` (smootherstep),
    `ramp`, `pulse`, `win`, `mix`, the deterministic `rnd(i)`/`rnd2`,
    `envelope(t, Envelope)`, `sumOf`, `maxOf`;
  - `stage-props/1.0.0.ts` — the zod schemas the kits share
    (`EnvelopeSchema`, `CameraSchema`, `FlashSchema`, `BoxSchema`,
    `AssetUrl` = `{ $asset }`) and `cameraStyle(t, camera)`;
  - `fonts/1.0.0.ts` — Anton 400, Fraunces 400/700 italic, Inter
    300/400/600, each `.woff2` loaded by a dynamic `import()` inside the
    browser only, with `FontFace` under Remotion's `delayRender`/
    `continueRender`; exports the family names (`fonts.d.ts` declares
    `*.woff2`);
  - `dentro-i-versi/1.0.0.ts` — the palette (`HALL`, `TITLES`, `LIGHT`) and
    the text shadow;
  - `hall-fx/1.0.0.tsx` — `Glass`, `Cover`, `Shatter`, `LiveBolt`,
    `Teleport`, `pictureCamera`, `strikeAt`, the nine picture effects
    (`PICTURE_FX`) and the eight room effects (`ROOM_FX`), unique SVG ids
    by `useId`, textures passed as URLs;
  - `interprete/1.0.0.tsx` — the SVG puppet (variants `attore`, `attrice`;
    outfits, hairstyles, accessories), `REST`, `EXPR`, `POSE_PRESETS`,
    `PALETTES`, the palette passed in as a value.
- **The lock hash covers what a kit draws with:** a kit that imports no
  library module hashes as before (its file's sha256); otherwise `sha256`
  over the kit file and every library module it reaches, transitively, in
  sorted path order, each as `<path relative to src/kits>\0<bytes>`.
  Library imports are `../lib/<name>/<x.y.z>.js` from a kit and
  `../<name>/<x.y.z>.js` between modules; anything else is refused. The
  existing entries (`still`, `clip`, `captions`) do not change.
  `scripts/kit-source.ts` (`importsOf`, `libraryFile`, `moduleProblems`,
  `sourceFiles`, `kitSourceHash`) is shared by `npm run kits:lock` and the
  kit tests; editing a released library module fails the check for every
  kit that uses it.
- **Kits may be drawn for some profiles only:** `KitVersion.profiles?`. A
  timeline using such a kit in another profile is refused (`wrong-profile`,
  before its props are checked); `listKits` reports the profiles, previews
  and one-frame tests cover only them (`drawnFor(kit, profileId)`). The
  seven kits here are drawn for `vertical-1080x1920`.
- `drawingCodeHash` already covers all of the package's built code: a
  layout sheet made before any change here is stale after it.

### 2. Shared types (props)

```ts
Envelope = { from: number; to: number; rampIn: number; rampOut: number; amount: number }  // seconds from item start
Camera   = { origin: [number, number]; zoom: Envelope[]; shake: Envelope[] }                 // shake amount in px
Flash    = { strikes: number[] }                                                              // seconds from item start
```

`envelope(t, e)` = `e.amount × ramp(t, from, from + rampIn) × (1 − ramp(t, to − rampOut, to))`.
Camera scale = `1 + Σ zoom envelopes`; shake = max of shake envelopes,
jittered by `rnd(floor(t × 24))` as in `sala8`. Flash = `sala8`'s strike
curve over `strikes`.

### 3. The kits (all `1.0.0`; Dentro i versi look by default)

Every kit is a pure function of the item's frame and its props. Times in
props are seconds from the item's start.

| Kit | Layer | Props |
|---|---|---|
| `brand-mark` | overlay | `text?` ("DENTRO I VERSI"), `x?` (60), `y?` (120) |
| `lower-third` | overlay | `kicker`, `titleLines` (1–2), `author`, `maxWidth`, `size` (Anton px, ≤ 160), `x?` (90), `bottom?` (1500: the card grows upwards from it), `ruleGrow?` (1.2 s; 0: already drawn) |
| `title-chip` | overlay | `title` (≤ 40), `author?`, `right?` (140), `y?` (120) |
| `verse-plate` | overlay | `text` (lines by `\n`), `words: {text, at}[]` (one per token of `text`), `strong?`, `gloss`, `start?` (0.28), `enter?` (0.27), `dim?` (0.42), `x?` (90), `y?` (1240), `bottom?` (1500: a long verse grows upwards), `width?` (500) |
| `museum-hall` | fill | `room`, `screen` (360, 215, 620, 910), `pictures: {src, at, scale, origin, move: {dx, dy, z, r}, fx, spill}[]`, `camera`, `flash`, `lights: {at, dark, spot, w}[]`, `blackout?: Envelope`, `bolt?: {at, dur}`, `wind?: Envelope[]`, `shatter?: {at, picture, dur}[]`, `pedestal?`, `actor: {x, scale, liveFrom, liveTo}`, `textures?: {fog?, caustics?}` |
| `interprete` | fill | `variant`, `outfit?`, `hairstyle?`, `accessories?`, `palette` (full), `x`, `footY?` (1800), `scale?` (0.95), `poses: {at, pose}[]`, `expressions: {at, ex}[]`, `gaze?`, `blinks?`, `live: {from, to}`, `bow: {from, to}`, `mouth: {energy: {rate, values}, speech: [number, number][], from, to}`, `teleport?: {in?: {at, dur}, out?: {at, dur}}`, `camera`, `flash`, `blackout?` |
| `room-effect` | fill | `effect`, `color?`, `start?`, `end`, `screen`, `camera`, `blackout?`, `textures?: {fog?}`, `figure?: {src?, x?, y?, w?, mode? (sale, salpa, scende), exit? (rientra, svanisce), glow?}`; `apparizione` needs `figure.src`, `nebbia-sala` needs `textures.fog` |

Assets are `{ $asset }` objects. Overlays fade only through the timeline's
`transitionIn`/`transitionOut`; nothing slides in.

Drawing follows `sala8` and its runtime, rewritten clean: same geometry,
colours, curves and timings. Specifics:

- `verse-plate`: whole verse visible; a word not yet said at `dim`
  opacity, lit over 0.22 s from its `at`; strong words bold, ink → accent;
  the cyan rule grows over 0.5 s; the paraphrase (Inter 30) fades in from
  the verse's start + 0.1 s and stays until the plate fades (UP-55, UP-59).
  No movement beyond the plate's entry.
- `museum-hall`: room image, screen with crossfading pictures and their slow
  camera moves and picture effects, lightning glow on wall and floor,
  darkness mask with light holes on the screen and around the actor,
  lights' tint and spill, shatter, wind, pedestal, bolt in the blackout,
  blackout over everything below the plate.
- `interprete`: inside the camera; contact shadow and floor reflection;
  lit by the flash; hidden by the blackout; `Teleport` in and out; mouth
  from the energy of the voice (5-frame average, threshold 0.045, × 12,
  0–9), closed outside speech.
- `room-effect`: inside the camera, from `start` to `end`, faded in 0.6 s
  and out 0.8 s; `note`, `apparizione` and `fantasma` make their own entry
  and exit.

Each kit has examples at several instants (a word not yet said and lit;
teleport halfway; blackout; a strike; each effect), rendered by the
one-frame tests and the previews; overlays checked against the safe zone.
Samples are generated placeholders in `kits/samples/`: a sketched hall, flat
pictures, a cut-out silhouette.

### 4. Track order

From the bottom: `hall` (z 0) → `room-N` (z 10+) → `verses-N` (z 20+) →
`actor` (z 30: above the plates; hands may pass in front of one, never off
screen; UP-56) → `card` (z 40, the lower third at the opening and the bow) →
`chip` (z 41) → `brand` (z 50). Audio: `voice` (the takes), `sfx-N`,
`applause`, `music` (ducked under the voice). A track never has overlapping
items (the contracts' rule): items that overlap — a plate fading into the
next, effects at once — go on the first lane where they fit (`verses-1`,
`verses-2`, `room-1`…, `sfx-1`…).

### 5. The compiler `dentro-i-versi-short@1.0.0` (`@studio/series`)

**Spec data** (the series schema), from CreativeStudio's `museo.json`:

```text
title, author, kicker?, titleLines?, voiceEndWord?
verses[]: { text, strong?, gloss }
pictures[]: { assetId, at?, cam?: {dx, dy, z, r}, fx?, spill?, sc?, org? }
actor: { variant, outfit?, hairstyle?, accessories?, base?, palette?: {…overrides} }
poses[]: { at, preset? , angles… }       expressions?: string (one letter per verse, N A W I M S)
gaze[]: { from, to, x, y, h }            pushVerses?: number[]
lights[]: { at, dark?, spot?, tint?, w? }   (tint is accepted and ignored: sala8 keeps the dark blue)
hall: { room, textures?: {fog?, caustics?}, pedestal?, teleport?: {in: [at, dur], out: [at, dur]},
        wind?, shake?, shatter?, blackout?, bolt? }
roomFx[]: { fx, at, to?, color?, assetId?, x?, y?, w?, mode?, exit?, glow? }
sfx[]: { assetId, at, dur, gain?, offset? }   (dur: seconds or a time)
applause?: { assetId, gain?, dur?, delay? }   music?: { assetId, gain?, duck? }
```

Times keep CreativeStudio's syntax: `verse:N`, `verseEnd:N`, `word:parola`,
`end`, `picture:N`, each with an optional `±seconds`, or seconds. Pictures,
the room, textures and silhouettes are `image-<assetId>`; sounds are
`sound-<assetId>`.

**From the takes:** the unit `recital` — the title take first, then the
poem — is laid out by `layoutUnit` and played from 0.3 s (`voce.wav` in
CreativeStudio is 0.3 s + title + ~1 s + recital). The poem's words are the
unit's words after the title take's tokens; verses are those words split by
each verse's token count, checked word by word against the verse's text; a
verse starts at its first word. The voice ends at `voiceEndWord`'s last
saying — matched without case or punctuation, and only in the last verse —
or at the last word; the video lasts until 6 s after it. Profile
`vertical-1080x1920`, 30 fps.

**It computes**, as `sala8` does:

- pictures: the first at 0, the others at their time (default the start of
  verse `i + 1`); scale 1.07, origin `50% 40%`, spill `#b9a8ff`, default
  camera moves cycling `sala8`'s six;
- camera (origin 600, 1100): a breathing zoom from verse 1 to the end of
  the voice + 1.8 s (0.025), pushes of 0.027 on `pushVerses` (default
  `[1, round(n·0.4), round(n·0.8), n]`), shakes (amp default 7);
- lightning 0.05 s before each picture change while the voice speaks;
- lights (default: bright at 0, brighter at the end + 1.8 s), wind,
  shatter (1.4 s), blackout, bolt (0.7 s);
- the actor: poses (presets + angles, rest at 0 and at the end of the
  voice), expressions per verse (from 0.15 s before it, back to N 0.3 s
  after the voice), gazes (at each picture change + the spec's), blinks
  (from 1.1 s, 2–5 s apart by `rnd`), live from 1 s to 0.2 s before verse
  1, the bow from the end + 2.5 s to + 4.7 s, the mouth from the takes'
  energy (padded by the 0.3 s lead) within the speech spans, teleport;
- the title card: width = actor x − 150 × scale − 24 − 90 (514), Anton size
  `min(124, ⌊(width − 66) / (0.47 × longest line)⌋)`, the title on one line
  when that size is ≥ 100, else on `titleLines` (default: halved); at the
  opening until 0.1 s before verse 1 (fade out 24 frames) and from the end
  + 1 s to the last frame (fade in 27, rule already drawn);
- the chip from 0.9 s before verse 1 to the end + 1.9 s, the author only
  when the title has at most 13 characters;
- one plate per verse from 0.28 s before it to 0.05 s before the next (the
  last to the end + 1 s), its words' times relative to the plate;
- one `room-effect` per `roomFx` (to default `at` + 8 s), the camera and
  blackout shifted to its start;
- audio: the takes, the sounds (fades 9/18 frames, at most half of what is
  left), applause (0.8 s after the voice, 5.7 s, 0.72), music (0.6, ducked
  to 0.75 under the voice); everything cut at the last frame;
- sections `title`, `verse-N`, `bow`.

**It refuses**, with the JSON path of the cause: no `recital` unit
(`missing-unit`), or one without both takes (`missing-take`); verses whose
words are not the recital's (`verse-mismatch`); a `word:` or
`voiceEndWord` the recital does not say (`unknown-word`); a
`voiceEndWord` last said before the last verse (`voice-end-early`); a time
that is not one, or `picture:N` with no picture N (`bad-time`); an unknown
pose preset (`unknown-pose`) or costume (`unknown-palette`); a picture or
sound with no file (`missing-asset`); a sound or room effect starting after
the video's end (`after-end`).

### 6. The validator `dentro-i-versi-short@1.0.0`

Holds the timeline to be rendered — a hand edit included — to the format:

- errors: `profile-changed`, `fps-changed`, `duration-range` (25–90 s),
  `forbidden-kit` (only the seven kits, at 1.0.0), `verse-text` (a plate
  that is not a verse of the spec; UP-59), `missing-verse`,
  `missing-actor`, `missing-teleport` (in and out: the first and last frame
  are the empty hall), `altered-voice` (takes never cut, moved or reworked);
- warnings: `apparitions` (`apparizione`, `fantasma`) not exactly 2,
  `apparition-short` (under 5 s; UP-58), `title-pause` (between the title's
  last word and the poem's first, not 0.8–1.4 s).

Golden cases as for `poetry-short` (15).

### 7. The template release (fixtures)

`studio/series/fixtures/dentro-i-versi-short/1.0.0/`: the golden
`input.json` and `expected-timeline.json` — San Martino with
CreativeStudio's text, data and word timing (the title's words synthetic,
the recital's from CreativeStudio's `words.json`, energy from its
`energy.json`), placeholder hashes — and the release under `release/`:
`series-template.json` (compiler and validator `dentro-i-versi-short@1.0.0`;
`sheet.instants` at the teleport in (title start + 0.85 s), every verse's
middle, the teleport out (bow end − 0.7 s)), `FORMAT.md` (the standard,
rewritten from CreativeStudio's), `episode-spec.schema.json`,
`episode-spec.template.json` (`__FILL__` placeholders). `avg-dcf.1` copies
the release into the channel's series.

### 8. The episode side (`@studio/episode`)

- `loadEpisode` offers every file in `assets/sounds/` (`.wav .mp3 .m4a .aac
  .flac .ogg`) as `sound-<name>`, kind `audio`, hashed into the inputs, as
  it does pictures; two files with one name are `ambiguous-asset`.
- `alignTake` also writes the take's **energy** (`measureEnergy`: RMS per
  1/30 s, divided by the loudest, as many samples as the take lasts):
  without it the actor's mouth stays closed. ADR-0038 records it.
- `@studio/episode/testing` gains `divShortEpisode`: the golden San Martino
  on disk, every picture, sound and take written by the caller or as
  placeholders.

Found and left to `avg-8hs.5`: raw takes keep their head and tail silences
(4.7 s between title and poem with CreativeStudio's raw takes), and
CreativeStudio lengthened the recital's pauses by hand; the trim and the
lengthening belong on the take's audio, before alignment.

## Verifying the look

Done before the plan (2026-10-07), uncommitted: San Martino compiled from
CreativeStudio's data, its two raw takes trimmed and aligned by Qwen,
stand-in pictures and silent sounds (CreativeStudio's pictures, room and
delivered short are in its Windows library, not here), rendered through
`renderEpisode` (34.6 s, about 10 minutes) and `makeLayoutSheet` (36
frames), compared with CreativeStudio's interprete look and effect
previews. Approved by the user.

## Testing

- Lock: a kit's hash covers its library modules; a kit without them hashes
  as before; editing a module fails every kit that reaches it; imports
  outside the rule are refused (`test/kit-source.test.ts`).
- Kits: props refused when wrong; `wrong-profile`; every example's one
  frame in each profile it is drawn for; overlays inside the safe zone;
  previews regenerated.
- Compiler (`test/dentro-i-versi-short.test.ts`): golden output; timing,
  strikes, camera, shakes and effects from the words, blinks, poses and
  mouth, the title card's fit, the chip, the plates, lanes without
  overlaps, a take cut at the end; each refusal with its path.
- Validator: 15 golden cases.
- Episode: sounds offered and ambiguous; energy written by `alignTake`.
- A real render (`REMOTION_E2E=1`, `tests/dentro-i-versi-short.e2e.test.ts`)
  of the golden episode through `makeLayoutSheet` and `renderEpisode`.

## Documentation

ADR-0039 "Format kits share frozen libraries" (and its row in
`docs/index.md`); ADR-0038's note on energy; the composer README (the new
kits, library modules, profiles, the lock rule); the `@studio/series`
README (the compiler, the validator, `sound-<name>`); the `@studio/episode`
README (`measureEnergy`, sounds). No contract changes.
