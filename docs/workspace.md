# Workspace contract

## Layout 2

```text
library/
└── channel-slug/
    ├── channel.md
    ├── settings.yaml                   # `budget:` caps paid calls (avg-91o); nearest level wins
    ├── brand/                          # channel knowledge
    ├── characters/
    ├── references/
    ├── skills/
    ├── sources/                        # shared material episodes pin (ADR-0035)
    ├── voices/
    └── series/                         # explicit container
        └── series-slug/
            ├── series.md
            ├── settings.yaml
            ├── visual-bible/           # series knowledge
            ├── skills/
            ├── templates/              # <id>/<version>/ + <id>/references/ (ADR-0037)
            ├── sources/
            ├── pipelines/
            └── episodes/               # explicit container
                └── episode-slug/
                    ├── episode.yaml
                    ├── episode-spec.json       # optional editorial spec, pinned series template
                    ├── pipeline.snapshot.yaml
                    ├── source/                 # source/pins/<id>.json: pinned shared material
                    ├── artifacts/
                    ├── prompts/
                    ├── assets/
                    ├── attempts/               # kept candidates, one per completed attempt (avg-qr4.6)
                    ├── reviews/
                    ├── journal/
                    └── output/
```

**A directory inside `series/` is a series. A directory inside `episodes/` is an
episode.** Nothing else has to be inferred.

Layout 1 placed series directly inside the channel directory, mixed with the
channel's own files, so nothing could tell a series from a support folder by
looking. The gateway carried a hardcoded denylist of names that are *not* a
series — which meant adding a `characters/` folder to a channel invented a
phantom series. Explicit containers delete that class of bug, and let a channel
grow as much knowledge as it likes.

Names beginning with `.` are metadata and names beginning with `_` are reserved
holding areas (`_media`, `_exports`). Neither is ever content, at any level.

`studio/contracts/src/layout.mjs` is the single source of truth for these paths.
Compute paths through it rather than joining strings.

## Migrating

```bash
node tools/migrate-library-layout.mjs --library ./library --dry-run
node tools/migrate-library-layout.mjs --library ./library
```

Moves are `rename` within one filesystem, so no media is copied or rewritten,
and the script is idempotent — a library already in layout 2 is left alone.

## Inheritance

Configuration resolves in this order:

```text
system defaults -> channel -> series -> episode
```

The resolved values, provider bindings, contract versions, pipeline definition, and relevant skill identities are frozen in `pipeline.snapshot.yaml`.

## Series template releases

[ADR-0037](adr/0037-series-templates-pin-editorial-standards.md) defines
`templates/<id>/<version>/series-template.json`, which pins the release's
`FORMAT.md`, `episode-spec.schema.json` and `episode-spec.template.json`.
The standard and procedure live together in that `FORMAT.md`; content slots
use `__FILL__`. Versions are immutable and explicitly selected, never
implicitly upgraded.

An optional editorial `episode-spec.json` records its template ID, exact
version and manifest hash. It is separate from workspace identity/settings
in `episode.yaml`. Drafts can contain placeholders; compilation cannot.
Approved golden descriptors live separately at
`templates/<id>/references/<reference-id>.json`, pinning frozen review
snapshots and immutable output media, not today's episode or current pointer.

A release may also pin the channel's look: `theme: {id, version, hash}`
names `<channel>/themes/<id>/<version>/theme.json`
([ADR-0040](adr/0040-channel-themes-carry-the-look-as-data.md)) — colour and
font roles, characters, rooms and brand, with the images it names beside
it. Theme releases are immutable too; a new look is a new theme release and
a new series template release. A theme release is sealed: its `theme.json`
lists each file it names with its hash (`vpr theme seal`), and the loader
holds the rooms to them. `vpr template release` copies a release to a new
version pinned to a sealed theme, and `pva_upgrade_spec` moves an episode's
spec to it (its revision goes up; the sheet must be reviewed again).

This is the contract for forthcoming series compilers. Existing episode
initialization and composition do not yet create or consume it. Path helpers
are `seriesTemplatePath` and `seriesReferencePath` in `layout.mjs`;
`EPISODE_SPEC_PATH` names the editorial file.

## File ownership

- Markdown with YAML frontmatter: human and agent editorial content.
- YAML: declarative configuration, scenes, and timeline.
- JSON: typed editorial episode specs and template data, generated manifests, reports, and current pointers.
- JSONL: append-only events and review history.
- Media: immutable attempt files named with stable IDs, never `final-final-2`.

## Editing rules

Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink. For a spec-driven episode, a render starts only when a person approved its current layout sheet (`artifacts/layout-sheet/review.json`, signed by `vpr sheet approve`; making the sheet again clears it). A render becomes current only after its file passes the render audit (decode, streams, duration, loudness, and the loop when the timeline declares one); a render that fails stays in `output/` with its report, which says why.

## Git and storage

Textual workspace files are suitable for Git, but large generated media are not automatically committed. Media backup and remote object storage are future policies; manifests retain content hashes and provenance so missing assets are detectable rather than silently ignored.
