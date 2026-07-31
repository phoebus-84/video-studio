"""Advisory local-ASR text fidelity and adjacent boundary diagnostics."""

from __future__ import annotations

import importlib.metadata
import math
import re
import wave
from array import array
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import Field

from qwen_tts_worker.models.quality import FrozenContract


DIAGNOSTICS_VERSION = "0.1.0"
_TOKEN = re.compile(r"[^\W_]+(?:[-'][^\W_]+)*", re.UNICODE)


class DiagnosticsError(RuntimeError):
    pass


class LexiconTargetResult(FrozenContract):
    target: str
    expected_tokens: tuple[str, ...]
    observed: bool


class ASRFidelityReport(FrozenContract):
    schema_version: Literal["0.1.0"] = DIAGNOSTICS_VERSION
    diagnostics_version: Literal["0.1.0"] = DIAGNOSTICS_VERSION
    tool: str
    tool_version: str
    model_id: str
    expected_text: str
    transcript: str
    expected_word_count: int = Field(..., ge=0)
    transcript_word_count: int = Field(..., ge=0)
    substitutions: int = Field(..., ge=0)
    deletions: int = Field(..., ge=0)
    insertions: int = Field(..., ge=0)
    word_error_rate: float = Field(..., ge=0)
    lexicon_targets: tuple[LexiconTargetResult, ...] = ()
    status: Literal["advisory"] = "advisory"


class BoundaryContinuityReport(FrozenContract):
    schema_version: Literal["0.1.0"] = DIAGNOSTICS_VERSION
    diagnostics_version: Literal["0.1.0"] = DIAGNOSTICS_VERSION
    left_path: str
    right_path: str
    expected_same_speaker: bool
    left_edge_rms_dbfs: float
    right_edge_rms_dbfs: float
    rms_jump_db: float
    waveform_step: float = Field(..., ge=0)
    spectral_centroid_jump_hz: float = Field(..., ge=0)
    status: Literal["advisory"] = "advisory"
    notes: tuple[str, ...] = ()


def normalized_words(text: str) -> tuple[str, ...]:
    return tuple(token.casefold() for token in _TOKEN.findall(text))


def _edit_counts(expected: tuple[str, ...], observed: tuple[str, ...]) -> tuple[int, int, int]:
    # Dynamic program stores (cost, substitutions, deletions, insertions), with
    # deterministic tie-breaking preferring substitutions over paired del+ins.
    rows = len(expected) + 1
    columns = len(observed) + 1
    matrix: list[list[tuple[int, int, int, int]]] = [
        [(0, 0, 0, 0) for _ in range(columns)] for _ in range(rows)
    ]
    for i in range(1, rows):
        matrix[i][0] = (i, 0, i, 0)
    for j in range(1, columns):
        matrix[0][j] = (j, 0, 0, j)
    for i in range(1, rows):
        for j in range(1, columns):
            if expected[i - 1] == observed[j - 1]:
                matrix[i][j] = matrix[i - 1][j - 1]
                continue
            diagonal = matrix[i - 1][j - 1]
            deletion = matrix[i - 1][j]
            insertion = matrix[i][j - 1]
            options = (
                (diagonal[0] + 1, diagonal[1] + 1, diagonal[2], diagonal[3]),
                (deletion[0] + 1, deletion[1], deletion[2] + 1, deletion[3]),
                (insertion[0] + 1, insertion[1], insertion[2], insertion[3] + 1),
            )
            matrix[i][j] = min(options, key=lambda value: (value[0], value[2] + value[3], value[1], value[2]))
    _, substitutions, deletions, insertions = matrix[-1][-1]
    return substitutions, deletions, insertions


def compare_transcript(
    expected_text: str,
    transcript: str,
    *,
    lexicon_targets: tuple[str, ...] = (),
    tool: str = "provided-transcript",
    tool_version: str = "n/a",
    model_id: str = "n/a",
) -> ASRFidelityReport:
    expected = normalized_words(expected_text)
    observed = normalized_words(transcript)
    substitutions, deletions, insertions = _edit_counts(expected, observed)
    errors = substitutions + deletions + insertions
    wer = errors / len(expected) if expected else float(bool(observed))
    target_results = tuple(
        LexiconTargetResult(
            target=target,
            expected_tokens=normalized_words(target),
            observed=_contains_sequence(observed, normalized_words(target)),
        )
        for target in lexicon_targets
    )
    return ASRFidelityReport(
        tool=tool,
        tool_version=tool_version,
        model_id=model_id,
        expected_text=expected_text,
        transcript=transcript,
        expected_word_count=len(expected),
        transcript_word_count=len(observed),
        substitutions=substitutions,
        deletions=deletions,
        insertions=insertions,
        word_error_rate=wer,
        lexicon_targets=target_results,
    )


