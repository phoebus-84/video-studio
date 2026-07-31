"""Projection from validated worker artifacts to canonical workspace wire contracts."""

from __future__ import annotations

from typing import Any

from qwen_tts_worker.models.quality import (
    NarrationManifest,
    SegmentPlan,
    SegmentQualityReport,
    SynthesisAttempt,
    WavArtifact,
)


class WorkspaceContractError(ValueError):
    pass


def _hash(value: str) -> str:
    return value if value.startswith("sha256:") else f"sha256:{value}"


def canonical_wav(wav: WavArtifact) -> dict[str, Any]:
    return {
        "path": wav.path,
        "contentHash": _hash(wav.sha256),
        "sizeBytes": wav.size_bytes,
        "durationSeconds": wav.duration_seconds,
        "sampleRate": wav.sample_rate,
        "channels": wav.channels,
        "sampleWidthBytes": wav.sample_width_bytes,
    }


def canonical_direction(direction) -> dict[str, Any]:
    return {
        "directionVersion": direction.direction_version,
        "baseDirectionId": direction.base_direction_id,
        "baseInstruction": direction.base_instruction,
        "delta": direction.delta.model_dump(mode="json", exclude_none=True),
        "composedInstruction": direction.composed_instruction,
    }


def canonical_segment(segment: SegmentPlan) -> dict[str, Any]:
    return {
        "schemaVersion": segment.schema_version,
        "segmentId": segment.segment_id,
        "sourceDocumentHash": _hash(segment.source_document_sha256),
        "sourceBlockIds": list(segment.source_block_ids),
        "sourceSpans": [span.model_dump(mode="json") for span in segment.source_spans],
        "preprocessingVersion": segment.preprocessing_version,
        "displayText": segment.display_text,
        "spokenText": segment.spoken_text,
        "language": segment.language,
        "role": segment.role.value,
        "speakerProfileId": segment.speaker_profile_id,
        "direction": canonical_direction(segment.direction),
        "context": segment.context.model_dump(mode="json"),
        "pauseAfterMs": segment.pause_after_ms,
    }


def canonical_attempt(attempt: SynthesisAttempt) -> dict[str, Any]:
    profile = attempt.profile
    result: dict[str, Any] = {
        "schemaVersion": attempt.schema_version,
        "attemptId": str(attempt.attempt_id),
        "segmentId": attempt.segment_id,
        "requestFingerprint": _hash(attempt.request_fingerprint),
        "phase": attempt.phase.value,
        "profile": {
            "schemaVersion": profile.schema_version,
            "profileId": profile.profile_id,
            "profileRevision": profile.profile_revision,
            "model": {
                "modelId": profile.model.model_id,
                "modelProfile": profile.model.model_profile,
                "modelHash": _hash(profile.model.model_sha256),
                "quantization": profile.model.quantization,
                "mlxAudioVersion": profile.model.mlx_audio_version,
                "mlxVersion": profile.model.mlx_version,
            },
            "speaker": profile.speaker,
            "language": profile.language,
            "sampleRate": profile.sample_rate,
            "channels": profile.channels,
            "sampleWidthBytes": profile.sample_width_bytes,
            "sampling": {
                "temperature": profile.sampling.temperature,
                "topK": profile.sampling.top_k,
                "topP": profile.sampling.top_p,
                "repetitionPenalty": profile.sampling.repetition_penalty,
                "maxTokens": profile.sampling.max_tokens,
                "seed": profile.sampling.seed,
            },
        },
        "direction": canonical_direction(attempt.direction),
        "createdAt": attempt.created_at.isoformat(),
        "completedAt": attempt.completed_at.isoformat(),
        "processingSeconds": attempt.processing_seconds,
    }
    if attempt.raw_wav is not None:
        result["rawWav"] = canonical_wav(attempt.raw_wav)
    if attempt.failure is not None:
        result["failure"] = attempt.failure.model_dump(mode="json")
    if attempt.retry_of is not None:
        result["retryOf"] = str(attempt.retry_of)
    if attempt.peak_memory_bytes is not None:
        result["peakMemoryBytes"] = attempt.peak_memory_bytes
    return result


def canonical_quality(report: SegmentQualityReport) -> dict[str, Any]:
    result = {
        "schemaVersion": report.schema_version,
        "reportId": str(report.report_id),
        "validatorVersion": report.validator_version,
        "attemptId": str(report.attempt_id),
        "metrics": {
            "peakDbfs": report.metrics.peak_dbfs,
            "rmsDbfs": report.metrics.rms_dbfs,
            "clippedSampleRatio": report.metrics.clipped_sample_ratio,
            "dcOffset": report.metrics.dc_offset,
            "leadingSilenceMs": report.metrics.leading_silence_ms,
            "trailingSilenceMs": report.metrics.trailing_silence_ms,
            "spokenWordsPerMinute": report.metrics.spoken_words_per_minute,
        },
        "checks": [
            {
                "checkId": check.check_id,
                "status": check.status,
                "observed": check.observed,
                "expected": check.expected,
            }
            for check in report.checks
        ],
        "decision": report.decision.value,
        "createdAt": report.created_at.isoformat(),
    }
    if report.override_actor is not None:
        result["overrideActor"] = report.override_actor
        result["overrideReason"] = report.override_reason
    return result


def canonical_narration_manifest(
    manifest: NarrationManifest,
    segments: tuple[SegmentPlan, ...],
) -> dict[str, Any]:
    by_id = {segment.segment_id: segment for segment in segments}
    if len(by_id) != len(segments):
        raise WorkspaceContractError("canonical narration segments must be unique")
    if [entry.segment_id for entry in manifest.entries] != [segment.segment_id for segment in segments]:
        raise WorkspaceContractError("segment plan order must exactly match narration manifest")
    captions: list[dict[str, Any]] = []
    cursor = 0.0
    entries = []
    for index, entry in enumerate(manifest.entries, 1):
        segment = by_id[entry.segment_id]
        end = cursor + entry.wav.duration_seconds
        captions.append(
            {
                "segmentId": entry.segment_id,
                "index": index,
                "startSeconds": cursor,
                "endSeconds": end,
                "text": segment.display_text,
            }
        )
        entries.append(
            {
                "segmentId": entry.segment_id,
                "acceptedAttemptId": str(entry.accepted_attempt_id),
                "qualityReportId": str(entry.quality_report_id),
                "wav": canonical_wav(entry.wav),
                "pauseAfterMs": entry.pause_after_ms,
                "transformIds": list(entry.transform_ids),
            }
        )
        cursor = end + entry.pause_after_ms / 1000
    if abs(cursor - manifest.final_wav.duration_seconds) > 1 / manifest.final_wav.sample_rate:
        raise WorkspaceContractError(
            "manifest speech/pause duration does not match measured final WAV"
        )
    return {
        "schemaVersion": manifest.schema_version,
        "manifestId": str(manifest.manifest_id),
        "episodeId": manifest.episode_id,
        "sourceRevision": manifest.source_revision,
        "entries": entries,
        "masteringProfileId": manifest.mastering_profile_id,
        "finalWav": canonical_wav(manifest.final_wav),
        "mastering": {
            "integratedLufs": manifest.mastering.integrated_lufs,
            "truePeakDbtp": manifest.mastering.true_peak_dbtp,
            "loudnessRangeLu": manifest.mastering.loudness_range_lu,
        },
        "captions": captions,
        "createdAt": manifest.created_at.isoformat(),
    }
