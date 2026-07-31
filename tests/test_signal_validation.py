"""Calibrated signal validation, report persistence, override, and retry tests."""

from __future__ import annotations

import hashlib
import io
import math
import wave
from datetime import datetime, timezone
from pathlib import Path

import pytest

from qwen_tts_worker.attempt_store import AttemptStore, AttemptStoreError
from qwen_tts_worker.models.quality import (
    AttemptPhase,
    QualityDecision,
    SynthesisAttempt,
    WavArtifact,
)
from qwen_tts_worker.signal_validation import (
    QualityReportStore,
    SignalValidationError,
    SignalValidationPolicy,
    override_quality_decision,
    validate_attempt_signal,
)
from test_attempt_store import profile, segment


def make_wav(
    *,
    seconds: float = 2.0,
    amplitude: int = 5000,
    dc_offset: int = 0,
    leading_seconds: float = 0,
    trailing_seconds: float = 0,
    sample_rate: int = 24_000,
    channels: int = 1,
) -> bytes:
    frames = int(seconds * sample_rate)
    leading = int(leading_seconds * sample_rate)
    trailing = int(trailing_seconds * sample_rate)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        raw = bytearray()
        for index in range(frames):
            if index < leading or index >= frames - trailing:
                value = 0
            else:
                value = round(dc_offset + amplitude * math.sin(2 * math.pi * 220 * index / sample_rate))
                value = max(-32768, min(32767, value))
            for _ in range(channels):
                raw.extend(int(value).to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(raw))
    return output.getvalue()


def completed_attempt(tmp_path: Path, data: bytes, *, segment_id: str = "signal"):
    store = AttemptStore(tmp_path)
    job = store.execute(
        store.submit(segment(segment_id, "one two three four"), profile()).job_id,
        lambda *_: data,
    )
    assert job.phase == "completed"
    return store, job, store.get_attempt(job.attempt_id)


def status(evidence, check_id: str) -> str:
    return next(check.status for check in evidence.report.checks if check.check_id == check_id)


def test_good_speech_fixture_is_accepted_with_versioned_machine_report(tmp_path: Path) -> None:
    store, job, attempt = completed_attempt(tmp_path, make_wav())
    evidence = validate_attempt_signal(attempt, store.root, spoken_word_count=4)
    assert evidence.report.decision == QualityDecision.ACCEPT
    assert evidence.policy_id == "qwen-pcm24k-v1"
    assert len(evidence.policy_fingerprint) == 64
    assert evidence.policy_fingerprint[:12] in evidence.report.validator_version
    assert status(evidence, "wav.format") == "pass"
    assert status(evidence, "signal.speech-presence") == "pass"
    assert status(evidence, "signal.clipping") == "pass"
    assert status(evidence, "speech.rate") == "pass"


def test_silent_fixture_is_rejected_and_quality_retry_is_bounded(tmp_path: Path) -> None:
    store, job, attempt = completed_attempt(tmp_path, make_wav(amplitude=0))
    evidence = validate_attempt_signal(attempt, store.root, spoken_word_count=4)
    assert evidence.report.decision == QualityDecision.REJECT
    assert status(evidence, "signal.speech-presence") == "fail"
    retry = store.retry_rejected(attempt.attempt_id, evidence.report)
    assert retry.retry_of == attempt.attempt_id
    assert retry.retry_reason == "quality:signal.speech-presence"
    assert retry.profile.sampling.seed == profile().sampling.seed + 1


def test_clipped_dc_offset_and_excessive_edges_are_reason_coded(tmp_path: Path) -> None:
    clipped_store, _, clipped_attempt = completed_attempt(
        tmp_path / "clipped", make_wav(amplitude=32767)
    )
    clipped = validate_attempt_signal(clipped_attempt, clipped_store.root)
    assert clipped.report.decision == QualityDecision.REJECT
    assert status(clipped, "signal.clipping") == "fail"

    dc_store, _, dc_attempt = completed_attempt(
        tmp_path / "dc", make_wav(amplitude=1000, dc_offset=6000)
    )
    dc = validate_attempt_signal(dc_attempt, dc_store.root)
    assert dc.report.decision == QualityDecision.REJECT
    assert status(dc, "signal.dc-offset") == "fail"

    edge_store, _, edge_attempt = completed_attempt(
        tmp_path / "edge",
        make_wav(seconds=12, leading_seconds=5.5, trailing_seconds=5.5),
    )
    edge = validate_attempt_signal(edge_attempt, edge_store.root)
    assert edge.report.decision == QualityDecision.REJECT
    assert status(edge, "signal.edge-silence") == "fail"


