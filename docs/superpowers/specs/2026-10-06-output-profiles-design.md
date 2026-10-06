# Output profiles 9:16 and 16:9 with safe zones

**Issue:** `avg-tk7.4` — output profiles 9:16 and 16:9 with safe zones
**Epic:** `avg-tk7` — Remotion composer for layered timelines (the `cs-port` plan)
**Builds on:** [edit timeline v2](2026-10-05-edit-timeline-v2-design.md) (ADR-0034); [Remotion composer](2026-10-06-remotion-composer-design.md); [kit registry](2026-10-06-kit-registry-design.md)
**Related:** `avg-z6c.2` (YouTube encoding profile); CreativeStudio `services/media-utils/mu.py` (`SAFE`, `export`)
**Blocks:** `avg-dcf.3`, `avg-dcf.4` (Dentro i versi kits)
**Date:** 2026-10-06

## Problem

The edit timeline knows its `resolution` and `fps`, nothing more. Nothing
says where text may go without being covered — on a phone, the TikTok,
Reels and Shorts interface covers the top bar, the bottom 380 px and a right
column — and the loudness target is a constant in the composer, although
ADR-0034 says it belongs to the output profile. The workspace settings allow
one profile, `youtube-1080p-30`. The "Dentro i versi" shorts need a native
1080×1920 format whose kits keep clear of the platform's interface.

## Decisions taken with the user

1. **One native profile per timeline.** A timeline renders one format. The
   short and the long of a series are separate timelines; re-cropping one
   format into another is not this issue.
2. **The profile travels whole inside the timeline**: id, size, safe zone,
   loudness. The catalog lives in the contracts; the series compiler copies
   the chosen profile into the timeline, and the composer reads only the
   timeline. A delivered episode re-renders as it was even if the catalog
   later changes (the same reason kit versions are frozen).
3. **The safe zone is checked on the rendered kit.** Overlay kits are
   rendered on a transparent background in every profile, and the box of
   the pixels they actually drew must lie inside the safe zone.

## Design

### The catalog — `studio/contracts/src/output-profiles.json` and `.mjs`

The data is one JSON file, so packages' tests can read it by path (as they
read contract fixtures) without importing `studio/`.

| id | width × height | safeZone (top, right, bottom, left) px | loudness (I LUFS, TP dBTP, LRA LU) |
|---|---|---|---|
| `youtube-1920x1080` | 1920 × 1080 | 54, 96, 54, 96 (title safe, 5% a side) | −15, −1, 11 |
| `vertical-1080x1920` | 1080 × 1920 | 120, 140, 380, 60 | −14, −1, 11 |

The 9:16 top, right and bottom insets are CreativeStudio's (the platforms'
interface); the 60 px left inset and the 16:9 title-safe insets are new. The
16:9 loudness is the composer's current default, so 16:9 output does not
change.

`output-profiles.mjs` exports `OUTPUT_PROFILES` (frozen, from the JSON),
`outputProfile(id)` → the profile or `undefined`, and
`validateOutputProfile(profile)` → problems (see below). Types in
`output-profiles.d.mts`.

### The timeline — `profile` (v1alpha2, required)

```jsonc
"profile": {
  "id": "vertical-1080x1920",
  "width": 1080, "height": 1920,
  "safeZone": { "top": 120, "right": 140, "bottom": 380, "left": 60 },
  "loudness": { "integrated": -14, "truePeak": -1, "range": 11 }
}
```

- Schema: `id` `^[a-z0-9]+(-[a-z0-9]+)*$`; `width`, `height` integers like
  `resolution`; `safeZone` four integers ≥ 0; `loudness.integrated` in
  [−70, −5], `truePeak` in [−9, 0], `range` in [1, 20]. `profile` is
  required: v1alpha2 has no producer outside tests yet (the cutover is
  `avg-tk7.6`).
- The profile need not be in the catalog — it is a self-contained copy.
- `validateEditTimeline` adds:
  - `profile-resolution-mismatch` (path `$.profile`): `resolution` differs
    from the profile's `width`/`height`;
  - `profile-safe-zone` (path `$.profile.safeZone`): `top + bottom ≥ height`
    or `left + right ≥ width`.
  These come from `validateOutputProfile`, shared with the catalog's own
  test.
- `migrateEditTimelineV1alpha1(doc, {assetHashes, profile?})` sets
  `profile`: the given one, otherwise the catalog profile whose size equals
  the v1alpha1 resolution; with neither it throws a `RangeError` naming the
  resolution and the catalog sizes, like its other refusals (non-integer
  `fps`, missing hashes).
- Fixtures: both valid fixtures gain the 16:9 profile; a new valid
  `vertical-short.json` (1080×1920); invalid `profile-resolution-mismatch.json`,
  `profile-safe-zone.json`, `missing-profile.json`.
