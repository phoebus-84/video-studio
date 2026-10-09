# ADR-0045: A channel is its own repository; its media are named by hash

## Status

Accepted (`avg-d1x`, phase 5). Implemented:
- `vpr channel init` and `vpr channel media`;
- `media.lock.jsonl`.

## Context

ADR-0041 to ADR-0044 moved a channel's procedures into its library: its series' compilers and validators, its kits, its releases. The library is gitignored production data, so that code had no history and no backup.

The operator also wants several people to work on the same channel. A channel weighs about 1.7 GB of media against about 10 MB of text, and the media can't go into git. A storage for them is a later study.

## Decision

**Each channel is its own git repository, versioning its text. Its heavy media are named by hash, not stored.**
- **`vpr channel init <channel> [--commit]`** makes `library/<channel>/` a repository. A repository, `.gitignore` or `.gitattributes` already there is kept as it is.
  - **`.gitignore`** leaves out the heavy media (pictures, audio, video, fonts, `.blend`, `.zip`, in any letter case), what a machine makes for itself (`.cache/`, `node_modules/`, `*.tmp`) and the timeline backups a rebuild leaves (`*.bak.json`), whose role git takes over. When a `.gitignore` is kept, `init` lists the media it would let into git.
  - **`.gitattributes`** merges the stage journals (`**/journal/*.jsonl`) and the media lock by union: two people's lines merge without a hand. It marks sealed `*.cjs` bundles as generated. When one is kept, `init` warns of a missing union rule.
  - **`--commit`** commits everything in a repository `init` made, but only its own files in one it found, never the person's other work. With nothing new, it commits nothing.
- **`media.lock.jsonl`** at the channel's root names every heavy file, one JSON line each: its path (NFC, `/`-separated), `sha256` and size. A symlink is named by where it points, never followed. It is versioned with the work that made the files.
  - **It is shared, so it never forgets.** `vpr channel media <channel>` names every file on this machine and keeps every line naming a file this machine lacks: another person's media, not fetched here. `--prune` forgets those, for files deleted on purpose.
  - **It merges by union.** Two people naming new media add different lines. One file named differently on two sides shows twice; `--check` accepts either, and the next `vpr channel media` keeps the bytes on disk.
  - It hashes in chunks, so a file of any size, and only what moved, thanks to a hash cache in `.cache/` keyed by size and mtime, local to this machine. `--verify` ignores the cache.
  - `vpr channel media <channel> --check` compares this machine with the lock and writes nothing. It reports what is **missing** (to fetch after a pull), **changed** (not the bytes named) and **unlisted** (not yet named), and exits 2 unless all match.
- **What makes it shareable already:**
  - **Sealed releases** (themes, templates, kits) never change, so they never conflict.
  - **Specs** carry a revision.
  - **Takes, timings, timelines, pins and render reports** already name their media by hash.
  - **Journals** merge by union.

## Consequences

- **Pulling.** A collaborator who pulls has every release, spec and record. `channel media --check` lists the media to fetch. A content-addressed store keyed by these hashes is the storage issue.
- **Approvals.** They are signed with one shared operator key (an HMAC). Two people verify each other's approvals only by sharing that key, and an approval does not say whose it is. Per-person signatures are a separate issue: each operator with a key pair, the channel listing whose approvals it trusts.
- **Working the repository.** `git` is used as it is: commit, push, pull, branch. The studio doesn't wrap it.
