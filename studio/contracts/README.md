# video-workspace-contracts

Language-neutral contracts shared by every Agentic Video Studio module.

## Owns

- JSON Schemas for pipelines, workspaces, journal events, edit timelines, review threads, provider jobs, capability bindings, error envelopes, editorial artifacts, and assets.
- Stable IDs, revision references, content hashes, and identity primitives.
- Canonical capability vocabulary and artifact-kind registry.
- Golden valid/invalid fixtures per schema family.
- TypeScript bindings generated from schemas with drift check.

## Does not own

Filesystem mutation, pipeline execution, creative skills, provider calls, rendering, or UI behavior.

## Schema families

| Schema file | Purpose |
|---|---|
| `identity.schema.json` | Stable IDs, revision refs, content hashes, provenance primitives |
| `workspace.schema.json` | Channel, series, episode profiles; settings, policy, snapshots |
| `pipeline-manifest.schema.json` | Pipeline definition with editorial/capability stage types |
| `vocabulary.schema.json` | Canonical capability names and artifact kinds |
| `journal-event.schema.json` | Append-only execution journal events |
| `edit-timeline.schema.json` | Edit timeline. `v1alpha2/`: NLE tracks of kit instances and audio, sections with spec provenance, integer frames, and a copy of its output profile (size, safe zone, loudness; catalog in `src/output-profiles.json`) (ADR-0034), checked by `src/edit-timeline.mjs`. `v1alpha1/`: deprecated segment list |
| `word-timing.schema.json` | When each word of one audio take is spoken, in seconds of that audio: written words with their spoken form where it differs, lines as word ranges, speech spans, lip-sync energy; provider-neutral; checked by `src/word-timing.mjs` |
| `cue.schema.json` | When something happens in terms of the voice: a whole word (or `*` prefix), seconds, or a word / line / take / mark object with `at` and `offset`; resolved to an absolute frame, never by fallback, by `src/cues.mjs` |
| `narration-takes.schema.json` | Every accepted voice take of an episode, from any tool (text as written, `spokenText` exactly as the tool received it, voice provenance, its word timing), and what each unit plays: takes in order with pauses and declared scene pauses; laid out and mapped from the Qwen narration manifest by `src/narration-takes.mjs` |
| `source-pin.schema.json` | An episode's pin on shared material — a channel source (`<channel>/sources/<name>`) or another episode of the channel — with an inventory (hash, size, mtime per file); verified cheaply by `src/source-pins.mjs` (ADR-0035) |
| `series-template.schema.json` | Immutable series-template releases (optionally pinning a channel theme), pinned editable episode specs, and hash-backed golden reference descriptors with human approval evidence (ADR-0037); pure helpers in `src/series-templates.mjs` |
| `channel-theme.schema.json` | A channel's look as data — colour and font roles, characters, rooms, brand — released as `<channel>/themes/<id>/<version>/theme.json` and pinned by series template releases (ADR-0040); `validateChannelTheme`, `BUNDLED_FONTS`, `ROLE_FACES` and `themeReleasePath` in `src/channel-themes.mjs` |
| `review-thread.schema.json` | Anchored review conversations with comments |
| `provider-job.schema.json` | Tracked provider invocations with cost and idempotency |
| `error-envelope.schema.json` | Cross-process error envelope with typed codes |
| `capability-binding.schema.json` | Concrete provider binding records (frozen in pipeline snapshots) |
| `editorial-artifact.schema.json` | Editorial artifacts (brief, script, tape, etc.) |
| `asset.schema.json` | Media asset metadata |

## Series templates

`src/series-templates.mjs` exports:

- `validateSeriesTemplate(manifest)`: closed manifest shape and canonical filenames,
  including the optional `sheet.instants` rules a layout sheet adds (avg-3th.1).
- `validateTemplateBundle({manifest, files})`: exact UTF-8 manifest text and a
  filename → UTF-8 text map; verifies every file hash and compiles the self-contained
  Draft 2020-12 data schema. No filesystem access or schema downloads.
- `instantiateEpisodeSpec(bundle, episodeRef)`: a fresh revision-1 draft,
  pinned to the manifest's hash, with `__FILL__` markers retained. No writes.
