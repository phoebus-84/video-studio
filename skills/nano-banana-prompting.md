# Nano Banana 2 Prompt Engineering Guide

## Model Info
- **fal.ai model**: `fal-ai/nano-banana-pro`
- **Architecture**: Gemini 3.0 Pro reasoning + GemPix 2 synthesis
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

### 5. Aspect Ratios & Resolution

**API parameter**: Use `aspect_ratio` (NOT `image_size` — that's Flux's parameter and will be ignored, defaulting to square).

Valid values:
- `"1:1"` — square (feed)
- `"16:9"` — landscape (YouTube)
- `"9:16"` — portrait (Stories/TikTok)
- `"4:3"` — classic landscape
- `"3:4"` — classic portrait

Resolution: 1K (fast prototype), 2K (production), 4K (print)

Output: PNG for text/diagrams, JPEG for photorealistic

```python
# Correct:
{"aspect_ratio": "16:9", "num_images": 1}

# Wrong — silently defaults to 1:1:
{"image_size": "landscape_16_9", "num_images": 1}
```

### 6. Cost Optimization
1. Generate 2-4 variations at 1K (fast, cheap)
2. Select the best one
3. Regenerate winner at 2K or 4K

## Fairy Tale Prompt Template
```
"[TITLE TEXT IF ANY]" storybook illustration: [SCENE DESCRIPTION].
[DETAILED VISUAL ELEMENTS]. [CHARACTER DESCRIPTION].
[MOOD/LIGHTING]. Watercolor storybook style, soft colors,
children's book illustration, [ARTIST REFERENCE].
```

### Example:
```
"Little Red Riding Hood" storybook illustration: A cheerful little girl
in a bright red hooded cloak standing at the door of a cozy cottage,
her mother handing her a wicker basket. Morning sunlight streaming
through the doorway, flowers in window boxes. Warm gold and cream
colors. Watercolor storybook style, soft edges, children's book
illustration, Beatrix Potter inspired.
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