- ADR-0034 gains a note: loudness and the safe zone belong to the output
  profile, which the timeline carries.

### Workspace settings — `outputProfile`

`OutputProfileRef` keeps its shape `{ id, width, height, frameRate }`; `id`
becomes one of the catalog ids, and `width`/`height` must equal that
profile's (checked in `workspace-semantics.mjs`, code
`output-profile-mismatch`). `youtube-1080p-30` becomes `youtube-1920x1080`
in the schema, fixtures, bindings and runtime defaults — no settings file
outside the repository uses it. `frameRate` stays (the timeline's `fps`
comes from it). `@studio/contracts` 0.6.0 → 0.7.0.

### Composer — `@av/remotion-composer` 0.2.0 → 0.3.0

- The zod mirror gains `profile`. `validateTimeline` reports
  `invalid-timeline` at `$.profile` when `resolution` differs from the
  profile (the composer stays standalone and re-checks).
- Loudness: `renderTimeline` normalises to `timeline.profile.loudness`; its
  `loudness` option remains an explicit override. `DEFAULT_LOUDNESS` leaves
  the public API.
- `KitContext` gains `profile: { id, width, height, safeZone }`, passed to
  every kit by `Timeline.tsx`. Frozen 1.0.0 kits ignore it.
- The render result gains `profile: "<id>"`.

### Kits

- `KitVersion` gains an optional `layer: "overlay"`: a kit that draws text
  or graphics over the picture. Without it a kit fills the frame (`still`,
  `clip`) and is not held to the safe zone. The 1.0.0 files stay frozen and
  have no `layer`; `captions@1.0.0` predates safe zones.
- **`captions@1.1.0`** (new file, `layer: "overlay"`): the same props as
  1.0.0, so a timeline upgrades by changing the version. It lays its text
  out inside `context.profile.safeZone`: `bottom` on the zone's bottom edge,
  `top` on its top edge, `center` centred in the zone; the block is at most
  the zone's width and wraps. Examples: `bottom`, `top`, `center`, `long`
  (several lines).

### Every example in every profile

- `PreviewRoot` registers one composition per example (as now); the profile
  arrives in `inputProps` and `calculateMetadata` sets width and height from
  it. The package holds no copy of the catalog.
- `test/kits-render.test.ts` reads the catalog JSON by path and renders
  every example of every version in both profiles:
  - fill kits: the frame has the profile's size and is not blank (as now);
  - overlay kits: rendered on a transparent background; FFmpeg
    (`alphaextract,cropdetect`) gives the box of drawn pixels, which must lie
    inside the safe zone. The failure names the kit, example, profile, side
    and overflow, e.g.
    `captions@1.1.0 long in vertical-1080x1920: 46 px below the safe zone`.
- Previews: one per profile, `previews/<name>@<version>.<profile-id>.png`
  (640×360 and 360×640), rendered by `npm run kits:previews` from the same
  catalog file. The three existing previews are renamed. `listKits()`
  returns `previews: { "<profile-id>": path }` instead of `preview`. The safe
  zone is not drawn on previews.

## Testing

- Contracts (`node:test`, `check:schemas`): every catalog profile passes
  `validateOutputProfile` and ids are unique; `validateEditTimeline` accepts
  the valid fixtures and rejects the three new invalid ones with their
  codes; migration sets `youtube-1920x1080` for a 1920×1080 v1alpha1
  timeline, `vertical-1080x1920` for 1080×1920, honours an explicit profile,
  and refuses another size; workspace settings accept both ids and refuse an
  unknown id or a mismatched size; TS bindings regenerated.
- Runtime: the settings tests pass with the renamed default.
- Composer: `invalid-timeline` on a resolution/profile mismatch; metadata
  test covers `captions@1.1.0` (lock updated); the render test covers every
  example in both profiles and the safe-zone check. Checked once by hand: a
  copy of `captions@1.0.0` marked `layer: "overlay"` fails on
  `vertical-1080x1920`, then removed.
- End to end (`REMOTION_E2E=1`): the existing 16:9 render still lands within
  ±1 LU of −15; a new short 9:16 timeline with a tone and `captions@1.1.0`
  renders 1080×1920 within ±1 LU of −14, and the result names its profile.
- Root `npm run check` and `npm run docs:build`.

## Out of scope

Encoding parameters (CRF, preset, faststart) and per-platform duration
limits (`avg-z6c.2`, render audit `avg-3th.3`); re-cropping one format into
another; Dentro i versi kits (`avg-dcf.3`, `avg-dcf.4`); the series compiler
choosing the profile from settings (`avg-jao`); drawing the safe zone on
previews.
