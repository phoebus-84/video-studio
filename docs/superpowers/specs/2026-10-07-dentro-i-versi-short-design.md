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
unnoticed. Six kits sharing a palette, fonts, maths, effects and an actor
need more:

- **Frozen library modules** at `packages/remotion-composer/src/kits/lib/<name>/<version>.tsx`
  (or `.ts`). Released like kit versions: never edited; a change is a new
  version file. 1.0.0 adds:
  - `stage-math/1.0.0.ts` — `clamp`, `ease` (smootherstep), `ramp`, `pulse`,
    `win`, `mix`, the deterministic `rnd(i)`, `envelope(t, Envelope)`;
  - `fonts/1.0.0.ts` — Anton 400, Fraunces 400 italic, Inter 300/400/600,
    imported as files from `@fontsource/*`, loaded with `FontFace` under
    Remotion's `delayRender`/`continueRender`; exports the family names;
  - `dentro-i-versi/1.0.0.ts` — the palette (`ink`, `ink2`, `accent`,
    `cyan`, `led`, `text`, `amber`, plate colours) and text shadows;
  - `hall-fx/1.0.0.tsx` — `Glass`, `LiveBolt`, `Teleport`, `Shatter`, the
    camera transform, the strike curve, the nine picture effects and the
    eight room effects;
  - `interprete/1.0.0.tsx` — the SVG puppet (variants `attore`, `attrice`;
    outfits, hairstyles, accessories), `REST`, `EXPR`, `POSE_PRESETS`,
    `PALETTES`.
- **The lock hash covers what a kit draws with:** `sha256` over the kit file
  and every local module it imports, transitively — relative imports only,
  `import type` excluded, files in sorted path order, each as
  `<path relative to src/kits>\0<bytes>`. The existing entries (`still`,
  `clip`, `captions`) import only types: their hashes do not change.
  `npm run kits:lock` and the kit tests use the same function; editing a
  released library module fails the check for every kit that uses it.
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
| `lower-third` | overlay | `kicker`, `titleLines` (1–2), `author`, `x`, `y`, `maxWidth`, `size` (Anton px), `fadeIn`, `fadeOut` (s) |
| `title-chip` | overlay | `title`, `author?`, `fadeIn`, `fadeOut` |
| `verse-plate` | overlay | `text` (lines by `\n`), `words: {text, at}[]` (one per token of `text`), `strong: string[]` (normalised words), `gloss`, `x` (36), `y` (1240), `width` (500), `dim` (0.42), `fadeIn` (0.27), `fadeOut` (0.27) |
| `museum-hall` | fills | `room: {$asset}`, `screen: {x, y, w, h}` (360, 215, 620, 910), `pictures: {src: {$asset}, at, scale, origin, move: {dx, dy, z, r}, fx: PictureFx[], spill}[]`, `camera: Camera`, `flash: Flash`, `lights: {at, dark, spot, tint?, w}[]`, `blackout?: {from, to, dark}`, `bolt?: {at, dur}`, `wind: Envelope[]`, `shatter: {at, picture, dur}[]`, `pedestal: boolean`, `actor: {x, scale, swayFrom, swayTo}` |
| `interprete` | fills (transparent) | `variant`, `outfit?`, `hairstyle?`, `accessories?`, `palette` (full), `x`, `footY`, `scale`, `poses: {at, pose}[]`, `expressions: {at, ex}[]`, `gaze: {from, to, x, y, h}[]`, `blinks: number[]`, `live: {from, to}`, `bow: {from, to}`, `mouth: {energy: {rate, values}, speech: [number, number][], offset}`, `teleport: {in?: [at, dur], out?: [at, dur]}`, `camera`, `flash`, `blackout?` |
| `room-effect` | fills (transparent) | `effect: RoomFx`, `color`, `screen`, `camera`, and for `apparizione`/`fantasma`: `src: {$asset}`, `x`, `y`, `w`, `mode?` (`sale`, `scende`, `salpa`), `exit?` (`rientra`, `svanisce`), `glow?` |

Drawing follows `sala8` and its runtime, rewritten clean: same geometry,
colours, curves and timings. Specifics:

- `verse-plate`: whole verse visible; a word not yet said at `dim`
  opacity, lit over 0.22 s from its `at`; strong words bold, ink → accent;
  the cyan rule grows over 0.5 s; the paraphrase (Inter 30) fades in from
  the verse's start + 0.1 s and stays until the plate fades (UP-55, UP-59).
  No movement beyond the plate's 16 px entry.
- `museum-hall`: room image, screen with crossfading pictures and their slow
  camera moves and picture effects, lightning glow on wall and floor,
  darkness mask with light holes on the screen and around the actor,
  lights' tint and spill, shatter, wind, pedestal, bolt in the blackout,
  blackout over everything below the plate.
- `interprete`: inside the camera; contact shadow and floor reflection;
  lit by the flash; hidden by the blackout; `Teleport` in and out; mouth
  from the energy of the voice (5-frame average, threshold 0.045, × 12,
  0–9), closed outside speech.
- `room-effect`: inside the camera, from its item's start to its end, faded
  in 0.6 s and out 0.8 s.

