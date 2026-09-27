# Harness review: multiple workflows and meaningful human direction

## Verdict

Keep the reusable-package / studio boundary, filesystem artifacts, provider-neutral
capabilities, pipeline manifests, and Pi as creative director. **Do not rewrite
these foundations.** The highest return is making the actual execution paths obey
the contracts already described in the architecture, then making shots and human
handoffs first-class. Adding more prompts or providers alone will not do that.

This is a source-level review, not an assertion that every browser journey was
exercised. Findings below distinguish working primitives from integration gaps.
The current system should **not be advertised as policy-enforced unattended
production**. Pi-directed automation and human-guided production are useful today,
but the end-to-end enforcement story is incomplete.

## Changes delivered with Blender

- `@av/blender`: editable scene building; Eevee/Cycles still/animation rendering;
  explicit GPU selection; immutable attempt directories; provenance; cancellable
  subprocesses; image-sequence-first MP4 encoding; Poly Haven acquisition.
- Dedicated studio tool module rather than expanding the 1,279-line
  `studio/agent/src/capability-tools.ts` monolith.
- `scene.create` / `scene.render` vocabulary + generated binding; component and
  optional local-3D profile; `blender-animation` Pi-directed shot workflow.
- A technique skill covering bpy, CLI, keyframes, Geometry Nodes, Asset Browser,
  Poly Haven, renderer choice, preview review and native-file handoff.
- Skill discovery now reads the composed `.pi/skills` location, accepts flat
  Markdown, reads frontmatter, uses layout-2 series paths, and scopes overrides
  explicitly. Catalog lookup refreshes after human edits instead of caching forever.
- `doctor` now rechecks requirements instead of reporting stale `composed.json`
  readiness. Composition and diagnostics share probes, including `BLENDER_BIN`.
- Quiet composition no longer hides configuration problems with a success exit.
- Root `check` now includes full contract schema/vocabulary/binding checks and
  built-in pipeline linting. Previously a missing capability fixture could pass
  the ordinary root tests. Readiness probes also have their own regression tests.

The new tools create **candidates**, not approved stage completions. No claim is
made that the legacy gateway executor now runs arbitrary workflows, that Python
is sandboxed, or that a render survives an agent-process crash.

## Highest-impact findings

### P0 — Reviews can be fabricated by the implementation

**Evidence:** `studio/gateway/src/runtime/executor.ts`, `handleSafetyReview` and
`handleContinuityCheck`, construct literal findings about a wolf, eight scenes,
and passing character/color/lighting checks. They do not inspect the episode.
The dispatcher labels successful handler returns `completed`, even when a handler
returns an empty output list. A report file is not proof a review happened.

**Change:** remove these handlers from production execution or fail explicitly
with `review_required`. Real review results must name the exact artifact hashes,
checks performed, evidence, reviewer and decision. An unavailable reviewer means
blocked/not-reviewed, never an invented pass. Keep sample reports only in fixtures.

**Acceptance:** an unrelated episode cannot receive the wolf report; missing
media/checker cannot pass QA; changing a reviewed artifact invalidates the review.

### P0 — Runtime invariants exist in modules but are bypassed by active paths

**Evidence (fixed, avg-qr4 "CLI and agent on the execution service"):**
`studio/runtime/src/cli.ts`, `cmdStatus`, *used to* infer completion from
output-file existence and emit a zero-consumption budget; it now replays the
episode journal through `ExecutionService.status` and reports no budget at all,
because nothing measures one yet (avg-91o). `cmdRun` *used to* select the first
stage missing outputs without driving the lease/state-machine/policy engine; it
now claims a stage through the service, takes a real lease, and prints the
`vpr complete` line that closes it. `cmdRerun` *used to* return an empty plan;
it now plans through the same service, and refuses `rerun-affected-downstream`
by name rather than planning nothing (avg-33r).

`studio/gateway/src/runtime/executor.ts` produces artifacts directly using a
hard-coded stage-name registry, contrary to ADR-0027 — still true, and not
addressed by the work above. `studio/agent/src/pipeline-tools.ts` *used to*
describe tools as executing/waiting while the runtime run command chiefly
returned stage instructions; its `pva_run_stage`, `pva_claim_stage` and
`pva_complete_stage` now go to the gateway's claim/complete routes, which are
the same execution service the CLI uses. There is one reading of “run” on
those paths; the legacy executor is the remaining one.

**Change:** one execution service shared by agent and browser:

