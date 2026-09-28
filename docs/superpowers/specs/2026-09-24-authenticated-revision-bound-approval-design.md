# An approval must say who gave it, and prove it

**Issue:** `avg-qr4.3` — implement authenticated revision-bound human approval
**Absorbs:** the staleness third of `avg-33r` (candidates, atomic selection, staleness propagation)
**Source:** `docs/harness-review.md`, "P0 — Human approval needs an authenticated, revision-bound origin"
**Related:** `avg-qr4.6` (take selection), `avg-qr4.8` (OS isolation), `avg-2n7` and `avg-grf` notes on qr4.3
**Date:** 2026-09-24
**Status:** approved design, not yet implemented

## The problem

### 1. Anyone can mint a human approval

`pva_approve` in `studio/agent/src/pipeline-tools.ts` POSTs to the gateway's
`/approve` route. That route shells out to `vpr approve`
(`studio/gateway/src/runtime/client.ts:135`), and `cmdApprove`
(`studio/runtime/src/cli.ts:507`) writes `actor: "human"` unconditionally. The
browser and Pi authenticate with the same bearer token, so the gateway cannot
tell them apart even if it wanted to.

The harness review's acceptance line — *an agent-only call cannot satisfy a
human gate* — fails today by construction.

### 2. The journal line proves nothing

Even with an honest API, an `approval-granted` line is plain JSONL. Pi runs as
the same OS user with shell and file tools; anything that can append to
`journal.jsonl` can write a line the review gate will accept. Authentication at
the API alone moves the forgery one step sideways, it does not stop it.

### 3. Half the binding exists

`avg-qr4.1` bound an approval to sha256 hashes of the outputs it covered, and
`deriveGateState` (`studio/contracts/src/gate-review.mjs`) re-hashes on every
read, so a re-render invalidates. That part is sound and stays. What is missing
is a binding to the *plan* — a changed capability, gate or dependency list does
not invalidate an approval — and any notion of who decided.

### 4. Five stages cannot run, and nobody is asked

`avg-2n7` made `gates.autopilot: false` real and refused it at `claim()`. There
is no way for a caller to say "a human is attending", so `script`, `compose` and
`safety-review` are unrunnable from every caller, including a person typing
`vpr run --stage script`. And since the old gateway loop was deleted, nothing
writes `approval-requested`: the journal no longer says "this is awaiting you".
There is also no way to reject — `GATE_DECISIONS` is `requested | approved`.

### 5. Staleness is computed nowhere

`propagate` in `studio/runtime/src/staleness/` has no production caller, and
the `staleness-marked` event is never written. `rerun-affected-downstream`
returns `MODE_UNSUPPORTED` because of it.

## Design

### 1. Two credentials, and a principal on every request

The gateway resolves two 0600 files the way it resolves its token today
(`studio/gateway/src/auth/token.ts`): the existing **agent token** and a new
**operator key**. Either file with group or world permissions refuses startup.

- The browser holds the operator key, entered once, stored where the gateway
  token is stored today.
- The CLI reads the operator key file directly. Running `vpr` as yourself is
  attended.
- Pi receives only the agent token, in the `gateway.connect` handshake. Nothing
  in its environment names the key file.

The auth middleware (`studio/gateway/src/auth/middleware.ts`) stops setting a
bare `isAuthenticated` and sets `request.principal`:

| Credential | Principal |
|---|---|
| operator key | `operator` |
| agent token | `agent` |
| `dev-token` (when allowed) | `agent` — never an operator |

Every existing route accepts `operator` and `agent`. Only three operations look
at the difference: granting a review, rejecting one, and an attended claim.

**Headless.** With no readable operator key the CLI is an `agent` principal.
The CLI never generates the key; only the gateway does, alongside its token.

**The boundary, stated plainly.** A same-user process that deliberately reads
the key file can forge a receipt. This design moves the trust boundary from
"whatever the prompt says" to "whoever holds the key file", which defends
against Pi using its tools and API as intended and against journal tampering.
Isolating Pi from the file is `avg-qr4.8`'s OS-isolation work.

### 2. The receipt

**Events.** `approval-requested` and `approval-granted` exist;
`approval-rejected` is added to `JOURNAL_EVENTS`, `journal.d.mts` and
`journal-event.schema.json`. `GATE_DECISIONS` becomes
`requested | approved | rejected`.

**Fields.** `buildGateReview` gains:

- `origin` — `human | agent | policy`: who *decided*. The journal `actor` still
  says who *wrote the line*; they are different questions and a gateway can
  write a human's decision.
