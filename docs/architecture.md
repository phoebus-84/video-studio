# Architecture

This page describes the current responsibilities and boundaries. It is not a
promise of unattended, one-prompt production. See the
[harness review](harness-review.md) for implementation gaps and the
[running guide](running.md) for prerequisites.

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

**The execution service**, in `studio/runtime`, tracks pipeline snapshots,
leases, attempts, dependencies, staleness, reviews and the spend ledger. The CLI
and gateway use that service. It does not write prose or silently choose a
creative provider.

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

## From sources to a candidate

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

The service can execute stages with a registered adapter. Other stages need
agent work through claim/complete, not an invented automatic handler.
`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`, `pva_layout_sheet`
and `pva_compose_video` already consume the series-release contracts; series
compilation is not a future placeholder.

## What reviews and audits mean

- A human review gate requires an authenticated operator decision. The agent
  requests review; it cannot approve through the agent API.
- A stage gate holds completion/advancement. It is **not a blanket lock on all
  media tools** or on arbitrary shell/API calls.
- Spec-driven renders check the current layout sheet against the timeline and
  its review policy. Source changes can invalidate earlier reviews.
- The render audit checks the file against its expected streams, dimensions,
  duration, decoding and applicable audio/loop requirements. A failed render
  retains a report rather than silently becoming the current deliverable.
- A current-render pointer and a technically passing file do **not** establish
  editorial acceptance, publication permission or quality at every frame.
- Supported paid tools use budget reservations and spend records. Calls outside
  those tools can bypass the ledger. Policy names such as `autopilot` are not
  a universal billing or safety boundary.

Review the actual film and audio. See [revision checks](running.md#comparing-two-versions)
and the [harness review](harness-review.md) for the limits of sampled evidence,
same-user access and execution guarantees.

## Files, history and collaboration

The library stores channels, series and episodes as files. The application
ships no channel's creative format. Series releases pin their compiler,
validator, theme and kits; generated attempts and earlier deliveries should be
preserved rather than overwritten.

A channel can be its own Git repository. Text files and production records are
versioned there; `media.lock.jsonl` identifies media by path, hash and size (or a
relative symlink target). An optional S3-compatible remote stores media bytes
by content hash. Cloning the repository and restoring verified media is a
handoff, not real-time co-editing or a distributed production lock.

See [channel media transfer](running.md#channel-media-backup-and-restore) for the actual commands, access controls
and operator-key requirements, and [workspace](workspace.md) for the file
contracts. Packages never depend on studio concepts; the one-way code boundary
is enforced by `npm run check:boundaries`.

## Source safety and historical decisions

Repository inputs should be pinned and treated as untrusted material. Research
is not permission to run source hooks, installation scripts or examples; any
execution needs an explicit, appropriate trust policy.

Decision records preserve why the design changed. Older records may describe
YAML timelines, a flat workspace or FFmpeg as the episode renderer; they are
not all current contracts. Follow later decisions and check their status where
provided. Current schemas, registrations and implementation take precedence
over an old plan or an illustrative library project.