- `validateEpisodeSpec(spec, bundle)`: compile-ready validation: exact pin,
  no remaining placeholders (even embedded in text), and the series data schema.
  No coercion, default insertion or field removal.
- `validateSeriesReference(reference)`: descriptor shape and approval artifact
  bindings, **not** a signature/file trust check or approval operation.
- `placeholderPaths(data)`: JSON paths of unresolved content.

`src/sheet-reviews.mjs` (`avg-3th.2`) is the review of a layout sheet: a
gate review of stage `layout-sheet`, signed with the operator key, bound to
the sheet's `inputsHash` (its plan) and to `sheet.json` and the grid (its
outputs). `buildSheetReview` builds it unsigned; `verifySheetReview` answers
`approved`, `rejected`, `stale` (another sheet) or `invalid`, checking the
signature only when given the key.

`src/series-references.mjs` (`avg-jao.6`) is where a descriptor becomes a
verdict: `verifySeriesReference({seriesDir, templateId, referenceId, key})`
reads the descriptor, its signature, a withdrawal, the files, the pinned
release and the provenance, and answers `trusted`, `withdrawn`, `invalid` or
`unverifiable`; `buildReferenceApproval` and `buildReferenceWithdrawal` build
the receipts the operator's CLI signs. It reads files and never writes them.

Validators return `{code, path, message}[]`. Instantiation throws on invalid
bundles or episode identities. Bundle validity alone does not prove its unfilled
defaults can form a valid episode: validate a filled example before release.

The three release files are `FORMAT.md`, `episode-spec.schema.json` and
`episode-spec.template.json`; the last contains the series data object, not
an envelope. The manifest names reviewed, versioned compiler/validator registry
entries, never executable workspace paths. Canonical storage paths come from
`src/layout.mjs`.

See [ADR-0037](../../docs/adr/0037-series-templates-pin-editorial-standards.md)
for release, approval, snapshot and integration rules. The fixture in
`fixtures/series-template/example/` is deliberately synthetic: it does not
represent an approved production, registered compiler or available media.
Runtime compiler/promotion integration is not implemented by these helpers.

## Vocabulary

Canonical capabilities (from `src/vocabulary.mjs`):

| Capability | Description |
|---|---|
| `image.generate` | Generate images from prompts |
| `image.edit` | Edit or transform existing images |
| `speech.synthesize` | Text-to-speech synthesis |
| `graphics.render` | Local exact-graphics rendering |
| `terminal.record` | VHS terminal recording |
| `video.compose` | FFmpeg video composition |
| `media.probe` | Media file inspection |

Artifact kinds: `markdown`, `json`, `yaml`, `audio`, `video`, `image`, `captions`, `tape`, `directory`.

## Bindings

TypeScript bindings are generated by `npm run bindings:generate` and verified in sync by `npm run bindings:check` (wired into `npm run check`). Generated files live in `bindings/ts/`.

**Python bindings are deferred** (ADR-0028). The TTS worker and any future Python consumers will use JSON Schema directly or adopt a codegen step when needed, avoiding untested dual-language surface area.

## Release rule

Contracts use semantic package versions and explicit resource `apiVersion` values. Canonical records are closed by default; extensibility uses preserved `metadata`, namespaced `extensions`, and open-vocabulary identifiers. Breaking changes require a new resource version and migration fixtures. Generated bindings are tested against the same fixtures to prevent cross-language drift.

## Contract documentation

- [`docs/contract-catalog.md`](docs/contract-catalog.md)
- [`docs/compatibility-policy.md`](docs/compatibility-policy.md)
- [`docs/wire-conventions.md`](docs/wire-conventions.md)
- [`docs/identity-and-provenance.md`](docs/identity-and-provenance.md)
- [`docs/workspace-and-policy.md`](docs/workspace-and-policy.md)

Run `bun run check` (or `npm run check`) to validate schemas, execute compatibility fixtures, verify bindings, and run tests.

Install with `bun install`.

## Plan

The detailed implementation graph is stored in Beads. Run `bd list`, `bd graph`, and `bd show <id>` from this directory.
