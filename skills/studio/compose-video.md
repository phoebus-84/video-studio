---
name: compose-video
version: "0.6.0"
description: Compose the final video through the episode's edit timeline, rendered with Remotion
inputs:
  - name: illustrations
    type: image/png
    description: Scene illustrations in assets/images (s1.png, s4a.jpg, …)
  - name: narration
    type: audio/wav
    description: The narration manifest and its final WAV
  - name: captions
    type: application/json
    description: Caption cues from the narration manifest
  - name: timing
    type: application/json
    description: Per-scene timing data (artifacts/timing.json)
outputs:
  - artifacts/edit-timeline.json:
      kind: file
      description: >
        The reviewable account of the render: a studio.video/v1alpha2 edit
        timeline listing every file it was built from.
  - output/:
      kind: directory
      description: >
        Rendered video written to output/<render-id>.mp4 with sibling
        <render-id>.report.json. output/current.json points at the current
        render id. GUI visibility is derived from current.json, never from
        filenames.
capabilities:
  - video.compose
---

# Compose Video

The episode is composed through its **edit timeline** (ADR-0036), not by
running FFmpeg: the timeline is a document you can read, review and edit, and
`@av/remotion-composer` renders exactly what it says.

## Tools

1. `pva_build_timeline` writes `artifacts/edit-timeline.json` from the
   episode's material and says how many scenes and captions it has, how long
   it is, and which output profile it uses. Use it for a first timeline to
   show the person before spending a render on it — not to "refresh" one a
   person edited: it replaces the file (keeping a different previous one as
   `artifacts/edit-timeline.<hash>.bak.json`, and saying so).
2. `pva_compose_video` renders it. It rebuilds the timeline first when there
   is none, when a file it was built from changed, appeared or disappeared, or
   when you ask for another `profile` — and says why, and where it kept the
   previous one. Otherwise it renders the timeline **as it stands**, including
   a hand edit made on the web or on disk. A hand edit the contracts reject,
   or a file that is not JSON, is refused with the reasons and left untouched:
   tell the person what to fix.

Profiles: `youtube-1920x1080` (default, −15 LUFS) and `vertical-1080x1920`
(9:16, −14 LUFS, safe zone clear of the platforms' interface).

## Episodes with a spec

A spec is created with `pva_init_spec` (a draft pinned to an exact template
release, never replacing an existing spec) and filled with the
`fill-episode-spec` skill. In the `series-production` pipeline the timeline,
check and render stages run the same code as the tools below.

An episode with an `episode-spec.json` is pinned to a series template release
(ADR-0037), and its timeline is **compiled** by the compiler that release names
(`poetry-short@1.0.0`, …) from the spec, `artifacts/narration/takes.json` and
each take's word timing — not assembled from scene images. Both tools say which
compiler ran and from which spec revision.

- The profile is the template's: asking for another is refused
  (`profile-fixed-by-template`).
- A problem is reported with the file and JSON path to fix
  (`episode-spec.json#$.data.panels[1].cue`, `artifacts/narration/takes.json#…`).
  Tell the person what to change in the spec or the takes; there is no
  fallback to scene images, and no render of an older timeline while the
  spec does not compile.
- Editing the spec, a take or a picture makes the next render recompile.
- Never change a template release to make a spec compile: a release is
  immutable, and its hash check fails.

### Series rules

The template may name a **validator** (`poetry-short@1.0.0`, …) whose rules
apply to whatever is rendered, hand edits included. Run `pva_check_episode`
before rendering: it says which timeline would be rendered (as it stands, or
recompiled and why) and lists every finding, writing nothing.

- **Errors** refuse `pva_build_timeline` and `pva_compose_video`; nothing is
  written or rendered. Each names the file and path to fix
  (`artifacts/edit-timeline.json#$.tracks[1]`, `episode-spec.json#$.data.panels[2]`).
- A hand edit may change what the series allows — when a picture changes, how
  captions are split. It may not touch the voice, the captions' words, the
  profile, the kits or the effects: tell the person to change the spec or the
  takes instead, or to delete `artifacts/edit-timeline.json` to recompile —
  deleting keeps no copy of the edit, so say so before suggesting it.
- **Warnings** (a picture flashing or held over 7 s, a long caption) do not
  block; they are in the reply and the render report's `validation`. Mention
  them to the person.

## What the timeline holds (episodes without a spec)

- **Scenes** in reading order (`s1, s2, s4a, s10`), each for its length from
  `timing.json`, else its narration, else 10 s; `still@1.0.0`, letterboxed
  (`fit: contain`) when the image's shape differs from the profile.
- **Crossfades** of 12 frames centred on each scene boundary; none around a
  scene shorter than 13 frames.
- **Narration**: the manifest's final WAV, else `narration-full.wav`, else the
  manifest's segments in order with their pauses, else (deprecated) the scene
  WAVs by filename. The last scene holds until the narration ends.
- **Captions**: one `captions@1.1.0` per cue of a canonical narration
  manifest, inside the profile's safe zone. A manifest that is not canonical
  gives narration without captions, and the tool says why.

## Long versions (1–10 hours)

An ambient episode whose approved render is a seamless loop is published long
too. Make the long version with `pva_extend_episode`, never by hand with
ffmpeg or `pva_edit_audio` (its single mix graph does not get through an hour):

- `hours` (0.25–10) or `durationSeconds`; `label` names the file
  (`output/<label>-<hours>h-<timestamp>.mp4`, with `.plan.json` and
  `.report.json` beside it). `current.json` does not move.
- `music`: the music pieces, at least two, paths relative to the episode
  (`{ path, in, out }` to choose a piece's playable stretch; a silent head and
  tail are cut otherwise). Default: every audio file in `assets/music/`. The
  soundtrack is **music only**: never put ambiences or effects from
  `assets/sounds/` in it (ambient-through-time is music only unless the
  operator says otherwise).
- `master` defaults to the render `current.json` names; `seed` defaults to
  one derived from the episode slug, so a rerun gives the same soundtrack.
- The video is the master looped by stream copy; the soundtrack is a seeded
  order that never repeats a piece back to back, mastered to −17 LUFS,
  ≤ −1 dBTP, 3 s fade-in, 6 s fade-out. An hour takes about two minutes.
- Read the summary's duration, loudness and concerns, then ask the operator
  to approve it. The file is media: it stays in the library, never in git.

## Output Layout

```
episode/
├── artifacts/edit-timeline.json
├── output/
│   ├── current.json     ← { "renderId": "<id>", "path": "<id>.mp4" }
│   ├── <render-id>.mp4
│   └── <render-id>.report.json   ← duration, size, sha256, kits, profile,
│                                   loudness, and the hash of the timeline
```

- Render ids are `<label>-<timestamp>-<first 8 hex of the timeline's hash>`.
- `current.json` moves only after the video and its report are complete; a
  failed render changes nothing in `output/`.
- Never look for `final.mp4`: read `output/current.json`.

## Quality Checks

- Every scene appears, in order, for its length; the last is not cut short.
- Captions sit inside the safe zone and match the narration.
- Loudness is the profile's (the report records it).
- The report's timeline hash matches the `edit-timeline.json` you reviewed.
