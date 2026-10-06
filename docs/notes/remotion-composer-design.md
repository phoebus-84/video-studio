# Remotion composes the typed edit timeline

Design, 2026-08-29. Status: approved; M1 and M2 done (2026-10-06: `avg-tk7.1`,
`avg-tk7.2`, `avg-tk7.6`), M3's registry and previews done (`avg-tk7.3`). What
renders episodes now is described in
[ADR-0036](../adr/0036-the-studio-renders-episodes-through-the-edit-timeline);
the sections below describe the state before it.

## Why

Final composition should move from FFmpeg to Remotion for three reasons, in the
order they matter:

1. **Motion and layout.** Ken Burns moves, animated text, lower thirds, real
   typography — cheap in React, painful or impossible as an FFmpeg filter graph.
2. **One engine.** `packages/infographics` already renders on Remotion. Running
   final composition on an unrelated engine means two mental models, two sets of
   failure modes, and two ways to express a dissolve.
3. **The agent authors compositions.** Given the Remotion skills in
   `skills/shared/remotion-best-practices`, the agent can write and reason about
   React it can preview, which it cannot do with an FFmpeg filter graph.

## What is actually there today

This matters, because the migration is smaller than it sounds in one respect and
larger in another.

[ADR-0009](../adr/0009-ffmpeg-compiles-a-typed-edit-timeline) says a dedicated
composer "validates that timeline, compiles FFmpeg filter graphs, runs FFmpeg and
ffprobe, and emits the deliverable plus a render report."

The validator exists — `packages/video-composer/src/validator.ts`, 929 lines —
and `studio/contracts/schemas/v1alpha1/edit-timeline.schema.json` declares itself
the canonical mapping to its `Timeline` type. **Nothing compiles a `Timeline`.**
`packages/video-composer/src/composer.ts` is not exported from `src/index.ts`,
and it accepts a flat `SceneInput[]` rather than a `Timeline`.

What renders episodes is `composeEpisodeVideo()` at
`studio/agent/src/capability-tools.ts:219` — a private function in the agent that
shells out to `ffmpeg` through `spawnSync` and `execSync`, globs `assets/images`,
concatenates narration WAVs, and normalises frame sizes by hand.
`pva_compose_video` calls it.

So the arrangement ADR-0009 was written to prevent — composition logic living in
the agent rather than behind a validated declarative contract — is approximately
what runs.

What `packages/video-composer` genuinely provides the studio: `validateTimeline`
(validating a schema nothing consumes), `runQa` (post-render ffprobe checks,
called from `studio/gateway/src/runtime/executor.ts:262`), `probeMedia` and
`normalizeMedia` behind `media.probe`, and `narrationCompositionInput`.

**The compiler seat is empty.** This design fills it with Remotion. That is more
work than swapping a renderer, because it means building the contract that was
specified and never built — but it is not a rewrite of working code.

## The decision that shapes everything else

"The agent authors compositions" cannot be adopted literally without reversing
this repository's central architectural commitment. ADR-0009 exists to stop the
agent emitting executable render instructions.
`packages/video-composer/README.md` states the boundary directly: "Arbitrary
shell fragments are rejected." Agent-authored TSX is arbitrary *code* — strictly
more powerful than the shell fragments already refused — and executing it against
`library/`, which holds production data, also sits badly with
[ADR-0014](../adr/0014-repository-inputs-are-pinned-and-untrusted).

The adopted shape preserves the property ADR-0009 protects while still letting
the agent write React:

- **Episode-level editorial intent stays declarative JSON**, validated and
  diffable. The agent never writes TSX into an episode workspace.
- **The visual vocabulary is open.** When the agent needs a visual the library
  does not cover, it authors a new *scene kit* — a named, versioned React
  component in `packages/remotion-composer/src/kits/`, in the repository, through
  the normal commit and review path. Timelines then reference it by name.

The agent genuinely writes Remotion components. It writes them into a reviewed
library rather than into production data. The cost, stated plainly: a genuinely
novel one-off flourish takes two steps rather than one.

## Architecture

A new package `packages/remotion-composer` (`@av/remotion-composer`) becomes the
compiler ADR-0009 specified — the same seat, a different engine. It is standalone
under the `packages/` rule: it knows about timelines, not about episodes.

