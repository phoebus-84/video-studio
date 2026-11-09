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

`pva_init_spec` creates an episode's spec from a release, and
`pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet` and
`pva_compose_video` compile and render it with the release's compiler and
validator (ADR-0041). An episode without a spec is built from its scene images
and narration instead. Path helpers are `seriesTemplatePath` and
`seriesReferencePath` in `layout.mjs`; `EPISODE_SPEC_PATH` names the editorial
file.

## File ownership

- Markdown with YAML frontmatter: human and agent editorial content.
- YAML: declarative configuration, pipeline manifests and scene descriptions.
- JSON: typed episode specs, layered edit timelines, template data, generated manifests, reports and current pointers.
- JSONL: append-only events and review history.
- Media: immutable attempt files named with stable IDs, never `final-final-2`.

## Editing rules

Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink. For a spec-driven episode, a render starts only when a person approved its current layout sheet (`artifacts/layout-sheet/review.json`, signed by `vpr sheet approve`; making the sheet again clears it). A render becomes current only after its file passes the render audit (decode, streams, duration, loudness, and the loop when the timeline declares one); a render that fails stays in `output/` with its report, which says why.

## Git and storage

A channel's text is versioned in its own git repository; heavy media stay out.
`media.lock.jsonl` names their channel-relative paths, SHA-256 hashes and sizes
(or relative symlink targets). Updating the lock keeps entries missing on this
machine; only explicit `--prune` forgets them (ADR-0045).

### Media remote

An optional, versioned `media.remote.json` gives those hashes an S3-compatible
remote ([ADR-0049](adr/0049-channel-media-use-a-content-addressed-s3-remote.md)).
No secrets belong here:

```json
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "MediaRemote",
  "url": "s3://channel-media/shared/",
  "endpoint": "https://storage.example.org",
  "region": "auto",
  "keep": ["paid", "approved", "archive", "masters", "other"],
  "rules": [
    {"prefix": "series/my-series/episodes/ep001/assets/loops", "tier": "derived"},
    {"prefix": "series/my-series/episodes/ep001/assets/video/wan", "tier": "paid"}
  ],
  "forcePathStyle": true,
  "checksum": true
}
```

- `url`: bucket plus optional object prefix, without credentials, queries or
  escapes. Objects are `<prefix>/sha256/<first-two-hex>/<full-hex>`. Cross-channel
  deduplication requires the **same bucket and prefix**.
- `region`: required; use the provider's region (`auto` for R2). `endpoint`
  is optional for AWS; otherwise an HTTPS origin. HTTP is permitted only on
  loopback and on a private IP address (`10.x`, `172.16–31.x`, `192.168.x`,
  `100.64–127.x`, IPv6 `fc00::/7`), such as a server reached through
  WireGuard or Tailscale; never on a hostname. Do not put credentials in an
  endpoint URL.
- Credentials use the standard AWS chain: `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, or `AWS_PROFILE`
  and the user's AWS config files. Unknown config fields are rejected.
- `keep` defaults to the five tiers shown. Explicit `keep` replaces that
  default, so retain `other` unless you deliberately want to exclude
  unclassified assets. An empty array selects nothing until `--tier` is given.
- `rules` defaults to empty. The first matching `prefix` wins, matching a
  complete file or directory boundary; no globs or trailing slash. Rules are
  channel policy, not a licence check or a signature verifier.
- Without a rule, `output/final-*` and `output/long-*` are `deliveries`;
  all other media are `other` and are kept by default. Assign known,
  receipt-backed loop frames, atlases, chains and soundtracks to `derived`
  explicitly; the runtime does not guess whether an unknown asset is
  reproducible. `paid`, `approved`, `archive` and `masters` can also
  be assigned with rules, without changing the lock format.
- `forcePathStyle` defaults to true. `checksum` defaults to true; set it
  false only for a provider without optional S3 SHA-256 request checksums.
  Mandatory local snapshot and download hashing is unaffected.

Push and pull support `--tier all` or a comma-separated/repeated `--tier`.
Their reports include transferred/planned paths and bytes, existing files,
missing files, local changes, ambiguous merged entries, per-path errors and
excluded counts/bytes by tier. Nonzero exit means the selected operation did
not fully succeed. A successful selective transfer is **not** a claim that
every locked file exists locally.

See [running the studio](running.md#channel-media-backup-and-restore) for
commands, provider requirements and a fresh-clone verification procedure.

## What the studio's file browser shows: `.uiignore`

A channel is a repository with code in it, so its tree holds files nobody opens
in the studio. The file browser leaves them out, and its **Show all files**
checkbox brings them back, dimmed. The checkbox says how many it left out, and
the browser remembers the choice.

The rules have `.gitignore`'s syntax and stack, a later layer winning:

1. **The studio's defaults:** `.git/`, `node_modules/`, `.cache/`, `*.tmp`,
   `*.bak.json`, `*.tsbuildinfo`, `Thumbs.db`, and lock files (`*.lock`,
   `*.lockb`, `*.lock.json`, `*.lock.jsonl`, `package-lock.json`,
   `pnpm-lock.yaml`, so `bun.lock`, `kits.lock.json` and `media.lock.jsonl`
   too). They are `DEFAULT_UIIGNORE` in `studio/gateway/src/workspace/uiignore.ts`.
2. **`<channel>/.uiignore`:** the channel's own additions, for everything in
   the channel.
3. **`<series>/.uiignore`**, and a `.uiignore` in any folder below: for that
   folder and what is inside it.

A pattern can bring back something an earlier layer left out:

```gitignore
# library/<channel>/.uiignore
# Leave out the channel's drafts,
drafts/
# but show the media lock.
!media.lock.jsonl
```

As in `.gitignore`, a comment takes a line of its own.

A folder that is left out is not opened, so nothing inside it can be brought
back, as with git. A `.uiignore` is a text file like any other: open it in the
studio, edit it, save, and the tree follows. Only the listing reads these
rules; the agent, the runtime and the file routes still reach every file.
