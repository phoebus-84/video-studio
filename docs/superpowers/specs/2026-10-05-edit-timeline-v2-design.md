# Edit timeline v2: tracks, kits, sections

**Issue:** `avg-7zp.3` — edit timeline v2 (tracks, layers, kit instances, audio tracks; ADR superseding ADR-0009)
**Epic:** `avg-7zp` — contracts for word-anchored, layered production (the `cs-port` plan)
**Related:** [Remotion composer design](../../notes/remotion-composer-design.md);
ADR-0009 (superseded here); ADR-0012 (feedback anchors, staleness);
ADR-0021 (immutable attempts); `avg-tk7.1` (composer), `avg-tk7.3` (kit
registry), `avg-jao.2` (series compiler), `avg-7zp.1`/`.2` (word timing, cues)
**Date:** 2026-10-05

## Problem

`edit-timeline.schema.json` (`studio.video/v1alpha1`) describes a **sequence of
segments** in seconds: one source asset each, an optional caption, a transition
to the next. That is enough for an illustrated explainer and nothing more.

The productions we are porting from CreativeStudio are **layered and
cue-driven**. In one instant of a lesson there is a persistent verse bar, a
guide character gesturing on a word, an apparition over a glass panel,
lightning in a window, a stack of text entering line by line, a sound effect
and a slice of music ducked under the voice. None of that fits a segment list.

Nothing in production reads v1alpha1 documents. The only users are the
contracts' own fixtures and the structural mirror in
`packages/video-composer`, which nothing compiles (`avg-lho.1`). Replacing the
model now costs a migration function, not a migration.

## Decisions taken with the user

1. **The timeline is derived.** People edit the episode *spec* (e.g. a lesson);
   a deterministic series compiler (`avg-jao.2`) produces the timeline. A
   hand edit to the timeline is lost at the next compile. The timeline records
   what it was derived from, so a spec or compiler change makes it stale.
2. **Sections and provenance.** Spans of the timeline map back to the part of
   the spec they came from, and every item may name its spec location. This is
   what makes "change only that part" (partial staleness, partial render,
   version compare), anchored comments, chapters and contact sheets possible.
3. **Tracks, as in an NLE.** Not a scene tree, not a flat z-list.

## Design

### Document

```jsonc
{
  "apiVersion": "studio.video/v1alpha2",
  "kind": "EditTimeline",
  "episodeRef": { "channel": "dentro-i-versi", "series": "long", "episode": "il-lampo" },
  "revision": 4,
  "derivedFrom": {
    "spec":     { "path": "artifacts/lesson.json", "hash": "sha256:…", "revision": 12 },
    "compiler": { "id": "dentro-i-versi/long", "version": "1.0.0" }
  },
  "fps": 30,
  "durationInFrames": 14400,
  "resolution": { "width": 1920, "height": 1080 },
  "assets": {
    "take-epoca":   { "path": "assets/takes/epoca.wav",       "hash": "sha256:…", "kind": "audio" },
    "timing-epoca": { "path": "artifacts/timing/epoca.json",  "hash": "sha256:…", "kind": "json" }
  },
  "tracks":   [ /* Track */ ],
  "sections": [ /* Section */ ],
  "metadata": { }
}
```

- `fps` is a positive integer; `durationInFrames` a positive integer.
- `derivedFrom` is optional (a hand-built test timeline has none). When
  present, `spec.hash` is a `ContentHash` and `compiler` names the producing
  compiler and its version.
- `assets` is a map from a local id to `{ path, hash, kind }`. `hash` is a
  `ContentHash` (`sha256:<64 hex>`), required. `kind` reuses the artifact-kind
  vocabulary (`audio`, `video`, `image`, `json`, …). **Every file the render
  depends on is declared here once.** Audio items name an asset id; kit props
  reference one with the marker object `{ "$asset": "<id>" }`. The composer can
  therefore stage and verify every file without knowing any kit's props, and
  staleness knows exactly what the render reads. Timing files (word timing,
  energy envelopes) are assets like any other.
- `metadata` is the contracts' usual open bag for extensions.

### Time

All times in the document are **integer frames** at `fps`: `from`,
`duration`, fades, transitions, duck attack/release, `trimStart`. Seconds exist
only in the spec and the compiler. This removes rounding drift between the
compiler, the composer and frame-exact checks such as "first frame equals last
frame".

### Tracks

```jsonc
{ "id": "guide", "type": "visual", "z": 30, "items": [ /* VisualItem */ ] }
{ "id": "music", "type": "audio",
  "duck": { "under": ["voice"], "gain": 0.4, "attack": 6, "release": 9 },
  "items": [ /* AudioItem */ ] }
```

