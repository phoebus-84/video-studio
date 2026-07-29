---
name: vhs-terminal-recording
version: "0.1.0"
description: Generate high-quality terminal recordings using charmbracelet/vhs for code walkthrough and CLI demo scenes
inputs:
  - name: tape_content
    type: text/plain
    description: The .tape file content describing the terminal session to record
  - name: scene_id
    type: string
    description: Scene identifier (e.g., s4a, s5)
  - name: output_format
    type: string
    description: Output format — mp4 (recommended for video pipeline), gif, webm, or png
outputs:
  - "{scene_id}.mp4":
      kind: video/mp4
      description: Rendered terminal recording, ready for video composition
  - "{scene_id}.tape":
      kind: text/plain
      description: Source tape file archived alongside the recording
capabilities:
  - vhs
  - ffmpeg
---

# VHS Terminal Recording

Generate professional terminal recordings using [charmbracelet/vhs](https://github.com/charmbracelet/vhs). VHS lets you script terminal interactions in a declarative `.tape` DSL and renders them as high-quality video files.

## Quick Start

```bash
# Install (macOS)
brew install vhs ttyd

# Create a tape
vhs new demo.tape

# Record live terminal actions into a tape
vhs record > demo.tape

# Render to video
vhs demo.tape
```

## .tape File Format

A tape file is a script of commands executed in a virtual terminal. Settings come first, then actions.

### Minimal Template

```
# Output configuration
Output demo.mp4

# Terminal appearance
Set FontSize 22
Set FontFamily "JetBrains Mono"
Set Width 1200
Set Height 600
Set Padding 20
Set Margin 20
Set MarginFill "#0D0D0D"
Set BorderRadius 8
Set Framerate 30
Set PlaybackSpeed 1.0

# Terminal session
Type "echo 'Hello, VHS!'"
Enter
Sleep 2s
```

### Settings Reference

| Setting | Example | Notes |
|---------|---------|-------|
| `Set Shell` | `Set Shell zsh` | Shell to use |
| `Set FontSize` | `Set FontSize 22` | Font size in px |
| `Set FontFamily` | `Set FontFamily "JetBrains Mono"` | Must be installed |
| `Set Width` | `Set Width 1200` | Terminal width |
| `Set Height` | `Set Height 600` | Terminal height |
| `Set Padding` | `Set Padding 20` | Inner padding |
| `Set Margin` | `Set Margin 20` | Outer margin |
| `Set MarginFill` | `Set MarginFill "#0D0D0D"` | Margin color |
| `Set BorderRadius` | `Set BorderRadius 8` | Corner radius |
| `Set Framerate` | `Set Framerate 30` | Capture FPS |
| `Set PlaybackSpeed` | `Set PlaybackSpeed 1.0` | 0.5 = slower, 2.0 = faster |
| `Set CursorBlink` | `Set CursorBlink false` | Disable blinking |
| `Set WindowBar` | `Set WindowBar Colorful` | Window chrome style |
| `Set Theme` | `Set Theme "~/path/theme.json"` | Custom color theme |
| `Set TypingSpeed` | `Set TypingSpeed 50ms` | Per-char delay |
| `Set LetterSpacing` | `Set LetterSpacing 0` | Character spacing |
| `Set LineHeight` | `Set LineHeight 1.2` | Line spacing |

### Action Commands

| Command | Example | Notes |
|---------|---------|-------|
| `Type` | `Type "npm install"` | Types characters with TypingSpeed |
| `Type@<time>` | `Type@200ms "slow"` | Override speed per command |
| `Enter` | `Enter` or `Enter 3` | Press Enter (with repeat) |
| `Space` | `Space 5` | Press space |
| `Tab` | `Tab` | Press tab |
| `Backspace` | `Backspace 8` | Delete characters |
| `Up` / `Down` / `Left` / `Right` | `Down 3` | Arrow keys |
| `Ctrl+X` | `Ctrl+C` | Control sequences |
| `Sleep` | `Sleep 2s` or `Sleep 500ms` | Pause |
| `Hide` / `Show` | | Pause/resume frame capture |
| `Wait` | `Wait /pattern/` | Wait for regex to appear |
| `Screenshot` | `Screenshot` | Capture current frame |
| `Copy` / `Paste` | | Clipboard operations |
| `Source` | `Source setup.tape` | Include another tape |

---

## Dyne Visual Identity

Use the Dyne theme for all Dyne channel recordings. The theme file is at `library/dyne/vhs-theme.json`.

### Dyne VHS Theme

```json
{
  "name": "Dyne",
  "black": "#0D0D0D",
  "red": "#D77733",
  "green": "#6B8F5E",
  "yellow": "#FEFBF6",
  "blue": "#423E8E",
  "magenta": "#AA7FF0",
  "cyan": "#43C1BE",
  "white": "#FFFFFF",
  "brightBlack": "#423E8E",
  "brightRed": "#D77733",
  "brightGreen": "#6B8F5E",
  "brightYellow": "#FEFBF6",
  "brightBlue": "#423E8E",
  "brightMagenta": "#AA7FF0",
  "brightCyan": "#43C1BE",
  "brightWhite": "#FFFFFF",
  "background": "#0D0D0D",
  "foreground": "#FFFFFF",
  "selection": "#423E8E",
  "cursor": "#D77733"
}
```

### Recommended Dyne Settings

```
Set FontFamily "JetBrains Mono"
Set FontSize 22
Set Width 1200
Set Height 600
Set Padding 20
Set Margin 40
Set MarginFill "#0D0D0D"
Set BorderRadius 8
Set Framerate 30
Set PlaybackSpeed 1.0
Set CursorBlink false
Set WindowBar Colorful
Set Theme "library/dyne/vhs-theme.json"
```

---

## Best Practices

### 1. Prefer Tapes Over Live Recording
Always write `.tape` files by hand rather than using `vhs record`. Hand-written tapes are:
- Reproducible and version-controllable
- Editable for timing and pacing
- Cleaner (no mistakes, no retyping)
- Archivable alongside episode assets

Use `vhs record` only for discovery — to capture real command output you want to replicate.

### 2. Structure Tapes for the Video Pipeline
Each tape should produce one scene. Keep scenes focused:
- **Code walkthrough scenes** (s4 type): Show a single concept, ~30-40s of terminal
- **Demo scenes** (s5 type): Walk through a workflow, ~40-50s
- **Setup/cleanup**: Use `Hide`/`Show` to hide build steps

### 3. Typing Speed Matters
- `Set TypingSpeed 30ms` — natural typing pace for code
- `Set TypingSpeed 50ms` — slightly slower for readability
- Use `Type@100ms` for emphasis on key commands
- Never use instant typing (0ms) — it feels fake

### 4. Size for Composition
- VHS output should match the video format: **1920×1080**
- With `Set Margin 40` and `Set Padding 20`, set `Set Width 1200` and `Set Height 600` to fill the frame nicely
- The margin creates a clean black border that blends with the video background

### 5. Simulate Real Terminal State
Before showing commands, set up the environment:
```
Hide
Type "cd /path/to/project && clear"
Enter
Sleep 500ms
Show
```
This makes the terminal look like a real working session.

### 6. Highlight Key Moments
- Use `Sleep 1s` after important output
- Use `Sleep 500ms` between commands
- Pause on error messages or key results
- Don't rush — the viewer needs time to read

### 7. Keep Output Clean
- Use `clear` between distinct sections
- Redirect verbose output: `command 2>&1 | head -20`
- Use `Hide` for noisy setup/cleanup
- Simulate realistic but clean output

### 8. File Naming Convention
```
artifacts/tapes/
├── {episode}/
│   ├── s4a.tap       # Code: validation
│   ├── s4b.tap       # Code: creation workflow
│   ├── s4c.tap       # Code: FIDO2
│   └── s5.tap        # Demo: full lifecycle
```

### 9. Integration with FFmpeg Compose
VHS renders to MP4. The compose stage can use these MP4s directly:
- Trim or loop VHS clips to match narration duration
- Crossfade between VHS clips and static illustrations
- Overlay VHS output on Dyne-branded backgrounds

### 10. Test Render Before Committing
Always render and visually inspect:
```bash
vhs artifacts/tapes/tomb/s4a.tap
# Check: artifacts/tapes/tomb/s4a.mp4
# Verify: timing, readability, colors, cursor position
```

---

## Learnings Log

> **This section grows with every generation. Add entries chronologically.**
> Format: `### YYYY-MM-DD — Episode: Scene — Key Insight`

### Template for new entries

```
### YYYY-MM-DD — {episode}: {scene} — {one-line summary}

**Context**: What were we trying to do?

**What worked**:
- Point 1

**What didn't**:
- Point 1

**Decision**: What we'll do differently next time.

**Tape pattern** (if reusable):
```
Show a reusable .tape snippet here
```
```

### 2026-07-29 — tomb: s4a/s4b/s4c — First VHS integration attempt

**Context**: Replacing PIL-generated static code screenshots with real terminal recordings for Tomb episode code walkthrough.

**What worked**:
- VHS renders clean, antialiased terminal text at any size
- The `.tape` format is simple enough to generate programmatically
- Theme integration with Dyne colors works perfectly

**What didn't**:
- Font must be installed on the rendering machine — JetBrains Mono needs `brew install font-jetbrains-mono`
- `ttyd` is required as a dependency — must be installed alongside VHS
- `Output` command only accepts bare filenames (not paths) — render from the target directory
- `Set Theme` with a file path doesn't work; must inline the theme JSON directly in the `.tape` file
- VHS renders are short (13-36s) — need to loop or pad for longer narration scenes

**Decision**: Use VHS for ALL code/terminal scenes in Dyne episodes. Keep PIL for title cards, diagrams, and end cards. For scenes where VHS output is shorter than narration, pad the video with freeze-frame or loop at the end.

---

## Pipeline Integration

### Scene Type Detection

When writing the episode script, identify scenes that should use VHS:

| Scene intent keyword | Use VHS? | Scene type |
|---------------------|----------|------------|
| "terminal", "shell", "CLI", "command" | ✅ Yes | `terminal-demo` |
| "code walkthrough", "source", "snippet" | ✅ Yes | `code-walkthrough` |
| "title card", "end card" | ❌ No | `graphics` |
| "illustration", "diagram", "architecture" | ❌ No | `illustration` |

### Workflow

1. **Script** identifies terminal/code scenes
2. **Art direction** specifies VHS settings per scene
3. **Tape generation** creates `.tape` files from the script's code snippets
4. **VHS render** produces `.mp4` clips
5. **Compose** uses VHS clips alongside static images

### Tape Generation Strategy

For code walkthrough scenes, generate the `.tape` file from the episode's source references:

```
# Generated from episode.json scene s4a
Output assets/tapes/tomb/s4a.mp4

Set FontFamily "JetBrains Mono"
Set FontSize 22
Set Width 1200
Set Height 600
Set Padding 20
Set Margin 40
Set MarginFill "#0D0D0D"
Set BorderRadius 8
Set Framerate 30
Set Theme "library/dyne/vhs-theme.json"

Hide
Type "cat -n /usr/local/bin/tomb | sed -n '589,620p'"
Enter
Sleep 1s
Show

Sleep 3s
```

### Dependency Requirements

```bash
# Required for VHS rendering
brew install vhs ttyd font-jetbrains-mono

# Verify
vhs --version      # >= 0.11.0
ttyd --version     # any recent version
fc-list | grep JetBrains  # JetBrains Mono installed
```
