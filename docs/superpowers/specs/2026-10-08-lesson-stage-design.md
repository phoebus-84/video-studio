# Channel themes and the neutral 16:9 lesson stage

**Issues:** `avg-dcf.4.1` (child of `avg-dcf.4`, the long-lesson kits)
**Epic:** `avg-dcf` — test channel "Dentro i versi" (the `cs-port` plan)
**Builds on:**
- the kit registry, frozen library modules and kit profiles (ADR-0034, ADR-0039, `avg-dcf.3`);
- output profiles (`avg-tk7.4`);
- series templates (ADR-0037);
- the episode loader (`avg-jao.2`).

**Unblocks:** `avg-dcf.4.2` (the neutral teaching tools), `avg-dcf.6` (Il lampo long end to end, with the long compiler), `avg-dcf.1` (the channel)
**Source:** `../CreativeStudio/formats/poesie-museo-long/` (`FORMAT.md`, `components.json`, `runtime/v10/{index,ui,fx7}.tsx`, `previews/components/`). Read only; nothing copied.
**Date:** 2026-10-08

## Problem

The short's kits (`avg-dcf.3`) carry the Dentro i versi look in code: a palette module, fixed fonts, positions and costumes. That was accepted for the short, but it is the opposite of the boundary the studio is moving to (`avg-d1x`):
- **the library** holds assets and parametric files: looks, characters, rooms;
- **the application** executes;
- **composers and channel-neutral kits** are extensions.

The long lesson has about twice as many pieces as the short. Building them the same way would double the channel-specific code to move later. This work starts the boundary with the long format: the look becomes data, and the kits become neutral.

## Decisions taken with the user

1. **Split `avg-dcf.4`** into three steps:
   - **`avg-dcf.4.1`** (this spec): the theme and the 16:9 stage.
   - **`avg-dcf.4.2`**: the teaching tools.
   - The long compiler comes with **`avg-dcf.6`**, together with the channel (`avg-dcf.1`).
2. **Neutral kits, the look as data (B).** No channel colour, font, text or costume in kit code.
3. **Versioned theme releases in the channel (A):** `library/<channel>/themes/<id>/<version>/`, immutable. A series template release pins the theme by id, version and hash, so a published episode re-renders with the look it had.
4. **One shared `look` prop (A).** A single vocabulary of colour roles, font roles and shared measures. Every neutral kit takes `look`; the compiler passes the theme's `look` through untouched.
5. **Characters are theme data**, drawn by a new neutral `interprete@1.1.0`. The short's `interprete@1.0.0` stays frozen.
6. **The short is not migrated here** (`avg-d1x`).

## Design

### 1. The theme (`ChannelTheme`, contracts)

A theme release is a folder, `library/<channel>/themes/<id>/<version>/`, holding `theme.json` and the images it names (paths relative to the folder).

```text
apiVersion: studio.video/v1alpha1, kind: ChannelTheme, id, version
look:
  colors:   ink, paper, accent, highlight, glow, plate, plateText, plateLine, shadow, signal   (#rrggbb or rgba())
  fonts:    display, serif, sans → { family, weights[] }   (family ∈ bundled: Anton, Fraunces, Inter)
  measures: plateRadius (px), textShadow (CSS), minTextPx (≥ 26 for 16:9 lessons)
layout?:  { safe: {top, bottom}, floorY, panel: Box }               (stricter than the profile when the format wants it)
characters: { <name>: { variant, outfit?, hairstyle?, accessories?, palette, poses: { <name>: angles } } }
rooms:    { <name>: { image, sky?: polygon[], doors?: Box[], lights?: path[] } }
brand:    { text, icon: "bolt" | "none" }
```

`validateChannelTheme(doc)` returns problems with JSON paths:
- the schema is satisfied;
- every font family is a bundled one, with weights it has;
- every palette uses only the puppet's keys;
- every pose uses only its angles;
- room geometry lies inside 1920×1080;
- image paths are relative and portable.

`SeriesTemplate` gains an optional `theme: {id, version, hash}`, where the hash is the `theme.json`'s sha256 (the images are hashed by the loader).

### 2. The look in the composer

- **`lib/look/1.0.0.ts`**: `LookSchema` (zod), the same shape as the contract's `look`. It also provides small helpers: a role's colour, `plateStyle(look)`, `textShadow(look)`.
- **`lib/fonts/1.1.0.ts`**: a registry of every bundled face (Anton 400; Fraunces 400 and 700, normal and italic; Inter 200–600). `useLookFonts(look)` loads only the faces the look names, under `delayRender`. A face that fails stops the render with its error, as `fonts@1.0.0` does now.
- **`lib/lesson-stage/1.0.0.tsx`**: the neutral drawing code the stage kits share. Its colours come from `look`.
  - Teleport, the hologram exit and LiveBolt are neutral copies; `hall-fx@1.0.0` imports the Dentro i versi palette, so the neutral kits never import it.
  - It also holds the storm, the glass, the cover framing with a pan to the focus, and the warp streaks.