```text
resolve immutable plan → validate inputs + authorization + budget
→ lease attempt → dispatch editorial work to Pi / capability work to adapter
→ validate outputs → record candidate → satisfy review gate
→ atomically select accepted output → invalidate dependent selections
```

Keep the gateway a transport. Use the existing engine primitives, not a third
state machine. File existence is discovery, not completion. Unknown executors,
empty required outputs, expired leases and missing budget reservations fail closed.

**Acceptance:** CLI and browser produce the same events/state; dependency failure
blocks downstream work; two sessions cannot select conflicting outputs; restart
recovers the same attempt; dry-run performs no production writes or paid calls.

### P0 — “Human approval” needs an authenticated, revision-bound origin

**Evidence (fixed, avg-qr4.3 "authenticated, revision-bound approval"):** Pi
*used to* have `pva_approve`; runtime `cmdApprove` wrote `actor: "human"`
regardless of who invoked the command, and the decision was not bound to an
output hash. Pi now has `pva_request_approval` instead: the gateway resolves
Pi's token to the `agent` principal, and `ExecutionService.review` downgrades
an agent's decision on a `review: human` stage to a request rather than a
grant. A receipt is signed only when the caller holds the operator key, and it
binds the stage's plan hash and output hashes — a changed source, camera,
timing or render setting invalidates it.

**Change (done):** distinguish agent assessment, policy auto-acceptance and
actual human approval. The browser/TUI/CLI supply authenticated approval
receipts bound to plan/attempt/artifact revisions. Pi may request an approval,
not mint a human one. Authorization is enforced at `ExecutionService.review`,
the one place that writes a review event, not solely in a skill prompt.

**Acceptance:** an agent-only call cannot satisfy a human gate; a stale receipt
cannot authorize a new expensive render; print/headless mode stops with an explicit
approval request rather than assuming yes.

### P1 — Capability addition is a distributed manual process

**Evidence:** vocabulary schema + mirror + generated TypeScript; composition
manifest + profiles; package exports/dependencies; agent registration; skills;
pipeline declarations; diagnostics and tests. `studio/agent/src/agent.ts` also
contains a static `CAPABILITIES` list. Before the Blender change, the agent/gateway
TypeScript paths did not consume `composed.json`, despite documentation saying
they did. Tool availability and installed capability readiness could disagree.
The old contributing guide also prohibited multiple providers, while compose
already supported explicit `defaultProviders`.

**Change:** a declarative **studio adapter descriptor**, leaving packages reusable:

```ts
// Proposed, not an API implemented by this change.
{
  capability: 'scene.render', version: '1.0.0', provider: 'blender',
  inputSchema, outputSchema, validateOutput, probe, estimate,
  submit, poll, cancel, recover,
  tools: ['pva_blender_render'], skills: ['blender-scene'],
  resources: { gpuSlots: 1 }, effects: ['local-process', 'filesystem']
}
```

Generate discovery/health/tool metadata from these descriptors, cross-check them
against contracts in CI, and lazy-load tools by the selected workflow. Separate
**known**, **installed**, **ready**, **selected** and **authorized**; never silently
replace an unavailable provider. Permit multiple providers and choose bindings
explicitly per shot/run. See the corrected [contributing checklist](contributing.md).

**Acceptance:** adding a provider needs a package and one studio descriptor;
unbound/unknown capabilities and missing skill resources fail CI; an unselected
provider is not accidentally called or billed.

### P1 — Make workflows compose at the shot level

**Evidence:** the built-in narrated pipeline requires `terminal.record` and a
terminal stage even when no terminal scene exists. Several inherited pipelines
still converge on the illustrated/narrated path. The typed video composer supports
more than the legacy agent composition helper, which follows an image-concat path.
Blender animation is not an image, and optional input files do not make a required
stage/capability optional.

**Change:** a shared shot/sequence plan with explicit visual-source choices:
`still`, `generated-video`, `blender-scene`, `motion-graphic`, `terminal`, or
`imported-media`. Expand each choice into a small versioned subgraph. Freeze that
expanded DAG for a run; support conditionals/foreach at planning time rather than
letting an LLM silently mutate a running graph. Normalize results to a media-clip
contract; route all editing through the typed timeline/compiler.

Suggested workflow families:

| Workflow | Production route | Useful intervention points |
|---|---|---|
| Narrated explainer | brief → script → selected visuals + voice → edit | script, voice audition, cut |
| 3D product/educational animation | shot plan → scene → playblast → final → edit | camera, materials, motion |
| Mixed documentary | research → shot plan → imported/generated/3D clips → edit | sources, shot selection, cut |
| Code tutorial | repository analysis → selected terminal/code/diagram shots → edit | commands, technical accuracy |
| Artist-led production | supplied source → preview → feedback revisions → final | native editing at every phase |

