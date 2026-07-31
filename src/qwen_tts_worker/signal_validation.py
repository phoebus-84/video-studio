"""Cheap calibrated PCM signal validation before review, retry, or mastering."""

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
    QualityCheck,
    QualityDecision,
    SegmentQualityReport,
    SignalMetrics,
    SynthesisAttempt,
)


SIGNAL_VALIDATOR_VERSION = "0.1.0"


class SignalValidationError(ValueError):
    """The attempt cannot be associated with a validation report."""


class SignalValidationPolicy(FrozenContract):
    schema_version: Literal["0.1.0"] = SIGNAL_VALIDATOR_VERSION
    policy_id: str = "qwen-pcm24k-v1"
    required_sample_rate: int = 24_000
    required_channels: int = 1
    required_sample_width_bytes: int = 2
    minimum_duration_seconds: float = Field(default=0.10, gt=0)
    maximum_duration_seconds: float = Field(default=60.0, gt=0)
    minimum_rms_dbfs: float = -50.0
    silence_threshold_dbfs: float = -45.0
    minimum_active_sample_ratio: float = Field(default=0.005, ge=0, le=1)
    clipping_amplitude: int = Field(default=32_760, ge=1, le=32_767)
    maximum_clipped_sample_ratio: float = Field(default=0.001, ge=0, le=1)
    dc_offset_warn: float = Field(default=0.03, ge=0, le=1)
    dc_offset_fail: float = Field(default=0.10, ge=0, le=1)
    edge_silence_warn_ms: float = Field(default=1500.0, ge=0)
    edge_silence_fail_ms: float = Field(default=5000.0, ge=0)
    speech_rate_warn_min_wpm: float = Field(default=70.0, ge=0)
    speech_rate_warn_max_wpm: float = Field(default=240.0, ge=0)
    speech_rate_fail_min_wpm: float = Field(default=35.0, ge=0)
    speech_rate_fail_max_wpm: float = Field(default=340.0, ge=0)

    @model_validator(mode="after")
    def _thresholds_are_ordered(self) -> SignalValidationPolicy:
        if self.minimum_duration_seconds >= self.maximum_duration_seconds:
            raise ValueError("minimum duration must be below maximum duration")
        if self.dc_offset_warn > self.dc_offset_fail:
            raise ValueError("DC warning threshold cannot exceed failure threshold")
        if self.edge_silence_warn_ms > self.edge_silence_fail_ms:
            raise ValueError("edge warning threshold cannot exceed failure threshold")
        if not (
            self.speech_rate_fail_min_wpm
            <= self.speech_rate_warn_min_wpm
            <= self.speech_rate_warn_max_wpm
            <= self.speech_rate_fail_max_wpm
        ):
            raise ValueError("speech-rate thresholds must be ordered fail/warn/warn/fail")
        return self


class SignalValidationEvidence(FrozenContract):
    schema_version: Literal["0.1.0"] = SIGNAL_VALIDATOR_VERSION
    policy_id: str
    policy_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    report: SegmentQualityReport


