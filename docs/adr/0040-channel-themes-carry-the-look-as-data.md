# ADR-0040: Channel themes carry the look as data

## Status

Accepted (`avg-dcf.4.1`). Implemented:
- the `ChannelTheme` contract and the optional theme pin in `SeriesTemplate`;
- the composer's `look` vocabulary, fonts by family and ten neutral 16:9 lesson-stage kits;
- the loader reading a pinned theme;
- the first channel's theme as the first release (a fixture until the channel exists, `avg-dcf.1`).

## Context

The studio is moving to a boundary (`avg-d1x`):
- **the library** holds assets and parametric files;
- **the application** executes;
- **composers and channel-neutral kits** are extensions.

The short's kits (`avg-dcf.3`) were built the other way round: the first channel's palette, fonts, positions and costumes are composer code (ADR-0039 records it). The long lesson has about twice as many pieces. Building them the same way would double the channel code to move out later.

## Decision

**A channel's look is data in the library.** A theme release is a folder, `library/<channel>/themes/<id>/<version>/`. It holds `theme.json` (a `ChannelTheme`) and the images it names, and it is immutable like a series template release. It carries:
- **`look`**:
  - colour roles: `ink`, `text`, `textDim`, `accent`, `highlight`, `glow`, `lightning`, `plate`, `plateLine`, `shadow`, `backdrop`, `signal`;
  - font roles: `display`, `serif`, `sans`, by family among the composer's bundled faces;
  - shared measures: plate radius, text shadow, minimum text size.
- **`characters`**: the puppet's variant, outfit, palette and named poses.
- **`rooms`**: a picture, plus the geometry the kits draw on: sky polygons for the storm, windows, doors, a monitor clip.
- **`brand`**: the mark's text and icon.
- **`layout`**: optional, where the format is stricter than the output profile.

`validateChannelTheme` holds a theme to the contract:
- fonts the composer bundles, with the faces each role is drawn with;
- room names that can name an asset, storms no faster than a bolt lasts;
- palette keys and pose angles the puppet has;
- geometry on the 1920×1080 frame;
- image paths that stay in the release.

**A series template release pins its theme** by id, version and the hash of `theme.json`. When the release names one, the loader (`loadEpisode`):
- reads it and checks it against the pin (`missing-theme`, `theme-mismatch`, its own `id` and `version` included) and against the contract, every file inside that release (`path-escape`);
- puts it in `CompileInput.theme`;
- offers each room's picture as the asset `theme-<room>` (`theme-<room>-monitor` for its clip), with a path relative to the episode;
- hashes all of it into the episode's inputs.

A published episode therefore re-renders with the look it had, until a new release pins a new theme.

**A theme release is sealed** (amended 2026-10-08, `avg-dcf.6.8`). The pin's hash covers `theme.json` only, so `theme.json` lists every file it names with its sha256 (`files`), written by `vpr theme seal` (`studio/runtime/src/theme-release.ts`). The loader holds a sealed release's rooms to those hashes (`theme-mismatch` at the changed file). A release made before sealing loads as before, with a `theme-unsealed` warning. A release that a template release already pins is never sealed in place: sealing would change the hash it pinned.

**Kits receive the look as a prop.** The composer's `lib/look/1.0.0.ts` defines the same `look` vocabulary as zod, fonts checked against the bundled faces (`lib/font-metrics/1.0.0.ts`, which also gives kits the faces' widths to fit text with). Channel-neutral kits take `look` (and, for the puppet, a theme `character`) like any other prop, and compilers pass the theme's look through untouched. `lib/fonts/1.1.0.ts` loads only the families a look names, before the first frame.

The composer may not import the contracts (`check:boundaries`), so the two schemas are held together from the app side: a test in `@studio/series` passes every theme fixture's look and characters through the props schemas of every neutral kit, and compares the font families.

**Renders may take assets from the channel's themes.** `stageAssets`, `renderTimeline` and `renderLayoutSheet` accept `sharedRoots`: folders outside the asset root that assets may come from. `renderEpisode` and `makeLayoutSheet` pass the theme release the episode's series pins; nothing else outside the episode is ever staged, and links are followed before the comparison.

## Consequences

- **Neutral 16:9 stage kits** draw any channel's lessons: `room`, `panel`, `interprete@1.1.0`, `verse-bar`, `block-title`, `figure-title`, `chapter-opener`, `cover`, `warp`, `brand-mark@2.0.0`. Their examples use a demo look with no channel in it.
- **Changing a channel's look** is a new theme release and a new series template release: data, reviewed like data, with no kit version. The operator seals the theme (`vpr theme seal`), releases the template on it (`vpr template release … --from <v> --theme <id>@<v>`), and each episode moves onto the new release with `pva_upgrade_spec`.
- **The short's kits still carry the first channel's look in code.** Moving them onto the theme is `avg-d1x`.
- **A release without a theme** loads and renders exactly as before.
