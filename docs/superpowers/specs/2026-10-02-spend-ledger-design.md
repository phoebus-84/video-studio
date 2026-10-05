# The spend ledger

**Issue:** `avg-91o` — no budget ledger
**Related:** the [execution service design](2026-09-19-execution-service-design.md)
("absence is refusal"); the [harness review](../../harness-review.md), P0
"Runtime invariants…" ("missing budget reservations fail closed") and step 5
"Durable workers and budgets"; `avg-qr4.8` (OS isolation, deferred)
**Date:** 2026-10-02

## Problem

An episode has a budget on paper and none in practice.

1. **Nothing reserves, nothing records.** `studio/runtime/src/policy/ledger.ts`
   has `reserveBudget`, `consumeReserve` and `releaseReserve`. They work on an
   in-memory object, and nothing calls them outside their own tests.
2. **The guards say yes to everything.** The execution service refuses a stage
   when no `BudgetGuard` is configured. The CLI and the gateway both configure
   one that answers `ok` with an estimate of 0. So the fail-closed rule is met
   in name only.
3. **The money is spent somewhere the guard never looks.** Paid calls are not
   made by stages. `pva_generate_image` (fal) and `pva_generate_minimax_h3_video`
   (fal, about $0.48 a clip) run inside Pi's tools and call the provider
   directly. No stage boundary sits around them, so a stage-level guard could
   not stop them even if it said no.
4. **The report cannot see the spend.** `GET …/budget` sums `cost` from
   `assets/manifest.json`. Nothing in the current tree writes costs there, so
   an episode that bought forty images reports $0.

## Decision

Spend is a journal record, like everything else that happened to an episode.
A paid call reserves its estimate **before** it reaches the provider and
settles **after**. The reservation is checked against the budget, and appended,
under one lock, so two processes cannot both spend the last dollar.

### Events (contracts)

Three new execution events in `JOURNAL_EVENTS`, `journal-event.schema.json`
and `execution-event.schema.json`:

| Event | Required data | Meaning |
|---|---|---|
| `spend-reserved` | `reserveId`, `capability`, `provider`, `estimate` (Money) | A paid call is about to go out. Optional fields: `profile`, `purpose` (e.g. `image s3`), and `priced: false` when no price is known for the model. |
| `spend-settled` | `reserveId`, `cost` (Money), `basis` | The call went out. `basis` is `provider` when the provider reported what it charged, or `estimate` when it did not, so the estimate stands. Optional: `providerRequestId`. |
| `spend-released` | `reserveId`, `reason` | The call never reached the provider, or the provider refused it, so nothing was spent. |

Money uses the shape the contracts already define: integer `micros` plus an
ISO `currency`.

### Derivation (`@studio/contracts/src/budget.mjs`)

`deriveBudget(events, envelope, legacy)` replays the journal:

- **spent**: the sum of settled costs.
- **reserved**: the sum of open reservations, meaning reservations that were
  neither settled nor released. **An open reservation counts.** A process that
  died mid-call may still have been billed, so its estimate stays committed
  until someone settles or releases it.
- **committed**: spent plus reserved. **remaining**: limit minus committed.
  **exhausted**: committed has reached the limit. **warn**: committed has
  reached `warnAtMicros`.
- **legacy**: `cost` entries in `assets/manifest.json` that older productions
  recorded are added to spent and counted separately, so money already spent is
  never reported as $0. Attempts that carry no cost are counted as `uncosted`.
  Their spend is unknown, not zero.
- **Currencies** that differ from the envelope's are not summed into its
  total. They are listed as mixed, the way the route already does.

### The envelope

`settings.yaml` at episode, series, then channel level. The nearest top-level
`budget: {currency, limitMicros, warnAtMicros?}` wins. This is the rule the
`/budget` route already used, now moved to contracts so the agent, the runtime
and the gateway share one reading. Contracts carries no YAML parser, so the
caller passes one in.

