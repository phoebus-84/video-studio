# Task 7 report — the gateway's remaining execute paths on the execution service

Branch `grf-cli-and-agent-on-the-service`, on top of `504b0c1`.

Every gateway path that executes a stage or reports on one now goes through
`@studio/runtime`'s `ExecutionService`, composed once in a new
`studio/gateway/src/runtime/service.ts`. Seven call sites moved: the
single-stage execute, `/execute`'s inline composition, `/status`,
`/rerun-plan`, the two new claim/complete routes, the episode-detail
enrichment in `routes/workspace.ts`, and the poll in `events/publisher.ts`.

---

## Changes per file

### `studio/gateway/src/runtime/service.ts` — new

`makeExecutionService(log, libraryRoot?)`, the gateway's one composition:
the real `GatewayDispatcher`, the real `GatewayReviewGate`, the pass-through
budget guard, `holder: gateway/pid-N`, a 15-minute lease TTL (overridable via
`AVG_CLAIM_TTL_MS`), and `builtinPipelines: builtinPipelinesPath() || undefined`
with the comment explaining why the `|| undefined` has to be there.

Two additions to the brief's version:

- **`DEFAULT_PIPELINE`** is exported from here rather than repeated as a
  string literal. Eight call sites now default to a pipeline when neither the
  request nor the episode names one; `routes/workspace.ts` used to default to
  `"fairy-tale-adaptation"` while `production.ts` defaulted to
  `"narrated-illustrated-video"`, so the episode list and the production panel
  could report on two different pipelines for the same episode. One constant
  closes that.
- **An optional `libraryRoot` parameter.** The routes omit it and take
  `AVG_LIBRARY_ROOT ?? "./library"`, which is what the brief specifies and what
  `/execute` already did. `server.ts` resolves
  `AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library"` and passes the
  answer to the `EventPublisher`, which is a long-lived collaborator rather
  than a request handler: without it, a gateway configured purely through
  `libraryRoots` would have the publisher polling a `./library` nobody put
  anything in. (The routes keep the env-only default; see *Concerns* — that
  divergence is pre-existing and is not fixed here.)

### `studio/gateway/src/routes/production.ts`

- Imports: dropped `ExecutionService`, `GatewayDispatcher`, `GatewayReviewGate`,
  `builtinPipelinesPath`; added `makeExecutionService`, `DEFAULT_PIPELINE`, and
  the `RerunMode` type.
- `/execute`: the 17-line inline composition is one `makeExecutionService`
  call. The loop is untouched, including `if (outcome.value.status !== "completed") break;`
  — confirmed by reading that it halts on every status it does not know how to
  continue past, which now includes `claimed`.
- **Single-stage execute** now calls `service.run(ref, pipeline, { stage, dryRun })`
  and returns `{ ok: true, outcome }` / `{ ok: false, error }`. It previously
  shelled out to `vpr run`, which printed `Ready to execute: <stage>` and
  exited 0 — the studio's Run Stage button reported success and nothing had
  happened.
- **`/stages/:stage/claim`** — new. Leases and records the start; returns the
  `StageOutcome`, whose `leaseId` and `expiresAt` the caller needs.
- **`/stages/:stage/complete`** — new. Accepts `outputs`, `leaseId`, `failed`,
  `error`, and **forwards `leaseId`**. Its description says the caller should
  pass the one `claim` returned and why: `complete()` without a lease id closes
  whatever open claim it finds, so a performer whose lease lapsed could close a
  second holder's claim. The CLI is excused because a human cannot recover a
  lease id (`LeaseState` carries no id); an HTTP caller has the claim response
  in hand and is not. A completion with neither outputs nor `failed` is refused
  before the service is touched.
- **`/status`** now calls `service.status`, keeping the
  `{ ok, data: { pipeline, stages } }` envelope the studio reads
  (`studio/web/src/lib/production-store.svelte.ts` reads `res.data.stages`).
  No response schema is declared on this route and none was added — Fastify
  strips properties a response schema does not list, and an out-of-date one
  would silently delete `state` and `stateReason`.
- **`/rerun-plan`** now calls `service.planRerun(ref, pipeline, mode ?? "retry-current", stageIds ?? [])`
  and returns `{ ok, plan }` / `{ ok, error }`. Schema enum fixed (see below).

### `studio/gateway/src/routes/workspace.ts`

