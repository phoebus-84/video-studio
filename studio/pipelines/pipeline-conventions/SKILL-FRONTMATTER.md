# Skill Frontmatter Convention

**Version**: 1.0.0
**Phase**: foundation
**Status**: stable

## Purpose

A skill teaches Pi **how** to perform or review a pipeline stage. Skills are authored as structured Markdown files with YAML frontmatter. The frontmatter declares what the skill does, which pipeline stage it belongs to, and how it should be progressively disclosed.

## Skill File

- **Location**: `skills/<pipeline-id>/<skill-id>/SKILL.md`
- **Format**: Markdown with YAML frontmatter (delimited by `---`), UTF-8, LF line endings
- **Naming**: skill ID is lowercase, hyphen-separated (`brief-normalizer`, `script-writer`)

## Frontmatter Schema

```yaml
---
# Required fields
skill:
  id: brief-normalizer                  # stable skill ID; matches manifest skill reference
  pipeline: narrated-illustrated-video  # pipeline ID this skill belongs to
  stage: brief-normalization            # stage ID this skill implements
  version: "1.0.0"                     # semver
  kind: producer                        # producer | reviewer | mixed

# Progressive disclosure
progressive_disclosure:
  summary: |
    Normalize a content brief into structured, verifiable constraints.
    Extract audience, duration, tone, and safety parameters.
  prerequisites:                        # what Pi must know before loading this skill
    - contract: content-brief           # contract the skill consumes
      version: "1.0.0"
    - contract: normalized-brief        # contract the skill produces
      version: "1.0.0"
  knowledge:                            # optional knowledge references
    - ref: docs/glossary.md#brief       # internal doc reference
    - ref: contracts/content-brief.md   # contract specification

# I/O specification
inputs:
  - contract: content-brief
    version: "1.0.0"
    required: true
    description: "Raw content brief from the upstream source"
outputs:
  - contract: normalized-brief
    version: "1.0.0"
    required: true
    description: "Structured brief with verified constraints"

# Reviewer configuration (only when kind = reviewer or mixed)
review:
  checklist:                            # items the reviewer checks
    - id: contract-completeness
      description: "All required contract fields are present and typed correctly"
      severity: error                   # error | warning | info
    - id: budget-within-limits
      description: "Token and wall-time estimates are within stage budget"
      severity: error
    - id: attribution-present
      description: "Source attribution is included where applicable"
      severity: warning
  format: structured                    # structured | freeform | pass-fail
  produces:                             # what the review produces
    - contract: stage-review
      version: "1.0.0"

# Metadata
metadata:
  author: contributor-name
  created: "2026-07-27"
  tags:
    - foundation
    - pipeline:narrated-illustrated-video
    - stage:brief-normalization
---
```

## Required Frontmatter Fields

| Field                              | Type    | Description                                                |
|------------------------------------|---------|------------------------------------------------------------|
| `skill.id`                         | string  | Stable skill ID matching a manifest `skills[].skill`       |
| `skill.pipeline`                   | string  | Pipeline ID this skill belongs to                          |
| `skill.stage`                      | string  | Stage ID this skill implements                             |
| `skill.version`                    | string  | Semver                                                     |
| `skill.kind`                       | string  | `producer`, `reviewer`, or `mixed`                         |
| `progressive_disclosure.summary`   | string  | One-paragraph summary of what the skill does               |
| `progressive_disclosure.prerequisites` | array | Contracts Pi must understand before loading the skill |
| `inputs`                           | array   | At least one input contract                                |
| `outputs`                          | array   | At least one output contract (producer/mixed) or `produces` (reviewer) |

## Progressive Disclosure

Skills follow a progressive-disclosure pattern:

1. **Frontmatter summary** — what the skill does in one paragraph
2. **Prerequisites** — contracts and concepts Pi must understand first
3. **Skill body** — the detailed Markdown instruction (below the frontmatter)
4. **References** — links to contract specs, glossary, and related skills

The frontmatter alone must give Pi enough information to:
- Determine if this skill is applicable to the current stage
- Load required contract definitions before proceeding
- Decide whether human review is needed

## Reviewer Skills

A skill with `kind: reviewer` or `kind: mixed` must include a `review` section with:

- `checklist`: ordered list of items the reviewer checks
- `format`: output format (`structured`, `freeform`, or `pass-fail`)
- `produces`: the contract produced by the review

Each checklist item must have:
- `id`: stable identifier
- `description`: what is checked
- `severity`: `error` (must fix), `warning` (should fix), or `info` (noteworthy)

## What Belongs in a Skill — and What Does Not

### ✓ IN a skill

- Instructions for how to produce or review an artifact
- Contract field descriptions and validation rules
- Quality checklist items and severity thresholds
- Examples of correct output
- Edge case handling guidance
- Reference to contract specifications

### ✗ NOT in a skill (belongs in manifests or operator config)

- Stage ordering or dependency declarations
- Gate configuration (autopilot, retry count, budget)
- Pipeline-level capability requirements
- File paths to runtime resources
- Credentials or API keys
- Execution environment configuration

## Anti-Pattern: Inline Orchestration

```yaml
# ✗ BAD: skill frontmatter contains orchestration logic
skill:
  id: bad-skill
  # ...
  run_after: [some-other-skill]       # ← belongs in manifest stages[].depends_on
  retry_count: 3                       # ← belongs in manifest stages[].gates.retry_on_failure
  timeout_seconds: 300                 # ← belongs in manifest stages[].gates.budget
  fallback_skill: fallback-producer    # ← belongs in operator configuration
```

## Anti-Pattern: Missing Progressive Disclosure

```yaml
# ✗ BAD: no progressive_disclosure section at all
---
skill:
  id: opaque-skill
  pipeline: some-pipeline
  stage: some-stage
  version: "1.0.0"
  kind: producer
inputs:
  - contract: something
    version: "1.0.0"
    required: true
---
Perform the work using the best approach.
```

This gives Pi no summary to determine applicability and no prerequisites to load context.
