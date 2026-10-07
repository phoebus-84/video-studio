# ADR-0037: Series templates pin editorial standards

## Status

Accepted. The contract and pure validation helpers are implemented in
`studio/contracts` (`avg-jao.1`). The compiler seat is `@studio/series`
(`avg-jao.2`): a registry of versioned, pure compilers, each frozen by a
golden output, with `poetry-short@1.0.0` the first; the agent's
`compileEpisode` loads and checks a spec-driven episode, and
`pva_build_timeline`/`pva_compose_video` use it whenever an episode has an
`episode-spec.json`. Series validators are implemented beside the compilers
(`avg-jao.3`). Golden references are proposed by Pi (`pva_propose_reference`),
approved, verified and withdrawn by the operator (`vpr reference`), and
verified by `verifySeriesReference` (`avg-jao.6`).

## Context

A series is a repeatable editorial format, not a directory of unrelated
videos. Approved episodes establish its style, direction, writing, voices
and editing; the next episode should change the content, not quietly invent
another format. CreativeStudio's UP-52/53 express this well, but copying its
executable episode templates into `library/` would violate our boundary:
editorial intent is data; reviewed repository code compiles it (ADR-0034).

The series already has a `templates/` knowledge folder. It has no contract
for what a template contains, how an episode pins it, or which historical
render is an approved reference. A path to an episode or `output/current.json`
is not a fixed reference: both can change.

## Decision

### One standard, explicit releases

Within `library/<channel>/series/<series>/`:

```text
templates/<template-id>/
  1.0.0/
    series-template.json          # SeriesTemplate: identity, code refs, file hashes
    FORMAT.md                     # the standard AND the production procedure
    episode-spec.schema.json      # self-contained JSON Schema for EpisodeSpec.data
    episode-spec.template.json    # data defaults and __FILL__ placeholders
  1.1.0/                          # a new release, never a rewrite of 1.0.0
  references/<reference-id>.json  # SeriesReference, append-only golden descriptor

episodes/<episode>/
  episode.yaml                    # workspace identity/settings, unchanged
  episode-spec.json               # editable EpisodeSpec; pins a template release
  artifacts/edit-timeline.json    # compiler output (avg-jao.2)
  artifacts/layout-sheet/         # sheet.json, sheet.jpg, frames/ (avg-3th.1)
  reviews/references/<reference-id>/
    episode-spec.json             # frozen editorial snapshot for the reference
    edit-timeline.json            # frozen derived snapshot
  output/<render-id>.mp4
  output/<render-id>.timeline.json  # the exact timeline rendered (avg-jao.5)
  output/<render-id>.report.json
  reviews/compare/<old>--<new>/   # version comparisons (avg-jao.5)
```

`layout.mjs` owns the path builders and names. IDs are slugs; versions are
exact `major.minor.patch`, without ranges, aliases, prereleases or `latest`.
The series' existing `format` prose is not a version selector. Creating a
spec requires an explicit template ID/version; existing workspaces remain
valid without one. No automatic migration or selection is introduced here.

A release manifest hashes the exact UTF-8 bytes of its three files. The
manifest's own hash, ID and version are carried by each spec. Checking only
the version string is insufficient: an in-place edit must fail the hash
check, not silently restyle an episode. A style/structure/voice change needs
an explicit operator request, a new release and a recorded explanation in
that release's `FORMAT.md`; even a correction does not rewrite a released
version. Existing specs stay pinned until explicitly migrated as a new
revision. SemVer describes the change, never permission to auto-upgrade.

`FORMAT.md` is the one template-specific standard and procedure, not another
competing visual bible. It names the applicable series/channel guidance;
any release-critical choice from that mutable guidance must be frozen in
this release's data or prose. Fixed style values use the data schema's
`const`/`enum`; the schema defines which content-dependent choices are
permitted. A hash alone cannot mechanically classify a human edit as a
"style change"; review and the later comparison/validator gates own that.

### Data templates, not executable scaffolds

`SeriesTemplate.compiler` names a versioned reviewed repository registry
entry. An optional `validator` does the same for series-specific checks.
Neither is a path, command, URL or source code. Availability/dispatch is
checked by their runtime consumers, not by the contract validator. No TSX,
Python hooks, shell, module loading or schema downloads come from a release.

The data schema declares JSON Schema Draft 2020-12 and `type: object`.
Definitions are bundled in root `$defs`; only `#/$defs/<name>` references
are allowed (not pointers into example/default data). Async/dynamic references
and nested schema IDs are unsupported.
Validation does not coerce values, insert defaults, remove fields or execute
custom keywords. Schema definitions are reviewed release inputs, not a
sandbox for arbitrary hostile regular expressions or unbounded schemas.

The template file is the **data object**, not the whole EpisodeSpec envelope.
`__FILL__` is a reserved marker, including when embedded in a string. It may
stand in for any JSON value (a number, object or array as well as text).
`instantiateEpisodeSpec` returns a fresh draft with these markers intact,
revision 1 and the exact release pin. It never fills in invented content.
The editor replaces placeholders with values of the correct type.