`registerWorkspaceRoutes` no longer takes a `RuntimeClient`; the episode-detail
enrichment builds the same service the `/status` route does. The published key
stays `id` (that is what `studio/web/src/lib/episode-store.svelte.ts` reads);
what changed is that it is now populated, from `s.stageId`. `name` falls back
to the id only when the manifest gives none, and `status` is the report's
pipeline-aware `state`. The `runtime` argument is gone from
`routes/index.ts:102`.

### `studio/gateway/src/events/publisher.ts`

Polls `service.status()` instead of `RuntimeClient.status`. The local
`StageState` interface is `{ stageId, state }`, the cross-poll match is
`previous.find(p => p.stageId === s.stageId)`, and the published payload is
`stageId: s.stageId`. `start()` no longer takes a `RuntimeClient` and the
`(this as any)._runtime` stash is gone, so `pollForEpisode` works whether or
not `start` was called. Options gained `libraryRoot`.

One behaviour change beyond the rename: the event-type map used to send
`stage.started` for `state === "runnable"`. Under the execution service's
vocabulary `runnable` means "a claim would be accepted", not "work has begun";
`running` is a live lease. `stage.started` is now emitted for `running`, and
`runnable` falls through to `stage.changed`. Keeping `runnable` would have had
the gateway announce that a stage had started the moment its last dependency
completed.

### `studio/gateway/src/server.ts`

`new EventPublisher({ bus, libraryRoot })` and `publisher.start(watcher)`.

### `studio/gateway/src/rpc/intent-router.ts`

The `rerun` intent's default mode is `retry-current`, was `rerun-affected`.

### `studio/gateway/test/single-stage-route.test.ts` — new, 20 tests

---

## How each of the three status consumers moved, and what covers it

| Consumer | Before | After | Coverage added |
|---|---|---|---|
| `routes/production.ts` `/status` | `runtime.status` → `vpr status` JSON | `service.status`, same `data` envelope | `GET /status`: "reports pending for a stage with artifacts and no journal" (a `brief.md` on disk does **not** make `brief` completed) and "names its stages stageId, and carries state and produces through" (asserts `stageId` is a string on every stage, plus `state`, `stateReason`, `dependsOn`, `produces` survive the wire) |
| `routes/workspace.ts` episode detail | `runtime.status`, mapping `id: s.id` — always `undefined` since Task 5 | `service.status`, mapping `id: s.stageId` | "names every stage, rather than shipping a list of undefined ids" — asserts ids are strings and include real stage ids, and that `name`/`status`/`dependsOn` are populated. Plus "falls back to the workspace's own stages when the pipeline cannot be resolved", which pins the catch branch |
| `events/publisher.ts` poll | `runtime.status`, matching `p.id === s.id` (undefined === undefined ⇒ every stage matched the first) and publishing `stageId: undefined` | `service.status`, matching on `stageId` | "names the stage that moved, and only that stage" — baseline poll publishes nothing; after `brief` completes, an event names `brief` with `previousState: runnable`/`newState: completed`, no event carries `stageId: undefined`, and the stage that unblocked as a consequence (`script`) is reported as itself. Plus "publishes nothing while nothing changes" and "starts and stops without a runtime client" |

The field rename could not have happened silently after this: each of the three
asserts on a real stage id coming out the far end of the HTTP/bus boundary.

**Evidence the tests bite.** The whole file was run against the pre-change
source (`git stash` of `studio/gateway/src`): **17 of 20 failed**. The three
that passed are the workspace fallback case (which the old code reached by
having no runtime at all), "publishes nothing while nothing changes" (vacuous
under the old code, kept as an anti-regression guard), and "starts and stops"
(a signature check). The status/claim/complete/rerun-plan routes returned 500
or 404, the episode detail returned no `stages` array, and the publisher
published nothing.

---

## Modified pre-existing assertions

**None.** No existing test file was edited. The 17 gate-enforcement tests (26
in that file overall) pass untouched, as do the other 271. Totals went
297 → 317, all additions.

Three pre-existing *source* behaviours changed, each justified above rather
than accommodated:

1. `routes/workspace.ts` default pipeline `"fairy-tale-adaptation"` →
   `DEFAULT_PIPELINE` (`"narrated-illustrated-video"`), so it agrees with every
   other path about the same episode.
