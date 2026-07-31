"""Synchronous compatibility synthesis route backed by Qwen3-TTS CustomVoice.

This endpoint remains the legacy compatibility surface while the durable job
API is implemented. Live mode is deliberately fail-closed: unavailable models,
unsupported controls, invalid speakers, and silent output are failures.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
import shutil
import tempfile
import time
import uuid
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator


router = APIRouter()
logger = logging.getLogger("qwen-tts-worker")
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CUSTOMVOICE_MODEL = PROJECT_ROOT / "models" / "qwen3-tts-1.7b-customvoice-8bit"
SPEAKER_ALIASES = {
    "default": "serena",
    "narrator": "serena",
    "girl": "vivian",
    "wolf": "uncle_fu",
    "woodcutter": "ryan",
    "grandmother": "serena",
}
BackendLanguage = Literal[
    "auto",
    "chinese",
    "english",
    "german",
    "italian",
    "portuguese",
    "spanish",
    "japanese",
    "korean",
    "french",
    "russian",
    "beijing_dialect",
    "sichuan_dialect",
]


class SynthesizeRequest(BaseModel):
    """Validated controls supported by the installed CustomVoice backend."""

    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = Field(default="serena", min_length=1, max_length=128)
    speed: float = Field(
        default=1.0,
        description="Reserved compatibility field; Qwen speed must be exactly 1.0.",
    )
    temperature: float = Field(default=0.7, gt=0.0, le=2.0)
    top_k: int = Field(default=50, ge=0, le=10_000)
    top_p: float = Field(default=1.0, gt=0.0, le=1.0)
    repetition_penalty: float = Field(default=1.05, ge=1.0, le=3.0)
    max_tokens: int = Field(default=1200, ge=1, le=8192)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    instruct: str | None = Field(default=None, max_length=768)
    language: BackendLanguage = "auto"
    voice_description: str | None = Field(
        default=None,
        description="Unsupported compatibility field; requires a VoiceDesign model.",
    )
    ref_audio: str | None = Field(
        default=None,
        description="Unsupported compatibility field; requires a Base voice-cloning model.",
    )

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be empty or whitespace-only")
        return value

    @field_validator("speed")
    @classmethod
    def supported_speed(cls, value: float) -> float:
        if value != 1.0:
            raise ValueError("Qwen3-TTS speed control is unsupported; speed must be 1.0")
        return value

    @model_validator(mode="after")
    def supported_model_profile(self) -> SynthesizeRequest:
        if self.voice_description is not None:
            raise ValueError(
                "voice_description is unsupported by the CustomVoice model; use a VoiceDesign endpoint"
            )
        if self.ref_audio is not None:
            raise ValueError(
                "ref_audio is unsupported by the CustomVoice model; use a Base voice-cloning endpoint"
            )
        return self


class SynthesisResult(BaseModel):
    """Result of a compatibility synthesis request."""

    job_id: str
    status: Literal["queued", "running", "completed", "failed"]
    text_hash: str
    duration_sec: float
    sample_rate: int
    num_samples: int
    num_channels: int
    provider_mode: Literal["live", "fake"]
    actual_speaker: str | None = None
    model_path: str | None = None
    wav_path: str | None = None
    wav_size_bytes: int | None = None
    created_at: str
    completed_at: str | None = None
    error: str | None = None


class SynthesizeResponse(BaseModel):
    """Response wrapping a terminal compatibility synthesis result."""

    ok: bool
    result: SynthesisResult


class SynthesisStatusResponse(BaseModel):
    """Status response for an in-memory compatibility job."""

    job_id: str
    status: str
    progress: float = 0.0
    result: SynthesisResult | None = None


class JobStore:
    """Simple in-memory job store, pending the durable job implementation."""

    def __init__(self) -> None:
        self._jobs: dict[str, SynthesisResult] = {}

    def create(self, result: SynthesisResult) -> None:
        self._jobs[result.job_id] = result

    def get(self, job_id: str) -> SynthesisResult | None:
        return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs: object) -> SynthesisResult | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        for key, value in kwargs.items():
            setattr(job, key, value)
        return job


_job_store = JobStore()


@dataclass(frozen=True)
class CustomVoiceModel:
    """Verified model profile and backend-discovered controls."""

    path: Path
    speakers: frozenset[str]
    languages: frozenset[str]


@dataclass(frozen=True)
class WavInfo:
    """Verified canonical live output metadata."""

    duration_seconds: float
    sample_rate: int
    num_samples: int
    channels: int
    sample_width_bytes: int
    rms_dbfs: float


def chunk_text(text: str, max_chars: int = 500) -> list[str]:
    """Split text at semantic punctuation without splitting words.

    The compatibility endpoint intentionally does not call this helper: computed
    chunks were previously discarded. Segmentation belongs to the planned
    preprocessing stage.
    """

    if len(text) <= max_chars:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > max_chars:
        window = remaining[:max_chars]
        split_at = max_chars
        for separator in (". ", "! ", "? ", "\n", "; ", ", "):
            index = window.rfind(separator)
            if index > max_chars // 2:
                split_at = index + len(separator)
                break
        else:
            space_index = window.rfind(" ")
            if space_index > 0:
                split_at = space_index + 1
        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].lstrip()
    if remaining.strip():
        chunks.append(remaining.strip())
    return chunks


def hash_text(text: str) -> str:
    """Stable short SHA-256 hash retained for compatibility metadata."""

    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def inspect_customvoice_model(model_path: str | Path) -> CustomVoiceModel:
    """Fail early unless a complete Qwen3-TTS CustomVoice checkpoint is present."""

    path = Path(model_path).expanduser().resolve()
    if not path.is_dir():
        raise FileNotFoundError(f"CustomVoice model directory not found: {path}")
    config_path = path / "config.json"
    weights_path = path / "model.safetensors"
    if not config_path.is_file():
        raise FileNotFoundError(f"CustomVoice config not found: {config_path}")
    if not weights_path.is_file() or weights_path.stat().st_size == 0:
        raise FileNotFoundError(f"CustomVoice weights not found or empty: {weights_path}")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot read CustomVoice model config: {exc}") from exc
    if config.get("model_type") != "qwen3_tts":
        raise RuntimeError(
            f"Expected Qwen3-TTS model_type, found {config.get('model_type')!r}"
        )
    if config.get("tts_model_type") != "custom_voice":
        raise RuntimeError(
            "The compatibility endpoint requires tts_model_type='custom_voice'; "
            f"found {config.get('tts_model_type')!r}"
        )
    talker = config.get("talker_config")
    if not isinstance(talker, dict):
        raise RuntimeError("CustomVoice config is missing talker_config")
    speaker_ids = talker.get("spk_id")
    language_ids = talker.get("codec_language_id")
    if not isinstance(speaker_ids, dict) or not speaker_ids:
        raise RuntimeError("CustomVoice config exposes no speakers")
    if not isinstance(language_ids, dict) or not language_ids:
        raise RuntimeError("CustomVoice config exposes no languages")
    return CustomVoiceModel(
        path=path,
        speakers=frozenset(str(name).lower() for name in speaker_ids),
        languages=frozenset({"auto", *(str(name).lower() for name in language_ids)}),
    )


def resolve_speaker(requested: str, model: CustomVoiceModel) -> str:
    """Resolve documented compatibility aliases and reject unknown speakers."""

    normalized = requested.strip().lower()
    speaker = SPEAKER_ALIASES.get(normalized, normalized)
    if speaker not in model.speakers:
        available = ", ".join(sorted(model.speakers))
        aliases = ", ".join(sorted(SPEAKER_ALIASES))
        raise ValueError(
            f"Unknown CustomVoice speaker {requested!r}; available speakers: {available}; "
            f"supported aliases: {aliases}"
        )
    return speaker


def validate_language(language: str, model: CustomVoiceModel) -> str:
    """Reject language values not discovered from the model config."""

    if language not in model.languages:
        available = ", ".join(sorted(model.languages))
        raise ValueError(f"Language {language!r} is not supported by this model: {available}")
    return language


def _seed_mlx(seed: int) -> None:
    """Apply the request seed immediately before stochastic generation."""

    import mlx.core as mx

    mx.random.seed(seed)


def _rms_dbfs(samples: array[int]) -> float:
    if not samples:
        return -120.0
    rms = math.sqrt(sum(int(value) ** 2 for value in samples) / len(samples))
    if rms <= 0:
        return -120.0
    return 20.0 * math.log10(rms / 32768.0)


def validate_live_wav(data: bytes) -> WavInfo:
    """Reject missing, malformed, non-canonical, empty, or silent live output."""

    if len(data) < 44:
        raise RuntimeError(f"Generated WAV is too small: {len(data)} bytes")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frame_count = wav.getnframes()
            compression = wav.getcomptype()
            raw = wav.readframes(frame_count)
    except (EOFError, wave.Error) as exc:
        raise RuntimeError(f"Generated output is not a valid WAV: {exc}") from exc
    if compression != "NONE":
        raise RuntimeError(f"Generated WAV must be uncompressed PCM, found {compression}")
    if channels != 1 or sample_width != 2 or sample_rate != 24_000:
        raise RuntimeError(
            "Generated WAV must be mono PCM16 at 24000 Hz; "
            f"found channels={channels}, width={sample_width}, rate={sample_rate}"
        )
    if frame_count <= 0 or not raw:
        raise RuntimeError("Generated WAV contains no audio frames")
    samples = array("h")
    samples.frombytes(raw)
    if os.sys.byteorder != "little":
        samples.byteswap()
    rms = _rms_dbfs(samples)
    if rms <= -50.0:
        raise RuntimeError(
            f"Generated WAV is silent or near-silent (RMS {rms:.2f} dBFS; threshold -50 dBFS)"
        )
    return WavInfo(
        duration_seconds=frame_count / sample_rate,
        sample_rate=sample_rate,
        num_samples=frame_count,
        channels=channels,
        sample_width_bytes=sample_width,
        rms_dbfs=rms,
    )


def synthesize_with_qwen(
    request: SynthesizeRequest,
    model: CustomVoiceModel,
    speaker: str,
) -> tuple[bytes, WavInfo]:
    """Map validated request controls exactly to mlx-audio 0.4.6."""

    from mlx_audio.tts.generate import generate_audio

    _seed_mlx(request.seed)
    temporary_dir = Path(tempfile.mkdtemp(prefix="qwen-tts-"))
    try:
        generate_audio(
            text=request.text,
            model=str(model.path),
            voice=speaker,
            instruct=request.instruct,
            speed=1.0,
            lang_code=request.language,
            temperature=request.temperature,
            top_k=request.top_k,
            top_p=request.top_p,
            repetition_penalty=request.repetition_penalty,
            max_tokens=request.max_tokens,
            split_pattern=None,
            output_path=str(temporary_dir),
            file_prefix="audio",
            audio_format="wav",
            join_audio=False,
            play=False,
            verbose=False,
            stream=False,
        )
        outputs = sorted(temporary_dir.glob("*.wav"))
        if len(outputs) != 1:
            raise RuntimeError(
                f"generate_audio must produce exactly one WAV, found {len(outputs)}"
            )
        data = outputs[0].read_bytes()
        return data, validate_live_wav(data)
    finally:
        shutil.rmtree(temporary_dir, ignore_errors=True)


def _generate_silent_wav(
    duration_sec: float,
    sample_rate: int = 24_000,
    num_channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    """Generate explicit fake-mode output; this is never a live fallback."""

    num_samples = max(1, int(duration_sec * sample_rate))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(num_channels)
        wav.setsampwidth(sample_width)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00" * num_samples * num_channels * sample_width)
    return buffer.getvalue()


def save_wav(data: bytes, output_dir: Path, filename: str) -> tuple[Path, int]:
    """Save already-validated WAV data to disk."""

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename
    output_path.write_bytes(data)
    return output_path, len(data)


def _provider_mode() -> Literal["live", "fake"]:
    value = os.environ.get("QTW_TTS_MODE", "live").strip().lower()
    if value not in {"live", "fake"}:
        raise RuntimeError("QTW_TTS_MODE must be explicitly set to 'live' or 'fake'")
    return value  # type: ignore[return-value]


def _model_path() -> Path:
    configured = os.environ.get("QTW_MODEL_PATH")
    if configured:
        return Path(configured).expanduser()
    models_dir = os.environ.get("QTW_MODELS_DIR")
    if models_dir:
        return Path(models_dir).expanduser() / DEFAULT_CUSTOMVOICE_MODEL.name
    return DEFAULT_CUSTOMVOICE_MODEL


@router.post(
    "/synthesize",
    response_model=SynthesizeResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
    """Run one compatibility synthesis request and return its terminal result."""

    text_hash = hash_text(request.text)
    job_id = f"tts-{uuid.uuid4().hex[:12]}"
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    mode: Literal["live", "fake"] = "live"
    result = SynthesisResult(
        job_id=job_id,
        status="queued",
        text_hash=text_hash,
        duration_sec=0.0,
        sample_rate=24_000,
        num_samples=0,
        num_channels=1,
        provider_mode=mode,
        created_at=created_at,
    )
    _job_store.create(result)

    try:
        mode = _provider_mode()
        result.provider_mode = mode
        result.status = "running"
        _job_store.update(job_id, provider_mode=mode, status="running")

        if mode == "fake":
            duration = max(0.1, len(request.text.split()) * 0.5)
            wav_data = _generate_silent_wav(duration)
            wav_info = WavInfo(
                duration_seconds=duration,
                sample_rate=24_000,
                num_samples=int(duration * 24_000),
                channels=1,
                sample_width_bytes=2,
                rms_dbfs=-120.0,
            )
            actual_speaker = request.voice
            selected_model_path = None
        else:
            model = inspect_customvoice_model(_model_path())
            actual_speaker = resolve_speaker(request.voice, model)
            validate_language(request.language, model)
            selected_model_path = str(model.path)
            wav_data, wav_info = synthesize_with_qwen(request, model, actual_speaker)

        voices_root = Path(
            os.environ.get(
                "QTW_VOICES_DIR",
                os.environ.get("TTS_VOICES_DIR", str(PROJECT_ROOT / "voices")),
            )
        ).expanduser()
        output_dir = voices_root / request.voice / "output"
        wav_path, wav_size = save_wav(wav_data, output_dir, f"{job_id}.wav")
        completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        result.status = "completed"
        result.actual_speaker = actual_speaker
        result.model_path = selected_model_path
        result.wav_path = str(wav_path.resolve())
        result.wav_size_bytes = wav_size
        result.duration_sec = round(wav_info.duration_seconds, 6)
        result.num_samples = wav_info.num_samples
        result.num_channels = wav_info.channels
        result.sample_rate = wav_info.sample_rate
        result.completed_at = completed_at
        _job_store.update(
            job_id,
            status="completed",
            actual_speaker=actual_speaker,
            model_path=selected_model_path,
            wav_path=result.wav_path,
            wav_size_bytes=wav_size,
            duration_sec=result.duration_sec,
            num_samples=result.num_samples,
            num_channels=result.num_channels,
            sample_rate=result.sample_rate,
            completed_at=completed_at,
        )
    except Exception as exc:
        logger.exception("Synthesis job %s failed", job_id)
        completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        result.status = "failed"
        result.error = f"{type(exc).__name__}: {exc}"
        result.completed_at = completed_at
        _job_store.update(
            job_id,
            status="failed",
            error=result.error,
            completed_at=completed_at,
        )

    return SynthesizeResponse(ok=result.status == "completed", result=result)


@router.get("/synthesize/{job_id}", response_model=SynthesisStatusResponse)
async def synthesis_status(job_id: str) -> SynthesisStatusResponse:
    """Check the status of an in-memory compatibility job."""

    job = _job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    terminal = job.status in {"completed", "failed"}
    progress = 1.0 if terminal else 0.5 if job.status == "running" else 0.0
    return SynthesisStatusResponse(
        job_id=job.job_id,
        status=job.status,
        progress=progress,
        result=job if terminal else None,
    )
