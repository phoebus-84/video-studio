---
name: fairy-tale-ingest
version: "0.1.0"
description: Ingest and structure a public-domain fairy tale for adaptation
inputs:
  - name: source
    type: text
    description: Raw text of the fairy tale
  - name: target_age
    type: string
    description: Target age range (e.g. "5-7", "8-10")
outputs:
  - story-structured.json:
      kind: application/json
      description: Structured story with scenes, characters, and key moments
capabilities:
  - llm
---

# Fairy Tale Ingest

Parse a fairy tale into structured scenes for video adaptation.

## Output Format
```json
{
  "title": "Original Title",
  "author": "Author (if known)",
  "source": "Public domain source",
  "target_age": "5-7",
  "characters": [
    { "name": "...", "role": "protagonist", "description": "..." }
  ],
  "scenes": [
    {
      "number": 1,
      "title": "...",
      "summary": "...",
      "key_dialogue": "...",
      "visual_moment": "...",
      "emotional_beat": "wonder"
    }
  ],
  "adaptation_notes": {
    "themes_to_emphasize": ["kindness", "courage"],
    "elements_to_soften": ["frightening imagery"],
    "suggested_runtime_minutes": 5
  }
}
```
