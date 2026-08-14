# Changelog

## [0.1.0] — unreleased

### Added

- Initial package scaffold with Pi extension entry point.
- `pva_version` tool for package version and health reporting.
- `pva_diagnostics` tool for detailed load-time diagnostics.
- `pva-executive-producer` skill for production coordination.
- Session lifecycle handlers (session_start, session_shutdown).
- Comprehensive test suite covering manifest, extension, skills, docs, security, and production install.
- Security notice documenting full-system-access implications.
- Contributor documentation with development setup and guidelines.
- Idempotent `pva_create_channel`, `pva_create_series`, and `pva_create_episode` workspace-authoring tools.
- Validated rigged SVG animation specs and deterministic ImageMagick/FFmpeg rendering via `pva_render_vector_animation`.
- Local deterministic speech-free buzz cues via `pva_synthesize_nonverbal_audio`.
- Immutable clip-and-audio-cue composition with loudness normalization via `pva_compose_multitrack_video`.