- **Kits** take `look` plus their own props, and are drawn for `youtube-1920x1080`. `look` is validated like any other prop, so a malformed look is `bad-props` at its path.

### 3. The stage kits

| Kit | Layer | Props (besides `look`) |
|---|---|---|
| `room@1.0.0` | fill | `room: {image, sky?, doors?, lights?}`, `storm?: {period, seed, calm: [from, to][]}`, `camera?`, `lightsOn?` |
| `panel@1.0.0` | fill | `box`, `content`: one picture `{src, focus, pan}`, or two side by side `{left, right, labels}`, or a clip `{src, live: [from, to]}`; `spin?: number[]`; `tag?` (AI credit) |
| `interprete@1.1.0` | fill | `character` (theme character, resolved), `x`, `footY`, `scale`, `poses`, `expressions`, `gaze`, `blinks`, `mouth`, `teleport?`, `holo?`, `costume?: {at, character}`, `flash?` |
| `verse-bar@1.0.0` | overlay | `kicker`, `words: {text, at}[]`, `strong?`, `y?`, `size?` |
| `block-title@1.0.0` | overlay | `kicker`, `title`, `info?`, `x?`, `bottom?` |
| `figure-title@1.0.0` | overlay | `kicker`, `text`, `x`, `y`, `maxWidth` |
| `chapter-opener@1.0.0` | fill | `n`, `title`, `sub?` |
| `cover@1.0.0` | overlay | `kicker`, `titleLines` (1–2), `hookLines` (0–2), `icon?` |
| `warp@1.0.0` | fill | `peak` (seconds from the item's start) |
| `brand-mark@2.0.0` | overlay | `text`, `icon`, `x?`, `y?` |

Every time in props is in seconds from the item's start, as in `avg-dcf.3`. Overlays lie inside the profile's safe zone. The examples also respect the stricter lesson zone (y 120–960), and every kit can be placed by props.

Drawing follows CreativeStudio's v10 runtime rewritten clean: the same geometry, curves and timings, with the colours and fonts taken from `look`.

### 4. The loader (`@studio/episode`)

When the pinned template release names a theme, `loadEpisode`:
1. reads `library/<channel>/themes/<id>/<version>/theme.json`;
2. checks it against the pin's hash (`theme-mismatch`);
3. validates it (`bad-theme`, with paths inside `theme.json`);
4. refuses a missing release (`missing-theme`) or any link that leaves the folder (`path-escape`);
5. puts it in `CompileInput.theme`;
6. offers each room image as the asset `theme-<room>`;
7. hashes the theme and its images into the inputs.

A release without a theme loads exactly as before.

### 5. The first theme

`studio/series/fixtures/themes/dentro-i-versi/1.0.0/` is the Dentro i versi look of CreativeStudio's long format:
- the palette (`K`) and fonts (Anton, Fraunces italic, Inter);
- the lesson layout (safe y 120–960, floor y 950, panel 440/150/1060×596);
- the guide (`guidePalette`) and the actor with the second recital's costume;
- the atrium and the hall, with their sky polygons and doors;
- the brand.

Its room images are generated placeholders: CreativeStudio's pictures are not in this checkout. `avg-dcf.1` copies the theme into the channel, and `avg-dcf.5` brings the real images.

## Verifying the look

Before the plan, uncommitted: render each stage kit with the Dentro i versi theme at the moments of CreativeStudio's component previews (cover, chapter opener, verse bar, block title, panel with two pictures, storm, picture panel, warp, brand, teleport, hologram exit). Show them beside CreativeStudio's frames for the user's approval.

## Testing

- **Contract**:
  - `validateChannelTheme` on valid and invalid themes (unknown font or weight, unknown palette key or angle, geometry off the frame, absolute or escaping image paths);
  - `SeriesTemplate` with and without `theme`.
- **Kits**:
  - every example's one frame in 16:9, using a neutral demo look (no channel);
  - overlays inside the safe zone, previews, and the lock;
  - a malformed `look` refused at its path;
  - `wrong-profile` in 9:16.
- **Alignment** (`@studio/series`): the Dentro i versi fixture theme's `look` and characters pass the composer's validation of every neutral kit.
- **Loader**: the theme read, hashed and offered; refused when missing, altered or escaping; releases without a theme unchanged.

## Documentation

- ADR-0040, "Channel themes carry the look as data", with its row in `docs/index.md`.
- The contracts catalog and README (`ChannelTheme`, `theme` in `SeriesTemplate`).
- The composer README (the stage kits, `look`, fonts 1.1.0).
- The episode README (the theme in the loader).

## Out of scope

- The teaching tools (`avg-dcf.4.2`).
- The long compiler and the lesson blocks (`avg-dcf.6`).
- The channel in the library (`avg-dcf.1`) and CreativeStudio's real images (`avg-dcf.5`).
- Window rain, which CreativeStudio's references do not use.
- Migrating the short's kits to the theme (`avg-d1x`).
