# Operator Guide

**Version**: 1.0.0

## Purpose

This guide explains how to operate pipelines defined in this repository. It covers pipeline execution model, stage lifecycle, gate behavior, diagnostics, and series configuration.

## Pipeline Execution Model

Pipelines in this repository are **declarative manifests** that define what must happen and which contracts prove completion. The execution environment (the "runtime") reads manifests, resolves dependencies, and invokes skills to produce artifacts.

### What You Control

| Concern                | Where Configured          | Example                        |
|------------------------|---------------------------|--------------------------------|
| Stage ordering         | Pipeline manifest         | `stages[].depends_on`         |
| Gate review policy     | Pipeline manifest         | `stages[].gates.review`       |
| Retry behavior         | Pipeline manifest         | `stages[].gates.retry_on_failure` |
| Budget limits          | Pipeline manifest         | `stages[].gates.budget`       |
| Series customization   | Series override file      | `series/<id>/overrides/...`   |
| Skill instructions     | SKILL.md files            | `skills/*/SKILL.md`           |

### What the Runtime Controls

- Actual LLM invocations
- Tool execution
- Retry scheduling and backoff
- Logging and telemetry
- Credential management
- File I/O paths and artifact storage

## Stage Lifecycle

```
PENDING → VALIDATING_INPUTS → RUNNING → REVIEWING → COMPLETE
                                     ↘ FAILED → (retry or BLOCKED)
```

1. **PENDING**: Stage is waiting for dependencies to complete.
2. **VALIDATING_INPUTS**: Runtime checks that all input contracts are present and version-compatible.
3. **RUNNING**: Skills are invoked to produce output artifacts.
4. **REVIEWING**: If `gates.review` is set, the reviewer skill or human operator assesses outputs.
5. **COMPLETE**: All outputs produced and validated; stage passes.
6. **FAILED**: Runtime error, budget exceeded, or contract validation failure.
7. **BLOCKED**: Reviewer found error-severity issues; requires operator intervention.

## Gate Behavior

### Autopilot Mode

When `gates.autopilot: true` and `gates.review: none`, stages run fully automatically. The runtime invokes the skill, validates outputs against contracts, and proceeds to the next stage.

### Review Gates

| `gates.review`    | Behavior                                                        |
|-------------------|-----------------------------------------------------------------|
| `none`            | No review; output validation only                               |
| `skill`           | Reviewer skill automatically assesses outputs                   |
| `human`           | Operator must manually approve before stage can complete        |
| `human-or-skill`  | Reviewer skill runs first; operator can override if needed      |

### Retry Behavior

`gates.retry_on_failure` specifies the maximum number of automatic retries before escalating to the operator. Retries use exponential backoff (controlled by the runtime, not the manifest).

### Budget Enforcement

If `gates.budget` is set, the runtime tracks wall time and token consumption. When a budget is exceeded, the stage fails with a `budget_exceeded` diagnostic. Budgets are per-stage, not cumulative.

## Reading Diagnostics

All failures produce machine-readable diagnostics to stderr. Example:

```
ERROR [contract_version_mismatch] brief-normalization stage
  Contract "content-brief": expected 1.2.0, available 1.0.0 (major mismatch)
  Action: Update the upstream brief to contract version 1.2.0,
          or downgrade the pipeline stage requirement.
```

Diagnostics have a consistent structure:
- **Stage**: which stage failed
- **Status**: `failed` or `blocked`
- **Reason**: machine-readable error code
- **Detail**: structured context
- **Action**: human-readable remediation

See [STAGE-I-O-CHECKLIST.md](../pipeline-conventions/STAGE-I-O-CHECKLIST.md) for the full error code catalog.

## Series Configuration

Series customize pipelines without modifying built-in manifests. A series is a directory under `series/<series-id>/` with:

- `series.yaml`: series manifest — which pipelines, default audience, duration, safety profile
- `overrides/pipelines/<pipeline-id>.yaml`: gate changes, added stages, skill replacements
- `overrides/skills/`: series-specific skill variants
- `overrides/contracts/`: series-local contract data (style guides, audience profiles)
- `episodes/`: per-episode input overrides

### Creating a Series

1. Create `series/<series-id>/series.yaml`
2. Create override files for any pipelines you need to customize
3. Never modify files in `pipelines/` or `skills/` — overrides are additive

### Common Override Scenarios

**Tighten review for child content:**
```yaml
overrides:
  pipeline: fairy-tale
  stages:
    - id: audience-adaptation
      gates:
        review: human          # was: skill
    - id: safety-review
      gates:
        review: human          # was: human-or-skill
```

**Add branding intro:**
```yaml
overrides:
  pipeline: fairy-tale
  add_stages:
    - after: safety-review
      stage:
        id: series-branding-intro
        # ... full stage definition
```

**Use series-specific style:**
```yaml
overrides:
  pipeline: fairy-tale
  stages:
    - id: visuals-generation
      inputs:
        - contract: series-style-guide
          source: series-local
```

## Verification

Before deploying changes, run:

```bash
npm run lint     # Lint all fixtures
npm test         # Run all tests
```

## Troubleshooting

| Symptom                                  | Likely Cause                    | Fix                                         |
|------------------------------------------|---------------------------------|---------------------------------------------|
| Stage blocked on review                  | Error-severity checklist item   | Read diagnostic, fix output, re-run stage   |
| `contract_missing` error                 | Upstream contract not provided  | Provide series-local override or fix caller |
| `contract_version_mismatch` (major)      | Pipeline expects newer schema   | Upgrade upstream or pin pipeline version    |
| `contract_duplicate_producer`            | Two stages claim same contract | Fix manifest to remove duplicate             |
| `budget_exceeded`                        | Stage too expensive             | Increase budget or optimize skill           |
| `stage_dependency_unsatisfied`           | Prior stage failed              | Fix and re-run prior stage                  |
| `capability_unavailable`                 | Environment missing capability  | Ensure execution environment supports it    |