**No budget configured means no cap, not no record.** Every paid call still
reserves and settles, so the spend is visible, but nothing refuses it. Refusing
every paid call on an episode that never set a budget would block existing
productions on the day this ships. The report says `limitMicros: null`, and
status says the spend is uncapped.

### Reserving (`reserveSpend`)

1. Take the episode's `budget` lock. It is the same `.locks/` directory, file
   format and `wx` arbitration the runtime's `FileLock` uses, with a short TTL
   and expired-lock reclaim.
2. Re-read the journal under the lock and derive the budget.
3. Refuse when:
   - the estimate is not a non-negative integer;
   - a limit is set and the estimate's currency differs from the limit's;
   - a limit is set and the model has no known price, because a call with no
     estimate cannot be checked against a cap;
   - a limit is set and committed plus the estimate would pass the limit.

   The refusal names the figures: limit, spent, reserved and estimate.
4. Otherwise append `spend-reserved`, release the lock, and return its
   `reserveId`.

`settleSpend` and `releaseSpend` take the same lock. They refuse a reservation
that does not exist or is already closed, so a reservation cannot be settled
twice.

### Callers

- **Agent tools.** The fal path of `pva_generate_image` and
  `pva_generate_minimax_h3_video` go through `withSpend`. A refusal returns the
  tool error, and the provider is never called. The estimate comes from the
  `@av/fal-media` profile's pricing (`estimatedUnitCost`). The sync `fal.run`
  endpoint reports no cost, so it settles at the estimate. The queue client
  returns `cost` when fal sends one. The Codex image provider bills a plan, not
  money, so it reserves nothing.
  - **Released**: a failure before the request is sent, or an error response
    from the provider.
  - **Settled**: anything after a successful response, including a failed
    download. A network error mid-request also settles at the estimate,
    because the provider may have done the work.
- **The stage guard.** `JournalBudgetGuard` replaces both allow-all guards. A
  stage that declares a paid capability (`image.generate`, `image.edit`,
  `video.generate`) is refused once the episode's budget is exhausted.
  Everything else passes. It mints nothing, because the spend is reserved where
  it happens, so the old warning that "`maySpend` mints a reservation nothing
  releases" no longer applies.
- **`GET …/budget`.** Reads the ledger: `limitMicros`, `consumedMicros`
  (spent), `reservedMicros`, `remainingMicros`, `warn`, `exhausted`, and
  `sources` (where the limit came from, settled and estimated counts, legacy
  counts, and the open reservations).
- **`vpr budget <ep>`** prints the same report.
  **`vpr budget <ep> release <reserveId>`** and
  **`POST …/budget/reservations/:id/release`** let the
  **operator** close an open reservation after checking the provider's
  dashboard. Releasing frees budget, so an agent cannot do it.
- `vpr status` puts the budget back in its output (it was removed because
  there was no ledger behind it).

The in-memory `policy/ledger.ts` is deleted. Keeping two ledgers, one of them
fictional, is the problem this issue exists to fix.

## What this does not stop

The ledger keeps **the agent's tools** honest. It does not stop a determined
agent:

- Pi's environment holds `FAL_KEY`, so `curl` from its bash tool reaches fal
  with no reservation.
- Pi can append a forged `spend-released` line, because spend records are not
  signed.

Both are the same boundary as the operator key: Pi runs as the operator's own
OS user (`avg-qr4.8`, deferred). The ledger is a brake on runaway loops and
honest mistakes, not a security boundary.

## Out of scope

- Per-stage budgets and reservations held across a whole stage.
- Price tables for providers with no profile pricing.
- `approvalPolicy.onBudgetExceeded: requireApproval`, meaning an operator
  grant to overspend. Today the operator raises the limit in `settings.yaml`.
- The settings resolver's invented `$5` system default. Nothing reads it for
  spending, and this design deliberately does not start.

## Acceptance

- Two concurrent reservations cannot together pass the limit.
- A refused reservation never reaches the provider.
- A crash between reserve and settle leaves the estimate committed, visible
  and releasable by the operator only.
- `GET …/budget`, `vpr budget` and the stage guard agree, because they share
  one derivation.
