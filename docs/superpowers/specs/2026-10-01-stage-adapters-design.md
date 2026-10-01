# Stage adapters: the gateway stops producing artifacts

**Issue:** `avg-qr4.4` — capability adapters (first slice)
**Related:** ADR-0015, ADR-0025, ADR-0026, ADR-0027; the
[gateway-as-transport design](2026-09-20-gateway-as-transport-design.md), which
left the gateway's four handlers in place "until `qr4.4` lands"; the
[harness review](../../harness-review.md), P1 "Capability addition is a
distributed manual process".

## Problem

After `avg-2n7` the gateway no longer decided *when* a stage ran, but it still
performed four of them itself: `studio/gateway/src/runtime/executor.ts` wrote
`artifacts/frames/*`, `captions.srt`, `timing.json` and `qa-report.json`, and
`dispatcher.ts` chose a handler from a table keyed by **stage id**.

That is two problems:

1. **ADR-0027** says the gateway never produces artifacts. It did.
2. **A stage id is a pipeline's private label, not a contract.** A pipeline
   that called its captions stage `subtitles` got no captions; one that reused
   `qa` for a narrative review would have had a technical probe written under
   that name. Nothing checked the pairing against the manifests that ship.

## Design

A new studio workspace, `@studio/adapters`, holds the work and the declarations
that pair it with stages.

**Descriptor.** A `StageAdapter` declares `id`, `summary`, `capability`
(a vocabulary id, or `null` for a deterministic derivation that calls no
provider), `provider`, `produces`, `consumes`, `requires`, and `perform(ctx)`.
It is the thin end of the descriptor the harness review proposes.

**Matching, by declaration only.**

- a capability adapter performs only a `type: capability` stage requesting
  exactly its capability;
- a derivation performs only a `type: editorial` stage requesting none — so it
  can never stand in for a provider a stage asked for (ADR-0015);
- the stage's outputs must equal the adapter's `produces`;
- the stage must declare every contract in the adapter's `consumes`.

**The registry refuses ambiguity at construction:** unknown capability,
duplicate or non-kebab id, empty `produces`, or two adapters with the same
capability and outputs.

**`AdapterDispatcher`** implements the runtime's `StageDispatcher`;
`canDispatch` and `dispatch` both go through `match`, so they cannot disagree
and invert the service's blocked-versus-failed distinction.

**The four handlers move verbatim** into adapters —
`illustrations-from-assets` (`image.generate`), `narration-captions`
(`media.probe`), `narration-timing` and `render-qa` (derivations) — with the
narration-manifest reader and WAV-header parser they share. The gateway
composes its execution service with `createStudioDispatcher()`, re-exports
nothing of its own for stage work, and drops its `@av/video-composer`
dependency.

**Behaviour is unchanged in the shipped pipelines.** Matching by contract finds
exactly `illustrations`, `captions`, `timing` and `qa` in
`narrated-illustrated-video` and its descendants — the conformance test pins
that — and nothing in `blender-animation`. `safety-review` and
`continuity-check` stay unperformable.

## Tests

- `@studio/adapters`: registry refusals and matching rules; dispatcher
  agreement; each adapter's artifact; conformance against every built-in
  pipeline (every adapter used, no ambiguity, capabilities as requested, the
  default pipeline's four stages, no review stage performable); the fabricated
  report stays in fixtures.
- `@studio/gateway`: its runtime layer writes no files and keeps no stage table
  (`test/runtime-transport.test.ts`); gate-enforcement now composes the real
  adapter dispatcher, and its synthetic "autopilot: false but dispatchable"
  stage is declared by contract.

## Out of scope, as follow-ups

- **The CLI does not dispatch.** `@studio/adapters` depends on
  `@studio/runtime`, so `vpr run` still claims rather than performs. Giving the
  CLI a dispatcher needs either a dispatcher-injecting entry point outside the
  runtime package or the CLI moving out of it.
- **Readiness.** `requires` is declared, not probed; `canDispatch` is
  synchronous and does not consult it.
- **Bindings.** `PipelineSnapshot.providerBindings` exists and is always
  empty. When bindings are recorded, matching should consult them rather than
  assume one adapter per signature.
- **Pi's capability tools** (`studio/agent/src/capability-tools.ts`) are not
  adapters; they are the next migration candidates, starting with one provider
  and Blender as the harness review recommends.
- **`illustrations-from-assets` renames `*.jpg` to `*.png` without converting**
  — moved verbatim; a JPEG under a `.png` name is a bug of its own.
- **`illustrations-from-assets` generates nothing** while serving
  `image.generate`. It is honest in its provider name
  (`pre-generated-assets`) and summary; whether adopting existing assets should
  be its own capability is a vocabulary question.