`packages/infographics` is the template to copy rather than merely resemble:
`bundle()` → `selectComposition()` → `renderMedia()` over a zod-validated spec
passed as `inputProps`, already proven in this repository.

It registers as a **second provider of `video.compose`**, not a replacement.
That machinery already exists: `capability-binding.schema.json` permits multiple
providers, `image.generate` already runs two (`fal-media` and `codex-image`), and
`compose.config.json` selects with `defaultProviders`. Engines can therefore be
switched per profile, with a working fallback while the kit library fills out.
This follows [ADR-0015](../adr/0015-stages-request-capabilities-not-providers)
and [ADR-0026](../adr/0026-capability-dispatch-via-package-imports) as written.

### FFmpeg does not leave

Three things stay on FFmpeg, and the design should not pretend otherwise:

- **`runQa`.** The checks in `packages/video-composer/src/qa.ts` read the
  finished MP4 with ffprobe. Engine-agnostic, unchanged.
- **`probeMedia` / `normalizeMedia`.** `media.probe` is a separate capability
  from `video.compose` and is out of scope.
- **Loudness.** `renderMedia()` has no EBU R128 equivalent; two-pass `loudnorm`
  is an FFmpeg filter, and the QA checks `loudness` and `true-peak` depend on it.

The pipeline becomes *Remotion renders, FFmpeg normalises and finalises* — a
post-render pass, not a filter graph. Two encodes. That is the price of keeping
the loudness gates green.

### Effect on ADR-0009

ADR-0009 changes engine, not principle. A new ADR supersedes it, carrying its
rationale forward verbatim: editorial intent stays declarative and reviewable;
what compiles it changes. The new ADR also records the kit-extension decision
above, because that is the part a future reader will otherwise misread as a
loophole.

## Components

Under `packages/remotion-composer/src/`:

| Module | Responsibility |
|---|---|
| `schema.ts` | zod mirror of the canonical `Timeline`; the single validation gate |
| `Timeline.tsx` | Root composition: scenes → `<Sequence>`, transitions → `@remotion/transitions`, narration → `<Audio>` |
| `kits/` | Versioned scene-kit registry: name → component, each with its own zod props schema and version |
| `render.ts` | `bundle` / `selectComposition` / `renderMedia`, plus the loudnorm post-pass |
| `index.ts` | Public API: `renderTimeline`, `validateTimeline`, `listKits` |

**On the schema mirror.** `tools/check-boundaries.mjs` forbids `packages/` from
depending on `studio/`, so this package cannot import `studio/contracts`. It owns
a structural mirror, exactly as `packages/video-composer/src/types.ts` already
does. Mirrors drift; see Testing for the guard.

**Kits shipped in M1**, covering what is rendered today plus the missing motion:
`still` (image with Ken Burns), `clip` (video with freeze-on-end), `title`,
`lower-third`, `captions`.

**Kits live in the repository, never in `library/`.** A timeline references a kit
by name and version with typed props, so an unknown kit or bad props is a
validation error before rendering starts rather than a crash mid-render.

### Studio side

`composeEpisodeVideo()` is deleted, along with its inline `execSync` and
`spawnSync` FFmpeg calls. Its real work — selecting scene frames, assembling
narration, normalising sizes — becomes *constructing a validated timeline*.
`narrationCompositionInput()` already returns the audio path, measured duration
and caption cues in the shape a timeline needs, so timing stays on the canonical
measured path with no filename sorting.

## Data flow

Upstream stages are unchanged: `assets/images/`, optional clips, and
`artifacts/narration/narration-manifest.json`.

1. A studio-side step writes **`artifacts/edit-timeline.json`**, validated
   against the canonical schema. This is the artifact that was always specified
   and never materialised, and it is the reviewable one — when the agent wants a
   different cut, it edits this, and the diff is readable.
2. `renderTimeline()` validates, bundles, and renders to an intermediate.
3. The FFmpeg loudnorm pass produces the final MP4.
4. Output lands at `output/<render-id>.mp4` with a sibling
   `<render-id>.report.json`, and `output/current.json` is updated — the layout
   `skills/studio/compose-video.md` already mandates and `findRender()` in
   `studio/gateway/src/runtime/executor.ts` already scans first.

