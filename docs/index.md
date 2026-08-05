# Qwen TTS Worker

A local, fail-closed Qwen3-TTS service for Apple Silicon. It keeps MLX checkpoints warm, preserves immutable synthesis attempts, validates generated audio, masters canonical narration, and supports consented Base-checkpoint voice cloning.

## Start here

1. [Install the CLI and private macOS service](MACOS-CLI.md).
2. Choose a verified checkpoint profile: CustomVoice for preset speakers, Base for reference-audio cloning, VoiceDesign for text-designed voices.
3. Run `qwen-tts doctor` before synthesis.
4. Use the [API contract](API.md) for integrations or the CLI for local work.
5. Read the [voice cloning safety and privacy contract](VOICE-CLONING.md) before enrollment.

## Quality status

The worker has passed deterministic preprocessing, durability, signal, mastering, package, and production-render gates. Controlled candidate audio improved advisory word-error rate relative to the frozen legacy baseline. No listening-quality superiority claim is authorized until exactly three independent listeners complete the current 55-item blinded protocol and the predeclared analyzer accepts their exports.

Fake TTS is a CI-only silent fixture. It is visibly labeled and cannot pass publication gates.
