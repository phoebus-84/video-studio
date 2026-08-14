# Architecture

## Product boundary

The MVP produces faceless, narrated, illustrated YouTube explainers:

- 1920x1080, 16:9, H.264/AAC MP4;
- typically 3 to 8 minutes;
- one primary narrator;
- generated illustrations plus deterministic code and infographic frames;
- segment-level captions;
- FFmpeg composition and verification;
- no YouTube upload or scheduling.

The architecture permits later output profiles for Shorts, Instagram, TikTok, and Facebook without putting publishing concerns in the production core.

## Control plane

Pi is the **Executive Producer**. It interprets intent, performs editorial work, chooses explicit provider bindings, calls production tools, reviews results, and reacts to feedback.

The **Pipeline Runtime** is deterministic. It resolves manifests, freezes snapshots, validates artifacts, leases stages, enforces policies, records attempts and events, computes staleness, and resumes interrupted runs. It never writes creative prose or silently selects a provider.

The **Agent Gateway** owns Pi RPC processes. Browser clients connect to the gateway, not to Pi stdin/stdout. The gateway associates sessions with episodes, maps comments to `prompt`, `steer`, or `follow_up`, handles extension UI requests, and streams both Pi and production events.

## Data plane

Stages request provider-neutral capabilities. The initial implementations are:

- `image.generate` and `image.edit`: fal media adapter;
- `speech.synthesize`: local Qwen3-TTS worker on MLX;
- `graphics.render`: deterministic SVG, diagram, and code-frame renderer;
- `video.compose` and `media.probe`: FFmpeg composer.

The provider selected by Pi is recorded in the episode's pipeline snapshot. Adapters do not silently fall back.

## End-to-end flow

```text
Terminal prompt or GUI action
  -> Pi executive producer
  -> pipeline runtime opens/leases a stage
  -> Pi reads the stage skill and current artifacts
  -> Pi calls one or more capability tools
  -> adapters persist jobs and immutable attempts
  -> Pi writes the canonical stage artifact
  -> runtime validates and records the attempt
  -> policy either continues or awaits approval
  -> edit timeline compiles through FFmpeg
  -> render QA determines Current Deliverable
```

## Reliability model

- Every episode stores an immutable resolved pipeline snapshot.
- Editorial artifacts are revisioned and written atomically.
- Generated assets and stage executions are immutable attempts.
- An append-only JSONL journal records lifecycle events.
- Derivatives record source revisions; edits mark only affected outputs stale.
- Stage leases prevent Pi and GUI actions from racing on canonical writes.
- Provider request IDs are persisted before polling so jobs survive restarts.
- A deliverable is current only if dependencies are current or explicitly accepted.

## Autonomy

Approval policies are `autopilot`, `guided`, and `manual`. Autopilot is the normal one-prompt route, but stops for budget overflow, paid actions above policy, material downgrades, unavailable required capabilities, validation failures, conflicting edits, and policy or licensing blockers.

## Source safety

Repository input is pinned to an exact commit and treated as untrusted. The documentation pipeline reads source without running hooks, package installation, builds, examples, or repository binaries. Executing examples is a later opt-in sandbox capability, not an MVP default.

## Quality gates

Before an MP4 becomes current, the system verifies:

- pipeline and artifact schema validity;
- no unresolved stale dependency unless explicitly accepted;
- expected duration, resolution, codecs, frame rate, and pixel format;
- sampled frames are decodable and not blank;
- narration is present and segment durations agree with the timeline;
- integrated loudness, true peak, and clipping are within the output profile;
- captions exist and fit within safe areas;
- all selected assets have provenance and production roles;
- spend reconciles against the episode budget.

## Lessons retained from OpenMontage

The design keeps OpenMontage's strongest ideas: agent-first creative direction, YAML pipeline manifests, Markdown director skills, schema-valid artifacts, explicit gates, immutable attempts, provenance, budget controls, and a filesystem-derived living storyboard. It intentionally narrows the capability surface and adds a deterministic state runtime because direct editing, RPC feedback, and selective re-execution require stronger concurrency and staleness semantics.
