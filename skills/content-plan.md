---
name: content-plan
version: "0.1.0"
description: Generate a multi-episode Content Plan from repository analysis
inputs:
  - name: analysis
    type: application/json
    description: Repository analysis from repo-analysis skill
  - name: target_audience
    type: string
    description: Target audience (developers, beginners, architects)
outputs:
  - content-plan.json:
      kind: application/json
      description: Episode plan with titles, descriptions, and dependencies
capabilities:
  - llm
---

# Content Plan

Transform a repository analysis into a structured multi-episode video series plan.

## Episode Structure Rules

Every episode in a documentation series must have:
1. A clear **learning objective** — what the viewer will understand after watching
2. A **visual hook** in the first 30 seconds — diagram, demo, or provocative question
3. **Code frames** at 2-4 key moments showing actual source
4. At least one **architecture diagram** per technical episode
5. A **call to action** — try this, read more, watch next episode

## Episode Types

### Overview Episode
- **Purpose**: Introduce the project — what, why, who
- **Runtime**: 3-5 minutes
- **Structure**: Problem → Solution → Demo → Architecture preview → What's next
- **Visuals**: Title card, project logo/brand, brief demo screen recording, high-level diagram
- **Code**: 1-2 short code snippets showing core API
- **Position**: Always episode 1

### Architecture Deep-Dive
- **Purpose**: Explain how the system is structured
- **Runtime**: 5-8 minutes
- **Structure**: Pattern → Layers → Key abstractions → Data flow → Design decisions
- **Visuals**: Full architecture diagram, layer-by-layer detail, comparison tables
- **Code**: Key interface/type definitions, wiring/DI setup, configuration
- **Position**: Episode 2 (after overview)

### Module Walkthrough
- **Purpose**: Detailed exploration of one major module
- **Runtime**: 5-8 minutes
- **Structure**: Module purpose → Entry points → Key functions/classes → Tests → Edge cases
- **Visuals**: Module dependency graph, call flow diagram, before/after comparisons
- **Code**: 3-5 code frames showing the module's logic
- **Position**: Episodes 3+ (one per major module)

### Tutorial Episode
- **Purpose**: Hands-on walkthrough of a specific task
- **Runtime**: 5-10 minutes
- **Structure**: Goal → Prerequisites → Step-by-step → Result → Variations
- **Visuals**: Step indicators, terminal output, before/after screenshots
- **Code**: Complete code examples, diff views for changes
- **Position**: Middle-to-late series

### Contributor Guide
- **Purpose**: How to set up, build, test, and contribute
- **Runtime**: 5-7 minutes
- **Structure**: Prerequisites → Setup → Build → Test → PR workflow → Style guide
- **Visuals**: Terminal recordings, workflow diagram, PR checklist
- **Code**: Build commands, test examples, PR template
- **Position**: Usually last episode

## Ordering Rules
1. Overview always first
2. Architecture always second (context before details)
3. Modules in dependency order (dependents come after their dependencies)
4. Tutorial episodes after the modules they reference
5. Contributor guide as last episode (or second-to-last if there's a conclusion)

## Series Title Convention
- Format: "[Verb] [Project Name]" or "Understanding [Project Name]"
- Examples: "Building with TanStack Router", "Understanding React Server Components"
- NOT: "How To..." (too tutorial-specific for a series)

## Minimum Requirements
A non-trivial repository (>1000 lines, >3 modules) must have:
- Minimum **3 episodes** (Overview + Architecture + at least one module walkthrough)
- Maximum **8 episodes** for MVP (larger repos get a "Part 2" series)

## Output Schema
```json
{
  "series": {
    "title": "Understanding Example Project",
    "summary": "A 4-episode series exploring the architecture, design patterns, and key modules of Example Project — a modern TypeScript framework for building data pipelines.",
    "estimated_total_runtime_minutes": 25,
    "target_audience": "Intermediate TypeScript developers",
    "prerequisites": "Familiarity with TypeScript and basic async patterns"
  },
  "episodes": [
    {
      "number": 1,
      "title": "What is Example Project?",
      "type": "overview",
      "learning_objective": "Understand what problem Example Project solves and when to use it",
      "description": "Introduction to Example Project: the data pipeline problem, how Example Project solves it with a declarative API, and a live demo of building a simple pipeline in 2 minutes.",
      "estimated_runtime_minutes": 5,
      "visual_plan": {
        "hook": "Title card: 'You''re building pipelines wrong' — then show 50 lines of imperative code shrinking to 10 lines of Example Project",
        "diagrams": ["High-level pipeline overview (3 boxes: Source → Transform → Sink)"],
        "code_frames": ["src/index.ts — basic pipeline example (10 lines)", "package.json — dependencies (5 lines)"]
      },
      "modules_covered": ["Overview / all"],
      "prerequisites": []
    },
    {
      "number": 2,
      "title": "Architecture: Pipelines, Stages, and Middleware",
      "type": "architecture",
      "learning_objective": "Understand the pipeline architecture and how stages, middleware, and error handling compose",
      "description": "Deep dive into Example Project's architecture: the pipeline abstraction, stage lifecycle, middleware pattern, and error recovery strategy.",
      "estimated_runtime_minutes": 7,
      "visual_plan": {
        "hook": "Split-screen: a pipeline failing without middleware, then the same pipeline with retry middleware succeeding",
        "diagrams": [
          "Full architecture diagram: Pipeline → Stages → Middleware → Transports",
          "Middleware chain flow diagram"
        ],
        "code_frames": [
          "src/core/Pipeline.ts — Pipeline class definition",
          "src/core/Middleware.ts — Middleware interface",
          "src/core/Stage.ts — Stage lifecycle"
        ]
      },
      "modules_covered": ["src/core"],
      "prerequisites": [1]
    }
  ]
}
```

## Quality Checklist
- [ ] Series has 3-8 episodes
- [ ] Episode 1 is always overview type
- [ ] Every technical episode has at least one diagram
- [ ] Every episode has at least 2 code frames
- [ ] Episodes form a logical learning progression
- [ ] Total runtime is between 15-60 minutes
- [ ] Each episode has a clear learning objective
- [ ] Module walkthroughs cover distinct, non-overlapping modules
- [ ] File paths in code_frames reference actual files from repo-analysis.json