def _contains_sequence(words: tuple[str, ...], target: tuple[str, ...]) -> bool:
    if not target:
        return False
    return any(words[index : index + len(target)] == target for index in range(len(words) - len(target) + 1))


def transcribe_with_mlx_whisper(
    wav_path: str | Path,
    expected_text: str,
    *,
    model_id: str = "mlx-community/whisper-tiny.en-mlx",
    lexicon_targets: tuple[str, ...] = (),
) -> ASRFidelityReport:
    try:
        import mlx_whisper
    except ImportError as exc:
        raise DiagnosticsError(
            "mlx-whisper is optional; install qwen-tts-worker[diagnostics]"
        ) from exc
    result = mlx_whisper.transcribe(
        str(Path(wav_path).expanduser().resolve()),
        path_or_hf_repo=model_id,
        language="en",
        temperature=0.0,
        condition_on_previous_text=False,
        verbose=False,
    )
    transcript = result.get("text")
    if not isinstance(transcript, str):
        raise DiagnosticsError("mlx-whisper result contains no transcript text")
    return compare_transcript(
        expected_text,
        transcript,
        lexicon_targets=lexicon_targets,
        tool="mlx-whisper",
        tool_version=importlib.metadata.version("mlx-whisper"),
        model_id=model_id,
    )


def _read_pcm16_mono(path: str | Path) -> tuple[np.ndarray, int]:
    resolved = Path(path).expanduser().resolve()
    try:
        with wave.open(str(resolved), "rb") as wav:
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            rate = wav.getframerate()
            frames = wav.getnframes()
            raw = wav.readframes(frames)
    except (OSError, EOFError, wave.Error) as exc:
        raise DiagnosticsError(f"cannot decode boundary WAV {resolved}: {exc}") from exc
    if width != 2 or channels != 1 or not raw:
        raise DiagnosticsError("boundary diagnostics require non-empty mono PCM16 WAV")
    samples = array("h")
    samples.frombytes(raw)
    values = np.asarray(samples, dtype=np.float64) / 32768.0
    return values, rate


def _rms_dbfs(values: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(values * values))) if len(values) else 0.0
    return 20 * math.log10(rms) if rms > 0 else -120.0


def _spectral_centroid(values: np.ndarray, rate: int) -> float:
    if not len(values) or not np.any(values):
        return 0.0
    windowed = values * np.hanning(len(values))
    magnitude = np.abs(np.fft.rfft(windowed))
    total = float(np.sum(magnitude))
    if total <= 0:
        return 0.0
    frequencies = np.fft.rfftfreq(len(values), 1.0 / rate)
    return float(np.sum(frequencies * magnitude) / total)


def compare_adjacent_boundaries(
    left_path: str | Path,
    right_path: str | Path,
    *,
    expected_same_speaker: bool,
    window_ms: float = 250.0,
) -> BoundaryContinuityReport:
    left, left_rate = _read_pcm16_mono(left_path)
    right, right_rate = _read_pcm16_mono(right_path)
    if left_rate != right_rate:
        raise DiagnosticsError("adjacent WAV sample rates differ")
    count = max(1, round(left_rate * window_ms / 1000.0))
    left_edge = left[-count:]
    right_edge = right[:count]
    left_rms = _rms_dbfs(left_edge)
    right_rms = _rms_dbfs(right_edge)
    waveform_step = float(abs(left[-1] - right[0]))
    centroid_jump = abs(
        _spectral_centroid(left_edge, left_rate)
        - _spectral_centroid(right_edge, right_rate)
    )
    notes: list[str] = []
    rms_jump = abs(left_rms - right_rms)
    if rms_jump > 8:
        notes.append("edge RMS differs by more than 8 dB")
    if waveform_step > 0.25:
        notes.append("raw boundary step may click without silence/fade")
    if expected_same_speaker and centroid_jump > 1500:
        notes.append("same-speaker spectral centroid changes by more than 1500 Hz")
    notes.append(
        "spectral/RMS continuity is not speaker identity; no automatic gate is authorized"
    )
    return BoundaryContinuityReport(
        left_path=str(Path(left_path)),
        right_path=str(Path(right_path)),
        expected_same_speaker=expected_same_speaker,
        left_edge_rms_dbfs=left_rms,
        right_edge_rms_dbfs=right_rms,
        rms_jump_db=rms_jump,
        waveform_step=waveform_step,
        spectral_centroid_jump_hz=centroid_jump,
        notes=tuple(notes),
    )