def test_suspicious_but_not_invalid_rate_and_edges_require_review(tmp_path: Path) -> None:
    store, _, attempt = completed_attempt(
        tmp_path, make_wav(seconds=4, leading_seconds=2)
    )
    evidence = validate_attempt_signal(attempt, store.root, spoken_word_count=4)
    assert evidence.report.decision == QualityDecision.REVIEW
    assert status(evidence, "signal.edge-silence") == "warn"
    assert status(evidence, "speech.rate") == "warn"


def test_corrupt_or_missing_artifact_is_rejected_not_crashed(tmp_path: Path) -> None:
    store, _, attempt = completed_attempt(tmp_path, make_wav())
    assert attempt.raw_wav is not None
    wav_path = store.root / attempt.raw_wav.path
    wav_path.write_bytes(b"broken")
    corrupt = validate_attempt_signal(attempt, store.root, spoken_word_count=4)
    assert corrupt.report.decision == QualityDecision.REJECT
    assert status(corrupt, "artifact.integrity") == "fail"
    assert status(corrupt, "wav.decode") == "fail"

    wav_path.unlink()
    missing = validate_attempt_signal(attempt, store.root)
    assert missing.report.decision == QualityDecision.REJECT
    assert status(missing, "artifact.readable") == "fail"


def test_noncanonical_format_rejects_and_does_not_quality_retry(tmp_path: Path) -> None:
    data = make_wav(sample_rate=16_000, channels=2)
    path = tmp_path / "stereo.wav"
    path.write_bytes(data)
    with wave.open(io.BytesIO(data), "rb") as wav:
        duration = wav.getnframes() / wav.getframerate()
    artifact = WavArtifact(
        path="stereo.wav",
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        duration_seconds=duration,
        sample_rate=16_000,
        channels=2,
        sample_width_bytes=2,
    )
    now = datetime.now(timezone.utc)
    attempt = SynthesisAttempt(
        segment_id="format",
        request_fingerprint="c" * 64,
        phase=AttemptPhase.COMPLETED,
        profile=profile(),
        direction=segment().direction,
        raw_wav=artifact,
        created_at=now,
        completed_at=now,
        processing_seconds=0,
    )
    evidence = validate_attempt_signal(attempt, tmp_path)
    assert status(evidence, "wav.format") == "fail"
    assert evidence.report.decision == QualityDecision.REJECT


def test_report_store_is_immutable_and_round_trips(tmp_path: Path) -> None:
    store, _, attempt = completed_attempt(tmp_path / "attempts", make_wav())
    evidence = validate_attempt_signal(attempt, store.root, spoken_word_count=4)
    reports = QualityReportStore(tmp_path / "reports")
    path = reports.save(evidence)
    assert reports.get(str(evidence.report.report_id)) == evidence
    assert path.read_bytes().endswith(b"\n")
    with pytest.raises(SignalValidationError, match="already exists"):
        reports.save(evidence)


def test_manual_override_requires_actor_reason_and_remains_auditable(tmp_path: Path) -> None:
    store, _, attempt = completed_attempt(tmp_path, make_wav(amplitude=0))
    evidence = validate_attempt_signal(attempt, store.root)
    overridden = override_quality_decision(
        evidence,
        actor="reviewer@example.org",
        reason="Known intentional silent interstitial; excluded from spoken narration",
        decision=QualityDecision.ACCEPT,
    )
    assert overridden.report.override_actor == "reviewer@example.org"
    assert overridden.report.override_reason is not None
    assert any(check.status == "fail" for check in overridden.report.checks)
    with pytest.raises(SignalValidationError, match="non-empty actor"):
        override_quality_decision(
            evidence, actor="", reason="because", decision=QualityDecision.ACCEPT
        )


def test_only_completed_attempts_can_be_validated(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    failed_job = store.execute(
        store.submit(segment(), profile()).job_id,
        lambda *_: (_ for _ in ()).throw(RuntimeError("generation failed")),
    )
    with pytest.raises(SignalValidationError, match="only completed"):
        validate_attempt_signal(store.get_attempt(failed_job.attempt_id), store.root)
