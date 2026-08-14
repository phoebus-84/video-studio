"""Conservative non-destructive edge processing and exact pause realization."""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import wave
from array import array
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from qwen_tts_worker.models.quality import (
    AttemptPhase,
    FrozenContract,
    QualityDecision,
    SegmentQualityReport,
    SynthesisAttempt,
    WavArtifact,
)


AUDIO_PROCESSING_VERSION = "0.1.0"


class AudioProcessingError(RuntimeError):
    pass


class EdgeProcessingPolicy(FrozenContract):
    schema_version: Literal["0.1.0"] = AUDIO_PROCESSING_VERSION
    policy_id: str = "conservative-edges-v1"
    silence_threshold_dbfs: float = -45.0
    preserve_margin_ms: float = Field(default=80.0, ge=0, le=500)
    maximum_trim_per_edge_ms: float = Field(default=1500.0, ge=0, le=5000)
    minimum_speech_ms: float = Field(default=100.0, gt=0)
    fade_mode: Literal["disabled"] = "disabled"
    required_sample_rate: Literal[24000] = 24_000
    required_channels: Literal[1] = 1
    required_sample_width_bytes: Literal[2] = 2

    @model_validator(mode="after")
    def _margin_is_conservative(self) -> EdgeProcessingPolicy:
        if self.preserve_margin_ms > self.maximum_trim_per_edge_ms:
            raise ValueError("preserve margin cannot exceed maximum edge trim")
        return self


class AudioTransformReport(FrozenContract):
    schema_version: Literal["0.1.0"] = AUDIO_PROCESSING_VERSION
    processing_version: Literal["0.1.0"] = AUDIO_PROCESSING_VERSION
    transform_id: str = Field(..., min_length=1, max_length=128)
    policy_id: str
    policy_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    attempt_id: str
    quality_report_id: str
    raw_wav_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    transformed_wav: WavArtifact
    pause_wav: WavArtifact | None = None
    requested_pause_ms: int = Field(..., ge=0, le=10_000)
    realized_pause_ms: float = Field(..., ge=0)
    leading_trimmed_samples: int = Field(..., ge=0)
    trailing_trimmed_samples: int = Field(..., ge=0)
    preserved_margin_samples: int = Field(..., ge=0)
    first_active_sample_before: int = Field(..., ge=0)
    first_active_sample_after: int = Field(..., ge=0)
    last_active_sample_before: int = Field(..., ge=0)
    last_active_sample_after: int = Field(..., ge=0)
    active_sample_sequence_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    fade_applied: bool = False
    format_transform: Literal["verified-canonical"] = "verified-canonical"


