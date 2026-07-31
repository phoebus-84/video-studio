"""Durable attempt, verified cache, cancellation, restart, and retry tests."""

from __future__ import annotations

import hashlib
import io
import json
import threading
import time
import wave
from pathlib import Path

import pytest

from qwen_tts_worker.attempt_store import AttemptStore, AttemptStoreError, RetryPolicy
from qwen_tts_worker.models.quality import (
    DeliveryDelta,
    ModelIdentity,
    SamplingProfile,
    SegmentContext,
    SegmentPlan,
    SourceSpan,
    SpeechRole,
    SynthesisProfile,
    VoiceDirection,
)


SHA_A = "a" * 64
SHA_B = "b" * 64


def direction() -> VoiceDirection:
    return VoiceDirection(
        direction_version="0.1.0",
        base_direction_id="base-1",
        base_instruction="Speak clearly and naturally",
        delta=DeliveryDelta(),
        composed_instruction="Speak clearly and naturally",
    )


def segment(segment_id: str = "segment-1", text: str = "Hello, world.") -> SegmentPlan:
    return SegmentPlan(
        segment_id=segment_id,
        source_document_sha256=SHA_A,
        source_block_ids=(f"block-{segment_id}",),
        source_spans=(SourceSpan(start=0, end=len(text)),),
        preprocessing_version="prep-1",
        display_text=text,
        spoken_text=text,
        language="en-US",
        role=SpeechRole.NARRATOR,
        speaker_profile_id="narrator-profile",
        direction=direction(),
        context=SegmentContext(),
        pause_after_ms=220,
    )


def profile(seed: int = 42) -> SynthesisProfile:
    return SynthesisProfile(
        profile_id="narrator-profile",
        profile_revision="1",
        model=ModelIdentity(
            model_id="qwen-customvoice",
            model_profile="custom_voice",
            model_sha256=SHA_B,
            quantization="8bit",
            mlx_audio_version="0.4.6",
            mlx_version="0.32.0",
        ),
        speaker="serena",
        language="english",
        sampling=SamplingProfile(
            temperature=0.7,
            top_k=50,
            top_p=1.0,
            repetition_penalty=1.05,
            max_tokens=1200,
            seed=seed,
        ),
    )


def wav_bytes(frames: int = 2400) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24_000)
        samples = bytearray()
        for index in range(frames):
            value = 2000 if index % 20 < 10 else -2000
            samples.extend(int(value).to_bytes(2, "little", signed=True))
        wav.writeframes(bytes(samples))
    return output.getvalue()


def success_generator(plan, selected_profile, cancelled) -> bytes:
    assert plan.spoken_text
    assert selected_profile.speaker == "serena"
    assert not cancelled.is_set()
    return wav_bytes()


