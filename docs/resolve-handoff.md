# Hand off an episode to DaVinci Resolve

The studio can hand reviewed media to a human editor: revision-specific bins,
series assemblies, final-master timelines, and new narration on independent
tracks. Keep the original cuts and audio so the editor can compare rather than
receive a destructive replacement.

Live control uses the optional, actively maintained upstream integration
[**samuelgursky/davinci-resolve-mcp**](https://github.com/samuelgursky/davinci-resolve-mcp).
We do **not** vendor its server or bridge, add a second Resolve SDK client, or
turn editor availability into a prerequisite for generating a video.

This workflow consists of an **offline preflight planner** and the agent's
`resolve-handoff` skill. The planner does not connect to Resolve; the agent
applies its plan through the upstream MCP tools after operator authorization.
There is no automatic exporter button, new pipeline capability, or approval gate
bypass in this integration.

## Requirements

- DaVinci Resolve installed, the intended project open (or explicit permission to
  create a new one), and permission to edit that project.
- Upstream MCP installed/configured in the agent's MCP client. Follow the
  [upstream installation and bridge documentation](https://github.com/samuelgursky/davinci-resolve-mcp#readme)
  for a reviewed release. Installation, client configuration and bridge updates
  are separate operator actions, not side effects of the planner.
- A working scripting connection. Discover the installed MCP tools and query
  the **live Resolve version, edition and current project** before any edit.
  An MCP handshake or a running Resolve process is not a scripting readiness test.
- Node 22+ and `ffprobe` for local preflight. Set `FFPROBE_BIN` if it is not on PATH.

Resolve edition/build, Python compatibility and in-app bridge requirements
change upstream. A missing Python script menu or `SCRIPTING_UNAVAILABLE` is a
blocker, not permission to guess another transport. On macOS a Dock/Finder
launch inherits the launchd **GUI** environment, not necessarily the shell's;
check actual inheritance before changing Python installations or system links.
Do not treat our earlier live workflow as a promise for every Resolve release.

## 1. Select assets explicitly

Load the episode's current render pointer and accepted take/selection manifests;
ask which revisions belong in the handoff. Do not recursively import an episode
or assume the newest filename is accepted. See [workspace layout](workspace.md)
for canonical selection and render conventions.

Write a versioned request, for example `artifacts/resolve/review-001.request.json`.
The [example manifest](/resolve-handoff.example.json) contains a silent-picture +
voice + music edit and a separate A/V final-master timeline. It assumes a
30-second picture/master/music and a four-second narration cue; **replace its
paths, project settings and measured ranges** with the selected assets.

```bash
npm run resolve:plan -- \
  --manifest /path/to/episode/artifacts/resolve/review-001.request.json \
  --media-root /path/to/episode \
  --out /path/to/episode/artifacts/resolve/review-001.plan.json
```

Omit `--out` to print the plan. Output files are create-only: use a new label for
another plan. A failed/cancelled preflight is not an imported project.

### Request format (schemaVersion 1)

| Field | Meaning |
|---|---|
| `project` | Explicit `name`, `mode` (`new` or `existing`), integer `fps`, `width`, `height`. Existing project settings must match; never silently reset them. Fractional rates are not supported by this planner. |
| `assets` | Unique `id`, relative slash-separated `path`, `kind`, and `bin` array of folder names below `Master`. Use the same ID whenever a file is reused. |
| `kind` | `video`, `video-audio`, `audio`, `still`, or `subtitle`. Stills/subtitles are import-only in v1. |
| `timelines` | Unique **new** `name`, explicit `tracks`, and positioned `items`. Existing timeline names are refused (`if_exists: fail`), not appended to or overwritten. |
| `tracks` | `type` (`video`/`audio`), 1-based contiguous `index`, `name`; audio also needs `audioType` (`mono`/`stereo`). |
| `items` | `assetId`, `sourceInFrame`, `sourceOutFrame`, `recordFrame`, `trackType`, `trackIndex`. All frame values are integers. |

Ranges are **half-open**: `[sourceInFrame, sourceOutFrame)`. A range `24..48`
contains 24 frames, not 25. `recordFrame` is relative to the timeline start;
frame zero means the beginning even when Resolve displays `01:00:00:00`.
Do not subtract one from `sourceOutFrame` when adapting to the verified
exclusive-end upstream wrapper. Verify this behavior against the installed
host before a real assembly; other builds/transports may differ.

The planner resolves the explicit media root (including episode-root symlinks),
rejects escaping paths and symlinks, checks nonempty regular files, runs
`ffprobe`, hashes media bytes, checks video FPS, source bounds, track types and
same-track overlaps, and emits small import/append batches. It never changes
media, sorts shots by filename, invents cue timing, or time-stretches speech.

Audio bounds use conservative **whole playable frames**. For a complete cue
whose duration is fractional at the project FPS, deliberately frame-pad its
silence in a *new* WAV before requesting the whole cue. Do not satisfy a bounds
error by truncating a spoken ending. Place genuinely overlapping sound on
separate tracks. A/V masters are checked against independent picture and audio
bounds; a short or unknown-duration audio stream is not made complete by a longer
video stream. Already mixed narration must not be played alongside its
original speech track.

The plan contains absolute local paths and hashes: keep it as a private episode
artifact, not a portable media archive or a file to commit with voice references.
Preflight checks filesystem containment, not Resolve's own media/output-root
policy or licensing. Those still need authorization at import time.

## 2. Apply through the upstream MCP tools

Ask the agent to load the `resolve-handoff` skill and apply the reviewed plan.
Tool names/prefixes and schemas vary by client/release: discover and describe
what is installed instead of copying one machine's global MCP configuration.

The skill requires this order:

1. Read live state, check the exact project name/settings, refuse conflicting
   timeline names, and save/export a pre-change `.drp` backup to an authorized
   output directory. Ask before leaving an unrelated unsaved project.
2. Create/reuse the declared bins. Import to the **explicit target folder**;
   import still images one at a time to avoid accidental image sequences.
3. Resolve symbolic asset IDs to fresh Media Pool IDs using bin **and actual
   file path**, not just clip name. Recheck bytes/hashes if files changed since
   planning. Never persist session-scoped bridge handles in a portable manifest.
4. Select `Master/Timelines` **immediately before each timeline creation**.
   Folder queries/imports can alter current-folder state. Create only new named
   timelines, set each current explicitly, configure/read back mono/stereo
   tracks, and then append the positioned items.
5. Fill each plan item's `clipInfo` with a fresh `clip_id`. The plan's
   `recordFrameMode: relative` targets the upstream wrapper, not the raw Resolve
   SDK (whose record frame may be absolute). If that option is unsupported,
   describe the tool and convert explicitly using the live start frame.
   `mediaType: 1` is picture only; `2` is audio only. This prevents a silent
   picture edit from accidentally bringing in baked speech.
6. Verify after **every batch**: item count, target track, start/end/duration and
   complete audio release. Save, reopen/read back, and write a handoff report.

Bridge handle tables are bounded. Start with the plan's batches of at most
three items; reduce to one on large pools. A `stale_handle` response is not a
reason to expand the server's table or blindly repeat an append: inspect what
actually landed, re-fetch IDs and retry only missing work. Partial failures
stop the handoff; do not delete/replace an existing cut to conceal them.

Generic `success: true`, `verification: unverified`, and a screenshot are not
sufficient readback. Record actual timeline frame counts, per-track item counts,
source paths/ranges, sample rates/channel layout and any errors or editorial
warnings. Upstream may create `_archived_vNN` safety snapshots; distinguish them
from the new review cuts rather than silently deleting them.

## Narration revisions and A/B review

- Keep approved text and voice identity unless the operator asks to change them.
- Deliver individual, measured WAV cues and a full-length narration stem, with
  music, Foley and bumper on independent tracks. Use a silent picture reference,
  not a final MP4 that still contains the old narrator.
- Add new revision bins/timelines; retain original assets and final masters.
- Use the supplied explicit timings. If a natural-speed take no longer fits,
  ask for editorial retiming or publish a separately labelled review candidate.
  Never automatically accelerate or trim a syllable to hide a collision.
- Add yellow markers and a report for shifted entries; update subtitles from
  the new cue times if authorized. An imported subtitle file is **not** proof
  that a caption track was created or synchronized.
- Offer a level-matched A/B timeline of the final line. ASR/text checks and
  pitch/release measurements are technical triage; **human listening remains
  necessary** to approve acting.

## What this does not reconstruct

A rendered MP4 is still rendered footage. Media Pool organization and editable
clip/audio timing do not reconstruct Blender rigs, Geometry Nodes, code,
generated motion, text layers or the production's native source project.
Retain those source artifacts alongside the episode and describe the limits.
A `.drp` export normally references local media; package/relink it explicitly
before promising a self-contained handoff to another machine.

## Validation

```bash
npm run test:tools         # planner, path/range/CLI/failure tests (mock probes)
npm run docs:build         # guide links and public example
```

For an opt-in live smoke test, ask the operator to authorize a **new disposable
project** and run the skill with short local media and a unique review label.
Record Resolve edition/version, upstream MCP version and readback; do not use an
active edit as an automated test fixture. Planner tests do not certify a live
Resolve connection. No handoff marks a pipeline stage approved or promotes
`output/current.json` or accepted takes by itself.
