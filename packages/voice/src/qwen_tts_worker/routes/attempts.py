"""Durable segment-attempt job API; legacy /synthesize remains compatible."""

from __future__ import annotations

import contextlib
import hashlib
import io
import logging
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from qwen_tts_worker.audio_processing import (
    AudioProcessingError,
    AudioProcessor,
    AudioTransformReport,
    AudioTransformStore,
    EdgeProcessingPolicy,
)
from qwen_tts_worker.attempt_store import (
    AttemptStore,
    AttemptStoreError,
    DurableAttemptJob,
    JobCancelled,
    RetryPolicy,
)
from qwen_tts_worker.config import Settings
from qwen_tts_worker.model_lifecycle import model_lifecycle
from qwen_tts_worker.models.quality import SegmentPlan, SynthesisAttempt, SynthesisProfile
from qwen_tts_worker.signal_validation import (
    QualityReportStore,
    SignalValidationEvidence,
    SignalValidationError,
    SignalValidationPolicy,
    validate_attempt_signal,
)
from qwen_tts_worker.routes.synthesis import (
    SynthesizeRequest,
    _generate_silent_wav,
    inspect_customvoice_model,
    resolve_speaker,
    synthesize_with_qwen,
    validate_language,
)


router = APIRouter(prefix="/attempt-jobs")


class SubmitAttemptRequest(BaseModel):
    segment: SegmentPlan
    profile: SynthesisProfile
    use_cache: bool = True


class ValidateAttemptRequest(BaseModel):
    spoken_word_count: int | None = None
    policy: SignalValidationPolicy | None = None


class RetryQualityRequest(BaseModel):
    report_id: UUID


class ProcessAttemptRequest(BaseModel):
    report_id: UUID
    pause_after_ms: int = 0
    policy: EdgeProcessingPolicy | None = None


@lru_cache(maxsize=4)
def _store_at(
    root: str,
    max_retries: int,
    seed_step: int,
    max_concurrent_jobs: int,
    minimum_free_disk_bytes: int,
) -> AttemptStore:
    return AttemptStore(
        root,
        retry_policy=RetryPolicy(max_retries=max_retries, seed_step=seed_step),
        max_concurrent_jobs=max_concurrent_jobs,
        minimum_free_disk_bytes=minimum_free_disk_bytes,
    )


def attempt_store() -> AttemptStore:
    settings = Settings()
    root = settings.attempt_store_dir or settings.outputs_dir / "attempt-store"
    return _store_at(
        str(root.expanduser().resolve()),
        settings.attempt_max_retries,
        settings.attempt_retry_seed_step,
        settings.max_concurrent_attempt_jobs,
        settings.minimum_free_disk_bytes,
    )


def quality_report_store() -> QualityReportStore:
    return QualityReportStore(attempt_store().root / "quality-reports")


def audio_transform_store() -> AudioTransformStore:
    return AudioTransformStore(attempt_store().root)


@lru_cache(maxsize=8)
def _sha256_file_cached(path: str, size: int, mtime_ns: int) -> str:
    del size, mtime_ns  # values are cache-key identity, not digest material
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_file(path: Path) -> str:
    stat = path.stat()
    return _sha256_file_cached(str(path.resolve()), stat.st_size, stat.st_mtime_ns)


def _durable_generator(
    segment: SegmentPlan,
    profile: SynthesisProfile,
    cancelled: threading.Event,
    *,
    provider_mode: Literal["live", "fake"],
) -> bytes:
    settings = Settings()
    if settings.tts_mode != provider_mode:
        raise ValueError(
            f"provider mode changed after submission: {provider_mode} -> {settings.tts_mode}"
        )
    if cancelled.is_set():
        raise JobCancelled("generation cancelled before model acquisition")
    if provider_mode == "fake":
        # Explicit fake mode remains visibly labeled by worker startup and response profile.
        return _generate_silent_wav(max(0.1, len(segment.spoken_text.split()) * 0.5))
    model_path = settings.model_path
    if model_path is None:
        model_path = settings.models_dir / "qwen3-tts-1.7b-customvoice-8bit"
    model = inspect_customvoice_model(model_path)
    if _sha256_file(model.path / "model.safetensors") != profile.model.model_sha256:
        raise ValueError("SynthesisProfile model SHA-256 does not match installed weights")
    speaker = resolve_speaker(profile.speaker, model)
    language = validate_language(profile.language, model)
    request = SynthesizeRequest(
        text=segment.spoken_text,
        voice=speaker,
        instruct=segment.direction.composed_instruction,
        language=language,
        temperature=profile.sampling.temperature,
        top_k=profile.sampling.top_k,
        top_p=profile.sampling.top_p,
        repetition_penalty=profile.sampling.repetition_penalty,
        max_tokens=profile.sampling.max_tokens,
        seed=profile.sampling.seed,
    )
    with model_lifecycle.acquire(model.path) as loaded:
        if cancelled.is_set():
            raise JobCancelled("generation cancelled before synthesis")
        started = time.monotonic()
        try:
            captured_stdout = io.StringIO()
            captured_stderr = io.StringIO()
            with contextlib.redirect_stdout(captured_stdout), contextlib.redirect_stderr(captured_stderr):
                data, _ = synthesize_with_qwen(request, model, speaker, loaded.instance)
            if captured_stdout.getvalue() or captured_stderr.getvalue():
                logging.getLogger("qwen-tts-worker").debug(
                    "Suppressed mlx-audio console output during durable synthesis",
                    extra={
                        "stdout_bytes": len(captured_stdout.getvalue()),
                        "stderr_bytes": len(captured_stderr.getvalue()),
                    },
                )
        finally:
            model_lifecycle.record_synthesis(time.monotonic() - started)
    return data