2. `publisher.ts` `stage.started` now keys off `running`, not `runnable`.
3. `/rerun-plan` rejects `rerun-affected` with a 400 instead of forwarding it
   (see below).

---

## Test commands and output

```
$ npm run build -w @studio/runtime
> tsc
                                   (no changes were made under studio/runtime;
                                    built anyway because the gateway's routes
                                    shell out to its dist/)

$ npm test -w @studio/gateway
 Test Files  27 passed (27)
      Tests  317 passed (317)

$ npm run typecheck -w @studio/gateway
> tsc --noEmit
                                   (clean)

$ npm test -w @studio/runtime
 Test Files  39 passed (39)
      Tests  501 passed (501)
```

`npm run lint -w @studio/gateway` fails on this branch before any of my
changes: ESLint 9 finds no `eslint.config.js` and the package still carries an
`.eslintrc`-era script. Pre-existing, not touched.

### A pre-existing flake, run down rather than waved at

Roughly one gateway run in six reports `Test Files 1 failed | 26 passed (27)`
while still reporting `Tests 317 passed (317)`. The failure is:

```
 FAIL  test/integration.test.ts > Gateway Integration
Error: Hook timed out in 30000ms.
```

— the suite's `beforeAll`, which boots a real server on a real port, occasionally
exceeding the 30 s `hookTimeout` `vitest.config.ts` sets. No assertion fails.

**It is not mine.** I checked out `504b0c1` over `studio/gateway`, deleted the
two new files, and ran the suite eight times: **2 of 8 failed, identically**
(`/tmp/base-1.txt`, `/tmp/base-7.txt` — same file, same hook, same message).
With this task's changes the rate over six runs was 1 in 6. Same defect, same
frequency, present before the branch.

Separately, `EventPublisher.start()` fires a poll it does not hand back, which
in the new "starts and stops" test would race `afterEach` deleting the temp
library. That is a real race in my own test and it now waits 50 ms; it is not
the flake above, which lives in `integration.test.ts` and predates it.

---

## What the brief got wrong

1. **Scope.** It named one consumer of the status projection. There are three,
   and two of them (`routes/workspace.ts:94`, `events/publisher.ts:77`) were
   already broken at HEAD by Task 5's rename — `id` undefined everywhere, and
   in the publisher's case every stage matching the first and every event
   naming nothing. Neither had a test. `/rerun-plan` was also missing from the
   brief and had to move, since Task 8 deletes `RuntimeClient.rerun`.

2. **`ErrorCode.VALIDATION_FAILED` does not exist.** `studio/gateway/src/errors/index.ts`
   has `VALIDATION` and `BAD_REQUEST`. Used `VALIDATION`.

3. **`GatewayError`'s constructor is not positional.** It takes
   `{ code, message, correlationId?, details?, statusCode? }`. The brief's
   `new GatewayError(ErrorCode.X, "msg")` would not compile.

4. **The `illustrations` seed trap, confirmed.** The brief seeds
   `["brief","script","art-direction","terminal-recordings"]`.
   `studio/pipelines/pipelines/narrated-illustrated-video.yaml` has
   `illustrations` depending on `art-direction` alone; `terminal-recordings` is
   a sibling behind the same dependency and seeding it proves nothing. Worse,
   the brief's seed omits what the stage actually needs: `handleIllustrations`
   reads `assets/images/`, and with that directory empty the run comes back
   `failed` ("the stage produced no outputs"), not `awaiting_review`. The test
   seeds `brief, script, art-direction` and writes one `assets/images/s1.png`.

5. **The brief's status test reads `res.json().stages`.** The envelope is
   `res.json().data.stages`, which the task instructions correct and the
   studio depends on.

6. **"Fix the enum to the three supported modes, and let `rerun-affected-downstream`
   reach the service"** is self-contradicting: a three-member enum makes
   Fastify 400 the fourth before the handler runs. Read as: list the four real
   `RerunMode` members and drop the phantom. The enum is now
   `["retry-current", "rerun-selected", "rerun-affected-downstream", "full-rebuild"]`;
   three are computed, and `rerun-affected-downstream` reaches the service and
   comes back `MODE_UNSUPPORTED`, which is asserted. Declared-and-refused is the
   honest pairing — dropping it from the schema would answer "no such mode" to
   a mode that exists and is planned (avg-33r).

