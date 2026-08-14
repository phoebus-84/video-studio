# Pipeline model

## Manifest shape

Built-in and series-owned pipelines use YAML. A simplified shape is:

```yaml
apiVersion: video.studio/v1alpha1
kind: Pipeline
metadata:
  name: fairy-tale
  version: 0.1.0
extends: narrated-illustrated-video@0.1.0
policy:
  defaultApproval: autopilot
  budgetUsd: 3.00
stages:
  adapt:
    after: [ingest]
    skill: skills/fairy-tale/adapt/SKILL.md
    consumes: [source-text, channel-profile, series-profile]
    produces: [adapted-story]
    capabilities: []
    gate: creative
    success:
      contracts: [adapted-story@1]
  art-direction:
    patch:
      skill: skills/fairy-tale/art-direction/SKILL.md
```

The actual schema is owned by `video-workspace-contracts`.

## Override semantics

A series pipeline can:

- `extends` one exact pipeline version;
- patch a stage by stable stage ID;
- insert a stage with explicit `before` or `after` edges;
- disable a stage only when downstream contracts remain satisfiable;
- replace the entire inherited definition;
- define a new pipeline from scratch.

No implicit array merge is permitted. Unknown stage IDs, ambiguous ordering, cycles, missing artifact producers, and unsatisfied capabilities fail resolution. The runtime writes the fully resolved result to the episode before execution.

## Built-in pipelines

### `narrated-illustrated-video`
Shared production stages: brief, script normalization, TTS segmentation, art direction, scene planning, narration, visual generation, graphics, edit, compose, and delivery QA.

### `fairy-tale`
Specialized stages before the shared production path: source ingestion, audience adaptation, safety and sensitivity review, narrative preservation review, and story-specific visual continuity.

### `repository-content-plan`
Series-level source snapshot, repository map, audience and prerequisite analysis, topic inventory, learning progression, terminology, visual grammar, and independent episode brief generation.

### `repository-documentation-episode`
Episode-level source grounding, claim and example verification, teaching script, code and diagram plan, then the shared narrated production path.

## Stage execution

1. Runtime verifies prerequisites and grants a lease.
2. Pi reads the stage skill and immutable snapshot.
3. Pi calls only stage-declared capabilities and writes candidate artifacts.
4. Runtime validates contracts and records a Stage Attempt.
5. Pi performs skill-directed review; findings are persisted.
6. Approval policy advances or pauses.
7. Changes to source revisions mark dependent outputs stale.

## Capability binding

Stages declare capability names rather than provider tools. Pi records a concrete binding before a paid or consequential call. The MVP bindings are fal for generated imagery, Qwen3-TTS for speech, local graphics for text-critical frames, and FFmpeg for composition. Changing a binding creates a revised decision and may require approval; adapters do not silently substitute providers.
