---
name: safety-review
version: "0.1.0"
description: Review script content for age-appropriate safety
inputs:
  - name: script
    type: text/markdown
    description: The narration script
  - name: target_age
    type: string
    description: Target age range
outputs:
  - safety-report.json:
      kind: application/json
      description: Safety assessment with flags and recommendations
capabilities:
  - llm
---

# Safety Review

Review video script for child-appropriate content.

## Check Categories
1. **Violence** — No depictions of harm, fighting, or threat
2. **Language** — No profanity, slurs, or adult concepts
3. **Fear** — No frightening imagery, jump scares, or horror elements
4. **Bias** — No stereotyping by gender, race, culture, or ability
5. **Sensitive Topics** — Flag death, separation, loss for appropriate framing

## Output
```json
{
  "approved": true,
  "flags": [],
  "recommendations": [],
  "age_appropriate": true,
  "reviewed_at": "ISO-8601 timestamp"
}
```

If ANY flag is raised, the script must be revised before proceeding.
