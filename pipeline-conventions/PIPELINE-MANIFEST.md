# Pipeline Manifest Convention

**Version**: 1.0.0
**Phase**: foundation
**Status**: stable

## Purpose

A pipeline manifest declares **what** must happen to produce a completed video artifact and **which contracts** prove each stage's completion. It does **not** specify how an agent or runtime executes the work — that belongs to skills and operator configuration.

## Manifest File

- **Location**: `pipelines/<pipeline-id>/manifest.yaml`
- **Format**: YAML 1.2, UTF-8, LF line endings
- **Naming**: lowercase, hyphen-separated (`narrated-illustrated-video`, `fairy-tale`, `repository-content-plan`)

## Schema

```yaml
# pipelines/<pipeline-id>/manifest.yaml

pipeline:
  id: narrated-illustrated-video    # stable, unique across all built-in pipelines
  version: "1.0.0"                 # semver; bump major on contract break, minor on new stage, patch on metadata fix
  description: >
    Downstream production stages shared by all video content types.
    Produces TTS-tagged script, art direction, scene plans, visuals,
    narration, edit composition, and delivery QA artifacts.
  capabilities:                     # capabilities this pipeline requires from the execution environment
    - id: tts-tagging               # stable capability ID
      version: "1.0.0"             # semver
    - id: art-generation
      version: "1.0.0"
    - id: video-editing
      version: "1.0.0"
  stages:                           # ordered list; parallelizable stages noted below
    - id: brief-normalization       # stable stage ID — never rename after publication
      name: "Brief Normalization"
      description: >
        Normalize a content brief into structured, verifiable constraints
        and target parameters.
      capability: brief-processing  # maps to one capability ID above
      inputs:                       # contract references consumed by this stage
        - contract: content-brief   # stable contract ID
          version: "1.0.0"
          source: upstream          # upstream | prior-stage.<stage-id> | series-local
      outputs:                      # contract references produced by this stage
        - contract: normalized-brief
          version: "1.0.0"
      gates:                        # gate semantics
        autopilot: true             # true = can proceed without human review
        review: none                # none | human | skill | human-or-skill
        retry_on_failure: 2         # max automatic retries before escalating
        budget:                     # optional resource budget
          wall_time: "5m"
          tokens: 10000
      skills:                       # skills that implement this stage
        - skill: brief-normalizer
          version: "1.0.0"
      depends_on: []                # stage IDs this stage waits for before starting
      parallelizable_group: null    # null or a group name; stages in same group may run in parallel

    - id: script-generation
      name: "Script Generation"
      description: "Produce a TTS-tagged script with speaker, emotion, and pacing markers."
      capability: tts-tagging
      inputs:
        - contract: normalized-brief
          version: "1.0.0"
          source: prior-stage.brief-normalization
      outputs:
        - contract: tts-tagged-script
          version: "1.0.0"
      gates:
        autopilot: true
        review: human
        retry_on_failure: 2
        budget:
          wall_time: "10m"
          tokens: 40000
      skills:
        - skill: script-writer
          version: "1.0.0"
      depends_on:
        - brief-normalization
      parallelizable_group: null
```

## Stable Identifiers

| Category    | Convention                     | Example                           |
|-------------|--------------------------------|-----------------------------------|
| Pipeline ID | lowercase, hyphen-separated    | `narrated-illustrated-video`      |
| Stage ID    | lowercase, hyphen-separated    | `brief-normalization`             |
| Contract ID | lowercase, hyphen-separated    | `normalized-brief`                |
| Capability  | lowercase, hyphen-separated    | `tts-tagging`                     |
| Skill ID    | lowercase, hyphen-separated    | `brief-normalizer`                |

**Rule**: Once published in a released manifest version, stage IDs, contract IDs, and capability IDs **must not** be renamed. Add new IDs and deprecate old ones with a `deprecated: true` flag.

## Contract References

Every pipeline stage must declare all inputs and outputs as typed contract references. Each reference includes:

- `contract`: the stable contract ID
- `version`: the semver of the contract schema
- `source`: where the artifact comes from

Valid `source` values:

| Source                  | Meaning                                                       |
|-------------------------|---------------------------------------------------------------|
| `upstream`              | Provided by the caller / series pipeline / external system    |
| `prior-stage.<id>`      | Produced by the named prior stage within this pipeline        |
| `series-local`          | Found in the series override directory for this pipeline      |

**Invariant**: Every consumed contract (input) must have exactly **one** producer — either a prior stage in the same pipeline, the upstream caller, or a series-local artifact.

## Gate Semantics

Each stage declares gate behavior:

| Field               | Type    | Description                                                 |
|---------------------|---------|-------------------------------------------------------------|
| `autopilot`         | boolean | If `true`, the stage can proceed without operator review    |
| `review`            | string  | `none`, `human`, `skill`, or `human-or-skill`              |
| `retry_on_failure`  | integer | Maximum automatic retries before escalating to operator     |
| `budget`            | object  | Optional time/token budget for the stage                    |

Gates are **declarative**, not procedural. They state what verification is required; the execution environment enforces them.

## Parallelization

Stages with the same non-null `parallelizable_group` value may execute concurrently. Each stage within the group must still declare its `depends_on` list. A stage may only join a parallelizable group if its dependencies are satisfied before the group begins.

## Versioning

- **Major** bump: contract schema change that breaks consumers (field removal, type change, required field added)
- **Minor** bump: new stage added, new optional field, new capability
- **Patch** bump: description fix, metadata-only change, non-breaking clarification

## What Belongs in a Manifest — and What Does Not

### ✓ IN the manifest

- Stage ordering and dependency declarations
- Contract IDs and versions consumed/produced per stage
- Gate configuration (autopilot, review, retry, budget)
- Capability requirements
- Parallelization hints

### ✗ NOT in the manifest (belongs in skills or operator config)

- Prompt text or LLM instructions
- Tool invocation sequences
- File paths, URLs, or credentials
- Retry backoff algorithms
- Logging or telemetry configuration
- Runtime error-handling logic
- Conditional branching based on content type (use separate pipelines or series overrides)
