# Channel sources and source pins

**Issue:** `avg-7zp.5` — pin assets and data from another episode or a shared source (ADR)
**Epic:** `avg-7zp` — contracts for word-anchored, layered production (the `cs-port` plan)
**Related:** [narration takes](2026-10-05-narration-takes-design.md); `docs/context.md` "Source Snapshot"; ADR-0003 (filesystem-first state); the runtime's staleness (`studio/runtime/src/staleness/`, `staleness-marked` events)
**Date:** 2026-10-05

## Problem

A poem's material — its text, illustrations, recital take, word timing,
sounds — is made once and used by two series (the short and the long of
"Dentro i versi"). CreativeStudio calls it the poem's *source* (UP-57):
whoever comes first creates it, whoever comes later reuses it read-only, and
an SHA inventory proves it has not changed.

video-studio has the idea — a **Source Snapshot** is "a read-only,
revision-pinned capture … that prevents later source changes from silently
altering an episode" — but only for texts and git repositories, and nothing
in the runtime watches material outside an episode. Staleness today is
between the stages of one episode only.

## Decisions taken with the user

1. **Shared sources live at channel level**, in a new channel knowledge
   folder `library/<channel>/sources/<name>/`. The material belongs to no
   series; both pin it. An episode may also pin another episode of the same
   channel.
2. **Contract plus a runtime check.** A pin carries an inventory; computing
   status re-checks it; a changed source makes the stages that read it, and
   everything downstream, stale. Accepting the new version is an explicit,
   journaled act.

## Design

### Layout

- `CHANNEL_KNOWLEDGE` (in `studio/contracts/src/layout.mjs`) gains `sources`.
  `sourcePath(root, channel, name)` returns
  `<root>/<channel>/sources/<name>`. `docs/workspace.md` shows it.
- A channel source is ordinary material (e.g. `takes.json`, `timing/`,
  `assets/`); it has no runtime state of its own.

### The pin — `SourcePin`, `<episode>/source/pins/<id>.json`

```jsonc
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "SourcePin",
  "id": "poesia",
  "source": { "kind": "channel-source", "name": "il-lampo" },
  "paths": ["takes.json", "timing", "assets/takes"],
  "usedBy": ["compile", "narration"],
  "pinnedAt": "2026-10-05T18:00:00Z",
  "files": {
    "assets/takes/recitazione.mp3": { "hash": "sha256:…", "size": 1203344, "mtimeMs": 1759600000000 }
  }
}
```

- `id`: `^[A-Za-z0-9][A-Za-z0-9._-]*$`, unique in the episode (the file name).
- `source`: `{ kind: "channel-source", name }` or
  `{ kind: "episode", series, episode }` — same channel only.
- `paths` (optional): source-relative files or directories to pin; absent
  means the whole source.
- `usedBy`: stage ids of this episode's pipeline that read the source (at
  least one).
- `files`: the inventory, source-relative POSIX paths →
  `{ hash (ContentHash), size, mtimeMs }`. The hash is the truth; size and
  mtime only spare re-hashing on a poll.
- When the source is an episode, its runtime state is never inventoried:
  `journal/`, `attempts/`, `reviews/`, `output/`, and any name starting with
  `.` or `_`. The same exclusions apply to channel sources (only `.`/`_`).

New kind, `schemas/v1alpha1/source-pin.schema.json`
(`$id` `https://video.studio/schemas/v1alpha1/source-pin.schema.json`).
`@studio/contracts` 0.5.0 → 0.6.0.

### Contract functions — `studio/contracts/src/source-pins.mjs`

- `sourceDir(root, channel, source)` → the source's directory
  (`sourcePath` or `episodePath`).
- `inventory(dir, paths?)` → `files` as above, sorted by path, exclusions
  applied; symlinks are not followed (a symlink is an error).
- `verifyPin(pin, dir, { hash })` → `{ changed: [{ path, change: "modified" |
  "added" | "removed" }] }`. Files whose size and mtime match the pin are not
  read. A file whose size or mtime differs is hashed; equal hash means
  unchanged (touched, not edited). Files under the pinned `paths` that are
  not in the inventory are `added`. `hash` is injectable so tests can count
  reads.
- `validateSourcePin(doc)` → `{ code, message, path }[]` (`schema` only; the
  rest needs a filesystem and a pipeline).

### Runtime — status

In `ExecutionService.status()` (`studio/runtime/src/execution/service.ts`),
after the existing derivation:

1. Read `source/pins/*.json` of the episode. A pin that does not validate, or
   whose source directory does not exist, makes its `usedBy` stages stale with
   that reason (never silently ignored).
2. `verifyPin` each pin. A pin with changes marks its `usedBy` stages and
   everything downstream of them (`propagate`) as `stale`, unless the stage
   is already `stale` for another reason; the reason names the source and up
   to five changed paths, e.g.
   `source "il-lampo" changed since it was pinned: assets/takes/recitazione.mp3 (modified), timing/new.json (added)`.
3. Status writes nothing: no journal event, no pin rewrite.

A stage made stale only by a changed pin and re-run without renewing the pin
stays stale: the reason ends with `— renew the pin to accept the new version`.

### Runtime — CLI (`vpr`)

- `vpr pin add <channel>/<series>/<episode> <id> --source channel:<name> | episode:<series>/<episode> --used-by <stage>[,<stage>…] [--path <p>]…`
  — inventories the source and writes the pin atomically. Refuses
  `unknown-source` (directory missing), `unknown-stage` (not in the episode's
  pipeline), `self-pin` (an episode pinning itself), an existing pin id.
- `vpr pin verify <episode>` — every pin and its changes; writes nothing.
- `vpr pin renew <episode> <id>` — re-inventories, writes the pin atomically,
  and appends `staleness-marked` with
  `data: { trigger: "pin:<id>", stageId: "pin:<id>", affected, changed }`,
  where `affected` is the `usedBy` stages and their downstream. Those stages
  then stay stale until they run again, by the existing mechanism. Renewal
  hides nothing — it turns "the source changed" into "these stages must be
  redone" — so any actor may renew; the journal records who.
- All three accept `--json`, like the other commands.

### ADR-0035 — "Shared material is pinned, never copied"

Records: channel `sources/`; episodes pin a channel source or another episode
of the same channel with an inventory; status verifies pins cheaply (stat
first, hash on difference) and reports stale stages without writing;
renewal is explicit and journaled; cross-channel pins are not allowed.

## Testing

- Contract (`node:test`, temporary directories): inventory sorting and
  exclusions; `paths` restriction; symlink refused; `verifyPin` reports
  modified, added, removed; a touched file with identical content is
  unchanged; a poll with no changes hashes nothing (injected `hash` never
  called); `validateSourcePin` on valid and invalid documents; schema
  fixtures in `check:schemas`.
- Runtime (`studio/runtime` tests): an episode with a pin on a channel source;
  editing a source file makes the `usedBy` stage and its downstream `stale`
  with the reason; renewing appends the journal event and the stages stay
  stale; re-running them makes them `completed`; a pin on a missing source
  directory is reported, not ignored.
- CLI: `pin add` (and each refusal), `pin verify`, `pin renew` on a temporary
  library.
- Root `npm run check`.

## Out of scope

- Web and agent tools for pins (status reasons already reach the web).
- Cross-channel pins.
- Creating the poem source itself (`avg-dcf.2`).
