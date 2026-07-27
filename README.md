# qwen-tts-worker

Persistent local Qwen3-TTS service optimized for Apple Silicon through MLX.

## Owns

Model discovery/download state, load and unload lifecycle, one reusable model cache, voice profiles, synthesis job queue, progress, cancellation, segment outputs, health/resource diagnostics, and canonical WAV metadata.

## Design correction over the prototype

The worker does not spawn and reload Python for every Pi tool call. A typed local API keeps models warm and makes narration jobs resumable and observable. Audio transcoding and final mixing remain FFmpeg composer responsibilities.

## Plan

Run `bd list`, `bd graph`, and `bd show <id>`.
