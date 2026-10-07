# qwen-tts-worker

Persistent local Qwen3-TTS service optimized for Apple Silicon through MLX.

## Owns

Model discovery/download state, load and unload lifecycle, one reusable model cache, voice profiles, synthesis job queue, progress, cancellation, segment outputs, health/resource diagnostics, and canonical WAV metadata.

It also aligns: `POST /align` returns when each word of a known text is said in an audio file, with Qwen3-ForcedAligner (`QTW_ALIGN_MODEL`, default `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`, downloaded and loaded on first use). See [the API contract](docs/API.md#forced-alignment).

## Design correction over the prototype

The worker does not spawn and reload Python for every Pi tool call. A typed local API keeps models warm and makes narration jobs resumable and observable. Audio transcoding and final mixing remain FFmpeg composer responsibilities.

## Quick start

```bash
python3.12 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements.txt
.venv/bin/pip install --no-deps -e .
.venv/bin/qwen-tts install 1.7B --profile custom_voice
.venv/bin/qwen-tts serve
```

**Python 3.12 specifically.** `requirements.txt` is hash-pinned and was
compiled with `uv pip compile --python-version 3.12`; those hashes are for
cp312 wheels. On any other interpreter the install dies partway through with
`No matching distribution found` for whichever pin lacks a wheel for your
version — a message that reads like a broken dependency rather than a wrong
`python3`. If `python3.12` is not on your machine, `mise install` in the
repository root fetches it.

API docs: `http://127.0.0.1:8000/docs`. For a private per-user LaunchAgent, diagnostics, synthesis, and cloning commands, follow [the macOS CLI guide](docs/MACOS-CLI.md).

## Tests

```bash
pytest
pytest --cov=src/qwen_tts_worker --cov-report=term-missing
QTW_ALIGN_LIVE=1 pytest tests/test_alignment.py   # also a real alignment (macOS `say` speaks Italian)
```

## Documentation

- [API Contract](docs/API.md) — public HTTP API reference
- [Operator Guide](docs/OPERATOR.md) — deployment, configuration, monitoring
- [macOS CLI](docs/MACOS-CLI.md) — installation, LaunchAgent lifecycle, diagnostics, synthesis, and recovery
- [Local voice cloning](docs/VOICE-CLONING.md) — consented Base enrollment, private references, synthesis, revocation, and limitations
- [Contributing](docs/CONTRIBUTING.md) — development setup and conventions
- [Releasing](docs/RELEASING.md) — clean-room gates, signed tags, checksums, provenance, verification, and incidents
- [Changelog](CHANGELOG.md) — production release capabilities, security boundary, and explicit quality limitations
- [TTS quality pipeline](docs/TTS-QUALITY-PIPELINE.md) — investigation, architecture, evaluation design, and implementation plan
- [English normalization](docs/NORMALIZATION.md) — supported spoken forms, lexicon policy, diagnostics, and source mapping
- [Dialogue turns](docs/DIALOGUE.md) — narration/character separation, attribution policy, ambiguity, and conservation
- [Semantic segmentation](docs/SEGMENTATION.md) — measured limits, protected boundaries, stable IDs, pauses, and reporting
- [Voice direction](docs/VOICE-DIRECTION.md) — stable preset identity, bounded delivery deltas, and continuity rules
- [Native batching evaluation](docs/BATCHING.md) — measured speed benefit, segment-seed coupling, and no-adoption decision
- [Signal validation](docs/SIGNAL-VALIDATION.md) — calibrated objective checks, rejection, review, and quality retry
- [Advisory diagnostics](docs/ADVISORY-DIAGNOSTICS.md) — local ASR/boundary evaluation, calibration evidence, bias, and no-gate decision
- [Audio processing](docs/AUDIO-PROCESSING.md) — non-destructive edge trim, exact pauses, provenance, and fade decision
- [Narration mastering](docs/MASTERING.md) — manifest order, boundary checks, two-pass loudness, and final provenance
- [Narration migration](docs/NARRATION-MIGRATION.md) — canonical workspace contract, compatibility readers, timing, and staleness
- [Production acceptance](docs/PRODUCTION-ACCEPTANCE.md) — controlled candidate, JaroMail/fairy runs, listener workflow, findings, and limitations
- [Blinded review publication](docs/LISTENING-REVIEW.md) — key-free packaging, deferred GitHub Pages deployment, collection, and analysis

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
