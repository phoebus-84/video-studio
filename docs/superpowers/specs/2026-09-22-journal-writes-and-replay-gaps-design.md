# A lost journal event must not be fatal, and a bug must not look like a full disk

**Issue:** `avg-0v5` — `appendJournalEvent` silently drops a malformed execution event
**Source:** raised by the final whole-branch review of `avg-pm8`, sharpened by its fix wave
**Related:** `avg-bk9` (parseJournal validates syntax, not shape), `avg-7he` (existing episodes have no journal)
**Date:** 2026-09-22
**Status:** approved design, not yet implemented

## The problem

`avg-pm8` made execution state a replay of the journal. `avg-tt7`, `avg-2n7`
and `avg-grf` then put every execution path through it. The journal is now the
only record of what ran, and two paths let it lose an event without anyone
failing.

### 1. One unchecked write can make an episode permanently underivable

`studio/runtime/src/execution/service.ts:599` appends `stage-started` and does
not check the return. It is the only execution append in the service that does
not — `stage-leased`, `stage-completed` and `stage-failed` all check theirs.

It is also the one where a dropped write is catastrophic. Replay's transition
table is `pending -> running -> completed`. A `stage-leased` opens the attempt
at `pending`; `stage-started` moves it to `running`; the terminal event closes
it. Drop the middle one and the terminal event attempts `pending -> completed`,
which the table forbids. Measured against the real module:

```
healthy [leased, started, completed]      -> completed
dropped stage-started [leased, completed] -> THROWS: cannot go from pending to completed
dropped stage-started [leased, failed]    -> THROWS: cannot go from pending to failed
```

The journal is append-only, so the throw is permanent. Every later `status`,
`run`, `claim` and `complete` on that episode fails, with no recovery short of
hand-editing the log — which is the one thing an append-only evidence log is
supposed to make unnecessary.

The comment directly above that append says the opposite:

> a dropped `stage-started` or `stage-completed` self-heals (the lease expires,
> the stage becomes retryable)

It has the two events backwards. A dropped `stage-completed` genuinely does
self-heal: the attempt stays open, the lease lapses, `closeIfExpired` closes it
as a timeout, and the stage becomes retryable. That is also the one that is
checked. The catastrophic one is not.

### 2. Two different faults return the same value

`appendJournalEvent` returns `null` when `buildJournalEvent` throws — an
unknown type or actor, a missing episode field, a non-object `data`, a missing
required execution field — and it returns `null` when `appendFile` throws,
which means the filesystem refused.

The first is a code bug: deterministic, identical on every retry, and fixed
only by changing the caller. The second is operational: a full disk, a bad
permission, a path that is not a directory. Today both surface to an operator
as `the journal write for its lease did not land`, which reads as transient and
invites retrying a bug forever.

## Design

### 1. Replay survives a gap it cannot repair

When a terminal event — `stage-completed`, `stage-failed` or `attempt-recorded`
— arrives for an attempt still at `pending`, replay synthesises the missing
`running` transition and records that it did so, rather than throwing.

**This is deliberately not done by widening `VALID_TRANSITIONS`.** The engine's
table and replay's table are byte-identical and pinned by
`studio/runtime/test/unit/engine/transition-table-agreement.test.ts`; that test
must keep passing unchanged. `pending -> completed` does not become a legal
transition. It becomes a *recorded gap*, which is a different statement: the
table still says what a healthy run may do, and the gap says this run was not
healthy.

The attempt gains `startRecorded: false`. Nothing else about it changes —
`startedAt` already comes from the `stage-leased` event, not from
`stage-started`, so the attempt keeps a real timestamp.

The justification is already written in that module, for the neighbouring case:

> because the journal can never be rewritten, it throws on every future replay
> too: one re-run would make that episode's execution state permanently
> underivable

That is the argument for allowing `completed -> pending`, and it applies
unchanged here. With an append-only log a gap cannot be repaired, so throwing
is not failing closed. It is failing dead.

**The mirror case stays fatal.** A terminal event whose `leaseId` matches no
open attempt still throws. There is no attempt record to attach the gap to — no
lease id, no ttl, no holder, no `startedAt` — so tolerating it would mean
inventing an attempt rather than noting a missing event. The asymmetry is the
point: a gap inside a known attempt is survivable evidence; an event belonging
to no attempt at all is not.

### 2. The write contract splits by whose fault it is

`buildJournalEvent` throwing means the caller constructed nonsense. That throw
propagates.

`appendFile` throwing means the environment refused. That still returns `null`.

The documented rationale survives intact, because it was always about the
write:

> Never throws for a caller's benefit — a stage that ran must not be reported
> as failed because its bookkeeping could not be written.

A malformed event is not bookkeeping that could not be written. It is
bookkeeping that was never valid, and no caller benefits from being handed a
`null` for it. The doc comment is rewritten to say which fault does which.

