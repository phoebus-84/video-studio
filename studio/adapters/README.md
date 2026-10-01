# @studio/adapters

The code that performs a pipeline stage, and the declarations that say which
stage that is.

A pipeline stage names the contracts it consumes and produces and, for a
capability stage, the one capability it requests (ADR-0015, ADR-0025). It never
names the code that performs it. A **stage adapter** is the other half: a
descriptor declaring the contracts it produces, the inputs it reads, the
capability it serves (or `null` for a deterministic derivation), its provider
and what it needs from the machine — plus the function that does the work.

```ts
export const narrationCaptions: StageAdapter = {
  id: "narration-captions",
  summary: "Writes SRT captions timed from the measured narration WAVs, in narration-manifest order",
  capability: "media.probe",
  provider: "studio",
  produces: ["captions.srt"],
  consumes: ["narration-manifest.json"],
  requires: {},
  async perform(ctx) { /* … */ },
};
```

## How a stage finds its adapter

`AdapterRegistry.match(stage)` pairs them by declaration, never by stage id:

- a **capability** adapter performs only a `type: capability` stage that
  requests exactly its capability;
- a **derivation** (`capability: null`) performs only a `type: editorial` stage
  that requests no capability — so a derivation can never stand in for a
  provider the stage asked for;
- the stage's outputs must be exactly the adapter's `produces`;
- the stage must declare every contract in the adapter's `consumes` as an
  input, so the DAG — not the adapter — guarantees they exist.

The registry refuses at construction anything it could not match
unambiguously: an unknown capability, a duplicate id, an adapter with no
outputs, or two adapters with the same capability and outputs, since
registration order would then be a provider choice nobody made.

`AdapterDispatcher` wraps a registry as the execution service's
`StageDispatcher`. `canDispatch` and `dispatch` both go through `match`, so a
stage reported as unhandled — a refusal for someone to clear — can never reach
`dispatch` and turn into a failed attempt.

## The studio's adapters

| Adapter | Capability | Produces | Reads |
|---|---|---|---|
| `illustrations-from-assets` | `image.generate` | `illustrations/` | images already in `assets/images/` — generates none |
| `narration-captions` | `media.probe` | `captions.srt` | `narration-manifest.json` |
| `narration-timing` | — (derivation) | `timing.json` | `narration-manifest.json` |
| `render-qa` | — (derivation) | `qa-report.json` | `output.mp4` |

`createStudioDispatcher()` is what the gateway composes its execution service
with. The gateway carries requests to these adapters and writes no artifact
itself (ADR-0027).

## Adding an adapter

1. Write the descriptor in `src/adapters/`, calling into a `packages/*` package
   for anything reusable — the adapter is studio integration, the package is
   the tool.
2. Add it to `STUDIO_ADAPTERS` in `src/studio.ts`.
3. `npm test --workspace @studio/adapters`. The conformance test fails if the
   adapter matches no built-in stage, collides with one already registered, or
   serves a capability its stages do not request.

## Not here yet

Readiness probes, cost estimates, asynchronous job submission, cancellation and
recovery, and explicit per-episode provider bindings are the rest of the
descriptor the [harness review](../../docs/harness-review.md) proposes. The
`vpr` CLI does not dispatch to adapters: `@studio/adapters` depends on
`@studio/runtime`, so the CLI claims stages rather than performing them.