7. **Auth.** The brief's test sketch passes a bearer token. The gateway's auth
   is a global `preHandler` installed in `server.ts`, not by
   `registerProductionRoutes`, so a test that registers the routes on a bare
   Fastify has nothing to authenticate against — which is why
   `gate-enforcement.test.ts` passes no token either. The new file matches it.

8. `production.ts`'s status route is at :273 and the single-stage route at
   :163, not the line numbers the brief gives; it was written against an older
   revision.

---

## Concerns for the next tasks

- **`studio/gateway/src/routes/runtime.ts`** still calls `runtime.status`,
  `runtime.run` and `runtime.rerun` at :90, :114 and :138 — a raw debug proxy
  registered at `routes/index.ts:105`. Task 8 deletes those three methods, so
  those endpoints have to go or be re-pointed with them. Out of this task's
  scope; flagging because Task 8's "remove `RuntimeClient.status` entirely" will
  not typecheck until they are dealt with.
- **`/status`'s error is now an object, not a string.** The studio does
  `/pipeline not found/i.test(res.error ?? "")` to decide `needsSnapshot`
  (`production-store.svelte.ts:80`); against `{ code, message }` that test
  stringifies to `[object Object]` and always fails. It was already fragile —
  the service's message is `Pipeline "x" resolved to no stages` — but Task 9
  should switch it to `res.error?.code === "PIPELINE_UNRESOLVED"`.
- **`studio/web/src/components/status/StalenessPanel.svelte:80`** posts
  `mode: "rerun-affected"` to `/rerun-plan`, which now returns 400 instead of
  being forwarded to a CLI that shrugged. `AppShell.svelte:85`,
  `CommandPalette.svelte:98` and `production-status.ts:212` carry the same
  string. Task 9's territory; the 400 is the correct answer to a mode that
  never existed, but the studio needs to stop sending it.
- **The routes' library root still ignores `config.libraryRoots`.** They take
  `AVG_LIBRARY_ROOT ?? "./library"`, while `server.ts` resolves
  `AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library"`. Pre-existing in
  `/execute` and now shared by six more call sites through one function —
  which at least means it is now fixable in one place. The publisher takes the
  server's resolved root explicitly; the routes could be given it the same way
  by threading it through `registerProductionRoutes`.

---

# Review round 2

Two findings from the coordinator, plus two of the four minors. Commit: see
`git log` following `12fca45`.

## CRITICAL — the migrated routes lost the server-resolved library root

**Upheld, and it was worse than my report said.** I had written the divergence
off as "pre-existing in `/execute`". It is pre-existing *for `/execute`* and a
**regression for the other four**: `/status`, the single-stage execute and
`/rerun-plan` previously reached the library through `RuntimeClient`, which
`server.ts:56` constructs with
`path.resolve(AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library")`.
They honoured `config.libraryRoots`. `makeExecutionService` defaulted to
`AVG_LIBRARY_ROOT ?? "./library"` and dropped it, and the two new claim/
complete routes shipped with the same defect.

Nothing in the repo sets `AVG_LIBRARY_ROOT`; `studio/gateway/config.json` sets
`libraryRoots: ["../../library"]`. So under `npm run dev -w @studio/gateway`
the configured root is `<repo>/library` and the service read `<cwd>/library`.
A claim leased and journaled a stage into the shadow tree while the configured
episode directory stayed empty, and `/status` — reading the same shadow tree —
reported a fully unstarted episode for a half-produced one. Calling that a
display problem was wrong: the journal is the service's only record of what
ran, and this whole epic exists to make it authoritative.

**Fix.** The server's resolved root is threaded through, the way it already
was for `EventPublisher`:

- `registerRoutes(app, config, libraryRoot, workspace, runtime, …)` — a new
  **required** third parameter, not optional, with the reasoning above on it.
  One caller, `server.ts:168`, which already has the value at :56.
- `registerProductionRoutes(…, { libraryRoot })` — on the existing options bag,
  so `gate-enforcement.test.ts`'s four-argument call is untouched.
- `registerWorkspaceRoutes(app, workspace, libraryRoot)`.
- Inside `production.ts`, one `serviceFor(request)` helper closes over
  `options.libraryRoot` and all six handlers call it. Six inline
  `makeExecutionService` calls were six chances to forget the argument —
  the same reasoning that put the composition in `runtime/service.ts` in the
  first place.