**Acceptance:** a Blender-only shot does not require fal/MLX/VHS; a mixed sequence
accepts native videos without flattening them to stills; changing one camera
rerenders that shot and its downstream edit, not all narration.

### P1 — Human direction must be durable production data, not just chat

The gateway already has steering/follow-up and review-thread primitives. Preserve
those, but distinguish “send the agent a message” from “lock this approved shot.”

**Change:** per-stage/per-shot execution policy and selection records. Human work
uses the same artifact contracts as automation: imports, native `.blend`/timeline
sources, immutable revisions, preview comparisons, explicit selected take, edit
locks, handoff/resume, and reasons for rejection. Feedback should anchor to a frame,
shot, object/camera/material or timing beat where possible. Do not silently
recreate an artist's edited scene from an old script.

| Mode | Intended behavior after enforcement work |
|---|---|
| Autopilot | Execute an approved plan within resource/license limits; evaluate automatic gates; stop on hard blockers |
| Guided | Generate alternatives and previews; wait at chosen decision points; continue from the selected revision |
| Manual | Execute only the requested stage/shot operation; native-app editing and approval drive continuation |

These are policies over the **same graph**, not three divergent implementations.
Allow a mostly automatic production with one heavily art-directed sequence.

**Acceptance:** a person can change the camera in Blender and resume without the
agent overwriting it; controls show which take/settings are approved; changed
upstream inputs invalidate only affected decisions; switching modes preserves work.

### P1 — Long jobs need workers, not blocking tool calls

**Evidence:** many existing capability tools use `spawnSync`/`execSync` and ignore
AbortSignal. That blocks feedback while rendering. Blender's new adapter uses
async subprocesses and retains frames, but still runs inside the agent lifetime.

**Change:** persist job IDs before execution; isolate local workers; bounded GPU
slots, CPU/memory/time/disk budgets, cancellation, heartbeats, incremental frame
progress, resume/reconcile after restart. Keep provider job state separate from
stage selection. First implement local workers; use the same job contract for a
render farm later. Queue independent shots, not simultaneous GPU-overcommitting
renders. Do not immediately add a large distributed scheduler.

**Acceptance:** browser disconnect does not kill/repeat a paid render; stopping a
job stops its process tree; partial frames are reusable only when source/settings
hashes match; stale worker results cannot replace newer selected takes.

### P2 — Validation, trust and QA need to scale with media types

- New shot pointer JSON artifacts are documented conventions, not yet dedicated
  canonical schemas. Formalize source/dependency manifests before generic worker
  recovery and fine-grained staleness depend on them.
- Existing lexical path guards are insufficient for arbitrary symlinked inputs;
  Blender's adapter adds realpath checks, but explicit Python still needs OS
  isolation for untrusted execution. Do not claim that `--disable-autoexec` is a
  sandbox. Control network access and add-on allowlists in the worker boundary.
- Record complete dependencies (textures, linked libraries, fonts, audio, caches,
  version, engine/device, color management, seeds, rights). Packing images alone
  does not make every `.blend` portable.
- QA profiles must distinguish silent 3D shots from narrated explainers and
  social output. Technical decoding, visual review and narrative/safety review
  are separate evidence types. Golden frame tests need tolerance across GPUs.
- Test the actual shipped extension and browser/CLI flow against fake providers,
  then opt-in real smoke tests. Do not let “tests of a helper pass” stand in for
  “a user can finish this workflow.”

## Recommended sequence

1. **Trustworthy execution:** remove fabricated reviews; enforce authenticated
   revision-bound approval; connect run/status/rerun to one engine.
2. **A thin adapter registry:** generate discovery and readiness, add conformance
   tests, migrate one existing provider and Blender before generalizing further.
3. **Shot contract and typed editing:** prove Blender + still + terminal + sound
   in one short sequence; exclude irrelevant capability requirements.
4. **Artist handoff/selection UI:** compare previews, lock takes, import edited
   native sources, targeted reruns. Build on the existing review/steer mechanisms.
5. **Durable workers and budgets:** cancellation/recovery/local GPU scheduling,
   then remote rendering only when local production proves the abstraction.

The `bd` CLI was unavailable during this review, so these are prioritized findings
and acceptance criteria, not claimed Beads tasks. Create durable issues for each
workstream when project task tracking is available.
