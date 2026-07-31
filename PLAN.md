# Beads implementation index

Beads/Dolt is the issue source of truth. This file is a human-readable projection; refresh status with the commands below rather than editing task status here.

```bash
bd status
bd ready
bd children qtw-48r
bd graph qtw-48r
bd show <id>
bd blocked
bd dep cycles
```

## Active quality program

**Epic:** `qtw-48r` — Build a reproducible high-quality local TTS pipeline

**Investigation and architecture:** [`docs/TTS-QUALITY-PIPELINE.md`](docs/TTS-QUALITY-PIPELINE.md)

### Goal

Deliver a local Qwen3-TTS pipeline with explicit spoken-text preparation, semantic segmentation, stable CustomVoice direction, immutable/retryable synthesis attempts, segment validation, boundary-safe mastering, and measured baseline-versus-candidate quality evidence.

### Current decision state

- Evidence gate `qtw-48r.2` is complete: contracts, fixtures/rubric, and the 54-attempt controlled legacy baseline are preserved.
- Synthesis foundation tasks `qtw-48r.4.1` and `.4.2` are complete: live synthesis fails closed, maps controls exactly, and reuses one safely leased warm model with telemetry.
- Preprocessing tasks `qtw-48r.3.1` through `.3.4` are complete: source-mapped ingestion, deterministic en-US normalization, conserved speaker turns, and measured semantic/prosodic segmentation now produce stable, context-aware synthesis units.
- Required work remains `qtw-48r.3` through `qtw-48r.6`; `qtw-48r.7` is optional and outside the critical path.
- The deterministic preprocessing epic `qtw-48r.3` is complete, including seeded property, exact conservation, stable-ID, locale, malformed-input, and repository-wide coverage.
- Stable CustomVoice profile and bounded delivery direction task `qtw-48r.4.3` is complete with adjacent continuity fixtures.
- Immutable durable attempt jobs, verified segment cache, restart/cancellation recovery, and bounded selective retries are complete in `qtw-48r.4.4`.
- Versioned segment signal validation and bounded quality-retry mapping are complete in `qtw-48r.5.1`.
- Local tiny-English ASR and spectral/RMS continuity diagnostics were evaluated in `.5.2` and remain advisory because measured error/bias cannot support an automatic gate.
- Conservative non-destructive edge processing and exact pause artifacts are complete in `.5.3`; micro-fades remain disabled by evidence.
- Manifest-driven FFmpeg assembly/mastering (`.5.4`) is complete with exact order/duration, boundary checks, -16 LUFS/-1.5 dBTP targets, and canonical narration manifests.
- The segment-validation/mastering epic `qtw-48r.5` is implementation-complete; representative listening remains part of `.6.1`/`.6.4` acceptance.
- Beads remains authoritative for live status and dependency edges.

### Module hierarchy

```text
qtw-48r  High-quality local TTS pipeline
├─ qtw-48r.2  Evidence, contracts, and controlled baseline [required]
│  ├─ qtw-48r.1    Investigation and Alexandria comparison [complete]
│  ├─ qtw-48r.2.1  Freeze stage and artifact contracts
│  ├─ qtw-48r.2.2  Build evaluation fixtures and rubric
│  └─ qtw-48r.2.3  Capture controlled legacy baseline
├─ qtw-48r.3  Deterministic spoken-text preparation [required]
│  ├─ qtw-48r.3.1  Source ingestion and structural blocks
│  ├─ qtw-48r.3.2  English normalization and pronunciation lexicon
│  ├─ qtw-48r.3.3  Narration/dialogue/attribution turns
│  ├─ qtw-48r.3.4  Semantic segmentation and stable IDs
│  └─ qtw-48r.3.5  Golden/property/conservation tests
├─ qtw-48r.4  Voice direction and reproducible CustomVoice synthesis [required]
│  ├─ qtw-48r.4.1  Correct Qwen/MLX routing and fail closed
│  ├─ qtw-48r.4.2  Warm lifecycle and resource telemetry
│  ├─ qtw-48r.4.3  Stable voice profiles and delivery direction
│  └─ qtw-48r.4.4  Immutable attempts, cache, and selective retry
├─ qtw-48r.5  Validation, post-processing, and mastering [required]
│  ├─ qtw-48r.5.1  Segment signal validation
│  ├─ qtw-48r.5.2  ASR/pronunciation/continuity diagnostic evaluation
│  ├─ qtw-48r.5.3  Edge processing and explicit pauses
│  └─ qtw-48r.5.4  Manifest-driven assembly and mastering
├─ qtw-48r.6  Evaluation, migration, and acceptance [required]
│  ├─ qtw-48r.6.1  Repeated blinded baseline/candidate comparison
│  ├─ qtw-48r.6.2  Cross-module contract and consumer migration
│  ├─ qtw-48r.6.3  Operator/contributor/findings documentation
│  └─ qtw-48r.6.4  Fairy-tale and technical-explainer acceptance
└─ qtw-48r.7  Optional extensions
   ├─ qtw-48r.7.1  Constrained LLM spoken adaptation
   ├─ qtw-48r.7.2  VoiceDesign-to-clone/Base cloning evaluation
   └─ qtw-48r.7.3  Native MLX batching evaluation
```

