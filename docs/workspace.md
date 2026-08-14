# Workspace contract

## Layout 2

```text
library/
└── channel-slug/
    ├── channel.md
    ├── settings.yaml
    ├── brand/                          # channel knowledge
    ├── characters/
    ├── references/
    ├── skills/
    ├── voices/
    └── series/                         # explicit container
        └── series-slug/
            ├── series.md
            ├── settings.yaml
            ├── visual-bible/           # series knowledge
            ├── skills/
            ├── templates/
            ├── sources/
            ├── pipelines/
            └── episodes/               # explicit container
                └── episode-slug/
                    ├── episode.yaml
                    ├── pipeline.snapshot.yaml
                    ├── source/
                    ├── artifacts/
                    ├── prompts/
                    ├── assets/
                    ├── attempts/
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

## File ownership

- Markdown with YAML frontmatter: human and agent editorial content.
- YAML: declarative configuration, scenes, and timeline.
- JSON: generated manifests, reports, and current pointers.
- JSONL: append-only events and review history.
- Media: immutable attempt files named with stable IDs, never `final-final-2`.

## Editing rules

Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink.

## Git and storage

Textual workspace files are suitable for Git, but large generated media are not automatically committed. Media backup and remote object storage are future policies; manifests retain content hashes and provenance so missing assets are detectable rather than silently ignored.
