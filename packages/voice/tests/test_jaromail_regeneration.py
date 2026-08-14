"""Deterministic helpers for the JaroMail production regeneration command."""

from __future__ import annotations

import importlib.util
import wave
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "evaluation" / "regenerate_jaromail.py"
SPEC = importlib.util.spec_from_file_location("regenerate_jaromail", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
regeneration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(regeneration)


def write_wav(path: Path, frames: bytes) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24_000)
        output.writeframes(frames)


def test_retime_srt_preserves_text_and_scales_within_scene() -> None:
    source = "1\n00:00:01,000 --> 00:00:03,000\nExact caption.\n"
    old = [{"id": "s1", "start": 0.0, "duration": 4.0, "end": 4.0}]
    new = [{"id": "s1", "start": 0.0, "duration": 8.0, "end": 8.0}]
    assert regeneration.retime_srt(source, old, new) == (
        "1\n00:00:02,000 --> 00:00:06,000\nExact caption.\n"
    )


def test_scene_slices_reconstruct_master_pcm_exactly(tmp_path: Path) -> None:
    first = int(1000).to_bytes(2, "little", signed=True) * 24
    second = int(-1000).to_bytes(2, "little", signed=True) * 48
    mastered = tmp_path / "mastered.wav"
    write_wav(mastered, first + second)
    durations = regeneration.slice_scenes(mastered, {"s1": 24, "s2": 48}, tmp_path)
    assert durations == {"s1": 0.001, "s2": 0.002}
    reconstructed = b""
    for scene in ("s1", "s2"):
        with wave.open(str(tmp_path / f"{scene}.wav"), "rb") as source:
            reconstructed += source.readframes(source.getnframes())
    assert reconstructed == first + second
