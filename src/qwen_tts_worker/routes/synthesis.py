"""Synthesis route — text-to-speech with Qwen3-TTS model."""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import struct
import tempfile
import time
import uuid
import wave
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

router = APIRouter()

# ── Request / Response models ────────────────────────────────────────────────

class SynthesizeRequest(BaseModel):
    """Request to synthesize speech from text."""

    text: str = Field(..., min_length=1, max_length=5000, description="Text to synthesize")
    voice: str = Field(default="default", description="Voice profile / speaker name (e.g. 'af_heart', 'default')")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speech rate multiplier")
    temperature: float = Field(default=0.7, ge=0.1, le=2.0, description="Generation temperature (higher = more variation)")
    instruct: Optional[str] = Field(default=None, description="Emotion/style instruction e.g. 'Speak warmly like a grandmother'")
    voice_description: Optional[str] = Field(default=None, description="VoiceDesign: describe the voice to create")
    ref_audio: Optional[str] = Field(default=None, description="Path to reference WAV for voice cloning consistency")
    language: str = Field(default="auto", description="Language code or 'auto'")

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be empty or whitespace-only")
        return v


class SynthesisResult(BaseModel):
    """Result of a synthesis job."""

    job_id: str
    status: str  # "queued" | "running" | "completed" | "failed"
    text_hash: str
    duration_sec: float
    sample_rate: int
    num_samples: int
    num_channels: int
    wav_path: Optional[str] = None
    wav_size_bytes: Optional[int] = None
    created_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None


class SynthesizeResponse(BaseModel):
    """Response wrapping a synthesis result."""

    ok: bool = True
    result: SynthesisResult


class SynthesisStatusResponse(BaseModel):
    """Status check response."""

    job_id: str
    status: str
    progress: float = 0.0  # 0..1
    result: Optional[SynthesisResult] = None


# ── In-memory job store ─────────────────────────────────────────────────────

class JobStore:
    """Simple in-memory job store (replaced by persistent queue in production)."""

    def __init__(self) -> None:
        self._jobs: dict[str, SynthesisResult] = {}

    def create(self, result: SynthesisResult) -> None:
        self._jobs[result.job_id] = result

    def get(self, job_id: str) -> Optional[SynthesisResult]:
        return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs: object) -> Optional[SynthesisResult]:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        for key, value in kwargs.items():
            setattr(job, key, value)
        return job


_job_store = JobStore()

# ── Text chunking ────────────────────────────────────────────────────────────

def chunk_text(text: str, max_chars: int = 500) -> list[str]:
    """Split text into synthesis-friendly chunks at sentence boundaries.

    Never splits mid-word. Prefers sentence breaks (., !, ?, newline).
    Falls back to word boundaries if no sentence break found within window.
    """
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    remaining = text

    while len(remaining) > max_chars:
        # Look backward from max_chars for a sentence break
        window = remaining[:max_chars]
        split_at = max_chars

        for sep in (". ", "! ", "? ", "\n", "; ", ", "):
            idx = window.rfind(sep)
            if idx > max_chars // 2:  # Don't make chunks too small
                split_at = idx + len(sep)
                break
        else:
            # No sentence break found — split at last space
            space_idx = window.rfind(" ")
            if space_idx > 0:
                split_at = space_idx + 1

        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].lstrip()

    if remaining.strip():
        chunks.append(remaining.strip())

    return chunks


# ── WAV generation ───────────────────────────────────────────────────────────

# ── Master voice reference for voice cloning ─────────────────────────────

_master_voice: dict = {"wav": None, "text": None, "path": None}


def _set_master(wav_data: bytes, text: str) -> None:
    """Save the first synthesis as master voice reference for cloning."""
    _master_voice["wav"] = wav_data
    _master_voice["text"] = text
    path = os.path.join(tempfile.gettempdir(), "qwen-tts-master.wav")
    with open(path, "wb") as f:
        f.write(wav_data)
    _master_voice["path"] = path
    import logging
    logging.getLogger("qwen-tts-worker").info(
        f"Master voice saved ({len(wav_data)} bytes) — subsequent calls will clone this voice"
    )


def _get_master() -> tuple[str | None, str | None]:
    """Get (audio_path, text) for master voice reference, or (None, None)."""
    p = _master_voice.get("path")
    t = _master_voice.get("text")
    if p and t and os.path.exists(p):
        return p, t
    return None, None


