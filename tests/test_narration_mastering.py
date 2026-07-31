"""Manifest ordering, exact duration, boundary, and FFmpeg mastering tests."""

from __future__ import annotations

import hashlib
import io
import math
import shutil
import uuid
import wave
from array import array
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from qwen_tts_worker.models.quality import WavArtifact
from qwen_tts_worker.narration_mastering import (
    AssemblyEntry,
    AssemblyPlan,
    MasteringError,
    NarrationMasterer,
)


pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg required")


def wav_data(
    frequency: float,
    *,
    seconds: float = 2.0,
    amplitude: int = 3500,
    edge_ms: int = 100,
    first: int | None = None,
    last: int | None = None,
) -> bytes:
    frames = round(seconds * 24_000)
    edge = round(edge_ms * 24)
    samples = array("h")
    for index in range(frames):
        value = 0 if index < edge or index >= frames - edge else round(
            amplitude * math.sin(2 * math.pi * frequency * index / 24_000)
        )
        samples.append(value)
    if first is not None:
        samples[0] = first
    if last is not None:
        samples[-1] = last
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24_000)
        wav.writeframes(samples.tobytes())
    return output.getvalue()


def write_artifact(root: Path, relative: str, data: bytes) -> WavArtifact:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    with wave.open(io.BytesIO(data), "rb") as wav:
        frames = wav.getnframes()
        rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
    return WavArtifact(
        path=relative,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        duration_seconds=frames / rate,
        sample_rate=rate,
        channels=channels,
        sample_width_bytes=width,
    )


def silence(ms: int) -> bytes:
    frames = round(ms * 24_000 / 1000)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24_000)
        wav.writeframes(array("h", [0]) * frames)
    return output.getvalue()


def entry(root: Path, index: int, frequency: float, pause_ms: int) -> AssemblyEntry:
    speech = write_artifact(
        root, f"processed/t{index}/speech.wav", wav_data(frequency)
    )
    pause = (
        write_artifact(root, f"processed/t{index}/pause.wav", silence(pause_ms))
        if pause_ms
        else None
    )
    return AssemblyEntry(
        segment_id=f"segment-{index}",
        accepted_attempt_id=uuid.uuid5(uuid.NAMESPACE_URL, f"attempt-{index}"),
        quality_report_id=uuid.uuid5(uuid.NAMESPACE_URL, f"quality-{index}"),
        transform_id=f"transform-{index}",
        speech_wav=speech,
        pause_wav=pause,
        pause_after_ms=pause_ms,
    )


def plan(root: Path) -> AssemblyPlan:
    return AssemblyPlan(
        episode_id="episode-mastering",
        source_revision="revision-1",
        entries=(
            entry(root, 1, 220, 200),
            entry(root, 2, 440, 350),
            entry(root, 3, 880, 0),
        ),
    )


def read_samples(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float64), rate


def dominant_frequency(values: np.ndarray, rate: int) -> float:
    magnitude = np.abs(np.fft.rfft(values * np.hanning(len(values))))
    return float(np.fft.rfftfreq(len(values), 1 / rate)[np.argmax(magnitude)])