Each kit has examples at several instants (a word not yet said and lit;
teleport halfway; blackout; a strike; each effect), rendered by the
one-frame tests and the previews; overlays checked against the safe zone.
Samples are generated placeholders in `kits/samples/`: a sketched hall, flat
pictures, a cut-out silhouette.

### 4. Track order

From the bottom: `museum-hall` → `room-effect` items → `verse-plate` items
→ `interprete` (above the plate: hands may pass in front of it, never off
screen; UP-56) → `title-chip`, `lower-third` items → `brand-mark`. Audio:
narration takes, effect sounds, applause, music.

### 5. The compiler `dentro-i-versi-short@1.0.0` (`@studio/series`)

**Spec data** (the series schema), from CreativeStudio's `museo.json`:

```text
title, author, kicker?, titleLines?, voiceEndWord?
verses[]: { text, strong[], gloss }
pictures[]: { assetId, at?, cam?: {dx, dy, z, r}, fx[], spill?, sc?, org? }
actor: { variant, outfit?, hairstyle?, accessories?, base?, palette?: {…overrides} }
poses[]: { at, preset? | angles… }       expressions?: string (one letter per verse)
gaze[]: { from, to, x, y, h }            pushVerses?: number[]
lights[]: { at, dark?, spot?, tint?, w? }
hall: { pedestal?, teleport?: {in, out}, wind?, shake?, shatter?, blackout?, bolt? }
roomFx[]: { fx, at, to?, color?, assetId?, x?, y?, w?, mode?, exit?, glow? }
sfx[]: { assetId, at, dur?, gain?, offset? }   applause?: { assetId, gain? }   music?: { assetId, gain? }
```

Times keep CreativeStudio's syntax: `verse:N`, `verseEnd:N`, `word:parola±s`,
`end±s`, `picture:N`, or seconds.

**From the takes:** `takes.json`'s sequence gives the title take and the
recital take with their pauses; each take's `WordTiming` words are moved to
recital time by the take's offset. Verses are the recital's words split by
each verse's token count; a verse's start is its first word's start. The
end of the voice is `voiceEndWord`'s end (or the last word's); the video
lasts until the end of the voice + 6 s. Profile `vertical-1080x1920`, 30 fps.

**It computes**, as `sala8` does: picture times and default camera moves;
camera zoom (`body` + verse pushes) and shake envelopes; strikes at picture
changes; lights; blinks (`rnd`-spaced from 1.1 s); gazes (picture changes +
spec); expressions per verse; pose keyframes (presets + angles, rest at 0
and at the end of the voice); the lower-third's width (actor x − 150 ×
scale − 24 − 36) and Anton size fitted to its lines; the actor's sway; the
live and bow windows; the two lower-third items (opening and bow), the chip
(for the poem; author omitted for titles over 13 characters), one plate per
verse, one `room-effect` per `roomFx`, the hall, the actor, the mark; audio
items for the takes, sfx, applause and music.

**It refuses**, with the JSON path of the cause: a `word:` the recital does
not say; a verse whose tokens do not match the recital's words; a picture or
sound with no asset; a missing title or recital take; a take without timing.

### 6. The validator `dentro-i-versi-short@1.0.0`

Holds the timeline to be rendered — a hand edit included — to the format:

- errors: duration outside 25–90 s; profile not `vertical-1080x1920`; a
  verse plate whose text differs from the spec's verse (UP-59); a kit
  replaced or at another version than the compiler's; no `interprete` or no
  `verse-plate` for some verse; no teleport in and out (the loop: first and
  last frame are the empty hall);
- warnings: apparitions (`apparizione`, `fantasma`) not exactly 2, or one
  shorter than 5 s (UP-58); the pause between title and poem not within
  0.8–1.4 s.

Golden cases as for `poetry-short`.

### 7. The template release (fixtures)

`studio/series/fixtures/dentro-i-versi-short/1.0.0/`: the golden `input.json`
and `expected.json` (a synthetic San Martino: real poem text, synthetic
timing and placeholder assets), and a template release under
`release/`: `series-template.json` (compiler and validator
`dentro-i-versi-short@1.0.0`, `sheet.instants` at the teleports and the
apparitions), `FORMAT.md` (the standard, rewritten from CreativeStudio's),
`episode-spec.schema.json`, `episode-spec.template.json` (`__FILL__`
placeholders). `avg-dcf.1` copies the release into the channel's series.

## Verifying the look

Prototyping includes a local, uncommitted comparison: San Martino short's
data and timing read from CreativeStudio (read only), compiled and rendered
here, and our frames beside CreativeStudio's delivered frames at the layout
sheet's instants — shown to the user for approval before the plan is
written.

## Testing

- Lock: a kit's hash covers its library modules; editing a released module
  fails every kit that imports it; existing entries unchanged; fonts load
  before the first frame.
- Kits: props refused when wrong; every example's one frame; overlays
  inside the safe zone; previews regenerated.
- Compiler: golden output; each refusal with its path; envelopes, strikes,
  blinks and the lower-third's fit.
- Validator: golden cases.
- A real render (`REMOTION_E2E=1`) of the golden fixture through
  `renderEpisode`, and its layout sheet.

## Documentation

ADR-0039 "Format kits share frozen libraries"; the composer README (the
new kits and their previews); the `@studio/series` README (the compiler and
validator); the contracts catalog only if a contract changes (none planned).
