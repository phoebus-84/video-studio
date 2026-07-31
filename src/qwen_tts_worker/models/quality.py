"""Versioned contracts for the TTS quality pipeline.

These models are module-local contracts while the quality pipeline is being
validated. Cross-module consumers must use promoted schemas owned by
``video-workspace-contracts`` rather than importing this experimental module.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


CONTRACT_VERSION = "0.1.0"
_SHA256_PATTERN = r"^[0-9a-f]{64}$"


class FrozenContract(BaseModel):
    """Base class for immutable, strictly validated artifact contracts."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceFormat(str, Enum):
    """Source formats supported by the first ingestion adapters."""

    MARKDOWN_SCRIPT = "markdown_script"
    NARRATION_SCRIPT_JSON = "narration_script_json"
    PLAIN_TEXT = "plain_text"


class SpeechRole(str, Enum):
    """The performance role of a spoken block or segment."""

    NARRATOR = "narrator"
    DIALOGUE = "dialogue"


class SourceSpan(FrozenContract):
    """A half-open character range in a source document."""

    start: int = Field(..., ge=0)
    end: int = Field(..., ge=1)

    @model_validator(mode="after")
    def _end_follows_start(self) -> SourceSpan:
        if self.end <= self.start:
            raise ValueError("source span end must be greater than start")
        return self


class SourceDocument(FrozenContract):
    """Exact source text and identity before spoken-text preparation."""

    schema_version: Literal["0.1.0"] = CONTRACT_VERSION
    source_id: str = Field(..., min_length=1, max_length=256)
    revision: str = Field(..., min_length=1, max_length=256)
    content_sha256: str = Field(..., pattern=_SHA256_PATTERN)
    format: SourceFormat
    language: str = Field(..., min_length=2, max_length=35)
    text: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _content_hash_matches(self) -> SourceDocument:
        actual = hashlib.sha256(self.text.encode("utf-8")).hexdigest()
        if actual != self.content_sha256:
            raise ValueError("content_sha256 does not match UTF-8 source text")
        return self


class TextChange(FrozenContract):
    """An auditable display-text to spoken-text transformation."""

    source_span: SourceSpan
    original: str = Field(..., min_length=1)
    spoken: str = Field(..., min_length=1)
    rule_id: str = Field(..., min_length=1, max_length=128)


class PronunciationEntry(FrozenContract):
    """An exact, scoped pronunciation substitution."""

    entry_id: str = Field(..., min_length=1, max_length=128)
    display: str = Field(..., min_length=1)
    spoken: str = Field(..., min_length=1)
    language: str = Field(..., min_length=2, max_length=35)
    case_sensitive: bool = False
    note: str | None = Field(default=None, max_length=512)


class SpokenBlock(FrozenContract):
    """A source-mapped structural unit after ingestion and role analysis."""

    block_id: str = Field(..., min_length=1, max_length=256)
    source_document_sha256: str = Field(..., pattern=_SHA256_PATTERN)
    source_spans: tuple[SourceSpan, ...] = Field(..., min_length=1)
    role: SpeechRole
    speaker: str = Field(..., min_length=1, max_length=128)
    display_text: str = Field(..., min_length=1)
    spoken_text: str = Field(..., min_length=1)
    language: str = Field(..., min_length=2, max_length=35)
    changes: tuple[TextChange, ...] = ()
    pause_after_ms: int | None = Field(default=None, ge=0, le=10_000)


class DeliveryDelta(FrozenContract):
    """Bounded delivery controls that do not redefine speaker identity."""

    pace: Literal["slower", "steady", "quicker"] | None = None
    articulation: Literal["soft", "natural", "crisp"] | None = None
    energy: Literal["low", "medium", "high"] | None = None
    emotion: Literal[
        "neutral",
        "warm",
        "joyful",
        "curious",
        "somber",
        "tense",
        "urgent",
    ] | None = None
    intensity: Literal["restrained", "moderate", "strong"] | None = None
    intent: Literal[
        "narrate",
        "explain",
        "reassure",
        "wonder",
        "warn",
        "question",
        "exclaim",
    ] | None = None
    distance: Literal["intimate", "conversational", "projected"] | None = None


class VoiceDirection(FrozenContract):
    """Stable base direction plus an optional segment delivery delta."""

    direction_version: str = Field(..., min_length=1, max_length=64)
    base_direction_id: str = Field(..., min_length=1, max_length=128)
    base_instruction: str = Field(..., min_length=1, max_length=512)
    delta: DeliveryDelta = Field(default_factory=DeliveryDelta)
    composed_instruction: str = Field(..., min_length=1, max_length=768)