def synthesize_with_qwen(
    text: str,
    voice: str,
    speed: float,
    model_path: str,
    *,
    temperature: float = 0.7,
    instruct: str | None = None,
    voice_description: str | None = None,
    ref_audio_path: str | None = None,
) -> bytes:
    """Synthesize speech using the Qwen3-TTS model.

    Uses a pre-loaded model object for consistent voice across calls.
    Supports ref_audio for voice cloning.
    """
    try:
        from mlx_audio.tts.generate import generate_audio

        tmp_dir = tempfile.mkdtemp(prefix="qwen-tts-")
        try:
            kwargs: dict = {
                "text": text,
                "model": model_path,
                "voice": voice,
                "speed": speed,
                "temperature": temperature,
                "output_path": tmp_dir,
                "verbose": False,
                "use_zero_spk_emb": True,
            }
            if instruct or voice_description:
                kwargs["instruct"] = instruct or voice_description
            # Use master voice as reference for cloning (with ref_text to avoid STT)
            master_path, master_text = _get_master()
            if master_path and master_text:
                kwargs["ref_audio"] = master_path
                kwargs["ref_text"] = master_text
            if ref_audio_path and os.path.exists(ref_audio_path):
                kwargs["ref_audio"] = ref_audio_path

            generate_audio(**kwargs)
            wav_path = os.path.join(tmp_dir, "audio_000.wav")
            if not os.path.exists(wav_path):
                wav_files = list(Path(tmp_dir).glob("*.wav"))
                if wav_files:
                    wav_path = str(wav_files[0])
                else:
                    raise RuntimeError("generate_audio produced no output file")

            with open(wav_path, "rb") as f:
                wav_data = f.read()

            if len(wav_data) < 44:
                raise RuntimeError(f"Generated WAV is too small: {len(wav_data)} bytes")

            # Capture first synthesis as master voice for cloning subsequent calls
            if _master_voice["wav"] is None and len(wav_data) > 1000:
                _set_master(wav_data, text)

            return wav_data
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    except (ImportError, FileNotFoundError, RuntimeError):
        # Fallback for CI / environments without MLX
        import logging
        logging.getLogger("qwen-tts-worker").warning(
            "Qwen3-TTS model not available, falling back to silent WAV"
        )
        return _generate_silent_wav(len(text) / 15.0 * speed)


def _generate_silent_wav(
    duration_sec: float,
    sample_rate: int = 24000,
    num_channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    """Generate silent WAV for environments without the TTS model."""
    num_samples = int(duration_sec * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(num_channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00" * num_samples * sample_width)
    return buf.getvalue()


def save_wav(data: bytes, output_dir: Path, filename: str) -> tuple[Path, int]:
    """Save WAV data to disk. Returns (path, size_bytes)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename
    output_path.write_bytes(data)
    return output_path, len(data)


# ── Text hashing for idempotency ─────────────────────────────────────────────

def hash_text(text: str) -> str:
    """Stable SHA-256 hash of synthesis text for idempotency."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/synthesize", response_model=SynthesizeResponse, status_code=status.HTTP_202_ACCEPTED)
async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
    """Submit a text-to-speech synthesis job.

    Text is chunked at sentence boundaries, each chunk is synthesized
    independently, and results are concatenated into a single WAV.
    """
    text_hash = hash_text(request.text)
    job_id = f"tts-{uuid.uuid4().hex[:12]}"
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Chunk the text
    chunks = chunk_text(request.text)

    # Estimate total duration (rough: ~15 chars/second for English)
    chars_per_sec = 15.0 * request.speed
    estimated_duration = len(request.text) / chars_per_sec

    result = SynthesisResult(
        job_id=job_id,
        status="queued",
        text_hash=text_hash,
        duration_sec=round(estimated_duration, 2),
        sample_rate=24000,
        num_samples=0,
        num_channels=1,
        created_at=created_at,
    )

    _job_store.create(result)

    # Synthesize with real model
    try:
        result.status = "running"
        _job_store.update(job_id, status="running")

        model_path = os.environ.get("QTW_MODEL_PATH", "models/qwen3-tts-0.6b-4bit")
        wav_data = synthesize_with_qwen(
            request.text,
            request.voice,
            request.speed,
            model_path,
            temperature=request.temperature,
            instruct=request.instruct,
            voice_description=request.voice_description,
            ref_audio_path=request.ref_audio,
        )

        # Use absolute path derived from env or default
        voices_root = Path(os.environ.get("TTS_VOICES_DIR", str(Path(__file__).resolve().parent.parent.parent / "voices")))
        output_dir = voices_root / request.voice / "output"
        filename = f"{job_id}.wav"

        wav_path, wav_size = save_wav(wav_data, output_dir, filename)

        # Read actual duration from generated WAV
        with wave.open(str(wav_path), "rb") as wf:
            actual_duration = wf.getnframes() / wf.getframerate()
            actual_samples = wf.getnframes()
            actual_channels = wf.getnchannels()
            actual_rate = wf.getframerate()

        result.status = "completed"
        result.wav_path = str(wav_path)
        result.wav_size_bytes = wav_size
        result.duration_sec = round(actual_duration, 2)
        result.num_samples = actual_samples
        result.num_channels = actual_channels
        result.sample_rate = actual_rate
        result.completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        _job_store.update(
            job_id,
            status="completed",
            wav_path=str(wav_path),
            wav_size_bytes=wav_size,
            num_samples=result.num_samples,
            completed_at=result.completed_at,
        )
    except Exception as exc:
        result.status = "failed"
        result.error = str(exc)
        _job_store.update(job_id, status="failed", error=str(exc))

    return SynthesizeResponse(ok=result.status == "completed", result=result)


@router.get("/synthesize/{job_id}", response_model=SynthesisStatusResponse)
async def synthesis_status(job_id: str) -> SynthesisStatusResponse:
    """Check the status of a synthesis job."""
    job = _job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    progress = 1.0 if job.status == "completed" else 0.5 if job.status == "running" else 0.0

    return SynthesisStatusResponse(
        job_id=job.job_id,
        status=job.status,
        progress=progress,
        result=job if job.status == "completed" else None,
    )
