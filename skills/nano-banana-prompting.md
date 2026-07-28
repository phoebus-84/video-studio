# Nano Banana 2 Prompt Engineering Guide

## Model Info
- **fal.ai model**: `fal-ai/nano-banana-pro`
- **API docs**: https://fal.ai/models/fal-ai/nano-banana-pro/api
- **Architecture**: Gemini 3 Pro Image (reasoning-based, not diffusion)
- **Key innovation**: Plan → Evaluate → Improve loop (not single-pass diffusion)

## Prompting Rules

### 1. Text Rendering (the killer feature)
Put ALL text in double quotes:
```
"OPEN" neon sign in coffee shop window at night
```
NOT: `coffee shop with open sign` (text will be garbled)

Specify positioning:
```
Poster on wall reading "GRAND SALE", centered above checkout counter
```

Limit to 3-5 text elements per image. Use standard typography.

### 2. Explicit Requirements
Nano Banana 2 is a reasoning system, not a pattern matcher:
```
GOOD: text must read exactly "PREMIUM", centered at top
BAD: premium signage at top
```

### 3. Diagrams & Technical Content
Use structured descriptions:
```
Human heart diagram:
- "SUPERIOR VENA CAVA" at top
- "RIGHT ATRIUM", "RIGHT VENTRICLE"
- "AORTA" arching from top
- Red/blue color coding
- Lines pointing from labels to structures
- Medical textbook illustration style
```

### 4. Spatial Composition
Specify what goes WHERE:
```
Bathroom mirror: reflection shows poster "NEVER GIVE UP" on wall behind viewer
Towel with "HOTEL LUXE" text on RIGHT side of actual wall (not in mirror)
Toothbrush holder with "FRESH" on sink counter (actual scene, not reflection)
```

### 5. API Parameters — Complete Reference

#### `prompt` (string, required)
The text prompt to generate the image.

#### `aspect_ratio` (enum, default: `"1:1"`)
**CRITICAL**: Use `aspect_ratio`, NOT `image_size` — that's Flux's parameter and Nano Banana silently ignores unknown params, defaulting to square.

Full list: `auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16`

Most useful for video production:
- `"16:9"` — YouTube / landscape video
- `"1:1"` — square (feeds)
- `"9:16"` — portrait (Stories / Shorts)
- `"21:9"` — cinematic ultra-wide

#### `resolution` (enum, default: `"1K"`)
Values: `1K, 2K, 4K`
- **1K** — fast prototype (1024px on shortest side)
- **2K** — production quality
- **4K** — print / high detail

**Always use `"2K"` for final renders.** The 1K default produces noticeably soft images.

#### `output_format` (enum, default: `"png"`)
Values: `jpeg, png, webp`
- `png` — lossless, best for text/diagrams, larger files
- `jpeg` — smaller files, good for photorealistic without text
- `webp` — balanced, modern web format

#### `num_images` (integer, default: `1`)
Number of images to generate.

#### `seed` (integer, optional)
Fixed seed for reproducible results.

#### `system_prompt` (string, optional, default: `""`)
System instruction that steers the model's persona and output style. Sent as the system instruction to Gemini. Use for global style guidance without cluttering the main prompt.

Example: `"You are a children's book illustrator specializing in watercolor storybook art with warm, cozy palettes inspired by Beatrix Potter and Tasha Tudor."`

#### `safety_tolerance` (enum, default: `"4"`)
Values: `1, 2, 3, 4, 5, 6`
- `1` — most strict (blocks most content)
- `6` — least strict

For children's content, `"4"` (default) is appropriate. For edgier content, try `"5"` or `"6"`.

#### `limit_generations` (boolean, default: `true`)
When true, ignores any instructions in the prompt about generating multiple images. Keep `true`.

#### `enable_web_search` (boolean, optional)
Allow the model to use web search for up-to-date information.

#### `sync_mode` (boolean, optional)
If true, returns media as data URI directly. Leave false for normal usage.

#### Complete payload example:
```json
{
  "prompt": "A cozy cottage interior...",
  "aspect_ratio": "16:9",
  "resolution": "2K",
  "output_format": "jpeg",
  "num_images": 1,
  "system_prompt": "You are a children's book illustrator. Watercolor, warm, Beatrix Potter style.",
  "safety_tolerance": "4"
}
```

```python
# ✅ Correct:
{"aspect_ratio": "16:9", "resolution": "2K"}

# ❌ Wrong — silently defaults to 1:1 at 1K:
{"image_size": "landscape_16_9"}
```

### 6. Cost Optimization
1. Generate 2-4 variations at 1K (fast, cheap)
2. Select the best one
3. Regenerate winner at 2K or 4K

### 7. Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| `"image_size": "landscape_16_9"` | Square 1:1 image | Use `"aspect_ratio": "16:9"` |
| No `resolution` set | 1024px (soft) | Set `"resolution": "2K"` |
| No `system_prompt` | Inconsistent style across batch | Add style system prompt |
| PNG for photorealistic | Unnecessarily large files | Use `"output_format": "jpeg"` |

## Fairy Tale Prompt Template

### Prompt text format:
```
"[TITLE TEXT IF ANY]" storybook illustration: [SCENE DESCRIPTION].
[DETAILED VISUAL ELEMENTS]. [CHARACTER DESCRIPTION].
[MOOD/LIGHTING]. Watercolor storybook style, soft colors,
children's book illustration, [ARTIST REFERENCE].
```

### Example prompt:
```
"Little Red Riding Hood" storybook illustration: A cheerful little girl
in a bright red hooded cloak standing at the door of a cozy cottage,
her mother handing her a wicker basket. Morning sunlight streaming
through the doorway, flowers in window boxes. Warm gold and cream
colors. Watercolor storybook style, soft edges, children's book
illustration, Beatrix Potter inspired.
```

### Full API payload (production):
```json
{
  "prompt": "\"Tom Thumb\" storybook illustration: A cozy cottage interior...",
  "aspect_ratio": "16:9",
  "resolution": "2K",
  "output_format": "jpeg",
  "num_images": 1,
  "system_prompt": "You are a children's book illustrator specializing in warm, cozy watercolor storybook art. Use soft brushstrokes, organic lines, and a warm golden-hour palette. Beatrix Potter and Tasha Tudor inspired. Nothing harsh, digital, or cold.",
  "safety_tolerance": "4"
}
```

## Comparison: Nano Banana 1 vs 2

| Feature | v1 (nano-banana) | v2 (nano-banana-pro) |
|---------|-----------------|---------------------|
| Text | Often garbled | Validated character-by-character |
| Resolution | Fixed | 1K/2K/4K native |
| Reasoning | None | Plan→Evaluate→Improve |
| Diagrams | Pattern guess | Structural validation |
| Best for | Pure artistic | Text, diagrams, UI, labels |

## When to use which model
- **nano-banana-pro**: Text in images, diagrams, UI, labels, ANY text rendering
- **flux/dev**: Pure artistic/photorealistic without text needs
- **flux/schnell**: Fast iteration, no text needed
