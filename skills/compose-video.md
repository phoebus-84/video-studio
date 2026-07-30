---
name: compose-video
version: "0.1.0"
description: Compose final video from illustrations, narration, captions, and timing
inputs:
  - name: illustrations
    type: image/png
    description: Scene illustrations directory
  - name: narration
    type: audio/mp3
    description: Narration audio file
  - name: captions
    type: text/srt
    description: Timed caption file
  - name: timing
    type: application/json
    description: Per-scene timing data
outputs:
  - output/:
      kind: directory
      description: >
        Rendered video written to output/<render-id>.mp4 with sibling
        <render-id>.report.json. Write output/current.json pointing at
        the current render id. GUI visibility is derived from current.json,
        never from filenames.
capabilities:
  - video.compose
---

# Compose Video

Assemble the final video using FFmpeg.

## Process
1. Load timing data to determine scene durations
2. For each scene, display the illustration for the scene duration
3. Overlay narration audio
4. Burn in captions
5. Add transitions between scenes
6. Encode at 1080p 30fps H.264

## Output Layout

Renders follow the canonical episode workspace layout:

```
episode/
├── output/
│   ├── current.json     ← { "renderId": "<id>", "path": "<id>.mp4" }
│   ├── <render-id>.mp4
│   └── <render-id>.report.json
```

- Write each render to `output/<render-id>.mp4`.
- Write a sibling `<render-id>.report.json` with duration, file size, and
  any warnings.
- Update `output/current.json` to point at the newly rendered id.
- GUI / review tools look at `current.json` to find the active render,
  **never** by scanning for specific filenames like `final.mp4`.

## Quality Checks
- All scenes match duration from timing.json
- Audio sync is frame-accurate
- Captions are readable at 1080p
- Transitions are seamless (no black frames)