- `binding` — `{ planHash, inputs, outputs }`. `inputs` and `outputs` are the
  sha256 lists `hashArtifacts` already produces. `planHash` is the sha256 of the
  canonical JSON (sorted keys) of the stage's resolved definition, so a changed
  capability, gate, output declaration or dependency list invalidates.
- `signature` — HMAC-SHA256, keyed by the operator key, over the canonical JSON
  of `{ stageId, decision, origin, binding, at }`. Present exactly when
  `origin: human`.

The top-level `inputs`/`outputs` fields move under `binding`; nothing outside
`gate-review.mjs`, `cmdApprove` and their tests reads them.

**Signing lives in contracts.** A new `studio/contracts/src/receipt.mjs`
exports `canonicalJson`, `signReceipt(review, key)` and
`verifyReceipt(review, key)` (constant-time compare). Contracts depends on
nothing in the gateway; the CLI and gateway both import it.

### 3. How the gate reads a receipt

`deriveGateState(events, stageId, episodeDir, { key, planHash })`. The latest
review event for the stage decides:

- `approval-requested` → `requested`
- `approval-rejected` → `rejected`, carrying its note. A rejection must also be
  signed when `origin: human`; an unsigned one reads `invalidated: unsigned`.
  A forged rejection could only block, so this is symmetry rather than safety,
  and symmetry keeps one rule to explain.
