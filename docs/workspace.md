# Workspace contract

```text
library/
└── channel-slug/
    ├── channel.md
    ├── settings.yaml
    └── series/
        └── series-slug/
            ├── series.md
            ├── settings.yaml
            ├── visual-bible.md
            ├── content-plan.md                 # optional, series-level
            ├── voice-profiles/
            ├── pipelines/                      # definitions and overrides
            ├── skills/                         # series-local Pi skills
            ├── sources/                        # shared pinned source metadata/cache refs
            └── episodes/
                └── episode-slug/
                    ├── episode.yaml
                    ├── pipeline.snapshot.yaml
                    ├── source/
                    │   └── source.yaml
                    ├── artifacts/
                    │   ├── brief.md
                    │   ├── adapted-story.md     # fairy-tale pipeline
                    │   ├── script.md
                    │   ├── tts-script.md
                    │   ├── art-direction.md
                    │   ├── scenes.yaml
                    │   └── edit.yaml
                    ├── prompts/
                    │   └── scene-id/
                    │       └── attempt-id.md
                    ├── assets/
                    │   ├── images/
                    │   ├── graphics/
                    │   ├── audio/
                    │   └── manifest.json
                    ├── attempts/
                    │   └── stage-id/
                    ├── reviews/
                    │   └── threads.jsonl
                    ├── journal/
                    │   └── events.jsonl
                    └── output/
                        ├── render-id.mp4
                        ├── render-id.report.json
                        └── current.json
```

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