class QualityReportStore:
    """Immutable machine-readable report persistence."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, evidence: SignalValidationEvidence) -> Path:
        path = self.root / f"{evidence.report.report_id}.json"
        data = (
            json.dumps(
                evidence.model_dump(mode="json"),
                ensure_ascii=False,
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
            raise SignalValidationError(f"quality report already exists: {path}") from exc
        return path

    def get(self, report_id: str) -> SignalValidationEvidence:
        path = self.root / f"{report_id}.json"
        try:
            return SignalValidationEvidence.model_validate_json(
                path.read_text(encoding="utf-8")
            )
        except FileNotFoundError as exc:
            raise SignalValidationError(f"unknown quality report {report_id}") from exc


def policy_fingerprint(policy: SignalValidationPolicy) -> str:
    canonical = json.dumps(
        policy.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _dbfs(value: float) -> float:
    if value <= 0:
        return -120.0
    return 20.0 * math.log10(value / 32768.0)


def _edge_silence(samples: array[int], threshold: float, sample_rate: int) -> tuple[float, float]:
    leading = 0
    for sample in samples:
        if abs(sample) > threshold:
            break
        leading += 1
    trailing = 0
    for sample in reversed(samples):
        if abs(sample) > threshold:
            break
        trailing += 1
    return leading * 1000.0 / sample_rate, trailing * 1000.0 / sample_rate


def _check(
    check_id: str,
    status: Literal["pass", "warn", "fail"],
    observed: str,
    expected: str,
) -> QualityCheck:
    return QualityCheck(
        check_id=check_id,
        status=status,
        observed=observed or "(no detail)",
        expected=expected or "(not specified)",
    )


def _sentinel_metrics() -> SignalMetrics:
    return SignalMetrics(
        peak_dbfs=-120.0,
        rms_dbfs=-120.0,
        clipped_sample_ratio=0.0,
        dc_offset=0.0,
        leading_silence_ms=0.0,
        trailing_silence_ms=0.0,
        spoken_words_per_minute=0.0,
    )


def validate_attempt_signal(
    attempt: SynthesisAttempt,
    artifact_root: str | Path,
    *,
    spoken_word_count: int | None = None,
    policy: SignalValidationPolicy | None = None,
) -> SignalValidationEvidence:
    """Measure one completed raw attempt and return a reason-coded decision."""

    if attempt.phase != AttemptPhase.COMPLETED or attempt.raw_wav is None:
        raise SignalValidationError("only completed attempts with raw WAV can be validated")
    if spoken_word_count is not None and spoken_word_count <= 0:
        raise SignalValidationError("spoken_word_count must be positive when supplied")
    active = policy or SignalValidationPolicy()
    checks: list[QualityCheck] = []
    wav_path = Path(artifact_root).expanduser().resolve() / attempt.raw_wav.path
    try:
        data = wav_path.read_bytes()
    except OSError as exc:
        data = b""
        checks.append(_check("artifact.readable", "fail", str(exc), "raw WAV is readable"))

    if data:
        actual_hash = hashlib.sha256(data).hexdigest()
        integrity_ok = (
            actual_hash == attempt.raw_wav.sha256
            and len(data) == attempt.raw_wav.size_bytes
        )
        checks.append(
            _check(
                "artifact.integrity",
                "pass" if integrity_ok else "fail",
                f"sha256={actual_hash}, bytes={len(data)}",
                f"sha256={attempt.raw_wav.sha256}, bytes={attempt.raw_wav.size_bytes}",
            )
        )
    else:
        integrity_ok = False

    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frame_count = wav.getnframes()
            compression = wav.getcomptype()
            raw = wav.readframes(frame_count)
        if compression != "NONE" or width != 2:
            raise wave.Error(
                f"requires uncompressed PCM16, found compression={compression}, width={width}"
            )
        samples = array("h")
        samples.frombytes(raw)
        if os.sys.byteorder != "little":
            samples.byteswap()
        if channels > 1:
            mono_samples = array("h", samples[::channels])
        else:
            mono_samples = samples
        if not mono_samples or frame_count <= 0:
            raise wave.Error("WAV has no frames")
    except (EOFError, wave.Error) as exc:
        checks.append(_check("wav.decode", "fail", str(exc), "valid non-empty PCM WAV"))
        metrics = _sentinel_metrics()
    else:
        checks.append(_check("wav.decode", "pass", "decoded PCM frames", "valid non-empty PCM WAV"))
        format_ok = (
            channels == active.required_channels
            and width == active.required_sample_width_bytes
            and sample_rate == active.required_sample_rate
        )
        checks.append(
            _check(
                "wav.format",
                "pass" if format_ok else "fail",
                f"rate={sample_rate}, channels={channels}, width={width}",
                f"rate={active.required_sample_rate}, channels={active.required_channels}, width={active.required_sample_width_bytes}",
            )
        )
        duration = frame_count / sample_rate
        duration_ok = active.minimum_duration_seconds <= duration <= active.maximum_duration_seconds
        checks.append(
            _check(
                "wav.duration",
                "pass" if duration_ok else "fail",
                f"{duration:.4f} seconds",
                f"{active.minimum_duration_seconds:.2f}..{active.maximum_duration_seconds:.2f} seconds",
            )
        )
        peak = max(abs(sample) for sample in mono_samples)
        rms = math.sqrt(sum(sample * sample for sample in mono_samples) / len(mono_samples))
        peak_dbfs = _dbfs(peak)
        rms_dbfs = _dbfs(rms)
        clipped = sum(abs(sample) >= active.clipping_amplitude for sample in mono_samples) / len(mono_samples)
        dc = sum(mono_samples) / len(mono_samples) / 32768.0
        silence_amplitude = 32768.0 * (10 ** (active.silence_threshold_dbfs / 20.0))
        active_ratio = sum(abs(sample) > silence_amplitude for sample in mono_samples) / len(mono_samples)
        leading, trailing = _edge_silence(mono_samples, silence_amplitude, sample_rate)
        wpm = (spoken_word_count * 60.0 / duration) if spoken_word_count is not None else 0.0
        metrics = SignalMetrics(
            peak_dbfs=peak_dbfs,
            rms_dbfs=rms_dbfs,
            clipped_sample_ratio=clipped,
            dc_offset=dc,
            leading_silence_ms=leading,
            trailing_silence_ms=trailing,
            spoken_words_per_minute=wpm,
        )
        presence_ok = (
            rms_dbfs > active.minimum_rms_dbfs
            and active_ratio >= active.minimum_active_sample_ratio
        )
        checks.append(
            _check(
                "signal.speech-presence",
                "pass" if presence_ok else "fail",
                f"rms={rms_dbfs:.2f} dBFS, active_ratio={active_ratio:.6f}",
                f"rms>{active.minimum_rms_dbfs:.1f} dBFS, active_ratio>={active.minimum_active_sample_ratio:.4f}",
            )
        )
        checks.append(
            _check(
                "signal.clipping",
                "pass" if clipped <= active.maximum_clipped_sample_ratio else "fail",
                f"peak={peak_dbfs:.2f} dBFS, clipped_ratio={clipped:.6f}",
                f"clipped_ratio<={active.maximum_clipped_sample_ratio:.6f}",
            )
        )
        dc_status: Literal["pass", "warn", "fail"] = (
            "fail" if abs(dc) > active.dc_offset_fail
            else "warn" if abs(dc) > active.dc_offset_warn
            else "pass"
        )
        checks.append(
            _check(
                "signal.dc-offset",
                dc_status,
                f"normalized_offset={dc:.6f}",
                f"warn<={active.dc_offset_warn:.3f}, fail<={active.dc_offset_fail:.3f}",
            )
        )
        edge_max = max(leading, trailing)
        edge_status: Literal["pass", "warn", "fail"] = (
            "fail" if edge_max > active.edge_silence_fail_ms
            else "warn" if edge_max > active.edge_silence_warn_ms
            else "pass"
        )
        checks.append(
            _check(
                "signal.edge-silence",
                edge_status,
                f"leading={leading:.1f} ms, trailing={trailing:.1f} ms",
                f"warn<={active.edge_silence_warn_ms:.0f} ms, fail<={active.edge_silence_fail_ms:.0f} ms",
            )
        )
        if spoken_word_count is not None:
            rate_status: Literal["pass", "warn", "fail"] = (
                "fail"
                if wpm < active.speech_rate_fail_min_wpm or wpm > active.speech_rate_fail_max_wpm
                else "warn"
                if wpm < active.speech_rate_warn_min_wpm or wpm > active.speech_rate_warn_max_wpm
                else "pass"
            )
            checks.append(
                _check(
                    "speech.rate",
                    rate_status,
                    f"{wpm:.2f} words/minute",
                    f"warn={active.speech_rate_warn_min_wpm:.0f}..{active.speech_rate_warn_max_wpm:.0f}, fail={active.speech_rate_fail_min_wpm:.0f}..{active.speech_rate_fail_max_wpm:.0f}",
                )
            )

    statuses = {check.status for check in checks}
    decision = (
        QualityDecision.REJECT if "fail" in statuses
        else QualityDecision.REVIEW if "warn" in statuses
        else QualityDecision.ACCEPT
    )
    fingerprint = policy_fingerprint(active)
    report = SegmentQualityReport(
        validator_version=f"signal-{SIGNAL_VALIDATOR_VERSION}-{fingerprint[:12]}",
        attempt_id=attempt.attempt_id,
        metrics=metrics,
        checks=tuple(checks),
        decision=decision,
    )
    return SignalValidationEvidence(
        policy_id=active.policy_id,
        policy_fingerprint=fingerprint,
        report=report,
    )


def override_quality_decision(
    evidence: SignalValidationEvidence,
    *,
    actor: str,
    reason: str,
    decision: QualityDecision,
) -> SignalValidationEvidence:
    if not actor.strip() or not reason.strip():
        raise SignalValidationError("manual override requires non-empty actor and reason")
    report = evidence.report.model_copy(
        update={
            "decision": decision,
            "override_actor": actor,
            "override_reason": reason,
        }
    )
    return evidence.model_copy(update={"report": report})
