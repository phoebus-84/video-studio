# VHS Terminal Recording — Cross-Module Integration Plan

## Overview

Replace static PIL-generated terminal screenshots with real animated terminal recordings using [charmbracelet/vhs](https://github.com/charmbracelet/vhs). VHS scripts terminal interactions in a declarative `.tape` DSL and renders them to MP4.

**Current state**: PIL generates static 1920×1080 images with fake syntax-highlighted code. Text is small, monochrome, and the terminal aesthetic is simulated.

**Target state**: VHS renders real terminal sessions with antialiased text, proper syntax coloring via terminal themes, cursor movement, typing animations, and accurate output — all in a Dyne-branded color theme.

## Modules Affected

| Module | Epic | Changes |
|--------|------|---------|
| `video-workspace-contracts` | `vwc-5q0` | New capability, asset kind, contracts |
| `video-built-in-pipelines` | `vbp-cal` | New skill, pipeline stage |
| `video-pipeline-runtime` | `vpr-qo0` | Capability registration |
| `pi-video-agent` | `pva-sob` | New tool, capability binding |
| `ffmpeg-video-composer` | `fvc-0zz` | Mixed image/video scene composition |
| `video-studio-gateway` | `vsg-e57` | MP4 asset serving, tape file API |
| `video-studio-web` | `vsw-pbt` | Video asset preview, tape editor |

---

## 1. video-workspace-contracts

### vwc-5q0.14 — Add `terminal-recording` capability contract

**What**: Define the `terminal-recording` capability with version `1.0.0`. This is a local capability (like `graphics.render`) — it runs on the host machine, not via a cloud service.

**Contract shape**:
```json
{
  "capability": "terminal-recording",
  "version": "1.0.0",
  "description": "Records scripted terminal sessions to MP4 using charmbracelet/vhs",
  "params": {
    "tapeContent": { "type": "string", "description": "Full .tape file content" },
    "outputFormat": { "type": "string", "enum": ["mp4", "gif", "webm", "png"], "default": "mp4" },
    "width": { "type": "number", "default": 1200 },
    "height": { "type": "number", "default": 600 },
    "framerate": { "type": "number", "default": 30 }
  },
  "returns": {
    "outputPath": { "type": "string" },
    "durationSeconds": { "type": "number" },
    "format": { "type": "string" }
  }
}
```

### vwc-5q0.15 — Add `video` asset kind

**What**: Extend `AssetAttempt.kind` from `"image" | "audio"` to `"image" | "audio" | "video"`. Video assets are MP4 terminal recordings with duration, dimensions, and codec metadata.

**New fields on AssetAttempt**:
```typescript
{
  kind: "video";
  durationSeconds: number;   // video duration
  codec: string;             // "h264" typically
  loopable: boolean;         // whether the video can be seamlessly looped
}
```

### vwc-5q0.16 — Add `.tape` file contract

**What**: Define the tape file as a recognized artifact type. `.tape` files live in `artifacts/tapes/{sceneId}.tape` and are the source of truth for terminal recordings.

---

## 2. video-built-in-pipelines

### vbp-cal.13 — Create `vhs-terminal-recording` skill

**What**: Move the skill from `.pi/skills/` to `video-built-in-pipelines/skills/vhs-terminal-recording.md`. This is where all pipeline skills live.

**Skill content**: The skill already exists at `.pi/skills/vhs-terminal-recording.md` with full command reference, Dyne theme, best practices, and learnings log. Copy it to the correct location and update paths.

### vbp-cal.14 — Add `terminal-recordings` stage to narrated-illustrated-video pipeline

**What**: Insert a new pipeline stage between `art-direction` and illustrations/compose.

**Stage definition**:
```yaml
- id: terminal-recordings
  name: "Terminal Recordings"
  description: "Render VHS terminal recordings for code walkthrough and CLI demo scenes"
  capability: terminal-recording
  inputs:
    - contract: art-direction.json
      version: "1.0.0"
    - contract: script.md
      version: "1.0.0"
  outputs:
    - contract: tapes/
      version: "1.0.0"
  gates:
    autopilot: true
    review: human
    retry_on_failure: 2
  skills:
    - skill: vhs-terminal-recording
      version: "0.1.0"
  depends_on:
    - art-direction
```

**Dependency update on compose stage**: Add `terminal-recordings` as optional input. Scenes with `kind: "terminal-demo"` use VHS output; scenes with `kind: "illustration"` use image output.

### vbp-cal.15 — Add Dyne VHS theme to pipeline fixtures

**What**: Bundle `library/dyne/vhs-theme.json` as a pipeline fixture. The theme is inlined in `.tape` files but the JSON file serves as the canonical reference.

---

## 3. video-pipeline-runtime

### vpr-qo0.15 — Register `terminal-recording` capability

**What**: Add `terminal-recording` to the capability registry with its parameter schema and output contract. This lets the runtime validate stage declarations that use this capability.

**Key behaviors**:
- Validate that `vhs` and `ttyd` are installed on the host
- Handle tape file validation (syntax check before render)
- Track render attempts with immutable output

### vpr-qo0.16 — Support `video` asset kind in dependency staleness

**What**: Extend the staleness checker to understand `.mp4` video files. When a `.tape` source changes, the corresponding `.mp4` is marked stale.

---

## 4. pi-video-agent

### pva-sob.14 — Add `pva_render_terminal` tool

**What**: New Pi tool that accepts a tape file path or content and renders it via VHS.

**Tool signature**:
```typescript
pva_render_terminal({
  channel: string,
  series: string,
  episode: string,
  sceneId: string,
  tapeContent?: string,    // Inline tape content (generated by Pi)
  tapePath?: string,       // Or path to existing .tape file
})
```

**Behavior**:
1. Write `.tape` file to `artifacts/tapes/{sceneId}.tape`
2. Run `vhs {sceneId}.tape` from the tapes directory
3. Move output MP4 to `assets/tapes/{sceneId}.mp4`
4. Return metadata: path, duration, dimensions

### pva-sob.15 — Add tape generation capability to script/art-direction flow

**What**: When Pi writes the script or art direction and detects terminal/code scenes, it also generates `.tape` files from the scene's code references. The tape generation follows patterns from the VHS skill.

**Detection**: Scene intents containing keywords `terminal`, `shell`, `CLI`, `command`, `code walkthrough`, `screencast` → generate `.tape`.

---

## 5. ffmpeg-video-composer

### fvc-0zz.15 — Support mixed image/video scene assets in compose

**What**: The compose stage currently assumes all scene assets are static images (JPG/PNG). VHS introduces MP4 video assets for terminal scenes.

**Changes**:
1. **Scene type detection**: Read `kind` from scene definition (`illustration` → image, `terminal-demo` → video)
2. **Video as scene source**: When a scene has a video asset, use the MP4 directly instead of a static image stretched to duration
3. **Duration matching**:
   - If video duration < scene duration: freeze on last frame or loop
   - If video duration > scene duration: trim to scene duration
4. **Crossfade**: Handle transition between video scene and image scene (crossfade or cut)
5. **Audio**: Narration audio overlays on top of video (video has no audio track, or its audio is stripped)

**FFmpeg filter graph update**:
```
# Static image scenes (unchanged):
[image] loop=-1,trim=duration={dur},setpts=PTS-STARTPTS [v{n}]

# Video scenes (new):
[video] trim=duration={dur},setpts=PTS-STARTPTS,fps=30,format=yuv420p [v{n}]

# Crossfade between any two scenes:
[v{n}][v{n+1}] xfade=transition=fade:duration=0.4:offset={end-dur} [merged]
```

### fvc-0zz.16 — Add `pva_probe_media` support for video assets

**What**: Extend the probe tool to return video-specific metadata: codec, framerate, duration, whether loopable.

---

## 6. video-studio-gateway

### vsg-e57.9 — Serve MP4 terminal recordings as assets

**What**: Add `video/mp4` to the asset serving pipeline. Currently the gateway serves `.jpg`/`.png` images and `.wav` audio. Terminal recordings are `.mp4` files in `assets/tapes/`.

**Changes**:
- Add `video/mp4` MIME type to asset routes
- Add byte-range support for video seeking (HTTP 206 Partial Content)
- Add `.tape` file serving for the editor (text/plain)

### vsg-e57.10 — Add tape file CRUD to workspace API

**What**: Expose `.tape` files through the editor API so the GUI can edit them. Tape files are plain text and fit the existing Markdown editor pattern.

---

## 7. video-studio-web (GUI)

### vsw-pbt.15 — Add video asset preview in scene storyboard

**What**: When a scene has a `video` kind asset, render an HTML5 `<video>` player instead of an `<img>` tag.

**UI requirements**:
- Inline video player with play/pause, seek, mute controls
- Loop toggle for terminal recordings
- Poster frame (first frame) for thumbnail in storyboard
- Responsive sizing within the scene card

### vsw-pbt.16 — Add tape file editor

**What**: Let operators view and edit `.tape` files directly in the GUI. Tape files are plain text with a simple DSL — they fit the existing Markdown editor.

**UI**: Same editor as other text artifacts (brief.md, script.md), with `.tape` syntax awareness:
- Comment lines (`#`) in grey
- Commands (`Type`, `Enter`, `Sleep`, `Set`, `Hide`, `Show`, `Output`) in accent color
- Arguments in default color

### vsw-pbt.17 — Add terminal recording to scene intent types

**What**: Extend `SceneRole` or add a `sceneKind` field:
```typescript
type SceneKind = "title-card" | "illustration" | "diagram" | "terminal-demo" | "end-card";
```

The GUI uses `sceneKind` to show the appropriate icon and preview component per scene.

---

## Dependency Graph

```text
Phase A: Contracts (vwc)
  vwc-5q0.14 (terminal-recording capability)
  vwc-5q0.15 (video asset kind)
  vwc-5q0.16 (tape file contract)
    ↓
Phase B: Runtime + Pipelines (vpr + vbp) — parallel
  vpr-qo0.15 (capability registration)
  vpr-qo0.16 (video staleness)
  vbp-cal.13 (VHS skill)
  vbp-cal.14 (pipeline stage)
  vbp-cal.15 (Dyne theme fixture)
    ↓
Phase C: Pi Agent + FFmpeg (pva + fvc) — parallel
  pva-sob.14 (render_terminal tool)
  pva-sob.15 (tape generation)
  fvc-0zz.15 (mixed image/video compose)
  fvc-0zz.16 (video probe)
    ↓
Phase D: Gateway (vsg)
  vsg-e57.9 (MP4 asset serving)
  vsg-e57.10 (tape file API)
    ↓
Phase E: GUI (vsw)
  vsw-pbt.15 (video preview)
  vsw-pbt.16 (tape editor)
  vsw-pbt.17 (scene kind types)
```

## Implementation Order

1. **Contracts first** (vwc): Define the capability, asset kind, and tape contract before any code.
2. **Runtime + skills** (vpr + vbp): Register the capability in the runtime, add the stage to the pipeline, and place the skill in the correct directory.
3. **Pi + FFmpeg** (pva + fvc): Add the tool and the compose logic. These can happen in parallel.
4. **Gateway** (vsg): Serve the new assets. Depends on Pi and compose being stable.
5. **GUI** (vsw): Preview and edit. Last, depends on everything below.

## Total: 17 new Beads issues across 7 modules

| Module | Issues |
|--------|--------|
| video-workspace-contracts | 3 |
| video-built-in-pipelines | 3 |
| video-pipeline-runtime | 2 |
| pi-video-agent | 2 |
| ffmpeg-video-composer | 2 |
| video-studio-gateway | 2 |
| video-studio-web | 3 |
