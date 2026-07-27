# Anti-Patterns Catalog

**Version**: 1.0.0

This catalog lists invalid patterns that the linter **must** detect and reject. Each anti-pattern includes a diagnostic code, severity, and example.

## AP-001: Orchestration in Skill

**Severity**: error
**Lint Rule**: `no-orchestration-in-skill`

### Description

Skills must not contain pipeline orchestration logic (stage ordering, dependencies, retry counts, fallbacks, budgets). These belong in the pipeline manifest.

### Example (Invalid)

```yaml
---
skill:
  id: bad-skill
  pipeline: some-pipeline
  stage: some-stage
  version: "1.0.0"
  kind: producer

run_after: [other-skill]          # ← orchestration
retry_count: 3                     # ← orchestration
timeout_seconds: 300               # ← orchestration
fallback_skill: fallback-producer  # ← orchestration
---
```

### Why It's Wrong

Skills are instructions for **how** to perform work. Orchestration is **what** stages run and in what order. Mixing them creates ambiguity about who controls execution flow.

---

## AP-002: Missing Progressive Disclosure

**Severity**: error
**Lint Rule**: `requires-progressive-disclosure`

### Description

Every skill must have a `progressive_disclosure` section with at least a `summary` and `prerequisites`.

### Example (Invalid)

```yaml
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
outputs:
  - contract: something-else
    version: "1.0.0"
    required: true
---
Do the work.
```

### Why It's Wrong

Without progressive disclosure, Pi cannot determine applicability or load prerequisites before reading the full skill body. This breaks the ability to select skills dynamically.

---

## AP-003: Unstable Stage ID

**Severity**: error
**Lint Rule**: `stable-stage-id`

### Description

Stage IDs must follow the `lowercase-hyphen-separated` convention and must not be generic or ambiguous.

### Example (Invalid)

```yaml
stages:
  - id: stage_1               # ← underscore, not hyphen
  - id: STEP-TWO              # ← uppercase
  - id: doTheThing            # ← camelCase
  - id: process               # ← too generic; collides easily
```

### Valid

```yaml
stages:
  - id: brief-normalization
  - id: script-generation
```

---

## AP-004: Orphan Contract

**Severity**: error
**Lint Rule**: `no-orphan-contract`

### Description

Every output contract must have at least one consumer. Every input contract must have exactly one producer.

### Example (Invalid)

```yaml
stages:
  - id: stage-a
    outputs:
      - contract: orphan-output     # ← no stage consumes this
        version: "1.0.0"
  - id: stage-b
    inputs:
      - contract: mystery-input     # ← no stage produces this
        version: "1.0.0"
        source: prior-stage.nonexistent
```

---

## AP-005: Duplicate Contract Producer

**Severity**: error
**Lint Rule**: `no-duplicate-producer`

### Description

A contract must not be produced by more than one stage.

### Example (Invalid)

```yaml
stages:
  - id: stage-a
    outputs:
      - contract: shared-output
        version: "1.0.0"
  - id: stage-b
    outputs:
      - contract: shared-output     # ← duplicate producer
        version: "1.0.0"
```

---

## AP-006: Content-Type Conditional in Manifest

**Severity**: error
**Lint Rule**: `no-content-conditional`

### Description

Pipeline manifests must not contain conditional logic based on content type. Use separate pipelines or series overrides instead.

### Example (Invalid)

```yaml
pipeline:
  id: video-pipeline
  stages:
    - id: script-generation
      description: "If fairy tale, adapt; if repository, extract; if generic, summarize"
      # ↑ content-type branching in manifest
      inputs:
        - contract: content-type-indicator    # ← this is a content-type flag
```

### Why It's Wrong

Content-type branching in manifests creates an unmaintainable combinatorial explosion. Separate content types into distinct pipelines (e.g., `fairy-tale`, `repository-content-plan`) that share the base `narrated-illustrated-video` stages.

---

## AP-007: Missing Required Frontmatter Field

**Severity**: error
**Lint Rule**: `requires-skill-fields`

### Description

