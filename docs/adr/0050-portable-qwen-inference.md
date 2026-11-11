# ADR-0050: Portable Qwen inference preserves the worker boundary

## Status

Proposed in [PR #95](https://github.com/phoebus-84/video-studio/pull/95).
Extends [ADR-0018](0018-typescript-is-the-control-plane-python-isolated-to-mlx.md)
to portable local inference while preserving the TypeScript control plane
and the deliberate Python worker/API boundary.

## Decision

`packages/voice` retains its local worker API, consent-gated voice store,
single warm-model lifecycle, job/quality pipeline and PCM output contract.
Inference is selected explicitly: MLX on Apple Silicon; official Qwen/PyTorch
on CPU, NVIDIA CUDA or supported AMD ROCm. The same provider is not duplicated
per agent harness, and no inference implementation is added to the website.

Automatic selection is a deterministic deployment policy, not error recovery.
Once selected, a missing dependency/device/model or generation failure does
not switch to another device/provider or to fake speech. GPU dtype defaults
follow reported BF16 support; CPU defaults to float32. SDPA is the portable
optimized attention baseline; FA2 and CPU BF16 require explicit operator
selection. Performance on hardware not measured is not advertised.

Official Torch snapshots and MLX-quantized snapshots have separate immutable
catalogue identities/directories. Installs remain revision- and SHA-pinned.
Resolved runtime options and versions are part of portable attempt provenance
and fingerprints; narration's model identity gains an optional runtime field.
Historical MLX fingerprints without it retain their previous calculation.

## Alternatives assessed

A GGUF file alone does not implement Qwen speech generation. Available
llama.cpp/ONNX and GGML implementations are candidates, but are not presumed
to match the existing preset/cloning/profile APIs, installation baseline and
control semantics. Introducing one requires a separate pinned adapter and
measured quality/performance evidence. This decision does not forbid it.

We do not force Qwen ASR and Qwen TTS into one environment despite their
currently incompatible exact Transformers requirements. Alignment,
transcription and optional ASR diagnostics remain explicitly MLX-only;
portable speech synthesis does not claim those features are available.
Windows service/ACL behavior is not inferred from POSIX chmod tests.

## Consequences

CPU provides a broad compatibility path, not a real-time guarantee. CUDA and
ROCm need correct vendor-supported PyTorch wheels/drivers. Production-quality
approval and GPU performance evidence still require tests on target hardware.
The provider-independent API lets a future benchmarked native backend reuse
the worker instead of replacing the rest of the pipeline.

See [portable backend operations](../reference/voice/docs/backends.md).