- `id` unique among tracks. `type` is `visual` or `audio`.
- `z` (integer) is **required on visual tracks and forbidden on audio tracks**.
  Higher draws on top. Two visual tracks may share a `z`; ties draw in array
  order.
- `duck` is allowed only on audio tracks: while any item on the tracks named in
  `under` is sounding, this track's gain is multiplied by `gain` (0–1), with
  `attack`/`release` ramps in frames. Every id in `under` must be an audio
  track other than this one.
- Optional `name` (display) and `muted`/`hidden` booleans for review tools.
- **Items on one track never overlap**, with the single exception of a
  declared crossfade (below). An empty stretch of a track is simply nothing on
  that layer — on the voice track it is a deliberate silence.

### Visual items: always a kit instance

```jsonc
{ "id": "verses-epoca", "from": 1340, "duration": 1360,
  "kit": { "name": "verse-bar", "version": "1.2.0" },
  "props": { "lines": ["…"], "timing": { "$asset": "timing-epoca" } },
  "source": "blocks[3]",
  "transitionIn":  { "type": "fade", "duration": 8 },
  "transitionOut": { "type": "fade", "duration": 8 } }
```

- A still image or a video clip is the `still` or `clip` kit; there is no
  second kind of visual item.
- `kit.name` is a kebab-case identifier; `kit.version` a semver string.
- `props` is an open object. Its shape is the kit's business and is validated
  by the composer against the kit's schema, not by the contract. Any object of
  the exact form `{ "$asset": "<id>" }` anywhere inside `props` is an asset
  reference and must resolve.

### Audio items

```jsonc
{ "id": "voice-epoca", "from": 1340, "duration": 1290, "asset": "take-epoca",
  "trimStart": 0, "gain": 1, "fadeIn": 4, "fadeOut": 4, "source": "blocks[3]" }
```

- `asset` must name an asset of kind `audio` (or `video`, for its sound).
- `trimStart` (frames into the source, default 0), `gain` (≥ 0, default 1),
  `fadeIn`/`fadeOut` (frames, default unset). Short edge fades against clicks
  are a composer default, not something the compiler must remember.
- Final loudness is **not** in the timeline. Targets (e.g. −15 LUFS, true
  peak ≤ −1 dBFS) belong to the output profile and the post-render pass, so
  one timeline can be delivered to different platforms.

### Transitions

- `transitionIn` / `transitionOut` on any item: `{ type, duration }`.
- `type: "fade"` fades the item from/to transparent (visual) or silence
  (audio). It does not overlap anything.
- `type: "crossfade"` is allowed only as `transitionIn`, and it is the only
  overlap a track permits: the item must start exactly `duration` frames
  before the previous item on the same track ends.
- Anything more elaborate (warp, teleport, flash) is **a kit on a higher
  track**, not a transition type. The transition vocabulary stays two words.

### Sections

```jsonc
"sections": [
  { "id": "epoca", "from": 1340, "duration": 1360, "source": "blocks[3]",
    "chapter": { "number": 1, "title": "L'epoca" } }
]
```

- Spans across all tracks. Ordered, **non-overlapping**, inside the timeline.
  Gaps are allowed (pauses between spec blocks belong to no section).
- No nesting. Chapters are an optional attribute of the section that opens
  them (YouTube chapters, chapter openers, contact-sheet grouping). Nesting
  can be added later as an additive change.
- `source` is a JSON path into `derivedFrom.spec` (optional).
- `sections` is optional; an empty or absent list means the timeline has no
  structure to anchor to.

### Provenance

`source` on an item or section is a JSON path into the spec
(`blocks[3].story.phases[1].fx[0]`). Optional: an element the compiler adds on
its own (default music, a brand bug) has none.

Membership is derived, never written: an item belongs to the section that
contains its whole span. An item that crosses a section boundary (the guide,
the verse bar, background music) belongs to none; a change to it stales every
section it covers. Consumers resolve "what is at timecode T on track X" →
item → `source` → the spec line to edit.

### Validation: two levels

| Level | Owner | Checks |
|---|---|---|
| Structure | `edit-timeline.schema.json` (v1alpha2) plus `studio/contracts/src/edit-timeline.mjs` | Shapes and types; integer frames ≥ 0, durations > 0; unique ids (tracks, items across all tracks, sections, assets); every item and section within `durationInFrames`; no overlap within a track except a correct crossfade; crossfade only as `transitionIn` and never on a track's first item; sections ordered and non-overlapping; `z` iff visual; `duck` only on audio, `under` naming other existing audio tracks; every `$asset` in props and every audio `asset` resolving to a declared asset of a suitable kind; fade durations not longer than the item |
| Kits | `@av/remotion-composer` (`avg-tk7.1`, `avg-tk7.3`) | Kit exists at the declared version; props valid against the kit's schema; asset files exist and match their hashes |

