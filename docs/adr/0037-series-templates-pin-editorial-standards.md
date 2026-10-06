# ADR-0037: Series templates pin editorial standards

## Status

Proposed for review with `avg-jao.1`. The contract and pure validation helpers
are implemented in `studio/contracts`. Compiler integration is `avg-jao.2`;
series-specific validator hooks are `avg-jao.3`. This does not change what
`pva_compose_video` currently renders.

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
  reviews/references/<reference-id>/
    episode-spec.json             # frozen editorial snapshot for the reference
    edit-timeline.json            # frozen derived snapshot
  output/<render-id>.mp4
  output/<render-id>.report.json
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
the existing typed timeline with spec/compiler provenance (ADR-0034). Until
`avg-jao.2` switches the consumer, ADR-0036's current timeline construction
and hand-edit preservation remain untouched.

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

This issue defines and tests descriptor shape/bindings, **not** a promotion
command, trust decision, filesystem loader, revocation mechanism or QA gate.
The integration must implement those checks before treating a descriptor as
a trusted golden; it cannot infer trust from `validateSeriesReference() === []`.

## Consequences and follow-ups

- A new contract family (`series-template.schema.json`) adds `SeriesTemplate`,
  `EpisodeSpec` and `SeriesReference`; no fields change in closed existing
  workspace schemas. TypeScript bindings and valid/invalid fixtures ship with it.
- Version pinning makes style drift detectable while keeping content editable.
  Re-running an old episode requires retaining its release, referenced kits,
  code versions and media; hashes do not constitute a backup.
- `avg-jao.2` owns loading/resolving the pinned release, compiler dispatch,
  workspace writes/staleness and the spec → timeline integration.
- `avg-jao.3` owns series-specific mechanical checks, reference trust/promotion
  integration and blocking the layout sheet on invalid inputs.
- `avg-jao.4` owns pipeline wiring; `avg-jao.5` owns identical-instant visual
  comparisons. Real channel templates and approved reference media belong to
  `avg-dcf`, not contract fixtures. No CreativeStudio runtime or production
  content is copied into this repository.