A draft is not compile-ready. `validateEpisodeSpec` checks the envelope,
release file hashes and exact pin, rejects every remaining marker, then
validates the data against the series schema. Diagnostics name the offending
JSON path. Bundle validation checks hashes and schema compilation; only a
filled example/spec can prove that the defaults and supplied content jointly
satisfy the data schema. There is no permissive "render despite placeholders"
mode. Instantiation and validation are pure and never write workspace files.

The compiler consumes the spec plus measured timing/source pins and produces
the existing typed timeline with spec/compiler provenance (ADR-0034):
`derivedFrom` names the spec's hash and revision and the compiler's id and
version, and `metadata.inputs` the hash of every file read. A released
compiler version is frozen by its golden output — a fixture must compile to
a byte-identical timeline — so a change in behaviour, even one coming from a
shared contract helper, is a new version. An episode with a spec is always
compiled; it never falls back to ADR-0036's builder, whose hand-edit
preservation applies to compiled timelines too.

### Series validators check what is rendered

`SeriesTemplate.validator` names a versioned, reviewed validator in
`@studio/series`, registered and frozen like a compiler: each released
version has golden cases (small edits of its compiler fixture's timeline with
their exact findings), and a new rule is a new version. A validator is pure;
it receives the compile input, the timeline about to be rendered and what the
compiler makes of the same inputs, and returns findings (`error` or
`warning`) located by JSON path.

The rules apply to **whatever is rendered**, a hand-edited timeline included:
a hand edit may change what the series allows (when a picture changes, how
captions are split), never the format itself (the voice, the text, the
profile, the effects). Errors refuse the build and the render before anything
is written; warnings are reported and recorded in the render report.
`pva_check_episode` runs the same check without writing anything — the gate
the layout sheet (`avg-3th.1`) and the pipeline stages (`avg-jao.4`) block
on. A template that names no validator has no series rules.

### The layout sheet shows what will be rendered

Before a render, a person reads the episode's **layout sheet**
(`avg-3th.1`): small stills of the timeline a render would use and one grid
of them, labelled by number, time and reason. Its instants are decided the
same way every time from the timeline alone — the first and last frame, a
spread over the sections by length (at least one each, never on a cut) — plus
the instants the release declares in an optional `sheet` field of
`series-template.json`:

```json
"sheet": { "instants": [{ "at": "start", "offsetSeconds": 2, "sections": ["block-*"] }] }
```

Each rule is anchored to the `start`, `middle` or `end` of every matching
section, so a hand edit that moves a section moves its instants. Rules are
data, pinned with the release like everything else: a series that wants
different instants publishes a new release. An instant that falls outside
its section is a warning in the sheet, not an error.

The series rules block the sheet: a timeline they refuse has no sheet.
`sheet.json` records the timeline it shows by hash, the kits it drew with by
their code hashes, the rest of the composer's drawing code (with its Remotion
and React versions), the rules and the scale, and an `inputsHash` over all
of them; the timeline names every asset by hash and all timing in frames, so
nothing else decides the pictures. In the `series-production` pipeline
(1.1.0) the `sheet` stage sits between `check` and `render`, with a human
gate, and `render` refuses a sheet that is missing, whose grid or stills were
replaced, or whose inputs hash no longer matches what it would render.
A sheet holds at most 120 frames: the defaults first, then the release's
rules in order; instants past the limit are dropped with a warning, so no
release can make a sheet impossible. Signing
the sheet's review is `avg-3th.2`.

### Corrections are proven by comparison

