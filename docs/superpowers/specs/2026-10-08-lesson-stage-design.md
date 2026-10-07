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
7. **The look was checked before the plan** against CreativeStudio's delivered Il lampo long (2026-10-08), at the times of its component previews: the same texts, the same pictures (crops of the panel), CreativeStudio's own empty rooms as the room picture. It was approved by the user.

## Design

### 1. The theme (`ChannelTheme`, contracts)

A theme release is a folder, `library/<channel>/themes/<id>/<version>/`, holding `theme.json` and the images it names (paths relative to the folder).

```text
apiVersion: studio.video/v1alpha1, kind: ChannelTheme, id, version
look:
  colors:   ink, text, textDim, accent, highlight, glow, lightning, plate, plateLine, shadow, backdrop, signal   (#rrggbb or rgba())
  fonts:    display, serif, sans → a family among the bundled ones (Anton, Fraunces, Inter); kits use fixed weights per role
  measures: plateRadius (px), textShadow (CSS), minTextPx
layout?:  { safe: {top, bottom}, floorY, panel: Box }               (stricter than the profile when the format wants it)
characters: { <name>: { variant, outfit?, hairstyle?, accessories?, palette, poses?: { <name>: angles } } }
rooms:    { <name>: { image, sky?: {poly, period?, seed?, scale?}[], windows?: polygon[], doors?: Box[], monitor?: {box, video} } }
brand:    { text, icon: "bolt" | "none" }
```

A sky region is just its polygon: bolts fall from its top edge towards its bottom edge at the x where they strike (CreativeStudio described each region with two hand-written functions).

`validateChannelTheme(doc)` returns problems with JSON paths:
- the schema is satisfied;
- every font family is a bundled one, with weights it has;
- every palette uses only the puppet's keys;
- every pose uses only its angles;
- room geometry lies inside 1920×1080;
- image paths are relative and portable.

`SeriesTemplate` gains an optional `theme: {id, version, hash}`, where the hash is the `theme.json`'s sha256 (the images are hashed by the loader).

### 2. The look in the composer

- **`lib/look/1.0.0.ts`**: `LookSchema` (zod), the same shape as the contract's `look`. It also provides `plateStyle(look)` (a short shadow, `0 10px 24px`, so plates near the safe zone stay inside it), `alpha(colour, a)`, `textPx`, and `DEMO_LOOK` for examples.
- **`lib/fonts/1.1.0.ts`**: a registry of every bundled face (Anton 400; Fraunces 400 and 700, normal and italic; Inter 200, 300, 400, 600). `useLookFonts(look.fonts)` loads the faces of the families the look names, under `delayRender`. A face that fails stops the render with its error, as `fonts@1.0.0` does now. `BUNDLED_FAMILIES` is exported, so the app can compare it with the contract.
- **`lib/lesson-stage/1.0.0.tsx`**: the neutral drawing code the stage kits share. Its colours come from `look`.
  - Teleport, the hologram exit and LiveBolt are neutral copies; `hall-fx@1.0.0` imports the Dentro i versi palette, so the neutral kits never import it.
  - It also holds the storm, the glass, the cover framing with a pan to the focus, and the warp streaks.
- **Kits** take `look` plus their own props, and are drawn for `youtube-1920x1080`. `look` is validated like any other prop, so a malformed look is `bad-props` at its path.

### 3. The stage kits

