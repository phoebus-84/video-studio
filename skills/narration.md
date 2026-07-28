---
name: narration
version: "0.1.0"
description: Synthesize narration audio from script using Qwen3-TTS CustomVoice with multi-character support
inputs:
  - name: script
    type: text/markdown
    description: The narration script with character annotations
outputs:
  - narration/:
      kind: audio/wav
      description: Per-scene WAV files in artifacts/narration/
capabilities:
  - llm
  - tts-worker
---

# Narration

Synthesize narration audio from the script using the Qwen3-TTS CustomVoice 8-bit model
running on the local TTS worker (`http://127.0.0.1:5197`).

## Process

1. Load the narration script (`artifacts/narration-script.json`)
2. Identify scenes with direct speech vs. pure narration
3. Map each character to a CustomVoice preset speaker
4. For multi-character scenes, split text at dialogue boundaries, synthesize each
   segment with the appropriate speaker, and concatenate WAVs
5. Save per-scene WAV files and update metadata JSON

## Model

Always pass `instruct` to trigger the 8-bit CustomVoice model (`qwen3-tts-1.7b-customvoice-8bit`).
Without `instruct`, the worker falls back to the lower-quality 0.6B 4-bit model.

API: `POST http://127.0.0.1:5197/synthesize`

```json
{
  "text": "Narration text",
  "voice": "<speaker_name>",
  "speed": 1.0,
  "instruct": "<emotion/style instruction>"
}
```

## CustomVoice Preset Speakers

| Speaker | Character | Notes |
|---------|-----------|-------|
| `serena` | Narrator, Fairy Godmother | Warm, gentle female voice. Default narrator. |
| `vivian` | Young girl, Little Red, Cinderella | Young, innocent, sweet voice. |
| `uncle_fu` | Wolf, villain, gruff characters | Male voice. Can go from smooth-charming to deep-growling via instruct. |
| `ryan` | Woodcutter, male hero | Strong, kind male voice. |
| `ono_anna` | Grandmother, older female | Elderly female voice. |
| `aiden` | Young male | Boy/young man voice. |
| `sohee` | Female (alt) | Alternative female voice. |
| `eric` | Male (alt) | Alternative male voice. |
| `dylan` | Male (alt) | Alternative male voice. |

**Important**: Pass the exact speaker name as `voice`. When `instruct` is set,
unknown names are silently mapped to `serena`.

## Multi-Character Scenes

Use **split-and-concatenate**: split the text at dialogue boundaries, synthesize
each segment with the character's preset speaker, then concatenate WAVs with `wave`.

### Example: Little Red s4

```python
segments = [
    ("uncle_fu", "Good day, Little Red Riding Hood,", wolf_instruct),
    ("serena",  " said the wolf in his smoothest voice. ", narrator_instruct),
    ("uncle_fu", "Where are you going on this fine morning? ", wolf_instruct),
    ("serena",  "Little Red, forgetting her mother's warning...", narrator_instruct),
]
```

**Attribution text** ("said the wolf", "she whispered") belongs to the narrator,
not the character. Split accordingly.

### Anti-pattern: Inline Character Tags

Do NOT use `Name: dialogue` inline format — the model reads character names aloud.
The `mlx_audio` `generate_audio` function does not expose multi-character tagging.

## Instruct Prompts

### Narrator (serena)
```
Speak warmly and gently, like a storyteller reading a fairy tale to a young child.
Soft, calm, and full of wonder.
```

### Young Girl (vivian)
```
Speak with a young, innocent, sweet girl voice. Curious and trusting.
```

### Wolf — Charming (uncle_fu)
```
Speak with a sly, smooth, charming voice like a clever wolf. Polite but cunning.
Keep it concise and natural, no unnecessary pauses.
```

### Wolf — Disguised as Grandmother (uncle_fu)
```
Speak with a raspy, hoarse voice, trying to sound like an old grandmother
but clearly a wolf in disguise. Strained and creaky.
```

### Wolf — Growl (uncle_fu)
```
Speak with a deep, growling, menacing wolf voice. Fierce, sudden, and hungry.
```

### Fairy Godmother (serena or ono_anna)
```
Speak with a warm, magical, grandmotherly voice. Kind and twinkling,
like a fairy godmother. Soft and full of gentle wonder.
```

### Woodcutter (ryan)
```
Speak with a strong, kind, heroic voice. Determined and brave.
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Short line takes 20s+ with breaths | Bad model generation | Re-synthesize that segment |
| Character names read aloud | Inline tag format used | Switch to split+concatenate |
| All voices sound the same | Voice mapped to serena | Pass exact CV speaker name |
| TTS worker unreachable | Wrong port | Worker runs on **5197**, not 5199 |

## Quality Checks

- Character voices are audibly distinct between speakers
- Attribution text ("she said") is in narrator voice, not character voice
- No unnecessary pauses or breathing artifacts
- All WAV files exist and have reasonable durations for their text length
- Duration roughly matches 2.5–3 words per second for natural speech