`edit-timeline.mjs` exports a pure `validateEditTimeline(doc)` that returns
**all** problems as `{ code, message, path }` — the same shape as the
composer's `ValidationMessage`, with a JSON path such as
`$.tracks[2].items[5].from`. Codes: `schema`, `duplicate-id`, `out-of-range`,
`overlap`, `bad-crossfade`, `z-on-audio`, `missing-z`, `bad-duck`,
`unknown-asset`, `asset-kind`, `section-overlap`, `fade-too-long`. The module
compiles the JSON Schema with Ajv and adds the semantic checks, so the series
compiler, the composer and the web all call one function.

### Versioning and migration

- New file `schemas/v1alpha2/edit-timeline.schema.json`,
  `$id` `https://video.studio/schemas/v1alpha2/edit-timeline.schema.json`.
  It may `$ref` v1alpha1 identity definitions (`ContentHash`).
- `v1alpha1` timeline stays, **frozen and deprecated** (its description says
  so). `packages/video-composer` keeps reading v1alpha1 until the cutover
  (`avg-tk7.6`).
- `scripts/generate-ts-bindings.mjs` learns to read `schemas/v1alpha2/` and
  writes `bindings/ts/v1alpha2/edit-timeline.ts`; `bindings:check` covers it.
- `migrateEditTimelineV1alpha1(doc, { assetHashes })` in `edit-timeline.mjs`
  converts a v1alpha1 document: segments become `still`/`clip` kit items on
  one visual track (`video` source kind → `clip`, otherwise `still`), seconds
  become frames (rounded to the nearest frame), segment transitions become
  `transitionIn` crossfades or fades, captions become a `captions` kit track,
  segment audio becomes an audio track. Because v1alpha1 hashes are optional
  and v1alpha2 hashes are required, the caller supplies hashes for assets the
  old document did not hash; a missing one is an error, not a placeholder.
- `@studio/contracts` gets a **minor** version bump (additive resource
  version, per `compatibility-policy.mjs` "new-kind").

### ADR

`docs/adr/0034-a-layered-kit-based-edit-timeline.md` supersedes ADR-0009 and
records: editorial intent stays declarative and is derived from the spec;
integer frames; NLE tracks plus sections with provenance; visual items are
versioned kit instances; kits live in the repository, never in `library/`;
loudness belongs to the post-render pass; validation is split between the
contract (structure) and the composer (kits). It carries forward ADR-0009's
rationale (no agent-authored executable render instructions). ADR-0009 gets a
"Superseded by ADR-0034" line.

## Testing

- **Valid fixtures** (`fixtures/timeline/v1alpha2/valid/`):
  `lesson-excerpt.json` — two sections with a chapter, six tracks (background,
  panel, guide, verses, voice, music with ducking), a crossfade, `$asset`
  references inside props, provenance; `explainer.json` — the migrated
  equivalent of v1alpha1 `basic.json`.
- **Invalid fixtures**, one rule each: overlap within a track; crossfade with
  the wrong overlap; crossfade on a first item; unknown `$asset`; audio item
  on a non-audio asset; overlapping sections; item past `durationInFrames`;
  `z` on an audio track; visual track without `z`; `duck.under` naming a
  missing or visual track; non-integer frame; duplicate item id; fade longer
  than its item. Each fixture names the expected error code.
- `scripts/check-timeline-fixtures.mjs` validates v1alpha1 (unchanged) and
  v1alpha2 fixtures; the v1alpha2 invalid fixtures must fail with their
  expected code.
- `node --test`: `validateEditTimeline` (every code, all-errors collection,
  JSON paths) and the migration (`basic.json` → `explainer.json`, and the
  missing-hash error).
- `npm run check` in `studio/contracts` passes, including `bindings:check`;
  the root `npm run check` passes.

## Out of scope

- The Remotion composer, the kit registry and any kit (`avg-tk7.*`).
- The series compiler and cue resolution (`avg-jao.2`, `avg-7zp.2`); word
  timing (`avg-7zp.1`).
- Changes to `packages/video-composer` (stays on v1alpha1 until `avg-tk7.6`).
- Nested sections, per-item effects/filters, keyframed props: kits own
  animation; anything else waits for a real need.
