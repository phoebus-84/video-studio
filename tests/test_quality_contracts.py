"""Contract tests for versioned TTS quality pipeline artifacts."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from qwen_tts_worker.models.quality import (
    AttemptFailure,
    AttemptPhase,
    DeliveryDelta,
    MasteringMetrics,
    ModelIdentity,
    NarrationEntry,
    NarrationManifest,
    QualityCheck,
    QualityDecision,
    SamplingProfile,
    SegmentContext,
    SegmentPlan,
    SegmentQualityReport,
    SignalMetrics,
    SourceDocument,
    SourceFormat,
    SourceSpan,
    SpeechRole,
    SynthesisAttempt,
    SynthesisProfile,
    VoiceDirection,
    WavArtifact,
    synthesis_fingerprint,
)


SHA_A = "a" * 64
SHA_B = "b" * 64


def make_direction() -> VoiceDirection:
    return VoiceDirection(
        direction_version="director-1",
        base_direction_id="narrator-warm-1",
        base_instruction="Speak warmly with clear, steady articulation.",
        delta=DeliveryDelta(emotion="warm", intent="narrate"),
        composed_instruction="Speak warmly with clear, steady articulation. Narrate warmly.",
    )


def make_segment() -> SegmentPlan:
    return SegmentPlan(
        segment_id="scene-1.abc123",
        source_document_sha256=SHA_A,
        source_block_ids=("block-1",),
        source_spans=(SourceSpan(start=0, end=12),),
        preprocessing_version="prep-1",
        display_text="Hello, world.",
        spoken_text="Hello, world.",
        language="en-US",
        role=SpeechRole.NARRATOR,
        speaker_profile_id="narrator-1",
        direction=make_direction(),
        context=SegmentContext(before="", after="Next sentence."),
        pause_after_ms=250,
    )


def make_profile() -> SynthesisProfile:
    return SynthesisProfile(
        profile_id="narrator-1",
        profile_revision="1",
        model=ModelIdentity(
            model_id="Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
            model_profile="custom_voice",
            model_sha256=SHA_B,
            quantization="8bit-affine-g64",
            mlx_audio_version="0.4.6",
            mlx_version="0.32.0",
        ),
        speaker="ryan",
        language="english",
        sampling=SamplingProfile(
            temperature=0.7,
            top_k=50,
            top_p=1.0,
            repetition_penalty=1.05,
            max_tokens=1200,
            seed=42,
        ),
    )


def make_wav(path: str = "raw.wav") -> WavArtifact:
    return WavArtifact(
        path=path,
        sha256=SHA_A,
        size_bytes=48_044,
        duration_seconds=1.0,
        sample_rate=24_000,
        channels=1,
        sample_width_bytes=2,
    )


class TestSourceContracts:
    def test_source_document_validates_its_content_hash(self) -> None:
        text = "Exact source text."
        document = SourceDocument(
            source_id="episode/script",
            revision="rev-1",
            content_sha256=hashlib.sha256(text.encode()).hexdigest(),
            format=SourceFormat.PLAIN_TEXT,
            language="en-US",
            text=text,
        )
        assert document.schema_version == "0.1.0"

        with pytest.raises(ValidationError, match="content_sha256"):
            SourceDocument(
                source_id="episode/script",
                revision="rev-1",
                content_sha256=SHA_A,
                format=SourceFormat.PLAIN_TEXT,
                language="en-US",
                text=text,
            )

    def test_source_span_is_half_open_and_non_empty(self) -> None:
        assert SourceSpan(start=2, end=5).model_dump() == {"start": 2, "end": 5}
        with pytest.raises(ValidationError, match="greater than start"):
            SourceSpan(start=2, end=2)

    def test_contracts_are_frozen_and_reject_unknown_fields(self) -> None:
        segment = make_segment()
        with pytest.raises(ValidationError):
            segment.spoken_text = "Changed"  # type: ignore[misc]
        with pytest.raises(ValidationError, match="Extra inputs"):
            SourceSpan(start=0, end=1, inclusive=True)  # type: ignore[call-arg]


class TestSynthesisFingerprint:
    def test_fingerprint_is_stable(self) -> None:
        first = synthesis_fingerprint(make_segment(), make_profile())
        second = synthesis_fingerprint(make_segment(), make_profile())
        assert first == second
        assert len(first) == 64

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("spoken_text", "Hello there."),
            ("language", "fr-FR"),
            ("speaker_profile_id", "narrator-2"),
            ("preprocessing_version", "prep-2"),
            ("context", SegmentContext(before="Prior sentence.", after="")),
            (
                "direction",
                VoiceDirection(
                    direction_version="director-2",
                    base_direction_id="narrator-warm-1",
                    base_instruction="Speak warmly with clear, steady articulation.",
                    delta=DeliveryDelta(emotion="tense"),
                    composed_instruction="Speak warmly with tense, restrained delivery.",
                ),
            ),
        ],
    )
    def test_segment_synthesis_inputs_change_fingerprint(
        self, field: str, value: object
    ) -> None:
        segment = make_segment()
        changed = segment.model_copy(update={field: value})
        assert synthesis_fingerprint(segment, make_profile()) != synthesis_fingerprint(
            changed, make_profile()
        )

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("speaker", "aiden"),
            ("language", "auto"),
            ("profile_revision", "2"),
            (
                "sampling",
                SamplingProfile(
                    temperature=0.8,
                    top_k=50,
                    top_p=1.0,
                    repetition_penalty=1.05,
                    max_tokens=1200,
                    seed=42,
                ),
            ),
            (
                "sampling",
                SamplingProfile(
                    temperature=0.7,
                    top_k=50,
                    top_p=1.0,
                    repetition_penalty=1.05,
                    max_tokens=1200,
                    seed=43,
                ),
            ),
        ],
    )
    def test_profile_synthesis_inputs_change_fingerprint(
        self, field: str, value: object
    ) -> None:
        profile = make_profile()
        changed = profile.model_copy(update={field: value})
        assert synthesis_fingerprint(make_segment(), profile) != synthesis_fingerprint(
            make_segment(), changed
        )

    def test_display_only_metadata_does_not_invalidate_audio(self) -> None:
        segment = make_segment()
        changed = segment.model_copy(
            update={
                "display_text": "Display-only edit",
                "source_spans": (SourceSpan(start=20, end=30),),
            }
        )
        assert synthesis_fingerprint(segment, make_profile()) == synthesis_fingerprint(
            changed, make_profile()
        )


class TestAttemptAndQualityContracts:
    def test_completed_attempt_requires_raw_wav(self) -> None:
        now = datetime.now(timezone.utc)
        with pytest.raises(ValidationError, match="requires raw_wav"):
            SynthesisAttempt(
                segment_id="s1",
                request_fingerprint=SHA_A,
                phase=AttemptPhase.COMPLETED,
                profile=make_profile(),
                direction=make_direction(),
                created_at=now,
                completed_at=now,
                processing_seconds=1.0,
            )

    def test_failed_attempt_requires_reason_and_forbids_wav(self) -> None:
        now = datetime.now(timezone.utc)
        failure = AttemptFailure(
            code="generation_failed", message="Model stopped early.", retryable=True
        )
        attempt = SynthesisAttempt(
            segment_id="s1",
            request_fingerprint=SHA_A,
            phase=AttemptPhase.FAILED,
            profile=make_profile(),
            direction=make_direction(),
            failure=failure,
            created_at=now,
            completed_at=now,
            processing_seconds=1.0,
        )
        assert attempt.failure == failure

        with pytest.raises(ValidationError, match="requires failure and no raw_wav"):
            SynthesisAttempt(
                segment_id="s1",
                request_fingerprint=SHA_A,
                phase=AttemptPhase.FAILED,
                profile=make_profile(),
                direction=make_direction(),
                raw_wav=make_wav(),
                failure=failure,
                created_at=now,
                completed_at=now,
                processing_seconds=1.0,
            )

    def test_quality_override_requires_actor_and_reason(self) -> None:
        metrics = SignalMetrics(
            peak_dbfs=-3.0,
            rms_dbfs=-20.0,
            clipped_sample_ratio=0.0,
            dc_offset=0.0,
            leading_silence_ms=80.0,
            trailing_silence_ms=100.0,
            spoken_words_per_minute=160.0,
        )
        check = QualityCheck(
            check_id="speech-presence",
            status="pass",
            observed="RMS -20 dBFS",
            expected="above -50 dBFS",
        )
        with pytest.raises(ValidationError, match="must be set together"):
            SegmentQualityReport(
                validator_version="validator-1",
                attempt_id=uuid4(),
                metrics=metrics,
                checks=(check,),
                decision=QualityDecision.ACCEPT,
                override_actor="operator",
            )


class TestNarrationManifest:
    def test_manifest_preserves_order_and_unique_segments(self) -> None:
        report_a, report_b = uuid4(), uuid4()
        entry_a = NarrationEntry(
            segment_id="s1.a",
            accepted_attempt_id=uuid4(),
            quality_report_id=report_a,
            wav=make_wav("a.wav"),
            pause_after_ms=250,
        )
        entry_b = NarrationEntry(
            segment_id="s1.b",
            accepted_attempt_id=uuid4(),
            quality_report_id=report_b,
            wav=make_wav("b.wav"),
        )
        manifest = NarrationManifest(
            episode_id="channel/series/episode",
            source_revision="rev-1",
            entries=(entry_a, entry_b),
            mastering_profile_id="youtube-dialogue-1",
            final_wav=make_wav("narration-full.wav"),
            mastering=MasteringMetrics(
                integrated_lufs=-16.0,
                true_peak_dbtp=-1.5,
                loudness_range_lu=5.0,
            ),
        )
        assert [entry.segment_id for entry in manifest.entries] == ["s1.a", "s1.b"]

        duplicate = entry_b.model_copy(update={"segment_id": "s1.a"})
        with pytest.raises(ValidationError, match="must be unique"):
            NarrationManifest(
                episode_id="channel/series/episode",
                source_revision="rev-1",
                entries=(entry_a, duplicate),
                mastering_profile_id="youtube-dialogue-1",
                final_wav=make_wav("narration-full.wav"),
                mastering=MasteringMetrics(
                    integrated_lufs=-16.0,
                    true_peak_dbtp=-1.5,
                    loudness_range_lu=5.0,
                ),
            )
