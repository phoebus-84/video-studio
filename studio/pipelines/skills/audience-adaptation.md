---
name: audience-adaptation
version: "0.1.0"
description: Adapt story content and language for a specific child age group
inputs:
  - name: story
    type: application/json
    description: Structured story from fairy-tale-ingest
  - name: target_age
    type: string
    description: Target age range
outputs:
  - adapted-story.json:
      kind: application/json
      description: Age-adapted story with vocabulary and complexity adjustments
capabilities:
  - llm
---

# Audience Adaptation

Adapt a fairy tale for the target age group.

## Age Guidelines
- **3-5**: Simple sentences, bright emotions, no scary elements, 3-4 minute runtime
- **5-7**: Clear good/evil, magical elements OK, mild tension, 4-6 minutes
- **8-10**: More complex plots, moral ambiguity, exciting moments, 6-8 minutes

## Adaptations
1. Vocabulary level appropriate for age
2. Soften frightening elements (describe outcome, not threat)
3. Emphasize positive themes (friendship, bravery, kindness)
4. Ensure diverse character representations
