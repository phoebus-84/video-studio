"""Durable immutable synthesis attempts, verified cache, and bounded retries."""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import threading
import time
import uuid
import wave
from array import array
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal
from uuid import UUID

from pydantic import Field, model_validator

from qwen_tts_worker.models.quality import (
    AttemptFailure,
    AttemptPhase,
    FrozenContract,
    QualityDecision,
    SegmentPlan,
    SegmentQualityReport,
    SynthesisAttempt,
    SynthesisProfile,
    WavArtifact,
    synthesis_fingerprint,
)


ATTEMPT_STORE_VERSION = "0.1.0"
Generator = Callable[[SegmentPlan, SynthesisProfile, threading.Event], bytes]


class AttemptStoreError(RuntimeError):
    """Durable state, immutable artifact, or lifecycle invariant failed."""


class JobCancelled(AttemptStoreError):
    """Generator cooperatively observed cancellation."""


class RetryPolicy(FrozenContract):
    schema_version: Literal["0.1.0"] = ATTEMPT_STORE_VERSION
    max_retries: int = Field(default=2, ge=0, le=10)
    seed_step: int = Field(default=1, ge=1, le=1_000_000)


class DurableAttemptJob(FrozenContract):
    schema_version: Literal["0.1.0"] = ATTEMPT_STORE_VERSION
    job_id: UUID
    phase: Literal["queued", "running", "completed", "failed", "cancelled"]
    segment: SegmentPlan
    profile: SynthesisProfile
    request_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    provider_mode: Literal["live", "fake"] = "live"
    retry_count: int = Field(default=0, ge=0)
    retry_of: UUID | None = None
    retry_reason: str | None = Field(default=None, max_length=256)
    attempt_id: UUID | None = None
    cache_hit: bool = False
    cancel_requested: bool = False
    recovered_after_restart: bool = False
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def _state_is_consistent(self) -> DurableAttemptJob:
        terminal = self.phase in {"completed", "failed", "cancelled"}
        if terminal and self.attempt_id is None:
            raise ValueError("terminal durable job requires attempt_id")
        if not terminal and self.attempt_id is not None:
            raise ValueError("non-terminal durable job cannot have attempt_id")
        if self.cache_hit and self.phase != "completed":
            raise ValueError("cache_hit is valid only for completed jobs")
        if self.updated_at < self.created_at:
            raise ValueError("updated_at cannot precede created_at")
        return self


class AttemptStoreSnapshot(FrozenContract):
    schema_version: Literal["0.1.0"] = ATTEMPT_STORE_VERSION
    jobs: int = Field(..., ge=0)
    queued: int = Field(..., ge=0)
    running: int = Field(..., ge=0)
    completed: int = Field(..., ge=0)
    failed: int = Field(..., ge=0)
    cancelled: int = Field(..., ge=0)
    attempts: int = Field(..., ge=0)
    cached_fingerprints: int = Field(..., ge=0)


