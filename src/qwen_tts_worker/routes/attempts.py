"""Durable segment-attempt job API; legacy /synthesize remains compatible."""

from __future__ import annotations

import hashlib
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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


@lru_cache(maxsize=4)
def _store_at(root: str, max_retries: int, seed_step: int) -> AttemptStore:
    return AttemptStore(
        root,
        retry_policy=RetryPolicy(max_retries=max_retries, seed_step=seed_step),
    )


def attempt_store() -> AttemptStore:
    settings = Settings()
    root = settings.attempt_store_dir or settings.outputs_dir / "attempt-store"
    return _store_at(
        str(root.expanduser().resolve()),
        settings.attempt_max_retries,
        settings.attempt_retry_seed_step,
    )


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
            data, _ = synthesize_with_qwen(request, model, speaker, loaded.instance)
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
