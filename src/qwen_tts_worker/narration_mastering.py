"""Manifest-ordered FFmpeg loudness mastering from accepted transformed attempts."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
import wave
from array import array
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from qwen_tts_worker.models.quality import (
    FrozenContract,
    MasteringMetrics,
    NarrationEntry,
    NarrationManifest,
    WavArtifact,
)


MASTERING_VERSION = "0.1.0"


class MasteringError(RuntimeError):
    pass


class MasteringProfile(FrozenContract):
    schema_version: Literal["0.1.0"] = MASTERING_VERSION
    profile_id: str = "narration-web-v1"
    integrated_lufs: float = Field(default=-16.0, ge=-30, le=-8)
    true_peak_dbtp: float = Field(default=-1.5, ge=-6, le=-0.1)
    loudness_range_lu: float = Field(default=11.0, ge=1, le=20)
    loudness_tolerance_lu: float = Field(default=0.6, gt=0, le=2)
    true_peak_tolerance_db: float = Field(default=0.2, ge=0, le=1)
    maximum_boundary_step: float = Field(default=0.25, gt=0, le=1)
    sample_rate: Literal[24000] = 24_000
    channels: Literal[1] = 1
    sample_width_bytes: Literal[2] = 2


class AssemblyEntry(FrozenContract):
    segment_id: str = Field(..., min_length=1, max_length=256)
    accepted_attempt_id: UUID
    quality_report_id: UUID
    transform_id: str = Field(..., min_length=1, max_length=128)
    speech_wav: WavArtifact
    pause_wav: WavArtifact | None = None
    pause_after_ms: int = Field(default=0, ge=0, le=10_000)

    @model_validator(mode="after")
    def _pause_is_consistent(self) -> AssemblyEntry:
        if self.pause_after_ms == 0 and self.pause_wav is not None:
            raise ValueError("zero pause cannot reference pause_wav")
        if self.pause_after_ms > 0 and self.pause_wav is None:
            raise ValueError("nonzero pause requires pause_wav")
        return self


class AssemblyPlan(FrozenContract):
    schema_version: Literal["0.1.0"] = MASTERING_VERSION
    episode_id: str = Field(..., min_length=1, max_length=256)
    source_revision: str = Field(..., min_length=1, max_length=256)
    entries: tuple[AssemblyEntry, ...] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _segments_are_unique(self) -> AssemblyPlan:
        identifiers = [entry.segment_id for entry in self.entries]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("assembly segment IDs must be unique")
        attempts = [entry.accepted_attempt_id for entry in self.entries]
        if len(attempts) != len(set(attempts)):
            raise ValueError("assembly accepted attempt IDs must be unique")
        return self


class BoundaryMeasurement(FrozenContract):
    left_segment_id: str
    right_segment_id: str | None = None
    boundary_kind: Literal["speech-to-pause", "pause-to-speech", "speech-to-speech"]
    sample_index: int = Field(..., ge=1)
    normalized_step: float = Field(..., ge=0, le=2)
    status: Literal["pass", "fail"]


class MasteringReport(FrozenContract):
    schema_version: Literal["0.1.0"] = MASTERING_VERSION
    mastering_version: Literal["0.1.0"] = MASTERING_VERSION
    assembly_id: str = Field(..., min_length=1, max_length=128)
    profile: MasteringProfile
    profile_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    ffmpeg_version: str
    ordered_segment_ids: tuple[str, ...]
    expected_duration_seconds: float = Field(..., gt=0)
    premaster_duration_seconds: float = Field(..., gt=0)
    final_duration_seconds: float = Field(..., gt=0)
    duration_error_seconds: float = Field(..., ge=0)
    boundaries: tuple[BoundaryMeasurement, ...]
    premaster_wav: WavArtifact
    final_wav: WavArtifact
    measured: MasteringMetrics
    manifest: NarrationManifest


class NarrationMasterer:
    def __init__(
        self,
        *,
        profile: MasteringProfile | None = None,
        ffmpeg: str = "ffmpeg",
    ) -> None:
        self.profile = profile or MasteringProfile()
        self.ffmpeg = ffmpeg
        profile_json = json.dumps(
            self.profile.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        )
        self.profile_fingerprint = hashlib.sha256(profile_json.encode()).hexdigest()
        self.ffmpeg_version = self._ffmpeg_version()

    def _ffmpeg_version(self) -> str:
        try:
            result = subprocess.run(
                [self.ffmpeg, "-version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise MasteringError(f"FFmpeg is unavailable: {exc}") from exc
        return result.stdout.splitlines()[0]

    def _read_artifact(self, root: Path, artifact: WavArtifact) -> tuple[bytes, array[int]]:
        path = root / artifact.path
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise MasteringError(f"cannot read assembly artifact {path}: {exc}") from exc
        if hashlib.sha256(data).hexdigest() != artifact.sha256 or len(data) != artifact.size_bytes:
            raise MasteringError(f"assembly artifact integrity mismatch: {path}")
        try:
            with wave.open(io.BytesIO(data), "rb") as wav:
                channels = wav.getnchannels()
                width = wav.getsampwidth()
                rate = wav.getframerate()
                frames = wav.getnframes()
                compression = wav.getcomptype()
                raw = wav.readframes(frames)
        except (EOFError, wave.Error) as exc:
            raise MasteringError(f"cannot decode assembly artifact {path}: {exc}") from exc
        if (
            channels != self.profile.channels
            or width != self.profile.sample_width_bytes
            or rate != self.profile.sample_rate
            or compression != "NONE"
            or frames <= 0
        ):
            raise MasteringError(f"assembly artifact is not canonical mono PCM16/24k: {path}")
        samples = array("h")
        samples.frombytes(raw)
        if os.sys.byteorder != "little":
            samples.byteswap()
        return data, samples

    @staticmethod
    def _encode(samples: array[int]) -> bytes:
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24_000)
            wav.writeframes(samples.tobytes())
        return output.getvalue()

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

    def _identity(self, plan: AssemblyPlan) -> str:
        material = {
            "version": MASTERING_VERSION,
            "episode": plan.episode_id,
            "source_revision": plan.source_revision,
            "profile": self.profile_fingerprint,
            "entries": [
                {
                    "segment": entry.segment_id,
                    "attempt": str(entry.accepted_attempt_id),
                    "quality": str(entry.quality_report_id),
                    "transform": entry.transform_id,
                    "speech": entry.speech_wav.sha256,
                    "pause": entry.pause_wav.sha256 if entry.pause_wav else None,
                    "pause_ms": entry.pause_after_ms,
                }
                for entry in plan.entries
            ],
        }
        canonical = json.dumps(material, sort_keys=True, separators=(",", ":"))
        return "assembly-" + hashlib.sha256(canonical.encode()).hexdigest()[:20]

    def _loudnorm(self, input_path: Path, output_path: Path) -> None:
        target = self.profile
        first_filter = (
            f"loudnorm=I={target.integrated_lufs}:TP={target.true_peak_dbtp}:"
            f"LRA={target.loudness_range_lu}:print_format=json"
        )
        first = subprocess.run(
            [self.ffmpeg, "-nostdin", "-hide_banner", "-i", str(input_path), "-af", first_filter, "-f", "null", "-"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if first.returncode != 0:
            raise MasteringError(f"FFmpeg loudness analysis failed: {first.stderr[-1000:]}")
        measured = self._parse_loudnorm(first.stderr)
        second_filter = (
            f"loudnorm=I={target.integrated_lufs}:TP={target.true_peak_dbtp}:LRA={target.loudness_range_lu}:"
            f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
            f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
            f"offset={measured['target_offset']}:linear=true:print_format=json"
        )
        second = subprocess.run(
            [
                self.ffmpeg, "-nostdin", "-hide_banner", "-i", str(input_path),
                "-af", second_filter, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if second.returncode != 0:
            raise MasteringError(f"FFmpeg loudness mastering failed: {second.stderr[-1000:]}")

    @staticmethod
    def _parse_loudnorm(stderr: str) -> dict[str, str]:
        candidates = re.findall(r"\{\s*\"input_i\".*?\}", stderr, re.DOTALL)
        if not candidates:
            raise MasteringError("FFmpeg loudnorm emitted no JSON measurements")
        try:
            result = json.loads(candidates[-1])
        except json.JSONDecodeError as exc:
            raise MasteringError(f"cannot parse FFmpeg loudnorm JSON: {exc}") from exc
        required = {"input_i", "input_tp", "input_lra", "input_thresh", "target_offset"}
        if not required.issubset(result):
            raise MasteringError("FFmpeg loudnorm JSON is incomplete")
        if any(str(result[key]).lower() in {"-inf", "inf", "nan"} for key in required):
            raise MasteringError("audio is too short or silent for loudness mastering")
        return result

    def _measure_loudness(self, path: Path) -> MasteringMetrics:
        target = self.profile
        result = subprocess.run(
            [
                self.ffmpeg, "-nostdin", "-hide_banner", "-i", str(path), "-af",
                f"loudnorm=I={target.integrated_lufs}:TP={target.true_peak_dbtp}:LRA={target.loudness_range_lu}:print_format=json",
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise MasteringError(f"FFmpeg final loudness probe failed: {result.stderr[-1000:]}")
        measured = self._parse_loudnorm(result.stderr)
        return MasteringMetrics(
            integrated_lufs=float(measured["input_i"]),
            true_peak_dbtp=float(measured["input_tp"]),
            loudness_range_lu=max(0.0, float(measured["input_lra"])),
        )

    def master(
        self,
        plan: AssemblyPlan,
        artifact_root: str | Path,
        output_root: str | Path,
    ) -> MasteringReport:
        source_root = Path(artifact_root).expanduser().resolve()
        destination_root = Path(output_root).expanduser().resolve()
        assembly_id = self._identity(plan)
        final_directory = destination_root / "mastered" / assembly_id
        if final_directory.exists():
            raise MasteringError(f"immutable mastered assembly already exists: {final_directory}")
        final_directory.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".{assembly_id}.", dir=final_directory.parent))
        try:
            combined = array("h")
            boundaries: list[BoundaryMeasurement] = []
            expected_frames = 0
            for index, entry in enumerate(plan.entries):
                _, speech = self._read_artifact(source_root, entry.speech_wav)
                if combined:
                    step = abs(int(combined[-1]) - int(speech[0])) / 32768.0
                    boundaries.append(
                        BoundaryMeasurement(
                            left_segment_id=plan.entries[index - 1].segment_id,
                            right_segment_id=entry.segment_id,
                            boundary_kind="pause-to-speech" if plan.entries[index - 1].pause_wav else "speech-to-speech",
                            sample_index=len(combined),
                            normalized_step=step,
                            status="pass" if step <= self.profile.maximum_boundary_step else "fail",
                        )
                    )
                combined.extend(speech)
                expected_frames += len(speech)
                if entry.pause_wav is not None:
                    _, pause = self._read_artifact(source_root, entry.pause_wav)
                    if any(pause):
                        raise MasteringError(f"pause artifact for {entry.segment_id} is not exact silence")
                    expected_pause_frames = round(entry.pause_after_ms * 24_000 / 1000)
                    if len(pause) != expected_pause_frames:
                        raise MasteringError(
                            f"pause artifact for {entry.segment_id} has {len(pause)} frames; "
                            f"expected {expected_pause_frames}"
                        )
                    step = abs(int(combined[-1]) - int(pause[0])) / 32768.0
                    boundaries.append(
                        BoundaryMeasurement(
                            left_segment_id=entry.segment_id,
                            boundary_kind="speech-to-pause",
                            sample_index=len(combined),
                            normalized_step=step,
                            status="pass" if step <= self.profile.maximum_boundary_step else "fail",
                        )
                    )
                    combined.extend(pause)
                    expected_frames += len(pause)
            failed = [boundary for boundary in boundaries if boundary.status == "fail"]
            if failed:
                raise MasteringError(
                    f"{len(failed)} boundary sample step(s) exceed {self.profile.maximum_boundary_step}"
                )
            premaster_data = self._encode(combined)
            premaster_path = temporary / "premaster.wav"
            premaster_path.write_bytes(premaster_data)
            mastered_path = temporary / "narration-full.wav"
            self._loudnorm(premaster_path, mastered_path)
            final_data = mastered_path.read_bytes()
            with wave.open(io.BytesIO(final_data), "rb") as final_wav:
                final_frames = final_wav.getnframes()
                if (
                    final_wav.getframerate() != 24_000
                    or final_wav.getnchannels() != 1
                    or final_wav.getsampwidth() != 2
                ):
                    raise MasteringError("FFmpeg final WAV is not canonical mono PCM16/24k")
            duration_error = abs(final_frames - expected_frames) / 24_000
            if duration_error > 1 / 24_000:
                raise MasteringError(
                    f"mastered duration differs by {duration_error:.6f}s from entries+pauses"
                )
            metrics = self._measure_loudness(mastered_path)
            if abs(metrics.integrated_lufs - self.profile.integrated_lufs) > self.profile.loudness_tolerance_lu:
                raise MasteringError(
                    f"final loudness {metrics.integrated_lufs:.2f} LUFS misses target {self.profile.integrated_lufs:.2f}"
                )
            if metrics.true_peak_dbtp > self.profile.true_peak_dbtp + self.profile.true_peak_tolerance_db:
                raise MasteringError(
                    f"final true peak {metrics.true_peak_dbtp:.2f} dBTP exceeds target ceiling"
                )
            final_directory.mkdir()
            premaster_final = final_directory / "premaster.wav"
            mastered_final = final_directory / "narration-full.wav"
            os.replace(premaster_path, premaster_final)
            os.replace(mastered_path, mastered_final)
            relative_base = f"mastered/{assembly_id}"
            premaster_artifact = self._artifact(
                f"{relative_base}/premaster.wav", premaster_data, expected_frames
            )
            final_artifact = self._artifact(
                f"{relative_base}/narration-full.wav", final_data, final_frames
            )
            manifest = NarrationManifest(
                manifest_id=uuid.uuid5(uuid.NAMESPACE_URL, f"qwen-tts-worker:{assembly_id}"),
                episode_id=plan.episode_id,
                source_revision=plan.source_revision,
                entries=tuple(
                    NarrationEntry(
                        segment_id=entry.segment_id,
                        accepted_attempt_id=entry.accepted_attempt_id,
                        quality_report_id=entry.quality_report_id,
                        wav=entry.speech_wav,
                        pause_after_ms=entry.pause_after_ms,
                        transform_ids=(entry.transform_id,),
                    )
                    for entry in plan.entries
                ),
                mastering_profile_id=self.profile.profile_id,
                final_wav=final_artifact,
                mastering=metrics,
                created_at=datetime.now(timezone.utc),
            )
            report = MasteringReport(
                assembly_id=assembly_id,
                profile=self.profile,
                profile_fingerprint=self.profile_fingerprint,
                ffmpeg_version=self.ffmpeg_version,
                ordered_segment_ids=tuple(entry.segment_id for entry in plan.entries),
                expected_duration_seconds=expected_frames / 24_000,
                premaster_duration_seconds=expected_frames / 24_000,
                final_duration_seconds=final_frames / 24_000,
                duration_error_seconds=duration_error,
                boundaries=tuple(boundaries),
                premaster_wav=premaster_artifact,
                final_wav=final_artifact,
                measured=metrics,
                manifest=manifest,
            )
            report_path = final_directory / "mastering-report.json"
            report_path.write_text(
                json.dumps(report.model_dump(mode="json"), indent=2) + "\n",
                encoding="utf-8",
            )
            return report
        except Exception:
            if final_directory.exists():
                shutil.rmtree(final_directory)
            raise
        finally:
            shutil.rmtree(temporary, ignore_errors=True)
