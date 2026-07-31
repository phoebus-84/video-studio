"""Advisory ASR edit accounting, boundary metrics, and frozen evidence tests."""

from __future__ import annotations

import io
import json
import math
import wave
from pathlib import Path

import pytest

from qwen_tts_worker.advisory_diagnostics import (
    DiagnosticsError,
    compare_adjacent_boundaries,
    compare_transcript,
    normalized_words,
)


ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "evaluation" / "diagnostics" / "legacy-advisory-v1.json"


def wav(path: Path, *, amplitude: int, frequency: int = 220) -> None:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(24_000)
        raw = bytearray()
        for index in range(24_000):
            value = round(amplitude * math.sin(2 * math.pi * frequency * index / 24_000))
            raw.extend(value.to_bytes(2, "little", signed=True))
        target.writeframes(bytes(raw))
    path.write_bytes(output.getvalue())


def test_normalized_words_are_punctuation_case_and_unicode_stable() -> None:
    assert normalized_words("Hello, HELLO! café -- qtw-48r") == (
        "hello", "hello", "café", "qtw-48r"
    )


@pytest.mark.parametrize(
    ("expected", "observed", "substitutions", "deletions", "insertions", "wer"),
    [
        ("one two three", "one two three", 0, 0, 0, 0),
        ("one two three", "one four three", 1, 0, 0, 1 / 3),
        ("one two three", "one three", 0, 1, 0, 1 / 3),
        ("one two", "one one two", 0, 0, 1, 1 / 2),
    ],
)
def test_edit_counts_are_deterministic(expected, observed, substitutions, deletions, insertions, wer) -> None:
    report = compare_transcript(expected, observed)
    assert report.substitutions == substitutions
    assert report.deletions == deletions
    assert report.insertions == insertions
    assert report.word_error_rate == pytest.approx(wer)
    assert report.status == "advisory"


def test_lexicon_targets_report_presence_without_claiming_pronunciation() -> None:
    report = compare_transcript(
        "Anaïs thanked her with merci",
        "Anais thanked her with mercy",
        lexicon_targets=("Anaïs", "merci"),
    )
    assert [target.observed for target in report.lexicon_targets] == [False, False]
    assert report.word_error_rate == pytest.approx(0.4)


def test_boundary_metrics_are_advisory_even_for_large_change(tmp_path: Path) -> None:
    left = tmp_path / "left.wav"
    right = tmp_path / "right.wav"
    wav(left, amplitude=1000, frequency=180)
    wav(right, amplitude=12000, frequency=3000)
    report = compare_adjacent_boundaries(
        left, right, expected_same_speaker=True
    )
    assert report.status == "advisory"
    assert report.rms_jump_db > 8
    assert report.spectral_centroid_jump_hz > 1500
    assert len(report.notes) >= 2
    assert "not speaker identity" in report.notes[-1]


def test_boundary_rejects_noncanonical_input(tmp_path: Path) -> None:
    left = tmp_path / "left.wav"
    right = tmp_path / "right.wav"
    wav(left, amplitude=1000)
    right.write_bytes(b"not wav")
    with pytest.raises(DiagnosticsError, match="cannot decode"):
        compare_adjacent_boundaries(left, right, expected_same_speaker=False)


def test_frozen_local_evaluation_records_versions_calibration_and_advisory_decision() -> None:
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    assert evidence["schema_version"] == "0.1.0"
    assert evidence["environment"]["mlx_whisper"] == "0.4.3"
    assert evidence["environment"]["model_id"] == "mlx-community/whisper-tiny.en-mlx"
    assert evidence["aggregate"]["segments"] == 18
    assert evidence["aggregate"]["boundaries"] == 9
    assert evidence["aggregate"]["mean_word_error_rate"] > 0.20
    assert evidence["aggregate"]["lexicon_targets_observed_as_written"] < evidence["aggregate"]["lexicon_targets"]
    assert evidence["calibration"]["labeled_examples"] == 90
    assert evidence["calibration"]["precision"] == 1.0
    assert evidence["calibration"]["recall"] == 1.0
    assert evidence["decision"]["automatic_gate_authorized"] is False
    assert evidence["decision"]["asr"] == "advisory"
    assert evidence["decision"]["continuity"] == "advisory"
    assert len(evidence["limitations"]) >= 4