class SegmentContext(FrozenContract):
    """Non-spoken neighboring context retained for controlled experiments."""

    policy: Literal["none", "metadata_only"] = "metadata_only"
    before: str = Field(default="", max_length=1000)
    after: str = Field(default="", max_length=1000)


class SegmentPlan(FrozenContract):
    """One independently synthesizable semantic segment."""

    schema_version: Literal["0.1.0"] = CONTRACT_VERSION
    segment_id: str = Field(..., min_length=1, max_length=256)
    source_document_sha256: str = Field(..., pattern=_SHA256_PATTERN)
    source_block_ids: tuple[str, ...] = Field(..., min_length=1)
    source_spans: tuple[SourceSpan, ...] = Field(..., min_length=1)
    preprocessing_version: str = Field(..., min_length=1, max_length=64)
    display_text: str = Field(..., min_length=1)
    spoken_text: str = Field(..., min_length=1)
    language: str = Field(..., min_length=2, max_length=35)
    role: SpeechRole
    speaker_profile_id: str = Field(..., min_length=1, max_length=128)
    direction: VoiceDirection
    context: SegmentContext = Field(default_factory=SegmentContext)
    pause_after_ms: int = Field(default=0, ge=0, le=10_000)


class ModelIdentity(FrozenContract):
    """Exact model and runtime identity used by a synthesis profile."""

    model_id: str = Field(..., min_length=1, max_length=256)
    model_profile: Literal["custom_voice"]
    model_sha256: str = Field(..., pattern=_SHA256_PATTERN)
    quantization: str = Field(..., min_length=1, max_length=64)
    mlx_audio_version: str = Field(..., min_length=1, max_length=64)
    mlx_version: str = Field(..., min_length=1, max_length=64)


class SamplingProfile(FrozenContract):
    """All stochastic generation controls supported by the backend."""

    temperature: float = Field(..., gt=0.0, le=2.0)
    top_k: int = Field(..., ge=0, le=10_000)
    top_p: float = Field(..., gt=0.0, le=1.0)
    repetition_penalty: float = Field(..., ge=1.0, le=3.0)
    max_tokens: int = Field(..., ge=1, le=8192)
    seed: int = Field(..., ge=0, le=2**32 - 1)


class SynthesisProfile(FrozenContract):
    """Validated CustomVoice identity and generation configuration."""

    schema_version: Literal["0.1.0"] = CONTRACT_VERSION
    profile_id: str = Field(..., min_length=1, max_length=128)
    profile_revision: str = Field(..., min_length=1, max_length=64)
    model: ModelIdentity
    speaker: str = Field(..., min_length=1, max_length=128)
    language: str = Field(..., min_length=2, max_length=35)
    sample_rate: Literal[24000] = 24000
    channels: Literal[1] = 1
    sample_width_bytes: Literal[2] = 2
    sampling: SamplingProfile


def synthesis_fingerprint(segment: SegmentPlan, profile: SynthesisProfile) -> str:
    """Hash every input that can affect generated speech or canonical WAV bytes."""

    material = {
        "fingerprint_version": "0.1.0",
        "spoken_text": segment.spoken_text,
        "language": segment.language,
        "role": segment.role.value,
        "speaker_profile_id": segment.speaker_profile_id,
        "preprocessing_version": segment.preprocessing_version,
        "context": segment.context.model_dump(mode="json"),
        "direction": segment.direction.model_dump(mode="json"),
        "profile": profile.model_dump(mode="json"),
    }
    canonical = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class AttemptPhase(str, Enum):
    """Immutable attempt outcome stored by the synthesis job system."""

    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AttemptFailure(FrozenContract):
    """Reason-coded failure safe for retry policy and operator display."""

    code: Literal[
        "invalid_request",
        "model_unavailable",
        "generation_failed",
        "missing_output",
        "invalid_wav",
        "validation_rejected",
        "cancelled",
    ]
    message: str = Field(..., min_length=1, max_length=1000)
    retryable: bool


class WavArtifact(FrozenContract):
    """Canonical metadata for one raw or transformed WAV artifact."""

    path: str = Field(..., min_length=1)
    sha256: str = Field(..., pattern=_SHA256_PATTERN)
    size_bytes: int = Field(..., ge=44)
    duration_seconds: float = Field(..., gt=0.0)
    sample_rate: int = Field(..., gt=0)
    channels: int = Field(..., ge=1)
    sample_width_bytes: int = Field(..., ge=1)


