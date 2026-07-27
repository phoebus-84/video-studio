# Series Overrides

**Version**: 1.0.0

## Purpose

A **series** is a collection of video episodes that share a production pipeline. Series folders allow customization of pipelines and skills **without modifying this repository**. All overrides are additive: they inherit from the built-in base and selectively replace or extend.

## Series Directory Structure

```
series/
  <series-id>/                       # e.g., "once-upon-a-time"
    series.yaml                      # series manifest
    overrides/
      pipelines/
        <pipeline-id>.yaml           # pipeline patches/overrides
      skills/
        <pipeline-id>/
          <skill-id>.md              # skill overrides or additions
      contracts/
        <contract-id>.yaml           # series-local contract artifacts
    episodes/
      e001.yaml                      # per-episode overrides (optional)
      e002.yaml
```

## Series Manifest

```yaml
# series/<series-id>/series.yaml

series:
  id: once-upon-a-time
  name: "Once Upon a Time"
  description: "Fairy tales adapted for children ages 6-9"
  pipelines:
    - pipeline: fairy-tale
      version: "1.0.0"
      overrides: overrides/pipelines/fairy-tale.yaml
  defaults:
    audience: children-6-9
    episode_duration: "8m"
    language: en
    safety_profile: child-safe-strict
```

## Pipeline Override File

A pipeline override file **patches** the built-in manifest. It does not redefine the entire pipeline.

### Supported Override Operations

#### 1. Replace a Stage Gate

```yaml
# overrides/pipelines/fairy-tale.yaml

overrides:
  pipeline: fairy-tale
  version: "1.0.0"
  stages:
    - id: audience-adaptation
      gates:
        review: human          # force human review (was: skill)
        budget:
          wall_time: "15m"     # increase budget (was: 10m)
```

#### 2. Add a Series-Specific Stage

```yaml
overrides:
  pipeline: fairy-tale
  version: "1.0.0"
  add_stages:
    - after: opening-generation     # insert after this stage
      stage:
        id: series-branding-intro
        name: "Series Branding Intro"
        description: "Insert the Once Upon a Time animated intro"
        capability: video-editing
        inputs:
          - contract: opening-video
            version: "1.0.0"
            source: prior-stage.opening-generation
        outputs:
          - contract: branded-opening
            version: "1.0.0"
        gates:
          autopilot: true
          review: human-or-skill
          retry_on_failure: 1
        skills:
          - skill: branding-intro-compositor
            version: "1.0.0"
        depends_on:
          - opening-generation
```

#### 3. Replace a Skill Reference

```yaml
overrides:
  pipeline: fairy-tale
  version: "1.0.0"
  skill_overrides:
    - stage: audience-adaptation
      replace: audience-adapter         # built-in skill
      with: once-upon-a-time-adapter   # series-local skill
      version: "1.0.0"
```

#### 4. Patch Stage Metadata (Non-Structural)

```yaml
overrides:
  pipeline: fairy-tale
  version: "1.0.0"
  metadata:
    episode_count: 12
    release_schedule: weekly
```

## Invariants (Override Must Not Violate)

| Rule                                                                | Checked By |
|---------------------------------------------------------------------|------------|
| Cannot remove a built-in stage                                      | lint       |
| Cannot rename a built-in stage ID or contract ID                     | lint       |
| Cannot remove a required output contract from a stage               | lint       |
| Cannot create a contract that duplicates a built-in producer         | lint       |
| Cannot change a stage's `depends_on` to depend on a removed stage    | lint       |
| Added stages must have valid `depends_on` referencing existing stages | lint       |

## Series-Local Contracts

Series may provide local contract artifacts referenced by `source: series-local` in manifests:

```yaml
# series/<series-id>/overrides/contracts/series-style-guide.yaml

contract: series-style-guide
version: "1.0.0"
data:
  color_palette: "#3A2E4D,#E8D6A3,#C44536"
  logo_path: "series/once-upon-a-time/assets/logo.svg"
  font_family: "Merriweather"
  intro_duration: "12s"
  outro_duration: "8s"
```

## Per-Episode Overrides

Individual episodes may override stage inputs:

```yaml
# series/<series-id>/episodes/e001.yaml

episode:
  number: 1
  title: "The Golden Key"
  overrides:
    - stage: audience-adaptation
      inputs:
        - contract: source-story
          version: "1.0.0"
          source: upstream    # override: source from series curator
```

## Example: Full Series Override

Built-in `fairy-tale` pipeline has stages:
1. `source-ingest` → 2. `audience-adaptation` → 3. `safety-review` → 4. `narration` → 5. `delivery`

Series `once-upon-a-time` wants:
- Tighter age range (6-9, not 4-12)
- Custom branding intro after `safety-review`
- Human review on `audience-adaptation`
- Custom `opening-generation` style

Override file at `series/once-upon-a-time/overrides/pipelines/fairy-tale.yaml`:

```yaml
overrides:
  pipeline: fairy-tale
  version: "1.0.0"

  stages:
    - id: audience-adaptation
      gates:
        review: human
      inputs:
        - contract: audience-profile
          version: "1.0.0"
          source: series-local      # use series-local audience profile

    - id: safety-review
      gates:
        review: human-or-skill

  add_stages:
    - after: safety-review
      stage:
        id: series-branding-intro
        name: "Series Branding Intro"
        description: "Insert series-specific animated intro bumper"
        capability: video-editing
        inputs:
          - contract: safe-narrative
            version: "1.0.0"
            source: prior-stage.safety-review
          - contract: series-style-guide
            version: "1.0.0"
            source: series-local
        outputs:
          - contract: branded-narrative
            version: "1.0.0"
        gates:
          autopilot: true
          review: human-or-skill
          retry_on_failure: 1
        skills:
          - skill: branding-intro-compositor
            version: "1.0.0"
        depends_on:
          - safety-review

  skill_overrides:
    - stage: opening-generation
      replace: generic-opening-writer
      with: once-upon-a-time-opening
      version: "1.0.0"
```

## Override Merge Algorithm

When loading a pipeline for a series, the runtime:

1. **Load** the built-in manifest from `pipelines/<pipeline-id>/manifest.yaml`
2. **Load** the series override from `series/<series-id>/overrides/pipelines/<pipeline-id>.yaml`
3. **Merge** gate overrides: replace matching stage fields
4. **Insert** `add_stages` at the position indicated by `after` or `before`
5. **Replace** skill references where `skill_overrides[].replace` matches
6. **Merge** metadata (shallow merge)
7. **Validate** invariants; fail with diagnostic if any violation
8. **Resolve** `series-local` source references from `series/<series-id>/overrides/contracts/`

The result is the effective pipeline for the series. The original built-in manifest is never modified.
