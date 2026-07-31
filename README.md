# qwen-tts-worker

Persistent local Qwen3-TTS service optimized for Apple Silicon through MLX.

## Owns

Model discovery/download state, load and unload lifecycle, one reusable model cache, voice profiles, synthesis job queue, progress, cancellation, segment outputs, health/resource diagnostics, and canonical WAV metadata.

## Design correction over the prototype

The worker does not spawn and reload Python for every Pi tool call. A typed local API keeps models warm and makes narration jobs resumable and observable. Audio transcoding and final mixing remain FFmpeg composer responsibilities.

## Quick start

```bash
pip install -e ".[dev]"
QTW_LOG_FORMAT=console python -m qwen_tts_worker
```

API docs: `http://127.0.0.1:8000/docs`

## Tests

```bash
pytest
pytest --cov=src/qwen_tts_worker --cov-report=term-missing
```

## Documentation

- [API Contract](docs/API.md) — public HTTP API reference
- [Operator Guide](docs/OPERATOR.md) — deployment, configuration, monitoring
- [Contributing](docs/CONTRIBUTING.md) — development setup and conventions
- [TTS quality pipeline](docs/TTS-QUALITY-PIPELINE.md) — investigation, architecture, evaluation design, and implementation plan
- [English normalization](docs/NORMALIZATION.md) — supported spoken forms, lexicon policy, diagnostics, and source mapping
- [Dialogue turns](docs/DIALOGUE.md) — narration/character separation, attribution policy, ambiguity, and conservation
- [Semantic segmentation](docs/SEGMENTATION.md) — measured limits, protected boundaries, stable IDs, pauses, and reporting
- [Voice direction](docs/VOICE-DIRECTION.md) — stable preset identity, bounded delivery deltas, and continuity rules

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
