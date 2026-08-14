# Stage Input/Output Checklist

**Version**: 1.0.0

Every pipeline stage must satisfy this checklist before it can be considered complete.

## Input Validation

Before a stage begins execution, the runtime verifies:

### Contract Presence
- [ ] Every input contract declared in the manifest is available
- [ ] Each contract has a single, unambiguous producer
- [ ] No contract is produced by more than one stage (duplicate producer)
- [ ] Upstream contracts come from the caller or a series-local override

### Contract Version Compatibility
- [ ] `major` version of available contract matches declared requirement
- [ ] `minor` version of available contract is ≥ declared requirement
- [ ] Version mismatch under `minor` produces a **warning** diagnostic
- [ ] Version mismatch under `major` produces an **error** diagnostic and blocks the stage

### Source Resolution
- [ ] `upstream` sources are present in the pipeline invocation context
- [ ] `prior-stage.<id>` sources reference a stage that has completed successfully
- [ ] `series-local` sources exist in the series override directory

## Output Validation

After a stage completes, the runtime verifies:

### Contract Completeness
- [ ] Every output contract declared in the manifest has been produced
- [ ] Each output artifact conforms to its contract schema
- [ ] Required fields are present and correctly typed
- [ ] Optional fields are absent or correctly typed

### Artifact Integrity
- [ ] Output artifacts are not empty or truncated
- [ ] Text artifacts have valid UTF-8 encoding
- [ ] Binary artifacts have correct magic bytes where applicable
- [ ] Artifact size is within expected range (not anomalously small or large)

### Reviewer Output (when applicable)
- [ ] Review contract is produced with all checklist items addressed
- [ ] `error` severity findings block stage completion
- [ ] `warning` severity findings are recorded but do not block
- [ ] `info` severity findings are recorded for audit

## Stage Completion Criteria

A stage is considered **complete** when:

| Condition                          | Autopilot | With Review     |
|------------------------------------|-----------|-----------------|
| Input contracts validated          | ✓         | ✓               |
| Output contracts produced          | ✓         | ✓               |
| Outputs validated against schema   | ✓         | ✓               |
| Review passed (if review != none)  | N/A       | ✓               |
| All error-severity findings closed | N/A       | ✓               |
| Budget not exceeded                | ✓         | ✓               |

## Failure & Diagnostics

When a stage fails, the runtime produces a machine-readable diagnostic:

```yaml
diagnostic:
  stage: brief-normalization
  status: failed
  reason: contract_version_mismatch
  detail:
    contract: content-brief
    expected: "1.2.0"
    available: "1.0.0"
    mismatch: major
  action: >
    Update the upstream brief to contract version 1.2.0,
    or downgrade the pipeline stage requirement.
  timestamp: "2026-07-27T12:00:00Z"
```

All diagnostics must include:
- `stage`: the failed stage ID
- `status`: `failed` or `blocked`
- `reason`: a machine-readable error code
- `detail`: structured context about the failure
- `action`: human-readable remediation guidance
- `timestamp`: when the diagnostic was produced

## Error Codes

| Code                              | Meaning                                           |
|-----------------------------------|---------------------------------------------------|
| `contract_missing`                | Required input contract not found                 |
| `contract_version_mismatch`       | Available contract version incompatible           |
| `contract_duplicate_producer`     | Multiple stages claim to produce the same contract|
| `contract_schema_violation`       | Output artifact does not match contract schema    |
| `stage_dependency_unsatisfied`    | Prior stage did not complete successfully         |
| `budget_exceeded`                 | Stage exceeded its wall-time or token budget      |
| `review_blocked`                  | Reviewer found error-severity issues              |
| `capability_unavailable`          | Required capability not provided by environment   |
| `source_unresolvable`             | Input source reference cannot be resolved         |
