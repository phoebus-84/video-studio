# Architecture

> This describes the target architecture. Some active CLI/gateway paths do not
> yet enforce its execution, approval and review guarantees. See the
> [source-level harness review](harness-review.md) before relying on unattended
> production.

## Product boundary

The studio produces narrated, illustrated videos, one-off or as episodes of a
series:

- output profiles `youtube-1920x1080` (16:9) and `vertical-1080x1920` (9:16),
  H.264/AAC MP4;
- one or more narrators, synthesized locally or recorded, as takes;
- generated, archive and deterministic pictures, generated clips, Blender
  shots, terminal recordings and infographics;
- captions by word for takes aligned to their text, by narration segment
  otherwise;
- composition by Remotion from a declarative edit timeline, then loudness and
  a render audit by FFmpeg;
- no upload or scheduling.

## Control plane

The agent — Pi, or Claude Code through the studio's MCP server (ADR-0048) — is
the **Executive Producer**. It interprets intent, performs editorial work,
chooses explicit provider bindings, calls production tools, reviews results,
and reacts to feedback. Both harnesses get the same tools, written once in
`studio/agent/src/`.

The **Pipeline Runtime** is deterministic. It resolves manifests, freezes snapshots, validates artifacts, leases stages, enforces policies, records attempts and events, computes staleness, and resumes interrupted runs. It never writes creative prose or silently selects a provider.

The **Agent Gateway** owns the agent sessions the browser talks to: Pi RPC processes or Claude Agent SDK sessions (`AVG_AGENT_BACKEND`). Browser clients connect to the gateway, not to the agent's stdin/stdout. The gateway associates sessions with episodes, maps comments to `prompt`, `steer`, or `follow_up`, handles extension UI requests, and streams both agent and production events. It never produces an artifact (ADR-0027).

## Data plane

Stages request provider-neutral capabilities (`studio/contracts/src/vocabulary.mjs`):

- `image.generate` and `image.edit`: fal (`@av/fal-media`) or an OpenAI route (`@av/codex-image`);
- `video.generate`: fal — MiniMax H3, Wan 2.2 and FLUX 3 Max clips;
- `speech.synthesize`: the local Qwen3-TTS worker on MLX (`packages/voice`);
- `speech.align`: the same worker, or ElevenLabs when asked (`@av/elevenlabs`);
- `graphics.render`: deterministic SVG, diagram and code-frame renderer;
- `graphics.animate`: Remotion infographics;
- `terminal.record`: VHS terminal recordings;
- `video.compose`: `@av/remotion-composer` for edit timelines; `@av/video-composer` (FFmpeg) for multitrack mixes;
- `media.probe`: FFmpeg probes;
- `scene.create` and `scene.render`: Blender editable 3D scenes and background
  Eevee/Cycles previews/animation, with a Pi-directed artist-handoff workflow.

Archive and stock media (`@av/archive-media`) and audio edits (`@av/audio-edit`)
are tools rather than stage capabilities.

## End-to-end flow

```text
Terminal prompt or GUI action
  -> the agent (Pi or Claude Code) as executive producer
  -> pipeline runtime opens/leases a stage
  -> the agent reads the stage skill and current artifacts
  -> the agent calls one or more capability tools
  -> adapters persist jobs and immutable attempts
  -> the agent writes the canonical stage artifact
  -> runtime validates and records the attempt
  -> policy either continues or awaits approval
  -> the edit timeline is built (or compiled from the series' spec)
  -> a layout sheet is read and, for a series episode, approved by a person
  -> Remotion renders the timeline; FFmpeg masters the sound
  -> the render audit determines Current Deliverable
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
