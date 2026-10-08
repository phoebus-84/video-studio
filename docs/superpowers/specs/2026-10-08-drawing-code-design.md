# What draws: an audio fix keeps the sheet and the render cache

**Issue:** `avg-dcf.6.13`, under `avg-dcf.6` (Il lampo long end to end).
**Found by:** the long Il lampo's render, 2026-10-08.
- `avg-dcf.6.12` changed only `packages/remotion-composer/src/loudness.ts`, the final file's sound.
- The operator's approved sheet then failed the render gate with "the composer changed". A new sheet with the same pictures needed a second approval.
- The render cache missed all 578 segments: 70 minutes, instead of a loudness pass over cached video.

**Date:** 2026-10-08

## Problem

Two hashes stand for "the composer's code", and each covers files that never shape a frame.

- **The sheet's.** `drawingCodeHash` (`identity.ts`) hashes every code file of the package, so a layout sheet records it and goes stale when it changes (`layout-sheet.ts`: "the composer changed").
- **The render cache's.**
  - `rendererKey` (`cached-render.ts`) hashes the browser bundle, which is the code that draws.
  - It also hashes all of the Node-side code (`runtime`), so that a renderer fix invalidates segments.

The Node side includes the loudness pass, the render audit, the media probe and the per-frame audio volume. None of them changes a pixel of a silent video segment or a still.

## Decisions

1. **One list of what never draws, beside `drawingCodeHash`.** In `identity.ts`: `NOT_DRAWING` names the modules whose code never changes a frame:
   - `audit`: the rendered file's checks;
   - `loudness`: the final file's sound;
   - `probe`: reading media;
   - `volume`: per-frame audio gain.

   `drawsPictures(file)` is false for those modules, whatever their extension (`.ts`, `.js`, `.json` map files…), and true for every other code file. A new module counts as drawing until someone names it here.
2. **The sheet's hash leaves them out.** `drawingCodeHash` hashes only the files that draw. Changing `loudness` or `audit` keeps a sheet current. Changing a kit, `Timeline`, `layers` or `render-cache` still makes it stale.
3. **The render cache's Node-side hash leaves them out too.** `rendererKey`'s `runtime` part uses the same `drawsPictures`. The browser bundle stays hashed whole: it is the drawing code, and its chunks can't be told apart by module.
4. **A one-time cost.** Because the hash's definition changes, every existing sheet goes stale once, and the render cache misses once. The long Il lampo's current render is unaffected; only a new render needs a new sheet. That is stated in the PR.

## Testing

- **`drawsPictures`:**
  - false for `audit.ts`, `loudness.js`, `probe.ts` and `volume.js`;
  - true for `Timeline.tsx`, `kits/room/1.0.0.tsx`, `render-cache.ts` and a new `foo.ts`.
- **`drawingCodeHash(dir)`, on a copy of the package's code in a temp folder:**
  - the same hash after `loudness.js` or `audit.js` changes;
  - another hash after a kit file or `Timeline.js` changes.
- **Guard:** every module under `src/` that `NOT_DRAWING` names exists, so the list can't silently go stale.