class AudioTransformStore:
    """Write-once transform reports; WAVs remain independently hash-verified."""

    def __init__(self, artifact_root: str | Path) -> None:
        self.root = Path(artifact_root).expanduser().resolve() / "transform-reports"
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, report: AudioTransformReport) -> Path:
        path = self.root / f"{report.transform_id}.json"
        data = (
            json.dumps(
                report.model_dump(mode="json"),
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode()
        try:
            with path.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError as exc:
            raise AudioProcessingError(f"transform report already exists: {path}") from exc
        return path

    def get(self, transform_id: str) -> AudioTransformReport:
        try:
            return AudioTransformReport.model_validate_json(
                (self.root / f"{transform_id}.json").read_text(encoding="utf-8")
            )
        except FileNotFoundError as exc:
            raise AudioProcessingError(f"unknown transform report {transform_id}") from exc


class _ProcessedPCM(FrozenContract):
    wav_bytes: bytes
    leading_trimmed_samples: int
    trailing_trimmed_samples: int
    margin_samples: int
    first_active_before: int
    first_active_after: int
    last_active_before: int
    last_active_after: int
    active_hash: str
    sample_count: int


class AudioProcessor:
    def __init__(self, policy: EdgeProcessingPolicy | None = None) -> None:
        self.policy = policy or EdgeProcessingPolicy()
        canonical = json.dumps(
            self.policy.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        )
        self.policy_fingerprint = hashlib.sha256(canonical.encode()).hexdigest()

    def _decode(self, data: bytes) -> array[int]:
        try:
            with wave.open(io.BytesIO(data), "rb") as wav:
                channels = wav.getnchannels()
                width = wav.getsampwidth()
                rate = wav.getframerate()
                frames = wav.getnframes()
                compression = wav.getcomptype()
                raw = wav.readframes(frames)
        except (EOFError, wave.Error) as exc:
            raise AudioProcessingError(f"cannot decode raw WAV: {exc}") from exc
        if (
            channels != self.policy.required_channels
            or width != self.policy.required_sample_width_bytes
            or rate != self.policy.required_sample_rate
            or compression != "NONE"
        ):
            raise AudioProcessingError(
                "accepted WAV must already be canonical mono PCM16 at 24000 Hz"
            )
        samples = array("h")
        samples.frombytes(raw)
        if os.sys.byteorder != "little":
            samples.byteswap()
        if not samples:
            raise AudioProcessingError("accepted WAV contains no samples")
        return samples

    @staticmethod
    def _encode(samples: array[int], sample_rate: int = 24_000) -> bytes:
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(samples.tobytes())
        return output.getvalue()

    def process_bytes(self, data: bytes) -> _ProcessedPCM:
        samples = self._decode(data)
        threshold = 32768.0 * (10 ** (self.policy.silence_threshold_dbfs / 20.0))
        active = [index for index, sample in enumerate(samples) if abs(sample) > threshold]
        if not active:
            raise AudioProcessingError("accepted WAV has no active samples above trim threshold")
        first_active = active[0]
        last_active = active[-1]
        margin = round(self.policy.preserve_margin_ms * 24_000 / 1000)
        maximum = round(self.policy.maximum_trim_per_edge_ms * 24_000 / 1000)
        trim_start = min(max(0, first_active - margin), maximum)
        trailing_available = max(0, len(samples) - 1 - last_active - margin)
        trailing_trim = min(trailing_available, maximum)
        trim_end = len(samples) - trailing_trim
        transformed = samples[trim_start:trim_end]
        if len(transformed) * 1000 / 24_000 < self.policy.minimum_speech_ms:
            raise AudioProcessingError("edge processing would leave less than minimum speech duration")
        first_after = first_active - trim_start
        last_after = last_active - trim_start
        active_bytes = samples[first_active : last_active + 1].tobytes()
        # No fades are enabled: the complete threshold-active sequence must remain byte-identical.
        assert transformed[first_after : last_after + 1].tobytes() == active_bytes
        return _ProcessedPCM(
            wav_bytes=self._encode(transformed),
            leading_trimmed_samples=trim_start,
            trailing_trimmed_samples=trailing_trim,
            margin_samples=margin,
            first_active_before=first_active,
            first_active_after=first_after,
            last_active_before=last_active,
            last_active_after=last_after,
            active_hash=hashlib.sha256(active_bytes).hexdigest(),
            sample_count=len(transformed),
        )

    @staticmethod
    def pause_bytes(pause_ms: int, sample_rate: int = 24_000) -> tuple[bytes | None, int]:
        frames = round(pause_ms * sample_rate / 1000)
        if frames <= 0:
            return None, 0
        return AudioProcessor._encode(array("h", [0]) * frames, sample_rate), frames

    @staticmethod
    def _artifact(path: str, data: bytes, frames: int) -> WavArtifact:
        return WavArtifact(
            path=path,
            sha256=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
            duration_seconds=frames / 24_000,
            sample_rate=24_000,
            channels=1,
            sample_width_bytes=2,
        )

    @staticmethod
    def _write_immutable(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError as exc:
            raise AudioProcessingError(f"transformed artifact already exists: {path}") from exc

    def process_attempt(
        self,
        attempt: SynthesisAttempt,
        quality_report: SegmentQualityReport,
        artifact_root: str | Path,
        output_root: str | Path,
        *,
        pause_after_ms: int,
    ) -> AudioTransformReport:
        if attempt.phase != AttemptPhase.COMPLETED or attempt.raw_wav is None:
            raise AudioProcessingError("only completed raw attempts can be processed")
        if quality_report.attempt_id != attempt.attempt_id:
            raise AudioProcessingError("quality report does not belong to attempt")
        if quality_report.decision != QualityDecision.ACCEPT:
            raise AudioProcessingError("only accepted quality decisions can be processed")
        raw_path = Path(artifact_root).expanduser().resolve() / attempt.raw_wav.path
        data = raw_path.read_bytes()
        if (
            hashlib.sha256(data).hexdigest() != attempt.raw_wav.sha256
            or len(data) != attempt.raw_wav.size_bytes
        ):
            raise AudioProcessingError("raw WAV integrity does not match immutable attempt")
        processed = self.process_bytes(data)
        identity = json.dumps(
            {
                "version": AUDIO_PROCESSING_VERSION,
                "raw": attempt.raw_wav.sha256,
                "policy": self.policy_fingerprint,
                "pause_ms": pause_after_ms,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        transform_id = "transform-" + hashlib.sha256(identity.encode()).hexdigest()[:20]
        output = Path(output_root).expanduser().resolve() / "processed" / transform_id
        speech_relative = f"processed/{transform_id}/speech.wav"
        speech_path = output / "speech.wav"
        self._write_immutable(speech_path, processed.wav_bytes)
        transformed_wav = self._artifact(
            speech_relative, processed.wav_bytes, processed.sample_count
        )
        pause_data, pause_frames = self.pause_bytes(pause_after_ms)
        pause_wav = None
        if pause_data is not None:
            pause_relative = f"processed/{transform_id}/pause.wav"
            self._write_immutable(output / "pause.wav", pause_data)
            pause_wav = self._artifact(pause_relative, pause_data, pause_frames)
        return AudioTransformReport(
            transform_id=transform_id,
            policy_id=self.policy.policy_id,
            policy_fingerprint=self.policy_fingerprint,
            attempt_id=str(attempt.attempt_id),
            quality_report_id=str(quality_report.report_id),
            raw_wav_sha256=attempt.raw_wav.sha256,
            transformed_wav=transformed_wav,
            pause_wav=pause_wav,
            requested_pause_ms=pause_after_ms,
            realized_pause_ms=pause_frames * 1000 / 24_000,
            leading_trimmed_samples=processed.leading_trimmed_samples,
            trailing_trimmed_samples=processed.trailing_trimmed_samples,
            preserved_margin_samples=processed.margin_samples,
            first_active_sample_before=processed.first_active_before,
            first_active_sample_after=processed.first_active_after,
            last_active_sample_before=processed.last_active_before,
            last_active_sample_after=processed.last_active_after,
            active_sample_sequence_sha256=processed.active_hash,
        )