- `approval-granted`, checked in order, first failure wins:
  1. `origin: human` and no `key` supplied → `unverifiable`
  2. `origin: human` and no signature → `invalidated: unsigned`
  3. signature does not verify → `invalidated: signature does not verify`
  4. `planHash` differs → `invalidated: the stage definition changed since it was approved`
  5. an artifact hash differs or is missing → `invalidated: "<path>" changed since it was approved` (today's check, unchanged)
  6. otherwise → `approved`, with `origin`

**What satisfies which gate.** `GatewayReviewGate` (and its CLI twin) maps the
state against the manifest's `gates.review`:

| `gates.review` | satisfied by `approved` with origin |
|---|---|
| `human` | `human` |
| `skill` | `human`, `agent` |
| `human-or-skill` | `human`, `agent` |
| `none` | not consulted |

`policy` satisfies nothing yet: no manifest asks for it, and it is carried in
the vocabulary so policy auto-acceptance has a name when it arrives.
`unverifiable`, `invalidated` and `rejected` are all `outstanding`, each with its
reason — a person reads why, not just that.

**Legacy records.** Every existing `actor: human` approval is unsigned and now
reads `invalidated: unsigned`. This is intended: those records cannot prove
their origin. Status names the reason; a real operator re-approves once.

### 4. One entry point for reviews

`ExecutionService.review(ref, stageId, { decision, principal, note })` is the
only code that writes a review event. It:

1. requires the stage's latest attempt to be completed with at least one
   output (today's `cmdApprove` refusals, moved here, same messages);
2. hashes the outputs and computes `planHash`;
3. derives `origin` from `principal` — `operator` → `human` (signed),
   `agent` → `agent`;
4. **downgrades rather than refuses** when an `agent` principal asks to
   approve or reject a `review: human` stage: it writes `approval-requested`
   naming the output hashes and returns `{ status: "requested", reason }`.
   Headless and Pi callers stop with an explicit request instead of assuming
   yes, which is the review's acceptance line;
5. writes under the stage's lock, so a review cannot interleave with a re-run
   of the same stage;
6. checks the append, and returns `blocked` if it failed — nothing counts as
   approved on a write that did not land.

`review` returns a `StageOutcome`-shaped result so the CLI and gateway render
it the way they render `run`.

**Status stops guessing.** `status()` used to report every completed reviewed
stage as `awaiting_review`, deferring to this issue what an approval is. It now
asks the review gate: `approved` reports `completed`; anything else reports
`awaiting_review` with the gate's reason as `stateReason`.

### 5. Attended claims

`claim()` and `run()` accept `principal`. The `autopilot: false` wall in
`service.ts` opens only for `operator`; the refusal for `agent` keeps its
current message and adds "sign in as the operator to take this stage". The
`stage-leased` event records `attended: true` for an operator claim, so the
journal shows a human took the stage. An attended lease expires like any other.

### 6. Requests are written again

When a stage with `gates.review !== "none"` completes, the service writes
`approval-requested` naming the output hashes, after `stage-completed`. The
execution state is already durable at that point, so a failed request write is
logged and reported in the outcome's `reason`, not treated as a failed stage —
the gate reads "no record" and falls back to the manifest rule, which refuses.

### 7. The callers

- **CLI.** `vpr approve <ref> <stage>` and new `vpr reject <ref> <stage> --note <text>`
  call `service.review`. An `agent` principal gets exit code `EX_RUNTIME` and
  the message "approval requested; an operator must approve".
- **Gateway.** `/stages/:id/approve` and new `/stages/:id/reject` call the
  service in-process with `request.principal`. `RuntimeClient.approve` and its
  `vpr approve` subprocess are deleted.
- **Agent.** `pva_approve` becomes `pva_request_approval`; its description says
  it asks and cannot grant. The `/approve` slash command stops instructing Pi to
  approve "by operator". The intent-router's `approve` case stops forwarding to
  Pi: it returns `rejected` with `action: "use-approve-route"`, naming the
  stage approve route. The router has no execution service and cannot write a
  review itself; the web already calls the route directly.
- **Web.** `approveStage` stays; `rejectStage(stageId, note)` is added; the
  operator key is requested where the gateway token is. (`awaiting_review` is
  already the web's spelling — `studio/web/src/contracts/gateway.ts:83` — so
  the vocabulary mismatch noted on qr4.3 is closed.) The web learns `stale`.

### 8. Staleness

After a grant, a rejection, or a completion of a stage that had a granted
review, the service calls `propagate(pipeline, [stageId], slug)` and writes one
`staleness-marked` event: `{ trigger, affected: [{ stageId, path }] }`.
`status()` reports an affected stage as `stale` until it re-runs or its own
review is re-granted after the trigger.

The event records *why* a stage went stale; hash comparison still decides
*whether* an approval stands. They answer different questions and neither
replaces the other.

With staleness computed, `rerun-affected-downstream` stops returning
`MODE_UNSUPPORTED`: the service passes the report the planner has been asking for.

## Testing

**Contracts.**
- sign/verify round-trip; canonical JSON is key-order independent
- a human receipt that is unsigned, tampered (any field), or signed with another
  key reads `invalidated`, each with its own reason
- no key → `unverifiable`
- `planHash` change → `invalidated`; artifact change still → `invalidated`
- `approval-rejected` → `rejected` with its note; `approval-requested` → `requested`
- a legacy `actor: human` record without `origin` reads `invalidated: unsigned`

**Runtime service.**
- `review` as `operator` writes a signed `approval-granted`
- `review` as `agent` on a `review: human` stage writes `approval-requested`
  and returns `requested`; on a `review: skill` stage writes an `agent` grant
  that satisfies the gate
- an `agent` grant does not satisfy a `review: human` dependency
- an `operator` claim opens an `autopilot: false` stage and records
  `attended: true`; an `agent` claim is refused
- completion of a reviewed stage writes `approval-requested`
- a grant writes `staleness-marked` naming every downstream stage;
  `rerun-affected-downstream` returns a plan instead of `MODE_UNSUPPORTED`
- a failed review append returns `blocked`

**Gateway.**
- each credential resolves to its principal; `dev-token` is never `operator`
- `/approve` with the agent token yields `requested`; with the operator key a grant
- an operator key file with loose permissions refuses startup

**CLI.** `vpr approve` with no key file exits non-zero and leaves an
`approval-requested` in the journal; with the key, a signed grant.

**End to end.** The harness review's acceptance line as one test: run `script`
attended, approve as operator, `compose` runs; the same flow through Pi's
token stops at `requested` and `compose` is refused.

## Scope

**In:** the operator key and principals; signed, plan-bound receipts;
`approval-rejected`; `ExecutionService.review`; attended claims; writing
`approval-requested` on completion; staleness propagation and the
`staleness-marked` event; the four callers.

**Out, filed as follow-ups:**
- binding a receipt to resolved settings — the service does not resolve
  settings yet, so there is nothing to hash
- candidates and atomic take selection — `avg-qr4.6`
- isolating Pi from the operator key file — `avg-qr4.8`
- operator key rotation — rotating invalidates every human receipt, which is
  correct and needs a documented procedure

## Risks

**Every existing human approval stops counting.** Intended, and loud: status
names `unsigned` as the reason. On an episode mid-production it means one
re-approval per reviewed stage.

**The key file is the whole boundary.** Anything running as the user that
chooses to read it is an operator. The design says so rather than claiming
more; it is still strictly stronger than today, where writing one JSON line was
enough.

**`origin` and `actor` are two answers to "who".** A reader could expect one.
The naming carries the difference — `actor` wrote the line, `origin` made the
decision — and the gateway writing an operator's grant is the case that needs
both.

**`planHash` is sensitive to resolver output.** A change in how the resolver
normalises a definition, with no change in meaning, invalidates approvals. The
canonical JSON is taken over the resolved definition, not the YAML, which
narrows this; it does not remove it.