def test_manifest_order_duration_loudness_peak_and_integrity(tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    selected = plan(artifacts)
    report = NarrationMasterer().master(selected, artifacts, artifacts)
    assert report.ordered_segment_ids == ("segment-1", "segment-2", "segment-3")
    expected = 2.0 + 0.2 + 2.0 + 0.35 + 2.0
    assert report.expected_duration_seconds == pytest.approx(expected, abs=1 / 24_000)
    assert report.final_duration_seconds == pytest.approx(expected, abs=1 / 24_000)
    assert report.duration_error_seconds <= 1 / 24_000
    assert report.measured.integrated_lufs == pytest.approx(-16.0, abs=0.6)
    assert report.measured.true_peak_dbtp <= -1.3
    assert all(boundary.status == "pass" for boundary in report.boundaries)
    assert report.manifest.final_wav == report.final_wav
    assert tuple(item.segment_id for item in report.manifest.entries) == report.ordered_segment_ids

    premaster_path = artifacts / report.premaster_wav.path
    final_path = artifacts / report.final_wav.path
    assert hashlib.sha256(premaster_path.read_bytes()).hexdigest() == report.premaster_wav.sha256
    assert hashlib.sha256(final_path.read_bytes()).hexdigest() == report.final_wav.sha256


def test_premaster_frequency_windows_prove_manifest_order(tmp_path: Path) -> None:
    artifacts = tmp_path / "artifacts"
    selected = plan(artifacts)
    report = NarrationMasterer().master(selected, artifacts, artifacts)
    values, rate = read_samples(artifacts / report.premaster_wav.path)
    starts = (0, round(2.2 * rate), round(4.55 * rate))
    observed = [
        dominant_frequency(values[start + rate // 4 : start + rate + rate // 4], rate)
        for start in starts
    ]
    assert observed == pytest.approx((220, 440, 880), abs=3)


def test_audio_output_is_deterministic_across_clean_roots(tmp_path: Path) -> None:
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first_plan = plan(first_root)
    second_plan = plan(second_root)
    first = NarrationMasterer().master(first_plan, first_root, first_root)
    second = NarrationMasterer().master(second_plan, second_root, second_root)
    assert first.assembly_id == second.assembly_id
    assert first.premaster_wav.sha256 == second.premaster_wav.sha256
    assert first.final_wav.sha256 == second.final_wav.sha256
    with pytest.raises(MasteringError, match="already exists"):
        NarrationMasterer().master(first_plan, first_root, first_root)


def test_duplicate_segments_or_attempts_are_rejected() -> None:
    placeholder = WavArtifact(
        path="x.wav", sha256="a" * 64, size_bytes=44,
        duration_seconds=1, sample_rate=24000, channels=1, sample_width_bytes=2,
    )
    repeated = AssemblyEntry(
        segment_id="same",
        accepted_attempt_id=uuid.uuid4(),
        quality_report_id=uuid.uuid4(),
        transform_id="t",
        speech_wav=placeholder,
    )
    with pytest.raises(ValidationError, match="segment IDs must be unique"):
        AssemblyPlan(episode_id="e", source_revision="r", entries=(repeated, repeated))


def test_hash_pause_and_boundary_failures_block_output(tmp_path: Path) -> None:
    integrity_root = tmp_path / "integrity"
    integrity_plan = plan(integrity_root)
    first = integrity_plan.entries[0]
    (integrity_root / first.speech_wav.path).write_bytes(b"changed")
    with pytest.raises(MasteringError, match="integrity mismatch"):
        NarrationMasterer().master(integrity_plan, integrity_root, integrity_root)

    pause_root = tmp_path / "pause"
    pause_plan = plan(pause_root)
    pause_entry = pause_plan.entries[0]
    wrong_pause_data = silence(100)
    wrong_pause = write_artifact(pause_root, pause_entry.pause_wav.path, wrong_pause_data)
    changed_entries = (
        pause_entry.model_copy(update={"pause_wav": wrong_pause}),
        *pause_plan.entries[1:],
    )
    with pytest.raises(MasteringError, match="expected 4800"):
        NarrationMasterer().master(
            pause_plan.model_copy(update={"entries": changed_entries}),
            pause_root,
            pause_root,
        )

    click_root = tmp_path / "click"
    left = write_artifact(click_root, "left.wav", wav_data(220, edge_ms=0, last=30000))
    right = write_artifact(click_root, "right.wav", wav_data(440, edge_ms=0, first=-30000))
    clicked = AssemblyPlan(
        episode_id="clicked",
        source_revision="r",
        entries=(
            AssemblyEntry(
                segment_id="left", accepted_attempt_id=uuid.uuid4(), quality_report_id=uuid.uuid4(),
                transform_id="left-t", speech_wav=left,
            ),
            AssemblyEntry(
                segment_id="right", accepted_attempt_id=uuid.uuid4(), quality_report_id=uuid.uuid4(),
                transform_id="right-t", speech_wav=right,
            ),
        ),
    )
    with pytest.raises(MasteringError, match="boundary sample step"):
        NarrationMasterer().master(clicked, click_root, click_root)