QA needs no change to find the result.

**Who writes what.** Step 4 is a workspace convention, and the package must not
know it — `@av/remotion-composer` is told an output path and returns a result
record (path, duration, file size, hash, kit versions used). Allocating the
render id, placing the file under `output/`, writing the sibling report and
updating `current.json` are the studio's job, in the same layer that constructs
the timeline. This keeps the `packages/` boundary honest and mirrors how
`packages/infographics` takes an `outputPath` and nothing more.

## Error handling

Three failure classes, caught deliberately at different points.

**Invalid timeline** — unknown kit, props failing a kit's schema, overlapping
scenes, missing or hash-mismatched asset. Caught before bundling and reported in
the existing `ValidationMessage` shape, whose JSON-path `path` field lets a
message point at `$.scenes[2].kit`.

`AssetRef.hash` exists in the schema today and nothing reads it. This is where it
starts earning its place: validating hashes before rendering catches a changed
asset instead of silently re-rendering it, which connects to
[ADR-0012](../adr/0012-feedback-is-anchored-and-revisions-propagate-staleness).

**Broken kit** — a kit that fails to compile or throws on mount. This is a
genuinely new failure mode; an FFmpeg filter graph cannot have this bug. The
mitigation is that every kit ships a one-frame render test, so a broken kit fails
`npm run check` rather than a production render.

**Render failure** — headless Chrome crash, or OOM at concurrency. Same
`ComposerError` code discipline as today, `renderMedia`'s progress callback
feeding the existing log stream, and cancellation kept at parity with the current
`AbortSignal` contract.

## Testing

- **Per-kit one-frame render assertions.** Fast: no encode.
- **Fixture-driven validation tests**, following the conventions already in
  `packages/video-composer/tests/validator.test.ts` and `golden-suite.test.ts`.
- **Contract conformance.** Extend
  `studio/contracts/scripts/check-timeline-fixtures.mjs` so the package's zod
  mirror and the canonical JSON schema accept and reject the *same* fixtures.
  This is the guard against silent drift, which is the standing hazard of the
  `packages/` boundary rule.
- **One end-to-end render behind a flag.** Needs headless Chrome and a full
  encode; too slow for `npm run check`.
- QA tests are unchanged.

## Milestones

**M1 — fill the compiler seat.** Package, schema, root composition, five kits,
`renderTimeline`, loudnorm pass, output layout. Registered as a `video.compose`
provider but *not* the default. Nothing breaks; the existing path keeps working.
M1 also measures render speed on a real episode (see Risks).

**M2 — cut the studio over.** Timeline construction replaces
`composeEpisodeVideo()`, which is deleted. `defaultProviders` flips for the
`full` profile. New ADR superseding 0009. *Done in `avg-tk7.6`: ADR-0036, the
flip in every profile that composes the agent, and `artifacts/edit-timeline.json`
as the reviewable artifact.*

**M3 — the kit extension mechanism.** Kit authoring contract, registry
versioning, a `remotion-studio` preview entry point for the agent, docs page.
This is the milestone that makes "the agent authors compositions" real rather
than promised.

## Risks

**Render speed is the significant one.** FFmpeg concatenating stills is
enormously faster than rasterising frames in a browser. A ten-minute episode at
1080p30 is 18,000 frames. M1 measures this on a real episode **before** M2
commits to the cutover. If it is an order of magnitude slower, that changes what
"easier" means in practice, and M2's default-provider flip should be reconsidered
rather than assumed.

**Headless Chrome becomes a system requirement.** Remotion downloads its own
Headless Shell. `npm run doctor` and `docs/install.md` must know about it, and it
affects CI time and install size.

**Remotion version drift.** `packages/infographics` pins 4.0.505; the vendored
skills now describe 4.0.518. M1 bumps both to 4.0.518 so exactly one Remotion
resolves in the lockfile.

## Out of scope

- `media.probe` and the `probeMedia` / `normalizeMedia` implementations.
- The QA suite's checks and thresholds.
- `packages/infographics`, beyond the version bump.
- Publishing, delivery, and anything downstream of the finished MP4.
