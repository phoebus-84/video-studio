---
name: content-plan
version: "0.1.0"
description: Generate a multi-episode Content Plan from repository analysis
inputs:
  - name: analysis
    type: application/json
    description: Repository analysis from repo-analysis skill
outputs:
  - content-plan.json:
      kind: application/json
      description: Episode plan with titles, descriptions, and dependencies
capabilities:
  - llm
---

# Content Plan

Generate a structured episode plan from repository analysis.

## Episode Types
- **Overview** — What the project does, why it exists
- **Architecture** — How it's structured, design decisions
- **Module Deep-Dive** — Detailed walkthrough of one module
- **Tutorial** — How to use a specific feature
- **Contributing** — How to set up, build, and contribute

## Output
```json
{
  "series": {
    "title": "Understanding [Project]",
    "description": "...",
    "estimated_total_runtime_minutes": 45
  },
  "episodes": [
    {
      "number": 1,
      "title": "Introduction to [Project]",
      "type": "overview",
      "description": "...",
      "estimated_runtime_minutes": 5,
      "modules_covered": ["..."],
      "prerequisites": []
    }
  ]
}
```

Minimum 3 episodes for any non-trivial repository.
