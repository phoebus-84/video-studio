# ADR-0045: A channel is its own repository; its media are named by hash

## Status

Accepted (`avg-d1x`, phase 5). Implemented:
- `vpr channel init` and `vpr channel media`;
- `media.lock.json`.

## Context

ADR-0041 to ADR-0044 moved a channel's procedures into its library: its series' compilers and validators, its kits, its releases. The library is gitignored production data, so that code had no history and no backup.

The operator also wants several people to work on the same channel. A channel weighs about 1.7 GB of media against about 10 MB of text, and the media can't go into git. A storage for them is a later study.

## Decision

**Each channel is its own git repository, versioning its text. Its heavy media are named by hash, not stored.**
- **`vpr channel init <channel> [--commit]`** makes `library/<channel>/` a repository. A repository, `.gitignore` or `.gitattributes` already there is kept as it is.
  - **`.gitignore`** leaves out the heavy media (pictures, audio, video, fonts, `.blend`), what a machine makes for itself (`.cache/`, `node_modules/`, `*.tmp`) and the timeline backups a rebuild leaves (`*.bak.json`), whose role git takes over.
  - **`.gitattributes`** merges the stage journals (`**/journal/*.jsonl`) by union: they are append-only, so two people's events merge without a hand. It marks sealed `*.cjs` bundles as generated.
- **`media.lock.json`** at the channel's root names every heavy file: its path, `sha256` and size, sorted. It is versioned with the work that made the files.
  - `vpr channel media <channel>` rewrites it. It hashes only what moved, thanks to a hash cache in `.cache/` keyed by size and mtime, local to this machine.
  - `vpr channel media <channel> --check` compares this machine with the lock. It reports what is **missing** (to fetch after a pull), **changed** (not the bytes named) and **unlisted** (not yet named), and exits 2 unless all match.
- **What makes it shareable already:**
  - **Sealed releases** (themes, templates, kits) never change, so they never conflict.
  - **Specs** carry a revision.
  - **Takes, timings, timelines, pins and render reports** already name their media by hash.
  - **Journals** merge by union.

## Consequences

- **Pulling.** A collaborator who pulls has every release, spec and record. `channel media --check` lists the media to fetch. A content-addressed store keyed by these hashes is the storage issue.
- **Approvals.** They are signed with one shared operator key (an HMAC). Two people verify each other's approvals only by sharing that key, and an approval does not say whose it is. Per-person signatures are a separate issue: each operator with a key pair, the channel listing whose approvals it trusts.
- **Working the repository.** `git` is used as it is: commit, push, pull, branch. The studio doesn't wrap it.