class SynthesisAttempt(FrozenContract):
    """An immutable record of one generation attempt for one segment."""

    schema_version: Literal["0.1.0"] = CONTRACT_VERSION
    attempt_id: UUID = Field(default_factory=uuid4)
    segment_id: str = Field(..., min_length=1, max_length=256)
    request_fingerprint: str = Field(..., pattern=_SHA256_PATTERN)
    phase: AttemptPhase
    profile: SynthesisProfile
    direction: VoiceDirection
    raw_wav: WavArtifact | None = None
    failure: AttemptFailure | None = None
    retry_of: UUID | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime
    processing_seconds: float = Field(..., ge=0.0)
    peak_memory_bytes: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _outcome_is_consistent(self) -> SynthesisAttempt:
        if self.phase == AttemptPhase.COMPLETED:
            if self.raw_wav is None or self.failure is not None:
                raise ValueError("completed attempt requires raw_wav and no failure")
        elif self.failure is None or self.raw_wav is not None:
            raise ValueError("failed/cancelled attempt requires failure and no raw_wav")
        if self.completed_at < self.created_at:
            raise ValueError("completed_at cannot precede created_at")
        return self


class SignalMetrics(FrozenContract):
    """Cheap objective measurements used by the first validation gate."""

    peak_dbfs: float
    rms_dbfs: float
    clipped_sample_ratio: float = Field(..., ge=0.0, le=1.0)
    dc_offset: float = Field(..., ge=-1.0, le=1.0)
    leading_silence_ms: float = Field(..., ge=0.0)
    trailing_silence_ms: float = Field(..., ge=0.0)
    spoken_words_per_minute: float = Field(..., ge=0.0)


class QualityCheck(FrozenContract):
    """One reason-coded segment quality check."""

    check_id: str = Field(..., min_length=1, max_length=128)
    status: Literal["pass", "warn", "fail"]
    observed: str = Field(..., min_length=1, max_length=512)
    expected: str = Field(..., min_length=1, max_length=512)


class QualityDecision(str, Enum):
    """Disposition of a synthesis attempt after validation."""

    ACCEPT = "accept"
    REJECT = "reject"
    REVIEW = "review"


class SegmentQualityReport(FrozenContract):
    """Validation evidence and decision for one immutable attempt."""

    schema_version: Literal["0.1.0"] = CONTRACT_VERSION
    report_id: UUID = Field(default_factory=uuid4)
    validator_version: str = Field(..., min_length=1, max_length=64)
    attempt_id: UUID
    metrics: SignalMetrics
    checks: tuple[QualityCheck, ...] = Field(..., min_length=1)
    decision: QualityDecision
    override_actor: str | None = Field(default=None, max_length=256)
    override_reason: str | None = Field(default=None, max_length=1000)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def _override_is_complete(self) -> SegmentQualityReport:
        if (self.override_actor is None) != (self.override_reason is None):
            raise ValueError("override_actor and override_reason must be set together")
        return self


class NarrationEntry(FrozenContract):
    """An ordered accepted attempt and its assembly intent."""

    segment_id: str = Field(..., min_length=1, max_length=256)
    accepted_attempt_id: UUID
    quality_report_id: UUID
    wav: WavArtifact
    pause_after_ms: int = Field(default=0, ge=0, le=10_000)
    transform_ids: tuple[str, ...] = ()


class MasteringMetrics(FrozenContract):
    """Measurements of the final assembled narration."""

    integrated_lufs: float
    true_peak_dbtp: float
    loudness_range_lu: float = Field(..., ge=0.0)


class NarrationManifest(FrozenContract):
    """Ordered provenance for accepted segments and the mastered narration."""

    schema_version: Literal["0.1.0"] = CONTRACT_VERSION
    manifest_id: UUID = Field(default_factory=uuid4)
    episode_id: str = Field(..., min_length=1, max_length=256)
    source_revision: str = Field(..., min_length=1, max_length=256)
    entries: tuple[NarrationEntry, ...] = Field(..., min_length=1)
    mastering_profile_id: str = Field(..., min_length=1, max_length=128)
    final_wav: WavArtifact
    mastering: MasteringMetrics
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def _segment_ids_are_unique(self) -> NarrationManifest:
        segment_ids = [entry.segment_id for entry in self.entries]
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("narration manifest segment IDs must be unique")
        return self
