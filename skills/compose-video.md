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
  - final.mp4:
      kind: video/mp4
      description: Final rendered video (must be named final.mp4 for GUI visibility)
capabilities:
  - ffmpeg
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

## Asset Paths

The GUI expects assets at the episode root, NOT inside `artifacts/`:

```
episode/
├── assets/
│   └── images/       ← GUI reads from here
│       ├── s1.jpg
│       └── ...
├── artifacts/
│   ├── narration/    ← audio files
│   ├── final.mp4     ← composed video
│   └── ...
```

When generating illustrations, save directly to `assets/images/`, not
`artifacts/assets/images/`. If you accidentally save in the wrong place:

```bash
mv artifacts/assets/images/*.jpg assets/images/
```

## Output Naming

The final video **must** be named `final.mp4`. The GUI only detects files
with this exact name. Create a copy if the compose step produces a different
filename:

```bash
cp artifacts/output.mp4 artifacts/final.mp4
```

## Quality Checks
- All scenes match duration from timing.json
- Audio sync is frame-accurate
- Captions are readable at 1080p
- Transitions are seamless (no black frames)
