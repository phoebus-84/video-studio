"""Consent-gated local Base-model voice enrollment and synthesis."""

from __future__ import annotations

import contextlib
import hashlib
import io
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from qwen_tts_worker.config import Settings
from qwen_tts_worker.model_lifecycle import model_lifecycle
from qwen_tts_worker.models.catalog import get_model_spec
from qwen_tts_worker.models.registry import InstallStatus, ModelEntry, ModelProfile, ModelRegistry, ModelSize
from qwen_tts_worker.models.voices import CloneEnrollmentRequest, SynthesisMode, VoiceProfile
from qwen_tts_worker.routes.synthesis import _generate_silent_wav, _seed_mlx, validate_live_wav
from qwen_tts_worker.voice_store import VoiceStore, VoiceStoreError


class CloneError(RuntimeError):
    pass


class CloneSynthesisRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    language: Literal["auto", "chinese", "english", "german", "italian", "portuguese", "spanish", "japanese", "korean", "french", "russian"] = "english"
    model_size: Literal["0.6B", "1.7B"] = "1.7B"
    temperature: float = Field(default=0.7, gt=0, le=2)
    top_k: int = Field(default=50, ge=0, le=10_000)
    top_p: float = Field(default=1.0, gt=0, le=1)
    repetition_penalty: float = Field(default=1.5, ge=1, le=3)
    max_tokens: int = Field(default=1200, ge=1, le=8192)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)

    @field_validator("text")
    @classmethod
    def text_has_speech(cls, value: str) -> str:
        if not value.strip(): raise ValueError("text must not be blank")
        return value


class CloneSynthesisResult(BaseModel):
    synthesis_id: UUID
    voice_id: UUID
    voice_revision_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    provider_mode: Literal["live", "fake"]
    model_size: str
    model_profile: Literal["base"] = "base"
    model_revision: str
    model_identity_sha256: str | None
    reference_audio_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    reference_text_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    seed: int
    wav_path: str
    wav_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    duration_seconds: float
    sample_rate: Literal[24000] = 24_000
    channels: Literal[1] = 1
    created_at: datetime
    warning: str | None = None


def enroll_clone(payload: CloneEnrollmentRequest, settings: Settings) -> VoiceProfile:
    source = Path(payload.reference_audio_path).expanduser().resolve()
    if not source.is_file(): raise CloneError(f"reference audio is not a regular file: {source}")
    if source.stat().st_size > 100_000_000: raise CloneError("reference audio exceeds 100 MB safety limit")
    temporary = Path(tempfile.mkdtemp(prefix="qtw-reference-"))
    try:
        canonical = temporary / "reference.wav"
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
             "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(canonical)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0: raise CloneError(f"FFmpeg cannot canonicalize reference: {result.stderr[-500:]}")
        data = canonical.read_bytes(); info = validate_live_wav(data)
        if not 3 <= info.duration_seconds <= 30:
            raise CloneError(f"reference duration must be 3-30 seconds; got {info.duration_seconds:.3f}")
        voice_id = uuid.uuid4(); relative = f"profiles/{voice_id}/reference.wav"
        text_hash = hashlib.sha256(payload.reference_text.encode("utf-8")).hexdigest()
        profile = VoiceProfile(
            id=voice_id, name=payload.name, mode=SynthesisMode.CLONE,
            reference_audio_path=relative, reference_audio_sha256=hashlib.sha256(data).hexdigest(),
            reference_duration_seconds=info.duration_seconds,
            reference_text=payload.reference_text, reference_text_sha256=text_hash,
            consent=payload.consent, language=payload.language,
        )
        return VoiceStore(settings.voices_dir).create(profile, data)
    except (OSError, subprocess.SubprocessError, VoiceStoreError) as exc:
        if isinstance(exc, CloneError): raise
        raise CloneError(f"cannot enroll reference: {exc}") from exc
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def synthesize_clone(voice_id: UUID, request: CloneSynthesisRequest, settings: Settings) -> CloneSynthesisResult:
    store = VoiceStore(settings.voices_dir)
    try: profile = store.get(voice_id); reference = store.reference_path(profile)
    except VoiceStoreError as exc: raise CloneError(str(exc)) from exc
    if profile.mode != SynthesisMode.CLONE: raise CloneError("voice profile is not a clone")
    reference_data = reference.read_bytes()
    if hashlib.sha256(reference_data).hexdigest() != profile.reference_audio_sha256:
        raise CloneError("reference audio integrity mismatch")
    spec = get_model_spec(request.model_size, "base")
    mode = settings.tts_mode; started = time.monotonic(); model_identity = None
    if mode == "live":
        registry = ModelRegistry(settings.models_dir)
        report = registry.validate_directory(ModelEntry(ModelSize(request.model_size), ModelProfile.BASE))
        if report.status != InstallStatus.COMPLETE or not report.verified:
            raise CloneError(
                f"verified {request.model_size} Base model is required; install with "
                f"python -m qwen_tts_worker.cli {request.model_size} --profile base"
            )
    if mode == "fake":
        data = _generate_silent_wav(max(0.25, len(request.text.split()) / 2.5))
        warning = "FAKE TTS MODE ENABLED: generated audio is a silent CI fixture and must not be published"
    else:
        from mlx_audio.tts.generate import generate_audio
        _seed_mlx(request.seed)
        temporary = Path(tempfile.mkdtemp(prefix="qtw-clone-"))
        try:
            with model_lifecycle.acquire(spec.path_under(settings.models_dir)) as loaded:
                model_identity = loaded.identity_sha256
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    generate_audio(
                        text=request.text, model=loaded.instance,
                        ref_audio=str(reference), ref_text=profile.reference_text,
                        lang_code=request.language, temperature=request.temperature,
                        top_k=request.top_k, top_p=request.top_p,
                        repetition_penalty=request.repetition_penalty,
                        max_tokens=request.max_tokens, split_pattern=None,
                        output_path=str(temporary), file_prefix="clone", audio_format="wav",
                        join_audio=False, play=False, verbose=False, stream=False,
                    )
                outputs = list(temporary.glob("*.wav"))
                if len(outputs) != 1: raise CloneError(f"Base model produced {len(outputs)} WAV files; expected one")
                data = outputs[0].read_bytes(); validate_live_wav(data)
            model_lifecycle.record_synthesis(time.monotonic() - started)
        finally:
            shutil.rmtree(temporary, ignore_errors=True)
        warning = None
    info = validate_live_wav(data) if mode == "live" else None
    output_dir = settings.outputs_dir / "voices" / str(voice_id); output_dir.mkdir(parents=True, exist_ok=True)
    synthesis_id = uuid.uuid4(); destination = output_dir / f"{synthesis_id}.wav"
    with destination.open("xb") as handle:
        handle.write(data); handle.flush(); os.fsync(handle.fileno())
    return CloneSynthesisResult(
        synthesis_id=synthesis_id, voice_id=voice_id,
        voice_revision_sha256=profile.revision_sha256, provider_mode=mode,
        model_size=request.model_size, model_revision=spec.revision,
        model_identity_sha256=model_identity,
        reference_audio_sha256=profile.reference_audio_sha256,
        reference_text_sha256=profile.reference_text_sha256,
        seed=request.seed, wav_path=str(destination), wav_sha256=hashlib.sha256(data).hexdigest(),
        duration_seconds=info.duration_seconds if info else max(0.25, len(request.text.split()) / 2.5),
        created_at=datetime.now(timezone.utc), warning=warning,
    )
