# Reviewer Format

**Version**: 1.0.0

## Purpose

Reviewer skills produce structured, machine-actionable assessments of stage outputs. The review format is standardized so that gates can consume review results automatically.

## Review Contract

Every review produces a `stage-review` contract (version `1.0.0`):

```yaml
review:
  stage: brief-normalization                    # stage being reviewed
  reviewer: brief-reviewer                       # skill that performed the review
  version: "1.0.0"
  status: blocked                                # passed | blocked | warning
  timestamp: "2026-07-27T14:30:00Z"
  checklist:                                     # mirror of the reviewer's checklist
    - id: contract-completeness
      description: "All required contract fields are present and typed correctly"
      severity: error
      result: pass                               # pass | fail | skipped
      detail: null
    - id: budget-within-limits
      description: "Token and wall-time estimates are within stage budget"
      severity: error
      result: fail
      detail: "Estimated tokens 15000 exceed budget 10000 by 50%"
    - id: attribution-present
      description: "Source attribution is included where applicable"
      severity: warning
      result: skip                               # skipped because no external sources
      detail: "Stage uses no external sources; attribution not applicable"
  summary: >
    Budget violation on token estimate. Reduce scope or increase budget.
    All other checks pass.
  artifacts_reviewed:
    - contract: normalized-brief
      version: "1.0.0"
      digest: sha256:abc123...                   # content hash for audit
```

## Review Status Semantics

| Status    | Meaning                                                      | Gate Behavior                    |
|-----------|--------------------------------------------------------------|----------------------------------|
| `passed`  | All checklist items pass or are skipped; no errors or warnings | Stage proceeds automatically   |
| `blocked` | At least one `error`-severity item failed                     | Stage is blocked; operator must resolve |
| `warning` | At least one `warning`-severity item failed; no errors        | Stage proceeds but warning is recorded for audit |

## Checklist Item Results

| Result   | Meaning                                                   |
|----------|-----------------------------------------------------------|
| `pass`   | The item was checked and satisfies the requirement        |
| `fail`   | The item was checked and does NOT satisfy the requirement |
| `skip`   | The item is not applicable to this stage's outputs        |

When a checklist item fails, `detail` must contain a human-readable explanation and, where possible, a suggested fix.

## Structured vs. Freeform

### Structured (default)

All checklist items are individually assessed with `pass`/`fail`/`skip` results. The review contract is fully machine-readable. Use `format: structured` in skill frontmatter.

### Freeform

The reviewer produces a narrative assessment. The review contract includes a `narrative` field with free-text findings but still uses the standard `status` field. Use `format: freeform`.

### Pass-Fail

The reviewer returns only `status: passed` or `status: blocked` with a brief reason. Individual checklist items are not reported. Use `format: pass-fail` for simple gate checks.

## Reviewer Invocation

Reviewers are invoked by the execution environment after a producer stage completes, **if and only if** the stage manifest declares `gates.review` as `skill` or `human-or-skill`.

The reviewer receives:
1. The stage's output artifacts (by contract ID)
2. The stage's manifest definition
3. The pipeline context (upstream inputs, series configuration)

The reviewer must **not**:
- Modify the artifacts it reviews
- Access artifacts from stages it does not explicitly depend on
- Produce side effects outside the review contract

## Audit Trail

Every review is recorded in the stage audit trail. When a review blocks a stage, the trail captures:

1. The review contract (full YAML)
2. The artifact digests at time of review
3. The reviewer skill version
4. The operator action that resolved the block (or escalated)
