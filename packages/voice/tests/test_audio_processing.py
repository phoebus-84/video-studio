"""Conservative edge trim, no-phoneme-loss, pause, and provenance tests."""

from __future__ import annotations

import hashlib
import io
import json
import math
import wave
from array import array
from pathlib import Path

import pytest

from qwen_tts_worker.attempt_store import AttemptStore
from qwen_tts_worker.audio_processing import (
    AudioProcessingError,
    AudioProcessor,
    AudioTransformStore,
    EdgeProcessingPolicy,
)
from qwen_tts_worker.models.quality import QualityDecision
from qwen_tts_worker.signal_validation import override_quality_decision, validate_attempt_signal
from test_attempt_store import profile, segment


ROOT = Path(__file__).resolve().parent.parent
EDGE_EVIDENCE = ROOT / "evaluation" / "diagnostics" / "legacy-edge-ab-v1.json"


def wav_bytes(
    *,
    seconds: float = 2.0,
    leading_ms: int = 400,
    trailing_ms: int = 400,
    amplitude: int = 5000,
    sample_rate: int = 24_000,
    channels: int = 1,
) -> bytes:
    frames = round(seconds * sample_rate)
    leading = round(leading_ms * sample_rate / 1000)
    trailing = round(trailing_ms * sample_rate / 1000)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        raw = bytearray()
        for index in range(frames):
            value = 0 if index < leading or index >= frames - trailing else round(
                amplitude * math.sin(2 * math.pi * 220 * (index - leading) / sample_rate)
            )
            for _ in range(channels):
                raw.extend(value.to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(raw))
    return output.getvalue()


def accepted(tmp_path: Path, data: bytes):
    store = AttemptStore(tmp_path / "attempt-store")
    job = store.execute(
        store.submit(segment(text="one two three four"), profile()).job_id,
        lambda *_: data,
    )
    attempt = store.get_attempt(job.attempt_id)
    evidence = validate_attempt_signal(attempt, store.root, spoken_word_count=4)
    if evidence.report.decision != QualityDecision.ACCEPT:
        evidence = override_quality_decision(
            evidence,
            actor="fixture-reviewer",
            reason="Synthetic fixture accepted specifically for transform behavior",
            decision=QualityDecision.ACCEPT,
        )
    return store, attempt, evidence.report


def decode(path: Path) -> tuple[array[int], int]:
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        samples = array("h")
        samples.frombytes(wav.readframes(wav.getnframes()))
    return samples, rate


def test_trim_preserves_margin_and_complete_active_sequence(tmp_path: Path) -> None:
    raw = wav_bytes()
    store, attempt, report = accepted(tmp_path, raw)
    processor = AudioProcessor()
    transformed_root = tmp_path / "transformed"
    result = processor.process_attempt(
        attempt, report, store.root, transformed_root, pause_after_ms=350
    )
    assert result.fade_applied is False
    assert result.format_transform == "verified-canonical"
    assert result.leading_trimmed_samples == pytest.approx(320 * 24, abs=120)
    assert result.trailing_trimmed_samples == pytest.approx(320 * 24, abs=120)
    assert result.preserved_margin_samples == 80 * 24
    assert result.first_active_sample_after == 80 * 24
    assert result.requested_pause_ms == 350
    assert result.realized_pause_ms == 350

    raw_samples, _ = decode(store.root / attempt.raw_wav.path)
    transformed_samples, rate = decode(transformed_root / result.transformed_wav.path)
    threshold = 32768 * 10 ** (-45 / 20)
    raw_active = [i for i, value in enumerate(raw_samples) if abs(value) > threshold]
    transformed_active = [i for i, value in enumerate(transformed_samples) if abs(value) > threshold]
    active_raw_bytes = raw_samples[raw_active[0] : raw_active[-1] + 1].tobytes()
    active_transformed_bytes = transformed_samples[
        transformed_active[0] : transformed_active[-1] + 1
    ].tobytes()
    assert active_transformed_bytes == active_raw_bytes
    assert hashlib.sha256(active_raw_bytes).hexdigest() == result.active_sample_sequence_sha256
    assert rate == 24_000
    assert (store.root / attempt.raw_wav.path).read_bytes() == raw


