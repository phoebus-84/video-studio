# Contributor Guide

**Version**: 1.0.0

## Quick Reference

| Task                                      | Command / Location                                         |
|-------------------------------------------|------------------------------------------------------------|
| Add a pipeline                            | Create `pipelines/<id>/manifest.yaml`                      |
| Add a skill                               | Create `skills/<pipeline-id>/<skill-id>/SKILL.md`          |
| Override for a series                     | Create `series/<series-id>/overrides/pipelines/<pid>.yaml` |
| Lint a pipeline                           | `npm run lint:pipeline <file>`                             |
| Lint a skill                              | `npm run lint:skill <file>`                                |
| Run all tests                             | `npm test`                                                 |
| Lint all fixtures                         | `npm run lint`                                             |

## Adding a New Pipeline

1. Read [PIPELINE-MANIFEST.md](../pipeline-conventions/PIPELINE-MANIFEST.md) for the full schema.
2. Read [STAGE-I-O-CHECKLIST.md](../pipeline-conventions/STAGE-I-O-CHECKLIST.md) for stage validation rules.
3. Read [ANTI-PATTERNS.md](../pipeline-conventions/ANTI-PATTERNS.md) for patterns to avoid.

### Checklist

- [ ] Pipeline ID is lowercase-hyphen-separated
- [ ] `version` is valid semver
- [ ] At least one stage defined
- [ ] Every stage has: `id`, `name`, `capability`, `inputs`, `outputs`, `gates`, `depends_on`
- [ ] Stage IDs are lowercase-hyphen-separated and stable (never rename after publication)
- [ ] No duplicate contract producers across stages (each contract has exactly one producer)
- [ ] Every input from `prior-stage.<id>` references a stage that exists in the pipeline
- [ ] No content-type conditional language in descriptions
- [ ] Gate `review` is one of: `none`, `human`, `skill`, `human-or-skill`
- [ ] No circular stage dependencies
- [ ] Pipeline manifest passes `npm run lint:pipeline <file>`

### Example: Minimum Valid Pipeline

```yaml
pipeline:
  id: my-pipeline
  version: "1.0.0"
  description: "A concise description of what this pipeline produces"
  stages:
    - id: first-stage
      name: "First Stage"
      capability: my-capability
      inputs:
        - contract: source-input
          version: "1.0.0"
          source: upstream
      outputs:
        - contract: stage-output
          version: "1.0.0"
      gates:
        autopilot: true
        review: none
        retry_on_failure: 0
      skills:
        - skill: my-producer
          version: "1.0.0"
      depends_on: []
```

## Adding a New Skill

1. Read [SKILL-FRONTMATTER.md](../pipeline-conventions/SKILL-FRONTMATTER.md) for the full schema.
2. Read [REVIEWER-FORMAT.md](../pipeline-conventions/REVIEWER-FORMAT.md) if writing a reviewer skill.

### Checklist

- [ ] File is at `skills/<pipeline-id>/<skill-id>/SKILL.md`
- [ ] File starts with `---` and has closed YAML frontmatter
- [ ] `skill.id` matches the file path's `<skill-id>`
- [ ] `skill.pipeline` matches the file path's `<pipeline-id>`
- [ ] `skill.version` is valid semver
- [ ] `skill.kind` is one of: `producer`, `reviewer`, `mixed`
- [ ] `progressive_disclosure` has at least `summary`
- [ ] `inputs` is a non-empty array with contract references
- [ ] `outputs` is present for `producer`/`mixed` skills
- [ ] `review` section with checklist for `reviewer`/`mixed` skills
- [ ] No orchestration fields (`run_after`, `retry_count`, `timeout_seconds`, `fallback_skill`)
- [ ] No gate fields (`gates`, `autopilot`)
- [ ] No `budget` at top level
- [ ] Skill passes `npm run lint:skill <file>`

### Example: Minimum Valid Skill

```markdown
---
skill:
  id: my-producer
  pipeline: my-pipeline
  stage: first-stage
  version: "1.0.0"
  kind: producer

progressive_disclosure:
  summary: >
    Transforms the source input into the stage output.

inputs:
  - contract: source-input
    version: "1.0.0"
    required: true

outputs:
  - contract: stage-output
    version: "1.0.0"
    required: true
---
# My Producer Skill

Instructions for performing the stage work go here.
```

## Series Overrides

Read [SERIES-OVERRIDES.md](../pipeline-conventions/SERIES-OVERRIDES.md) for the full reference.

Key rules:
- Overrides are **additive** — never modify built-in manifests
- Cannot remove built-in stages
- Cannot rename stage IDs or contract IDs
- Added stages must have valid `depends_on`

## Anti-Patterns

Read the full catalog in [ANTI-PATTERNS.md](../pipeline-conventions/ANTI-PATTERNS.md). The most common mistakes are:

1. **Orchestration in skills** — `run_after`, `retry_count`, `timeout_seconds` belong in manifests
2. **Missing progressive disclosure** — every skill needs a summary and prerequisites
3. **Unstable stage IDs** — use `lowercase-hyphen` only, no underscores, no camelCase
4. **Content-type branching** — use separate pipelines, not `if/then` in descriptions
5. **Gate logic in skills** — `autopilot`, `review`, `gates` belong in manifests

## Running Tests

```bash
npm test
```

Tests cover:
- Pipeline lint success and failure paths
- Skill lint success and failure paths
- Schema validity
- Documentation existence
- Fixture integrity (all fixtures are parseable YAML)

## Module Structure

```
video-built-in-pipelines/
├── pipeline-conventions/        # Authored conventions (the source of truth)
│   ├── README.md
│   ├── PIPELINE-MANIFEST.md
│   ├── SKILL-FRONTMATTER.md
│   ├── STAGE-I-O-CHECKLIST.md
│   ├── REVIEWER-FORMAT.md
│   ├── SERIES-OVERRIDES.md
│   └── ANTI-PATTERNS.md
├── schemas/                     # Machine-readable JSON schemas
│   ├── pipeline-manifest.schema.yaml
│   └── skill-frontmatter.schema.yaml
├── lint/                        # Executable lint tools
│   ├── validate-pipeline.js
│   └── validate-skill.js
├── fixtures/                    # Test fixtures
│   ├── valid/
│   └── invalid/
├── tests/                       # Deterministic tests
│   └── conventions.test.js
├── docs/                        # Public documentation
│   ├── CONTRIBUTING.md
│   └── OPERATOR-GUIDE.md
├── package.json
└── README.md
```
