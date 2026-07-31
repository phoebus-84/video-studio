"""Tests for controlled legacy baseline capture utilities."""

from __future__ import annotations

import importlib.util
import math
import sys
import wave
from array import array
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent.parent / "evaluation" / "capture_legacy_baseline.py"
SPEC = importlib.util.spec_from_file_location("capture_legacy_baseline", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
analyze_wav = MODULE.analyze_wav
compose_instruction = MODULE.compose_instruction
direct_concat = MODULE.direct_concat


def write_tone(path: Path, *, seconds: float = 0.1, amplitude: int = 5000) -> None:
    sample_rate = 24_000
    samples = array(
        "h",
        (
            round(amplitude * math.sin(2 * math.pi * 440 * index / sample_rate))
            for index in range(round(sample_rate * seconds))
        ),
    )
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(samples.tobytes())


def test_compose_instruction_is_stable_and_bounded() -> None:
    segment = {
        "speaker_profile": "narrator-under-test",
        "delivery": {"emotion": "warm", "pace": "steady", "intent": "narrate"},
    }
    assert compose_instruction(segment) == (
        "Speak warmly and clearly with natural pacing and a stable narrator voice. "
        "Delivery guidance — emotion: warm; pace: steady; intent: narrate."
    )


def test_analyze_wav_accepts_pcm_tone(tmp_path: Path) -> None:
    path = tmp_path / "tone.wav"
    write_tone(path, seconds=0.2)
    report = analyze_wav(path, "hello world")
    assert report["valid"] is True
    assert report["sample_rate"] == 24_000
    assert report["channels"] == 1
    assert report["rms_dbfs"] > -50
    assert report["sha256"]


def test_analyze_wav_labels_silence_as_failure(tmp_path: Path) -> None:
    path = tmp_path / "silence.wav"
    write_tone(path, amplitude=0)
    report = analyze_wav(path, "hello world")
    assert report["valid"] is False
    assert "silent_or_near_silent" in report["failure_reasons"]


def test_direct_concat_preserves_all_frames_without_added_pause(tmp_path: Path) -> None:
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    output = tmp_path / "joined.wav"
    write_tone(first, seconds=0.1)
    write_tone(second, seconds=0.2)

    manifest = direct_concat([first, second], output)

    with wave.open(str(output), "rb") as joined:
        assert joined.getnframes() == 7_200
        assert joined.getframerate() == 24_000
    assert manifest["assembly_policy"] == "legacy-direct-concat-no-explicit-pauses"