| Kit | Layer | Props (besides `look`) |
|---|---|---|
| `room@1.0.0` | fill | `room: {image, sky?, windows?, doors?, monitor?: {box, video}}`, `lightning?` (on unless false), `quiet?: [from, to][]` (the storm off, ramping 0.6 s: the loop's edges), `flash?`, `drift?`, `push?: {at, dur, scale, origin}`, `dark?`, `camera?` |
| `panel@1.0.0` | fill | `box?` (440/150/1060×596), `phases: {at, content, tag?}[]` where content is `picture {src, focus?, zoom?, zoomTo?, label?}`, `pair {left, right, sign?}` or `clip {src, live?}`; the glass turns at each phase change (`spin`, on unless false) and the content changes halfway through the turn; `appear?: {at, dur}`, `flash?`, `camera?` |
| `interprete@1.1.0` | fill | `character` (a theme character without its poses), `x`, `footY?` (950), `scale?` (0.78), `poses` (full angles, resolved by the compiler from the theme's named poses), `expressions?`, `gaze?`, `blinks?`, `bow?`, `mouth?`, `teleport?: {in?, out?}`, `costume?: {at, character}`, `flash?`, `camera?` |
| `verse-bar@1.0.0` | overlay | `lines: {text, at?, hot?}[][]` (1–3), `kicker?`, `y?` (790), `size?` (54), `width?` (1240) |
| `block-title@1.0.0` | overlay | `kicker`, `title`, `info?`, `x?` (128), `bottom?` (940), `ruleGrow?` (0.6 s) |
| `figure-title@1.0.0` | overlay | `kicker`, `text`, `x`, `y`, `maxWidth?` (820), `size?` (96), `align?` |
| `chapter-opener@1.0.0` | fill | `kicker` (e.g. "CAPITOLO I": every word is a prop), `title`, `sub?` |
| `cover@1.0.0` | fill | `kicker?`, `titleLines` (1–2), `hookLines?` (0–2), `icon?`. A fill kit: its gradient covers the frame; its texts sit inside the safe zone |
| `warp@1.0.0` | fill | `rise?`, `fall?` (seconds to and from its peak) |
| `brand-mark@2.0.0` | overlay | `text`, `icon`, `x?` (110), `y?` (60: inside the 16:9 zone) |

Assets are `{ $asset }` objects; pictures of any shape are framed with `object-fit: cover` on their focus. Overlays fade through the timeline's transitions; nothing slides in (CreativeStudio's 30 px slide would leave the zone). `room`, `panel` and `interprete` share an optional `camera` (`stage-props`' schema) for CreativeStudio's close-ups.

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

The theme's own validation problems keep the contract's codes, located inside `theme.json`. A release without a theme loads exactly as before.

The room images live in the channel, outside the episode, so the composer gains `sharedRoots` (`stageAssets`, `renderTimeline`, `renderLayoutSheet`): folders outside the asset root that assets may come from. `renderEpisode` and `makeLayoutSheet` pass the channel's `themes/` (`sharedRootsOf(episodeDir)`); nothing else outside the episode is staged.

### 5. The first theme

`studio/series/fixtures/themes/dentro-i-versi/1.0.0/` is the Dentro i versi look of CreativeStudio's long format:
- the palette (`K`) and fonts (Anton, Fraunces italic, Inter);
- the lesson layout (safe y 120–960, floor y 950, panel 440/150/1060×596);
- the guide (`guidePalette`) and the actor with the second recital's costume;
- the atrium and the hall, with their sky polygons and doors;
- the brand.

Its room images are generated placeholders: CreativeStudio's pictures are not in this checkout. `avg-dcf.1` copies the theme into the channel, and `avg-dcf.5` brings the real images.

## Verifying the look

Done before the plan (2026-10-08), uncommitted: the stage kits rendered with the Dentro i versi theme at the moments of CreativeStudio's component previews, taken from its delivered Il lampo long (cover, verse bar with the recital's title, chapter opener, block title, two-picture panel, warp, atrium with its storm), beside CreativeStudio's frames. The first comparison found three differences, fixed: pictures assumed to be 3:4 (stretched), the chapter's backdrop fading to black instead of dark blue, the warp too cyan. Approved by the user.

## Testing

- **Contract**:
  - `validateChannelTheme` on valid and invalid themes (unknown font or weight, unknown palette key or angle, geometry off the frame, absolute or escaping image paths);
  - `SeriesTemplate` with and without `theme`.
- **Kits**:
  - every example's one frame in 16:9, using a neutral demo look (no channel);
  - overlays inside the safe zone, previews, and the lock;
  - a malformed `look` refused at its path;
  - `wrong-profile` in 9:16.
- **Alignment** (`@studio/series`): the Dentro i versi and the contracts' sample themes pass the contract, and their `look` and characters pass the props schemas of every neutral kit; the contract's font families equal the composer's.
- **Staging**: an asset from a shared root is staged; nothing beside it is.
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
