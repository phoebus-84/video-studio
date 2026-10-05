# ADR-0035: Shared material is pinned, never copied

## Status

Accepted. Contract: `SourcePin` (`studio.video/v1alpha1`) in `studio/contracts`;
runtime check in `studio/runtime/src/execution/pins.ts`; `vpr pin`.

## Context

Some material is made once and used by several series: a poem's text,
illustrations, recital take and word timing serve both the short and the long
of one channel. Copying it into each episode makes the copies drift; reading
it in place lets a later edit silently change an episode that was already
reviewed. The Source Snapshot idea ("prevents later source changes from
silently altering an episode") existed only for texts and repositories, and
staleness only between stages of one episode.

## Decision

- Shared material lives in a channel source, `library/<channel>/sources/<name>/`,
  a channel knowledge folder. An episode may also use another episode of the
  same channel as a source. Cross-channel pins are not allowed.
- An episode **pins** what it reads: `source/pins/<id>.json` names the source,
  optionally the paths within it, the stages that read it (`usedBy`), and an
  inventory of every file (hash, size, mtime). An episode's runtime state
  (journal, attempts, reviews, output) and hidden names are never part of it.
- Computing status verifies every pin cheaply — stat every file, hash only
  those whose size or mtime moved — and reports the readers and everything
  downstream of them as stale, naming the changed files. Status writes nothing.
- Accepting a new version is **renewal**: the inventory is rewritten and a
  `staleness-marked` event (trigger `pin:<id>`) keeps the affected stages stale
  until they run again. Renewal hides nothing, so any actor may renew; the
  journal records who.

## Consequences

A changed source can never silently alter an episode: it is either reported as
stale or explicitly renewed and redone. Status costs one stat per pinned file
per poll. Pins are created and renewed from the CLI today; web and agent tools
can call the same service methods later.