### Dependency-ordered execution route

```text
qtw-48r.1 investigation [done]
  ├─> qtw-48r.2.1 contracts ───────────────┬─> qtw-48r.3.1 ingestion
  └─> qtw-48r.2.2 evaluation fixtures ─┐   │      ├─> qtw-48r.3.2 normalization ─┐
                                       ├─> qtw-48r.2.3 baseline                  ├─> qtw-48r.3.4 segmentation
                                       │       └─> qtw-48r.4.1 fail closed       │        └─> qtw-48r.3.5 tests
                                       │             └─> qtw-48r.4.2 lifecycle   │
                                       │                                        └─> qtw-48r.4.3 direction
                                       │                                              └─> qtw-48r.4.4 attempts/retry
                                       │                                                    └─> qtw-48r.5.1 validation
                                       │                                                          ├─> qtw-48r.5.2 diagnostics
                                       │                                                          └─> qtw-48r.5.3 edges/pauses
                                       │                                                                └─> qtw-48r.5.4 assembly
                                       └──────────────────────────────────────────────────────────────────────┐
                                                                                                               v
qtw-48r.3.5 + qtw-48r.5.2 + qtw-48r.5.4 ─> qtw-48r.6.1 blinded comparison
qtw-48r.2.1 + qtw-48r.5.4 ───────────────> qtw-48r.6.2 migration
qtw-48r.6.1 + qtw-48r.6.2 ───────────────> qtw-48r.6.3 documentation
qtw-48r.6.1 + qtw-48r.6.2 + qtw-48r.6.3 ─> qtw-48r.6.4 acceptance
```

`qtw-48r.3.3` (dialogue turns) also blocks segmentation. Use `bd show` for the authoritative complete edge list.

### Validation and relationship links

- `qtw-48r.3.5` validates normalization and preprocessing behavior.
- `qtw-48r.6.1` validates voice direction and post-processing quality.
- `qtw-48r.3.2` supersedes the incomplete closed scope recorded by `qtw-2af.5`.
- `qtw-48r.4.2` relates to existing lifecycle issue `qtw-2af.3`.
- `qtw-48r.4.3` relates to existing CustomVoice issue `qtw-2af.6`.
- `qtw-48r.4.1` relates to fake-provider safety issue `qtw-i7t.3`.
- `qtw-48r.4.4` relates to existing persistent-job issue `qtw-2af.4`.

### Completed decisions

- Keep the existing worker boundary and migrate incrementally; no broad rewrite.
- CustomVoice preset is speaker identity. Instructions primarily control delivery.
- English-first deterministic normalization; optional LLM adaptation is not required.
- Raw attempts are immutable; retries create new attempts.
- Silence/fallback is never a successful live output.
- Final assembly is manifest-driven and final mastering should align with `ffmpeg-video-composer` ownership.
- Quality claims require repeated representative baseline/candidate evidence.

### Unresolved questions

- The requested `preprocessor.md` and `qwen3-voice-director.md` files are missing and must be supplied or explicitly waived.
- Primary English narrator preset requires blinded selection.
- Initial segment length and generation sampling profile require evaluation.
- Final mastering ownership/API boundary with `ffmpeg-video-composer` requires a contract decision.
- Baseline hardware/run budget, listener panel, ASR gate status, and attempt retention need decisions.

## Existing worker delivery program

`qtw-2af` remains the worker's original implementation epic. Quality work must reuse rather than duplicate its still-open lifecycle, jobs, CustomVoice, resource, client, and hardware-test tasks. Inspect it with:

```bash
bd children qtw-2af
bd graph qtw-2af
```

`qtw-i7t` tracks honest model management and repository hygiene. Its fake-provider and model-integrity issues remain relevant to the quality critical path.