def test_pause_wav_is_exact_silence_and_zero_pause_has_no_artifact(tmp_path: Path) -> None:
    store, attempt, report = accepted(tmp_path, wav_bytes())
    processor = AudioProcessor()
    result = processor.process_attempt(
        attempt, report, store.root, tmp_path / "out", pause_after_ms=333
    )
    assert result.pause_wav is not None
    pause, rate = decode(tmp_path / "out" / result.pause_wav.path)
    assert len(pause) == round(333 * rate / 1000)
    assert all(value == 0 for value in pause)
    assert abs(result.realized_pause_ms - 333) <= 1000 / rate

    other_store, other_attempt, other_report = accepted(
        tmp_path / "zero", wav_bytes()
    )
    zero = processor.process_attempt(
        other_attempt, other_report, other_store.root, tmp_path / "zero-out", pause_after_ms=0
    )
    assert zero.pause_wav is None
    assert zero.realized_pause_ms == 0


def test_active_onset_is_never_faded_or_trimmed(tmp_path: Path) -> None:
    store, attempt, report = accepted(
        tmp_path, wav_bytes(leading_ms=0, trailing_ms=0)
    )
    result = AudioProcessor().process_attempt(
        attempt, report, store.root, tmp_path / "out", pause_after_ms=0
    )
    assert result.leading_trimmed_samples == 0
    assert result.trailing_trimmed_samples == 0
    assert result.transformed_wav.sha256 == attempt.raw_wav.sha256


def test_trim_is_capped_even_for_large_edges(tmp_path: Path) -> None:
    data = wav_bytes(seconds=5, leading_ms=2000, trailing_ms=2000)
    processor = AudioProcessor(
        EdgeProcessingPolicy(maximum_trim_per_edge_ms=500, preserve_margin_ms=80)
    )
    processed = processor.process_bytes(data)
    assert processed.leading_trimmed_samples == 500 * 24
    assert processed.trailing_trimmed_samples == 500 * 24


def test_rejected_or_mismatched_quality_evidence_cannot_transform(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path / "store")
    job = store.execute(
        store.submit(segment(text="one two"), profile()).job_id,
        lambda *_: wav_bytes(amplitude=0),
    )
    attempt = store.get_attempt(job.attempt_id)
    evidence = validate_attempt_signal(attempt, store.root, spoken_word_count=2)
    assert evidence.report.decision == QualityDecision.REJECT
    with pytest.raises(AudioProcessingError, match="only accepted"):
        AudioProcessor().process_attempt(
            attempt, evidence.report, store.root, tmp_path / "out", pause_after_ms=200
        )


def test_transform_report_store_is_write_once_and_round_trips(tmp_path: Path) -> None:
    store, attempt, report = accepted(tmp_path, wav_bytes())
    transformed = AudioProcessor().process_attempt(
        attempt, report, store.root, tmp_path / "artifacts", pause_after_ms=200
    )
    reports = AudioTransformStore(tmp_path / "artifacts")
    reports.save(transformed)
    assert reports.get(transformed.transform_id) == transformed
    with pytest.raises(AudioProcessingError, match="report already exists"):
        reports.save(transformed)


def test_raw_integrity_and_output_immutability_are_enforced(tmp_path: Path) -> None:
    store, attempt, report = accepted(tmp_path, wav_bytes())
    processor = AudioProcessor()
    output = tmp_path / "out"
    processor.process_attempt(attempt, report, store.root, output, pause_after_ms=200)
    with pytest.raises(AudioProcessingError, match="already exists"):
        processor.process_attempt(attempt, report, store.root, output, pause_after_ms=200)

    raw_path = store.root / attempt.raw_wav.path
    raw_path.write_bytes(b"changed")
    with pytest.raises(AudioProcessingError, match="integrity"):
        processor.process_attempt(
            attempt, report, store.root, tmp_path / "other", pause_after_ms=200
        )


def test_frozen_baseline_ab_preserves_active_audio_and_disables_unproven_fades() -> None:
    evidence = json.loads(EDGE_EVIDENCE.read_text(encoding="utf-8"))
    assert evidence["aggregate"]["segments"] == 18
    assert evidence["aggregate"]["boundaries"] == 9
    assert evidence["aggregate"]["all_active_sequences_preserved"] is True
    assert evidence["aggregate"]["segments_changed"] == 18
    assert evidence["aggregate"]["max_removed_seconds"] < 0.05
    assert evidence["decision"]["edge_trim"] == "enabled"
    assert evidence["decision"]["explicit_pause_wav"] == "enabled"
    assert evidence["decision"]["micro_fade"] == "disabled"


def test_noncanonical_or_silent_audio_fails_closed() -> None:
    processor = AudioProcessor()
    with pytest.raises(AudioProcessingError, match="no active samples"):
        processor.process_bytes(wav_bytes(amplitude=0))
    with pytest.raises(AudioProcessingError, match="canonical mono PCM16"):
        processor.process_bytes(wav_bytes(sample_rate=16_000, channels=2))
