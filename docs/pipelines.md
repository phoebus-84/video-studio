# Pipeline model

## Canonical manifests

Built-in manifests live in `studio/pipelines/pipelines/*.yaml`. They validate
against `studio/contracts/schemas/v1alpha1/pipeline-manifest.schema.json`, not a
second schema invented by a provider. For example:

```yaml
pipeline:
  id: a-scene-workflow
  version: "0.1.0"
  description: "Create an editable 3D scene"
  capabilities:
    - id: scene.create
      version: "1.0.0"
  stages:
    - id: build
      name: "Build Scene"
      type: capability
      capability: scene.create
      inputs: []
      outputs:
        - contract: scene-source.json
          version: "0.1.0"
      gates:
        autopilot: false
        review: human
        retry_on_failure: 1
      skills:
        - skill: blender-scene
          version: "0.1.0"
      depends_on: []
```

Editorial stages use `type: editorial` without a capability. Capabilities describe
what is requested, not which vendor/tool executes it. Versioned series overrides
must preserve a valid dependency graph and satisfiable input/output contracts;
see [ADR-0001](adr/0001-series-pipelines-use-explicit-inheritance.md).

## Built-in workflows

| ID | Route |
|---|---|
| `narrated-illustrated-video` | Brief, script, art direction, terminal/illustration generation, narration, captions/timing, composition, QA |
| `fairy-tale-adaptation` | Tale ingestion, audience adaptation and reviews plus the narrated path |
| `repository-documentation` | Repository-grounded explanation plus the narrated path |
| `blender-animation` | Shot plan → editable scene → preview/artist handoff → animation → shot acceptance |

`blender-animation` is a **Pi-directed silent-shot workflow**. It does not require
fal, voice synthesis or VHS, and it does not add production handlers to the legacy
gateway executor. The source/preview/render JSON artifacts reference immutable
attempts and source hashes; their conventions are documented in `blender-scene`.
The final MP4 can be a standalone silent shot or a video clip in a mixed-media edit.

## Automation and human direction

The intended common flow is: frozen plan → prerequisite validation → lease →
capability/editorial work → validated candidate → review → accepted selection.
Autopilot, guided and manual should be policies over that same graph. Guided
Blender production uses shot-direction, preview and final acceptance gates;
an artist can Save As a native revision and render that file without rebuilding
it from the original script. Automated runs require an explicitly agreed plan
and budget; a script trust flag is not a human approval.

**Current limitation:** active CLI run/status paths still rely heavily on file
existence and stage instructions, and the legacy gateway autopilot is hard-coded.
The full state-machine, approval and budget guarantees are not yet integrated
end to end. Do not interpret a declared gate as proof that direct tool calls are
mechanically blocked. See the [harness review](harness-review.md) for evidence and
priority fixes before unattended execution.

## The series-production family

`series-production` (`studio/pipelines/pipelines/series-production.yaml`) is
one pipeline for every series with a template (ADR-0037): the compiler and the
validator are the ones the episode's pinned release names, never the
pipeline's.

| Stage | Performed by | Gate |
|---|---|---|
| `spec` → `episode-spec.json` | Pi: `pva_init_spec`, then the `fill-episode-spec` skill | human |
| `pictures` → `images/` | the person or Pi: every picture the spec names, in `assets/images` | human |
| `takes` → `takes.json` | the person or Pi: the narration takes and their word timing | human |
| `timeline` → `edit-timeline.json` | adapter `series-timeline` (the release's compiler) | — |
| `check` → `series-check.json` | adapter `series-check` (the release's validator); errors fail it | human |
| `render` → `output.mp4` | adapter `series-render` (`video.compose`, Remotion) | human |

A series extends it and replaces stages by id (ADR-0001). The example
`studio/pipelines/fixtures/valid/series-local/poetry-short.yaml` keeps every
stage and replaces `takes` with the poem's recital:

```yaml
pipeline:
  id: poetry-short
  version: "1.0.0"
  extends:
    pipeline: series-production
    version: "1.0.0"
  stages:
    - id: takes
      name: "Recital Take"
      # same contracts as the base stage; the poem's own instructions
```

Stages that depend on unfinished work arrive as new versions of the base:
take synthesis, alignment and verification (`avg-8hs.*`) turn `takes` into
capability stages; the layout sheet (`avg-3th.1`) goes between `check` and
`render`; the render audit (`avg-3th.3`) and the delivery package
(`avg-3th.5`) follow `render`.

## Adding a workflow

1. Reuse provider-neutral capabilities and typed media outputs.
2. Declare stage inputs/outputs, dependencies, skills and gates explicitly.
3. Avoid requiring irrelevant capabilities for every shot; optional input files
   alone do not make a stage optional.
4. Use a typed video timeline for mixed clips; never reduce Blender animation to
   an image-concat input.
5. Validate manifests and test a real user route through the agent, not just the
   package API.

```bash
npm run check:pipelines
```

The [capability checklist](contributing.md) covers installation, registration,
skills, diagnostics, tests and documentation.