A correction to a rendered episode changes only what was asked for, and that
is shown (`avg-jao.5`, CreativeStudio's UP-54): the new render is compared
with the old one — or with a golden reference — at the same instants, and
every frame that differs is listed with its section.

Renders are compared, not re-rendered: an old timeline's assets may no longer
exist, but its video does, and both videos are decoded alike. Each render
keeps the exact timeline it rendered beside it
(`output/<render-id>.timeline.json`, hashed in its report), so the instants —
the layout sheet's, of the new version — are carried into the old version
section by section, at the same offset: a block that got longer does not make
everything after it look changed. A render without a timeline is aligned by
time, with optional shifts. A frame differs when its mean grey difference
exceeds a threshold (1.0 of 255 by default) or when enough of its pixels
changed (0.2%: a word in a caption barely moves the mean); one with no
counterpart (a new section, a section that got longer, a video that ends
earlier) differs by definition. What no frame can show is compared as shape:
a section added, removed or resized, or — without sections — a change of
length.

Only the compared instants are seen — the layout sheet's, about 24, or the
times asked — so a change between them can be missed; the comparison says
how many it compared, and a closer look passes times inside the corrected
part. Given the sections the correction was meant to change, the verdict is
`ok` when every difference found is inside them and `unexpected-changes`
otherwise; an
unexpected change is undone or narrowed, never waved through. The comparison
is evidence for a person (`reviews/compare/<old>--<new>/`, with each changed
frame drawn old | new | difference), not a pipeline gate. A reference's
signature is not checked here — that is the operator's `vpr reference verify`.

### Golden references are evidence, not live pointers

A `SeriesReference` records the source episode, the exact template pin,
frozen spec/timeline snapshots, immutable render/report files, their hashes,
and the preserved **human** approval receipt. The receipt must name this
episode, bind all four artifact hashes, and approve the render as an output.
An agent/policy approval, draft, rejected experiment or arbitrary episode
folder is not a golden reference.

References live alongside version directories, not inside a frozen release:
a newly approved episode can become another reference without changing that
release's hash. New references get new IDs; delivered corrections keep the
old evidence and add new snapshots/descriptors. Snapshotting editorial
review evidence is not copying shared media; shared assets still follow
ADR-0035 and media stay at their immutable attempt/output paths.

**A well-shaped descriptor is not proof of approval.** Before promotion or
use, the runtime must:

1. Verify the original receipt with the operator-only key using the existing
   `verifyReceipt`; use the journal/gate service to refuse superseded approval
   at promotion. Contract helpers do not issue approvals or read keys.
2. Verify every snapshot/media/report hash and that paths resolve safely
   inside the source episode (including realpath/symlink containment).
3. Validate the frozen spec against the pinned release; ensure its identity
   and pin match the descriptor and containing series; check timeline/report
   provenance against that spec/render. A missing file or release is a hard
   failure, not permission to use today's version.
4. Preserve that verified historical evidence. A later live episode edit
   does not rewrite a golden snapshot. Withdrawing a reference is an explicit
   operator action, never replacement of its historical record.

`avg-jao.1` defined and tested the descriptor's shape and bindings; trust
cannot be inferred from `validateSeriesReference() === []`.

**How the studio does it (`avg-jao.6`).**

- **Propose** (Pi or a person, `pva_propose_reference`): the episode's current
  render, the timeline it was made from and the spec that timeline was
  compiled from — with no series-rule errors — are frozen in
  `reviews/references/<id>/` with an unsigned `proposal.json`.
- **Approve** (the operator only, `vpr reference approve`): the proposed files
  are re-hashed (what is approved is exactly what was proposed); the approval
  is a `GateReview` of stage `reference-review` whose `planHash` is the
  proposal's hash (checked on every verify, so no field of the descriptor —
  metadata included — can change after signing), signed with the operator key; the descriptor is verified in
  full before it is written, then created exclusively — never rewritten.
- **Verify** (`verifySeriesReference`, `vpr reference verify | list`): the
  descriptor and its identity, the signature, a withdrawal, the files inside
  the source episode, the frozen spec against its pinned release, and the
  provenance from spec to timeline to render — in that order. The verdict is
  `trusted`, `withdrawn`, `invalid` (with the first failing check) or
  `unverifiable` (no key).
- **Withdraw** (the operator only, `vpr reference withdraw --reason`): a
  signed, exclusive `<id>.withdrawal.json` bound to the descriptor's hash;
  the descriptor and its evidence stay. A forged withdrawal makes the
  reference `invalid`, never quietly withdrawn. "Append-only" is what the
  studio does, not what the filesystem enforces: anyone who can write the
  library can delete a withdrawal (or any file), and a deleted withdrawal
  cannot be detected from inside the library. That is the same-user boundary
  of every operator file (`avg-qr4.8`, OS isolation); until then the library
  is backed up.

The record of a reference is its signed descriptor and withdrawal, not the
episode's journal: review events there are written only by the execution
service for pipeline stages (avg-qr4.3), and a reference is not a stage.
Approval and promotion are one command, so an approval cannot be superseded
before it is promoted; afterwards only a signed withdrawal ends a reference.

## Consequences and follow-ups

- A new contract family (`series-template.schema.json`) adds `SeriesTemplate`,
  `EpisodeSpec` and `SeriesReference`; no fields change in closed existing
  workspace schemas. TypeScript bindings and valid/invalid fixtures ship with it.
- Version pinning makes style drift detectable while keeping content editable.
  Re-running an old episode requires retaining its release, referenced kits,
  code versions and media; hashes do not constitute a backup.
- `avg-jao.2` owns loading/resolving the pinned release, compiler dispatch,
  workspace writes/staleness and the spec → timeline integration.
- `avg-jao.3` owns the series validators and the check that blocks rendering;
  `avg-jao.6` owns reference trust/promotion integration; `avg-3th.1` made
  the layout sheet, which the series rules block.
- `avg-jao.4` owns pipeline wiring: the `series-production` family (spec,
  pictures, takes, timeline, check, render), its stage adapters and
  `pva_init_spec`; `avg-jao.5` made the identical-instant comparison of
  two versions. Real channel templates and approved reference media belong to
  `avg-dcf`, not contract fixtures. No CreativeStudio runtime or production
  content is copied into this repository.