def test_completed_attempt_is_immutable_and_survives_restart(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    job = store.submit(segment(), profile())
    completed = store.execute(job.job_id, success_generator)
    assert completed.phase == "completed"
    assert completed.attempt_id is not None
    attempt = store.get_attempt(completed.attempt_id)
    assert attempt.raw_wav is not None
    assert attempt.raw_wav.sha256 == hashlib.sha256(wav_bytes()).hexdigest()
    assert (tmp_path / attempt.raw_wav.path).is_file()
    with pytest.raises(AttemptStoreError, match="immutable artifact already exists"):
        store._save_attempt(attempt)

    restarted = AttemptStore(tmp_path)
    assert restarted.get_job(job.job_id) == completed
    assert restarted.get_attempt(attempt.attempt_id) == attempt
    assert restarted.snapshot().completed == 1


def test_verified_fingerprint_cache_reuses_exact_attempt_without_generation(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    first = store.execute(store.submit(segment(), profile()).job_id, success_generator)
    cached = store.submit(segment(), profile())
    assert cached.phase == "completed"
    assert cached.cache_hit is True
    assert cached.attempt_id == first.attempt_id

    called = False
    def must_not_run(*args) -> bytes:
        nonlocal called
        called = True
        raise AssertionError("cache hit must not generate")

    assert store.execute(cached.job_id, must_not_run) == cached
    assert called is False
    assert store.snapshot().attempts == 1


def test_every_content_affecting_fingerprint_change_misses_cache(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    store.execute(store.submit(segment(), profile()).job_id, success_generator)
    assert store.submit(segment(text="Different text."), profile()).phase == "queued"
    assert store.submit(segment(), profile(seed=43)).phase == "queued"
    changed_direction = segment().model_copy(
        update={"direction": direction().model_copy(update={"composed_instruction": "Speak crisply"})}
    )
    assert store.submit(changed_direction, profile()).phase == "queued"


def test_corrupt_cached_wav_is_never_reused(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    complete = store.execute(store.submit(segment(), profile()).job_id, success_generator)
    attempt = store.get_attempt(complete.attempt_id)
    assert attempt.raw_wav is not None
    (tmp_path / attempt.raw_wav.path).write_bytes(b"corrupt")
    replacement = store.submit(segment(), profile())
    assert replacement.phase == "queued"
    assert replacement.cache_hit is False


def test_retry_creates_new_attempt_seed_fingerprint_and_chain(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path, retry_policy=RetryPolicy(max_retries=2, seed_step=7))
    failed_job = store.execute(
        store.submit(segment(), profile()).job_id,
        lambda *_: (_ for _ in ()).throw(RuntimeError("temporary generation failure")),
    )
    failed = store.get_attempt(failed_job.attempt_id)
    assert failed.failure is not None and failed.failure.retryable

    retry_job = store.retry(failed.attempt_id)
    assert retry_job.retry_count == 1
    assert retry_job.retry_of == failed.attempt_id
    assert retry_job.profile.sampling.seed == 49
    assert retry_job.request_fingerprint != failed.request_fingerprint
    completed = store.execute(retry_job.job_id, success_generator)
    retried = store.get_attempt(completed.attempt_id)
    assert retried.retry_of == failed.attempt_id
    assert retried.raw_wav is not None


def test_nonretryable_failure_and_retry_limit_are_enforced(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path, retry_policy=RetryPolicy(max_retries=1))
    invalid_job = store.execute(
        store.submit(segment(), profile()).job_id,
        lambda *_: (_ for _ in ()).throw(ValueError("bad controls")),
    )
    invalid = store.get_attempt(invalid_job.attempt_id)
    assert invalid.failure is not None and not invalid.failure.retryable
    with pytest.raises(AttemptStoreError, match="not retryable"):
        store.retry(invalid.attempt_id)

    failed_job = store.execute(
        store.submit(segment("retryable"), profile()).job_id,
        lambda *_: (_ for _ in ()).throw(RuntimeError("temporary")),
    )
    first_retry = store.retry(failed_job.attempt_id)
    failed_retry_job = store.execute(
        first_retry.job_id,
        lambda *_: (_ for _ in ()).throw(RuntimeError("still temporary")),
    )
    with pytest.raises(AttemptStoreError, match="retry limit exceeded"):
        store.retry(failed_retry_job.attempt_id)


def test_queued_and_running_cancellation_create_no_wav(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    queued = store.submit(segment("queued"), profile())
    cancelled = store.cancel(queued.job_id)
    assert cancelled.phase == "cancelled"
    queued_attempt = store.get_attempt(cancelled.attempt_id)
    assert queued_attempt.failure is not None
    assert queued_attempt.failure.code == "cancelled"

    running = store.submit(segment("running"), profile())
    entered = threading.Event()
    def cooperative(plan, selected_profile, cancel_event) -> bytes:
        entered.set()
        assert cancel_event.wait(timeout=2)
        return wav_bytes()

    holder: list = []
    thread = threading.Thread(
        target=lambda: holder.append(store.execute(running.job_id, cooperative))
    )
    thread.start()
    assert entered.wait(timeout=2)
    store.cancel(running.job_id)
    thread.join(timeout=3)
    assert not thread.is_alive()
    terminal = holder[0]
    assert terminal.phase == "cancelled"
    attempt = store.get_attempt(terminal.attempt_id)
    assert attempt.raw_wav is None
    assert not list((tmp_path / "raw-wav").glob(f"{attempt.attempt_id}.*"))


def test_running_job_is_resumable_after_process_restart(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    queued = store.submit(segment(), profile())
    running = queued.model_copy(update={"phase": "running", "updated_at": store._now()})
    store._save_job(running)

    restarted = AttemptStore(tmp_path)
    recovered = restarted.get_job(queued.job_id)
    assert recovered.phase == "queued"
    assert recovered.recovered_after_restart is True
    complete = restarted.execute(recovered.job_id, success_generator)
    assert complete.phase == "completed"


def test_invalid_wav_is_reason_coded_and_never_persisted(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    failed_job = store.execute(
        store.submit(segment(), profile()).job_id,
        lambda *_: b"not a wav",
    )
    attempt = store.get_attempt(failed_job.attempt_id)
    assert failed_job.phase == "failed"
    assert attempt.failure is not None
    assert attempt.failure.code == "invalid_wav"
    assert attempt.failure.retryable is True
    assert not tuple((tmp_path / "raw-wav").glob("*.wav"))


def test_selective_retry_does_not_change_neighbor_attempts(tmp_path: Path) -> None:
    store = AttemptStore(tmp_path)
    left = store.execute(store.submit(segment("left"), profile()).job_id, success_generator)
    middle = store.execute(
        store.submit(segment("middle"), profile()).job_id,
        lambda *_: (_ for _ in ()).throw(RuntimeError("retry me")),
    )
    right = store.execute(store.submit(segment("right"), profile()).job_id, success_generator)
    left_before = store.get_attempt(left.attempt_id)
    right_before = store.get_attempt(right.attempt_id)

    replacement = store.execute(store.retry(middle.attempt_id).job_id, success_generator)
    assert replacement.phase == "completed"
    assert store.get_attempt(left.attempt_id) == left_before
    assert store.get_attempt(right.attempt_id) == right_before
    assert store.get_attempt(replacement.attempt_id).segment_id == "middle"
