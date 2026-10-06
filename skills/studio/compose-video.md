---
name: compose-video
version: "0.2.0"
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

## What the timeline holds

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