This is the smallest change that stops a bug from wearing a disk failure's
clothes. It is not a discriminated result type: five call sites and one test
depend on the current return, and an option that nothing yet needs to branch on
is a wider change bought for a distinction no caller makes.

### 3. The service checks every write

The `stage-started` append returns `blocked` and dispatches nothing. It does
**not** release the lease: the `stage-leased` event landed, so the journal
already says this stage is held, and dropping the lockfile would leave the two
records contradicting each other. The stage becomes claimable again when the
lease lapses — the same path a process that dies immediately after leasing
already takes.

After this, every execution append in the service is checked:

| append | on a dropped write | why |
|---|---|---|
| `stage-leased` | release the lease, return `blocked` | the write did not land, so the journal says nothing about this stage; releasing is what keeps the lockfile and the journal agreeing |
| `stage-started` | return `blocked`, leave the lease to lapse | the lease event DID land, so the journal says the stage is held; releasing would make the two disagree |
| `stage-completed` | return `unrecorded`, leave the lease to lapse | same reason, and the work has already happened |
| `stage-failed` | return `false`, leave the lease to lapse | same |

An earlier draft of this table gave `stage-leased` and `stage-started` the same
treatment and the same reason, "nothing recorded, nothing ran". For
`stage-started` the first half is false, and it is the half that decides: the
lease event is in the log. The dividing line is not whether work has run, it is
**whether the journal already claims the stage**, and `stage-leased` is the only
append where it does not.

The comment above the `stage-leased` check is corrected: it currently names
`stage-started` as self-healing, which this design's first section shows it is
not.

### 4. The gap is visible

`StageStatusReport` gains `gaps?: string[]` — plain sentences such as
`attempt 1 has no recorded start`, in the same spirit as `stateReason`, which
exists so a caller can show the reason verbatim.

Recording a gap only where replay can see it is not recording it. An operator
looking at `vpr status` should be able to tell a stage that completed cleanly
from one whose history has a hole, because the second one means a write was
lost on that machine and something else may have been lost with it.

Absent when there is nothing to say, like `stateReason`.

## Testing

**Replay, the three terminal types.** `stage-completed`, `stage-failed` and
`attempt-recorded` each arriving on a `pending` attempt: the state derives, the
stage reaches the status the event names, and the attempt carries
`startRecorded: false`.

**Replay, the healthy path is unchanged.** A full `leased, started, completed`
sequence produces an attempt with no `startRecorded` field at all — the marker
appears only where there is a gap.

**Replay, the mirror case still throws.** A terminal event whose `leaseId`
opens no attempt raises, with the existing message.

**The agreement test passes unchanged.** Not a new test: the point is that
`studio/runtime/test/unit/engine/transition-table-agreement.test.ts` is not
touched and still passes, which is what proves the tolerance was not bought by
widening the table.

**Contracts, the two faults.** A malformed event throws — the existing test
`reports rather than throws when the event is malformed` inverts, and its
comment is rewritten to say why the never-throw promise never covered this. An
unwritable journal still returns `null`; that test is unchanged.

**Service, the dropped `stage-started`.** With an append that succeeds for
`stage-leased` and fails for `stage-started`, `claim` returns `blocked`, the
dispatcher is never called, the lock is released, and the journal contains the
lease event and nothing after it.

**Status, the gap surfaces.** A journal written with `stage-leased` and
`stage-completed` and no `stage-started` reports the stage as completed with
`gaps` naming the attempt.

## Scope

**In:** replay's tolerance of a missing `stage-started` and the
`startRecorded` marker; `appendJournalEvent` throwing on a malformed event;
the service's check on its fourth append and the corrected comment; `gaps` on
`StageStatusReport`.

**Out:** `parseJournal`'s event-shape validation (`avg-bk9`) — this design
concerns events the writer loses, not events a reader mis-admits. The journal's
durability guarantee, sequence numbers and hash chain, all still filed against
`avg-pm8`'s follow-ups. `artifactExists` (`avg-t7i`).

## Risks

**A tolerated gap is still a lost write.** Nothing here makes the machine more
reliable; it makes a lost event survivable and visible instead of fatal and
silent. If `gaps` starts appearing on real episodes, the right response is to
find out why writes are failing, not to note that the system coped.

**`startRecorded` is a second way to ask what an attempt did.** `outcome`
already says how an attempt ended. A reader could reasonably expect one field
to describe an attempt's health and find two. The mitigation is naming: this
field says whether one specific event was recorded, and nothing else. It is not
a health score and should not grow into one.

**The engine's state machine is untouched by section 1**, so a live run still
cannot go `pending -> completed` in memory. That is correct — the service always
writes `stage-started` before completing, and section 3 makes it stop if that
write fails — but it does mean the two tables stay equal while replay handles a
case the engine refuses. The agreement test pins the tables, not the handling,
and the difference is worth stating plainly rather than discovering later.