Skill frontmatter must include all required fields: `skill.id`, `skill.pipeline`, `skill.stage`, `skill.version`, `skill.kind`, `progressive_disclosure.summary`, `inputs`, and `outputs` (or `review.produces` for reviewer skills).

### Example (Invalid)

```yaml
---
skill:
  pipeline: some-pipeline
  stage: some-stage
  version: "1.0.0"
  # missing skill.id and skill.kind
---
```

---

## AP-008: Reviewer Without Checklist

**Severity**: error
**Lint Rule**: `reviewer-requires-checklist`

### Description

A skill with `kind: reviewer` or `kind: mixed` must include a `review` section with a `checklist` array.

### Example (Invalid)

```yaml
---
skill:
  id: lazy-reviewer
  pipeline: some-pipeline
  stage: some-stage
  version: "1.0.0"
  kind: reviewer
# missing entire review section
---
```

---

## AP-009: Invalid Kind Value

**Severity**: error
**Lint Rule**: `valid-kind`

### Description

`skill.kind` must be one of: `producer`, `reviewer`, `mixed`.

### Example (Invalid)

```yaml
skill:
  kind: generator    # ← not a valid kind
```

---

## AP-010: Budget in Skill

**Severity**: error
**Lint Rule**: `no-budget-in-skill`

### Description

Budget limits (wall time, tokens) belong in the pipeline manifest `stages[].gates.budget`, not in skill frontmatter.

### Example (Invalid)

```yaml
---
skill:
  id: budgeted-skill
  # ...
budget:
  wall_time: "10m"    # ← belongs in manifest
  tokens: 40000        # ← belongs in manifest
---
```

---

## AP-011: Non-Semver Version

**Severity**: error
**Lint Rule**: `requires-semver`

### Description

All `version` fields must be valid semver strings (e.g., `1.0.0`, `2.1.3-alpha`).

### Example (Invalid)

```yaml
version: "one-point-oh"    # ← not semver
version: "1.0"              # ← incomplete semver
version: 1.0                # ← not a string
```

---

## AP-012: Pipeline ID / Stage ID Mismatch

**Severity**: error
**Lint Rule**: `id-consistency`

### Description

A skill's `skill.pipeline` and `skill.stage` must reference IDs that exist in the pipeline manifest. The skill file path must match: `skills/<pipeline-id>/<skill-id>/SKILL.md`.

### Example (Invalid)

```yaml
# File: skills/fairy-tale/brief-normalizer/SKILL.md
skill:
  pipeline: narrated-illustrated-video    # ← pipeline mismatch with file path
  stage: source-ingest                     # ← stage mismatch with skill ID
```

---

## AP-013: Gate Logic in Skill

**Severity**: error
**Lint Rule**: `no-gate-in-skill`

### Description

Gate configuration (`autopilot`, `review`, `retry_on_failure`) belongs in the pipeline manifest, not in skill frontmatter.

### Example (Invalid)

```yaml
---
skill:
  id: self-gating-skill
  # ...
gates:
  autopilot: true             # ← belongs in manifest
  review: human               # ← belongs in manifest
---
```

---

## AP-014: Empty Stage List

**Severity**: error
**Lint Rule**: `stages-required`

### Description

A pipeline manifest must declare at least one stage.

### Example (Invalid)

```yaml
pipeline:
  id: empty-pipeline
  version: "1.0.0"
  stages: []          # ← no stages defined
```

---

## AP-015: Circular Stage Dependency

**Severity**: error
**Lint Rule**: `no-circular-deps`

### Description

Stage dependencies must form a directed acyclic graph (DAG). Circular dependencies are invalid.

### Example (Invalid)

```yaml
stages:
  - id: stage-a
    depends_on: [stage-b]
  - id: stage-b
    depends_on: [stage-a]    # ← circular
```

---

## AP-016: Series Override Removes Built-in Stage

**Severity**: error
**Lint Rule**: `no-stage-removal`

### Description

Series override files must not attempt to remove or disable built-in pipeline stages. They may only gate-override, add stages, or replace skill references.

### Example (Invalid)

```yaml
overrides:
  pipeline: fairy-tale
  version: "1.0.0"
  remove_stages:            # ← this operation is not allowed
    - safety-review
```
