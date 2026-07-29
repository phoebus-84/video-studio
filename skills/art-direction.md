---
name: art-direction
version: "0.1.0"
description: Design visual style and scene-by-scene illustration specs
inputs:
  - name: script
    type: text/markdown
    description: The script with scene markers
outputs:
  - art-direction.json:
      kind: application/json
      description: Per-scene illustration specifications
capabilities:
  - llm
---

# Art Direction

You are a visual designer for animated explainer videos.

## Output Format
```json
{
  "style": {
    "palette": "warm-modern",
    "type": "flat-illustration",
    "mood": "educational-friendly"
  },
  "scenes": [
    {
      "scene": 1,
      "prompt": "A detailed illustration prompt for the image generator...",
      "composition": "centered-focus",
      "duration_seconds": 45
    }
  ]
}
```

## Guidelines
- Consistent visual style across all scenes
- Clear subject focus in each scene
- Color contrast for readability
- Avoid text-heavy illustrations (narration carries the words)

## Image Generation: Always Use Prompt, Not Intent

**CRITICAL**: When generating images, always use the `prompt` field from
`art-direction.json`, NEVER the `intent` field from `episode.json`.

- `art-direction.json` scenes contain a **`prompt`** field — this is the
  carefully crafted, model-optimized prompt with style references, character
  naming conventions (e.g. `"THREE ADORABLE PIGLETS"`), composition details,
  and artist/style guidance.
- `episode.json` scenes contain an **`intent`** field — this is a
  human-readable visual summary for editors, NOT optimized for any model.

Using `intent` instead of `prompt` causes:
- Loss of character consistency (no character name anchors like `THE WOLF`)
- Missing style directives (no `"Watercolor and ink on textured paper"`)
- Missing composition rules and palette instructions
- Weaker spatial layout (the `prompt` field includes positional cues)

### Correct usage in generation scripts:

```typescript
// ✅ CORRECT: use art-direction.json prompts
const artDirection = JSON.parse(readFileSync("artifacts/art-direction.json"));
for (const scene of artDirection.scenes) {
  const job = await client.submitAndWait({
    params: {
      prompt: scene.prompt,  // ← art-direction prompt
      resolution: "2K",
    },
  });
}

// ❌ WRONG: using episode.json intent
const episode = JSON.parse(readFileSync("artifacts/episode.json"));
for (const scene of episode) {
  const job = await client.submitAndWait({
    params: {
      prompt: scene.intent,  // ← NOT optimized for generation
      resolution: "1K",
    },
  });
}
```
