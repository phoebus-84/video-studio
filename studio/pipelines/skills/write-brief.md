---
name: write-brief
version: "0.1.0"
description: Research a video topic and produce a structured creative brief
inputs:
  - name: topic
    type: string
    description: The topic to create a brief for
  - name: audience
    type: string
    description: Target audience description
  - name: duration_minutes
    type: number
    description: Target video duration in minutes (3–8)
outputs:
  - brief.md:
      kind: text/markdown
      description: Structured brief with topic outline, key points, and research notes
capabilities:
  - llm
---

# Write Brief

You are a video producer creating a structured creative brief.

## Task
Research the topic and produce a brief that covers:

1. **Topic Overview** — 2–3 paragraph summary
2. **Key Points** — 5–8 bullet points to cover in the video
3. **Audience Adaptation** — How to pitch this for the target audience
4. **Research Notes** — Citations, sources, or technical references
5. **Visual Suggestions** — 3–5 ideas for illustrations or diagrams

The brief should be thorough enough for a scriptwriter to work from without additional research.