def _http_error(exc: AttemptStoreError) -> HTTPException:
    message = str(exc)
    status = 404 if message.startswith("unknown") else 409
    return HTTPException(status_code=status, detail=message)


@router.post("", response_model=DurableAttemptJob, status_code=202)
def submit_attempt(request: SubmitAttemptRequest) -> DurableAttemptJob:
    settings = Settings()
    return attempt_store().submit(
        request.segment,
        request.profile,
        use_cache=request.use_cache,
        provider_mode=settings.tts_mode,
    )


@router.get("", response_model=list[DurableAttemptJob])
def list_attempt_jobs() -> list[DurableAttemptJob]:
    return list(attempt_store().list_jobs())


@router.get("/{job_id}", response_model=DurableAttemptJob)
def get_attempt_job(job_id: UUID) -> DurableAttemptJob:
    try:
        return attempt_store().get_job(job_id)
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc


@router.post("/{job_id}/execute", response_model=DurableAttemptJob)
def execute_attempt_job(job_id: UUID) -> DurableAttemptJob:
    try:
        store = attempt_store()
        job = store.get_job(job_id)
        return store.execute(
            job_id,
            lambda segment, profile, cancelled: _durable_generator(
                segment,
                profile,
                cancelled,
                provider_mode=job.provider_mode,
            ),
        )
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc


@router.post("/{job_id}/cancel", response_model=DurableAttemptJob)
def cancel_attempt_job(job_id: UUID) -> DurableAttemptJob:
    try:
        return attempt_store().cancel(job_id)
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc


@router.get("/{job_id}/attempt", response_model=SynthesisAttempt)
def get_job_attempt(job_id: UUID) -> SynthesisAttempt:
    try:
        job = attempt_store().get_job(job_id)
        if job.attempt_id is None:
            raise AttemptStoreError(f"durable job {job_id} has no terminal attempt")
        return attempt_store().get_attempt(job.attempt_id)
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc


@router.post("/{job_id}/retry", response_model=DurableAttemptJob, status_code=202)
def retry_attempt_job(job_id: UUID) -> DurableAttemptJob:
    try:
        job = attempt_store().get_job(job_id)
        if job.attempt_id is None:
            raise AttemptStoreError(f"durable job {job_id} has no terminal attempt")
        return attempt_store().retry(job.attempt_id)
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc


@router.post("/{job_id}/validate", response_model=SignalValidationEvidence)
def validate_attempt_job(
    job_id: UUID, request: ValidateAttemptRequest
) -> SignalValidationEvidence:
    try:
        store = attempt_store()
        job = store.get_job(job_id)
        if job.attempt_id is None:
            raise AttemptStoreError(f"durable job {job_id} has no terminal attempt")
        attempt = store.get_attempt(job.attempt_id)
        evidence = validate_attempt_signal(
            attempt,
            store.root,
            spoken_word_count=request.spoken_word_count,
            policy=request.policy,
        )
        quality_report_store().save(evidence)
        return evidence
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc
    except SignalValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/quality-reports/{report_id}", response_model=SignalValidationEvidence)
def get_quality_report(report_id: UUID) -> SignalValidationEvidence:
    try:
        return quality_report_store().get(str(report_id))
    except SignalValidationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/retry-quality", response_model=DurableAttemptJob, status_code=202)
def retry_rejected_attempt(
    job_id: UUID, request: RetryQualityRequest
) -> DurableAttemptJob:
    try:
        store = attempt_store()
        job = store.get_job(job_id)
        if job.attempt_id is None:
            raise AttemptStoreError(f"durable job {job_id} has no terminal attempt")
        evidence = quality_report_store().get(str(request.report_id))
        return store.retry_rejected(job.attempt_id, evidence.report)
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc
    except SignalValidationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/process", response_model=AudioTransformReport)
def process_accepted_attempt(
    job_id: UUID, request: ProcessAttemptRequest
) -> AudioTransformReport:
    try:
        store = attempt_store()
        job = store.get_job(job_id)
        if job.attempt_id is None:
            raise AttemptStoreError(f"durable job {job_id} has no terminal attempt")
        attempt = store.get_attempt(job.attempt_id)
        evidence = quality_report_store().get(str(request.report_id))
        report = AudioProcessor(request.policy).process_attempt(
            attempt,
            evidence.report,
            store.root,
            store.root,
            pause_after_ms=request.pause_after_ms,
        )
        audio_transform_store().save(report)
        return report
    except AttemptStoreError as exc:
        raise _http_error(exc) from exc
    except SignalValidationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AudioProcessingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/transforms/{transform_id}", response_model=AudioTransformReport)
def get_audio_transform(transform_id: str) -> AudioTransformReport:
    try:
        return audio_transform_store().get(transform_id)
    except AudioProcessingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