`makeExecutionService`'s env fallback stays for callers that mean it (tests
stubbing `AVG_LIBRARY_ROOT` around a temp tree); `registerRoutes` always
supplies the root, so no production path reaches the fallback.

**Pinned, and the pin covers the whole file rather than one test.**
`appWithEpisode()` now passes the temp library as `{ libraryRoot }` *and*
stubs `AVG_LIBRARY_ROOT` to a **different** throwaway directory. Any handler
that falls back to the environment writes where no assertion looks. Two
dedicated tests state the property directly:

- *"writes the journal into the root it was given, not the one in the
  environment"* — claims over HTTP, then asserts the journal is under the
  configured root, **not** under the decoy and **not** under
  `<cwd>/library/...`. The write path, which is the one that corrupts.
- *"reports status from the root it was given"* — the read half: a seeded
  `brief` reports `completed`, not `pending`.

**Mutation check:** dropping `options.libraryRoot` / `libraryRoot` from the two
`makeExecutionService` call sites fails **10 tests**, including both pins.

## IMPORTANT — `leaseId` forwarded but not required

**Upheld.** The description said a caller had no excuse to omit it and the
schema left it optional, so an HTTP caller still got close-whatever-you-find.

Now refused before the service is touched, with a message naming the reason.

**One deliberate widening of the instruction, flagged rather than slipped in:**
the review said "required for non-`failed` completions". I required it for
**every** completion, `failed` included. A `failed` completion appends
`stage-failed` against the claim it closes, so an omitted lease id fails
somebody else's live attempt — the identical hazard, and arguably worse than
the outputs case since it burns a retry. Nothing legitimate needs the looser
path: a genuinely abandoned claim self-heals when its lease expires, and
`complete()` refuses a lapsed attempt anyway. Both routes are new, so nothing
breaks. Narrowing it back to non-`failed` is a one-line change if you disagree
— delete the `failed` half of the comment and guard the check with
`!body.failed`.

Enforced in the handler rather than by adding `leaseId` to the schema's
`required`, so the refusal reads as one sentence about why instead of as a
schema violation naming a field the caller has never heard of.

Two tests: *"refuses a completion that names no leaseId"* and *"refuses a
failure report that names no leaseId"*. Both also assert the open claim is
left at `[stage-leased, stage-started]` — nothing was closed on a guess.

## Minor 1 — the no-op `roots.push()`

Deleted. It was left over from an earlier shape of the helper.

## Minor 3 — the workspace enrichment ran unguarded and swallowed failures

**Guard restored**, as the presence of `libraryRoot`: a caller that supplies no
library is a caller with no execution service behind it, and must not pay for a
pipeline resolution and a journal read on every episode-detail request to be
told so. Exactly equivalent to the old `if (runtime)` — that was always true in
production too, and only ever excused embedders and tests.

**Failures logged, not discarded.** A non-ok status now logs
`episode detail: no pipeline status for <ref> (<code>: <message>); showing the
workspace's own stages` at `warn`, and the catch logs the thrown message the
same way. The fallback is still correct — an episode whose pipeline will not
resolve still has a detail page — but a silent one turns "this pipeline is
misspelled in the series manifest" into "the studio shows stale stages and
nobody knows why".

Test: *"does not resolve a pipeline for a deployment that configured no
library"*.

## Minors 2 and 4 — skipped as directed

The bare-Fastify error-shape assertion and `publisher.ts`'s hardcoded default
poll target (`childrens/fairy-tales/little-red`) are untouched. Both
pre-existing.

## Verification

```
$ npm run typecheck -w @studio/gateway
> tsc --noEmit                        (clean)

$ npm test -w @studio/gateway
 Test Files  27 passed (27)
      Tests  322 passed (322)         (317 + 5 new; 297 pre-existing untouched)

$ npm test -w @studio/runtime
 Test Files  39 passed (39)
      Tests  501 passed (501)
```

Nothing under `studio/runtime` was touched in this round, so no rebuild was
needed; the suite was run regardless. No `integration.test.ts` flake in this
round's runs — see `avg-82z`, re-run rather than chase.

## Concerns retired

The fourth bullet of the original *Concerns* section — "the routes' library
root still ignores `config.libraryRoots`" — is closed by the Critical fix
above, for all six routes including `/execute`. The remaining three
(`routes/runtime.ts` for Task 8; the `/status` error shape and the phantom
`rerun-affected` in the studio for Task 9) stand.
