# Changelog

## 1.0.0 (unreleased)

First production-stable local macOS release.

### Added

- pinned, profile-aware atomic installer for five real Qwen3-TTS MLX checkpoints;
- warm singleton model lifecycle, durable immutable attempts, cancellation, verified caching, retry, resource preflights, and runtime diagnostics;
- deterministic ingestion, conservative normalization/dialogue handling, syntactically safe segmentation, stable direction, signal validation, edge processing, and FFmpeg mastering;
- canonical narration manifest integration across the video production toolchain;
- consent-gated private voice enrollment and Base-only reference-audio cloning with exact transcript/audio hashes, provenance, synthesis validation, and revocation;
- `qwen-tts` install, doctor, service, model, preset, voice, and clone workflows plus a private per-user LaunchAgent;
- reproducible macOS 14+/Python 3.12 hash lock, CI, dependency/static analysis, release checksums, and artifact provenance;
- strict documentation site and key-free deferred GitHub Pages listening-review package.

### Security

- rejects non-loopback binds and multiple MLX worker processes;
- bounds declared and chunked request bodies;
- removes static serving of private references, transcripts, consent records, and outputs;
- creates private voice/output directories and applies no-store/security response headers;
- restricts CLI API URLs to unauthenticated loopback HTTP.

### Quality status

Objective, signal, mastering, reproducibility, package, live MLX smoke, and production-render gates pass. The controlled candidate improved advisory WER over its frozen legacy baseline. Human listening remains deferred; this release makes no claim of listening-quality superiority until exactly three complete 55-item blinded listener exports pass the predeclared analyzer.