class AttemptStore:
    """Local filesystem store with atomic state updates and immutable outcomes."""

    def __init__(
        self,
        root: str | Path,
        *,
        retry_policy: RetryPolicy | None = None,
        max_concurrent_jobs: int = 1,
        minimum_free_disk_bytes: int = 0,
    ) -> None:
        self.root = Path(root).expanduser().resolve()
        self.retry_policy = retry_policy or RetryPolicy()
        if max_concurrent_jobs < 1:
            raise ValueError("max_concurrent_jobs must be positive")
        if minimum_free_disk_bytes < 0:
            raise ValueError("minimum_free_disk_bytes cannot be negative")
        self.max_concurrent_jobs = max_concurrent_jobs
        self.minimum_free_disk_bytes = minimum_free_disk_bytes
        self.jobs_dir = self.root / "jobs"
        self.attempts_dir = self.root / "attempts"
        self.wav_dir = self.root / "raw-wav"
        self.cache_dir = self.root / "cache"
        for directory in (self.jobs_dir, self.attempts_dir, self.wav_dir, self.cache_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._cancel_events: dict[UUID, threading.Event] = {}
        self._recover_running_jobs()

    def _preflight_disk(self) -> None:
        free = shutil.disk_usage(self.root).free
        if free < self.minimum_free_disk_bytes:
            raise AttemptStoreError(
                f"insufficient free disk before synthesis: {free} bytes available; "
                f"minimum {self.minimum_free_disk_bytes}"
            )

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _canonical_json(model: FrozenContract) -> bytes:
        return (
            json.dumps(
                model.model_dump(mode="json"),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode()

    def _atomic_replace(self, path: Path, data: bytes) -> None:
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def _write_immutable(self, path: Path, data: bytes) -> None:
        try:
            with path.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError as exc:
            raise AttemptStoreError(f"immutable artifact already exists: {path}") from exc

    def _job_path(self, job_id: UUID) -> Path:
        return self.jobs_dir / f"{job_id}.json"

    def _attempt_path(self, attempt_id: UUID) -> Path:
        return self.attempts_dir / f"{attempt_id}.json"

    def _cache_path(self, fingerprint: str, segment_id: str) -> Path:
        segment_key = hashlib.sha256(segment_id.encode()).hexdigest()[:16]
        return self.cache_dir / f"{fingerprint}-{segment_key}.json"

    def _save_job(self, job: DurableAttemptJob) -> None:
        self._atomic_replace(self._job_path(job.job_id), self._canonical_json(job))

    def _save_attempt(self, attempt: SynthesisAttempt) -> None:
        self._write_immutable(
            self._attempt_path(attempt.attempt_id), self._canonical_json(attempt)
        )

    def get_job(self, job_id: UUID | str) -> DurableAttemptJob:
        identifier = UUID(str(job_id))
        try:
            return DurableAttemptJob.model_validate_json(
                self._job_path(identifier).read_text(encoding="utf-8")
            )
        except FileNotFoundError as exc:
            raise AttemptStoreError(f"unknown durable job {identifier}") from exc

    def get_attempt(self, attempt_id: UUID | str) -> SynthesisAttempt:
        identifier = UUID(str(attempt_id))
        try:
            return SynthesisAttempt.model_validate_json(
                self._attempt_path(identifier).read_text(encoding="utf-8")
            )
        except FileNotFoundError as exc:
            raise AttemptStoreError(f"unknown synthesis attempt {identifier}") from exc

    def list_jobs(self) -> tuple[DurableAttemptJob, ...]:
        jobs = [
            DurableAttemptJob.model_validate_json(path.read_text(encoding="utf-8"))
            for path in self.jobs_dir.glob("*.json")
        ]
        return tuple(sorted(jobs, key=lambda job: (job.created_at, str(job.job_id))))

    def _verified_cached_attempt(
        self, fingerprint: str, segment_id: str
    ) -> SynthesisAttempt | None:
        cache_path = self._cache_path(fingerprint, segment_id)
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
            attempt = self.get_attempt(cache["attempt_id"])
        except (FileNotFoundError, KeyError, json.JSONDecodeError, AttemptStoreError, ValueError):
            cache_path.unlink(missing_ok=True)
            return None
        if (
            attempt.phase != AttemptPhase.COMPLETED
            or attempt.request_fingerprint != fingerprint
            or attempt.segment_id != segment_id
            or attempt.raw_wav is None
        ):
            cache_path.unlink(missing_ok=True)
            return None
        wav_path = self.root / attempt.raw_wav.path
        try:
            data = wav_path.read_bytes()
        except OSError:
            cache_path.unlink(missing_ok=True)
            return None
        if hashlib.sha256(data).hexdigest() != attempt.raw_wav.sha256:
            cache_path.unlink(missing_ok=True)
            return None
        return attempt

    def submit(
        self,
        segment: SegmentPlan,
        profile: SynthesisProfile,
        *,
        use_cache: bool = True,
        retry_count: int = 0,
        retry_of: UUID | None = None,
        provider_mode: Literal["live", "fake"] = "live",
        retry_reason: str | None = None,
    ) -> DurableAttemptJob:
        synthesis_inputs = synthesis_fingerprint(segment, profile)
        self._preflight_disk()
        fingerprint = hashlib.sha256(
            f"attempt-store-{ATTEMPT_STORE_VERSION}\0{synthesis_inputs}\0{provider_mode}".encode()
        ).hexdigest()
        now = self._now()
        with self._lock:
            cached = (
                self._verified_cached_attempt(fingerprint, segment.segment_id)
                if use_cache else None
            )
            job = DurableAttemptJob(
                job_id=uuid.uuid4(),
                phase="completed" if cached else "queued",
                segment=segment,
                profile=profile,
                request_fingerprint=fingerprint,
                provider_mode=provider_mode,
                retry_count=retry_count,
                retry_of=retry_of,
                retry_reason=retry_reason,
                attempt_id=cached.attempt_id if cached else None,
                cache_hit=cached is not None,
                created_at=now,
                updated_at=now,
            )
            self._save_job(job)
            if not cached:
                self._cancel_events[job.job_id] = threading.Event()
            return job

    def cancel(self, job_id: UUID | str) -> DurableAttemptJob:
        identifier = UUID(str(job_id))
        with self._lock:
            job = self.get_job(identifier)
            if job.phase in {"completed", "failed", "cancelled"}:
                return job
            event = self._cancel_events.setdefault(identifier, threading.Event())
            event.set()
            now = self._now()
            if job.phase == "queued":
                attempt = self._terminal_attempt(
                    job,
                    AttemptPhase.CANCELLED,
                    now,
                    0.0,
                    failure=AttemptFailure(
                        code="cancelled",
                        message="job cancelled before generation started",
                        retryable=False,
                    ),
                )
                self._save_attempt(attempt)
                job = job.model_copy(
                    update={
                        "phase": "cancelled",
                        "attempt_id": attempt.attempt_id,
                        "cancel_requested": True,
                        "updated_at": now,
                    }
                )
            else:
                job = job.model_copy(
                    update={"cancel_requested": True, "updated_at": now}
                )
            self._save_job(job)
            return job

    def _terminal_attempt(
        self,
        job: DurableAttemptJob,
        phase: AttemptPhase,
        completed_at: datetime,
        processing_seconds: float,
        *,
        wav: WavArtifact | None = None,
        failure: AttemptFailure | None = None,
    ) -> SynthesisAttempt:
        return SynthesisAttempt(
            segment_id=job.segment.segment_id,
            request_fingerprint=job.request_fingerprint,
            phase=phase,
            profile=job.profile,
            direction=job.segment.direction,
            raw_wav=wav,
            failure=failure,
            retry_of=job.retry_of,
            created_at=job.created_at,
            completed_at=completed_at,
            processing_seconds=processing_seconds,
        )

    @staticmethod
    def _probe_wav(data: bytes, relative_path: str) -> WavArtifact:
        if len(data) < 44:
            raise AttemptStoreError("generator returned missing or undersized WAV")
        try:
            with wave.open(io.BytesIO(data), "rb") as wav:
                channels = wav.getnchannels()
                width = wav.getsampwidth()
                rate = wav.getframerate()
                frames = wav.getnframes()
                compression = wav.getcomptype()
                raw = wav.readframes(frames)
        except (EOFError, wave.Error) as exc:
            raise AttemptStoreError(f"generator returned invalid WAV: {exc}") from exc
        if compression != "NONE" or frames <= 0 or not raw:
            raise AttemptStoreError("generator returned empty or compressed WAV")
        samples = array("h")
        if width == 2:
            samples.frombytes(raw)
        if width != 2 or channels != 1 or rate != 24_000:
            raise AttemptStoreError(
                "raw synthesis WAV must be mono PCM16 at 24000 Hz; "
                f"found channels={channels}, width={width}, rate={rate}"
            )
        return WavArtifact(
            path=relative_path,
            sha256=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
            duration_seconds=frames / rate,
            sample_rate=rate,
            channels=channels,
            sample_width_bytes=width,
        )

    @staticmethod
    def _failure_from_exception(exc: Exception) -> AttemptFailure:
        if isinstance(exc, JobCancelled):
            return AttemptFailure(code="cancelled", message=str(exc), retryable=False)
        if isinstance(exc, FileNotFoundError):
            return AttemptFailure(code="model_unavailable", message=str(exc), retryable=True)
        if isinstance(exc, ValueError):
            return AttemptFailure(code="invalid_request", message=str(exc), retryable=False)
        if isinstance(exc, AttemptStoreError) and "WAV" in str(exc):
            return AttemptFailure(code="invalid_wav", message=str(exc), retryable=True)
        return AttemptFailure(code="generation_failed", message=str(exc), retryable=True)

    def execute(self, job_id: UUID | str, generator: Generator) -> DurableAttemptJob:
        identifier = UUID(str(job_id))
        with self._lock:
            self._preflight_disk()
            job = self.get_job(identifier)
            if job.phase != "queued":
                return job
            running = sum(item.phase == "running" for item in self.list_jobs())
            if running >= self.max_concurrent_jobs:
                raise AttemptStoreError(
                    f"synthesis concurrency limit reached: {running}/{self.max_concurrent_jobs}"
                )
            event = self._cancel_events.setdefault(identifier, threading.Event())
            if event.is_set():
                return self.cancel(identifier)
            now = self._now()
            job = job.model_copy(update={"phase": "running", "updated_at": now})
            self._save_job(job)

        started = time.monotonic()
        wav_path: Path | None = None
        try:
            data = generator(job.segment, job.profile, event)
            if not isinstance(data, bytes):
                raise AttemptStoreError("generator returned missing WAV bytes")
            if event.is_set():
                raise JobCancelled("job cancelled during generation; generated bytes discarded")
            attempt_id = uuid.uuid4()
            relative = f"raw-wav/{attempt_id}.wav"
            wav = self._probe_wav(data, relative)
            wav_path = self.root / relative
            self._write_immutable(wav_path, data)
            completed_at = self._now()
            attempt = SynthesisAttempt(
                attempt_id=attempt_id,
                segment_id=job.segment.segment_id,
                request_fingerprint=job.request_fingerprint,
                phase=AttemptPhase.COMPLETED,
                profile=job.profile,
                direction=job.segment.direction,
                raw_wav=wav,
                retry_of=job.retry_of,
                created_at=job.created_at,
                completed_at=completed_at,
                processing_seconds=time.monotonic() - started,
            )
            self._save_attempt(attempt)
            try:
                self._atomic_replace(
                    self._cache_path(job.request_fingerprint, job.segment.segment_id),
                    (json.dumps({"attempt_id": str(attempt.attempt_id)}, sort_keys=True) + "\n").encode(),
                )
            except OSError:
                # The immutable successful attempt remains valid; cache indexing is optional.
                pass
            terminal_phase = "completed"
        except Exception as exc:
            if wav_path is not None:
                wav_path.unlink(missing_ok=True)
            completed_at = self._now()
            failure = self._failure_from_exception(exc)
            phase = AttemptPhase.CANCELLED if failure.code == "cancelled" else AttemptPhase.FAILED
            attempt = self._terminal_attempt(
                job,
                phase,
                completed_at,
                time.monotonic() - started,
                failure=failure,
            )
            self._save_attempt(attempt)
            terminal_phase = "cancelled" if phase == AttemptPhase.CANCELLED else "failed"

        with self._lock:
            terminal = job.model_copy(
                update={
                    "phase": terminal_phase,
                    "attempt_id": attempt.attempt_id,
                    "cancel_requested": event.is_set(),
                    "updated_at": completed_at,
                }
            )
            self._save_job(terminal)
            self._cancel_events.pop(identifier, None)
            return terminal

    def retry(self, attempt_id: UUID | str) -> DurableAttemptJob:
        prior = self.get_attempt(attempt_id)
        if prior.phase != AttemptPhase.FAILED or prior.failure is None:
            raise AttemptStoreError("only failed attempts can be retried")
        if not prior.failure.retryable:
            raise AttemptStoreError(
                f"attempt failure {prior.failure.code!r} is not retryable"
            )
        parent_jobs = [
            job
            for job in self.list_jobs()
            if job.attempt_id == prior.attempt_id and not job.cache_hit
        ]
        if len(parent_jobs) != 1:
            raise AttemptStoreError("attempt does not map to exactly one generating durable job")
        parent = parent_jobs[0]
        retry_count = parent.retry_count + 1
        if retry_count > self.retry_policy.max_retries:
            raise AttemptStoreError(
                f"retry limit exceeded: {retry_count} > {self.retry_policy.max_retries}"
            )
        seed = (
            parent.profile.sampling.seed
            + self.retry_policy.seed_step * retry_count
        ) % (2**32)
        sampling = parent.profile.sampling.model_copy(update={"seed": seed})
        profile = parent.profile.model_copy(update={"sampling": sampling})
        return self.submit(
            parent.segment,
            profile,
            use_cache=False,
            retry_count=retry_count,
            retry_of=prior.attempt_id,
            provider_mode=parent.provider_mode,
            retry_reason=prior.failure.code,
        )

    def retry_rejected(
        self,
        attempt_id: UUID | str,
        report: SegmentQualityReport,
    ) -> DurableAttemptJob:
        prior = self.get_attempt(attempt_id)
        if prior.phase != AttemptPhase.COMPLETED:
            raise AttemptStoreError("only completed attempts can be quality-retried")
        if report.attempt_id != prior.attempt_id:
            raise AttemptStoreError("quality report attempt_id does not match attempt")
        if report.decision != QualityDecision.REJECT:
            raise AttemptStoreError("quality retry requires a reject decision")
        failed_checks = sorted(
            check.check_id for check in report.checks if check.status == "fail"
        )
        retryable_checks = {
            "signal.speech-presence",
            "signal.clipping",
            "signal.dc-offset",
            "signal.edge-silence",
            "speech.rate",
            "wav.duration",
        }
        if not failed_checks or any(check not in retryable_checks for check in failed_checks):
            raise AttemptStoreError(
                "quality rejection includes non-retryable integrity/format failure"
            )
        parent_jobs = [
            job
            for job in self.list_jobs()
            if job.attempt_id == prior.attempt_id and not job.cache_hit
        ]
        if len(parent_jobs) != 1:
            raise AttemptStoreError("attempt does not map to exactly one generating durable job")
        parent = parent_jobs[0]
        retry_count = parent.retry_count + 1
        if retry_count > self.retry_policy.max_retries:
            raise AttemptStoreError(
                f"retry limit exceeded: {retry_count} > {self.retry_policy.max_retries}"
            )
        seed = (
            parent.profile.sampling.seed
            + self.retry_policy.seed_step * retry_count
        ) % (2**32)
        profile = parent.profile.model_copy(
            update={
                "sampling": parent.profile.sampling.model_copy(update={"seed": seed})
            }
        )
        return self.submit(
            parent.segment,
            profile,
            use_cache=False,
            retry_count=retry_count,
            retry_of=prior.attempt_id,
            provider_mode=parent.provider_mode,
            retry_reason="quality:" + ",".join(failed_checks),
        )

    def _recover_running_jobs(self) -> None:
        for path in self.jobs_dir.glob("*.json"):
            try:
                job = DurableAttemptJob.model_validate_json(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if job.phase == "running":
                recovered = job.model_copy(
                    update={
                        "phase": "queued",
                        "cancel_requested": False,
                        "recovered_after_restart": True,
                        "updated_at": self._now(),
                    }
                )
                self._save_job(recovered)
                self._cancel_events[recovered.job_id] = threading.Event()

    def snapshot(self) -> AttemptStoreSnapshot:
        jobs = self.list_jobs()
        counts = Counter(job.phase for job in jobs)
        return AttemptStoreSnapshot(
            jobs=len(jobs),
            queued=counts["queued"],
            running=counts["running"],
            completed=counts["completed"],
            failed=counts["failed"],
            cancelled=counts["cancelled"],
            attempts=len(tuple(self.attempts_dir.glob("*.json"))),
            cached_fingerprints=len(tuple(self.cache_dir.glob("*.json"))),
        )
