# qwen-tts-worker

Persistent local Qwen3-TTS service optimized for Apple Silicon through MLX.

## Owns

Model discovery/download state, load and unload lifecycle, one reusable model cache, voice profiles, synthesis job queue, progress, cancellation, segment outputs, health/resource diagnostics, and canonical WAV metadata.

## Design correction over the prototype

The worker does not spawn and reload Python for every Pi tool call. A typed local API keeps models warm and makes narration jobs resumable and observable. Audio transcoding and final mixing remain FFmpeg composer responsibilities.

## Quick start

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e '.[mlx,dev]'
.venv/bin/qwen-tts install 1.7B --profile custom_voice
.venv/bin/qwen-tts serve
```

API docs: `http://127.0.0.1:8000/docs`. For a private per-user LaunchAgent, diagnostics, synthesis, and cloning commands, follow [the macOS CLI guide](docs/MACOS-CLI.md).

## Tests

```bash
pytest
pytest --cov=src/qwen_tts_worker --cov-report=term-missing
```

## Documentation

- [API Contract](docs/API.md) — public HTTP API reference
- [Operator Guide](docs/OPERATOR.md) — deployment, configuration, monitoring
- [macOS CLI](docs/MACOS-CLI.md) — installation, LaunchAgent lifecycle, diagnostics, synthesis, and recovery
- [Local voice cloning](docs/VOICE-CLONING.md) — consented Base enrollment, private references, synthesis, revocation, and limitations
- [Contributing](docs/CONTRIBUTING.md) — development setup and conventions
- [TTS quality pipeline](docs/TTS-QUALITY-PIPELINE.md) — investigation, architecture, evaluation design, and implementation plan
- [English normalization](docs/NORMALIZATION.md) — supported spoken forms, lexicon policy, diagnostics, and source mapping
- [Dialogue turns](docs/DIALOGUE.md) — narration/character separation, attribution policy, ambiguity, and conservation
- [Semantic segmentation](docs/SEGMENTATION.md) — measured limits, protected boundaries, stable IDs, pauses, and reporting
- [Voice direction](docs/VOICE-DIRECTION.md) — stable preset identity, bounded delivery deltas, and continuity rules
- [Signal validation](docs/SIGNAL-VALIDATION.md) — calibrated objective checks, rejection, review, and quality retry
- [Advisory diagnostics](docs/ADVISORY-DIAGNOSTICS.md) — local ASR/boundary evaluation, calibration evidence, bias, and no-gate decision
- [Audio processing](docs/AUDIO-PROCESSING.md) — non-destructive edge trim, exact pauses, provenance, and fade decision
- [Narration mastering](docs/MASTERING.md) — manifest order, boundary checks, two-pass loudness, and final provenance
- [Narration migration](docs/NARRATION-MIGRATION.md) — canonical workspace contract, compatibility readers, timing, and staleness
- [Production acceptance](docs/PRODUCTION-ACCEPTANCE.md) — controlled candidate, JaroMail/fairy runs, listener workflow, findings, and limitations

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
