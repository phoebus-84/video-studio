"""Synthesis route — text-to-speech with chunking and WAV output."""

from __future__ import annotations

import hashlib
import io
import struct
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
    voice: str = Field(default="default", description="Voice profile name")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="Speech rate multiplier")
    sample_rate: int = Field(default=24000, ge=8000, le=48000, description="Output sample rate in Hz")
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

def generate_silent_wav(
    duration_sec: float,
    sample_rate: int = 24000,
    num_channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    """Generate a silent WAV buffer for testing / placeholder synthesis.

    In production, this is replaced by Qwen3-TTS model output.
    """
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
        sample_rate=request.sample_rate,
        num_samples=0,
        num_channels=1,
        created_at=created_at,
    )

    _job_store.create(result)

    # Synthesize (sync for now; async queue in production)
    try:
        result.status = "running"
        _job_store.update(job_id, status="running")

        # Generate placeholder WAV (real model in production)
        wav_data = generate_silent_wav(estimated_duration, request.sample_rate)
        output_dir = Path("voices") / request.voice / "output"
        filename = f"{job_id}.wav"

        wav_path, wav_size = save_wav(wav_data, output_dir, filename)

        result.status = "completed"
        result.wav_path = str(wav_path)
        result.wav_size_bytes = wav_size
        result.num_samples = int(estimated_duration * request.sample_rate)
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
