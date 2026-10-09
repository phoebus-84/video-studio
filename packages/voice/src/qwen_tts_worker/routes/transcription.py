"""``POST /transcribe`` and ``GET /transcribe``: what a take says (avg-8hs.3)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from qwen_tts_worker.config import Settings
from qwen_tts_worker.transcription import TRANSCRIBE_MAX_SECONDS, TranscribeError, Transcriber

router = APIRouter()

_transcriber: Transcriber | None = None


def reset() -> None:
    """Forget the transcriber (tests: each application gets its own)."""
    global _transcriber
    _transcriber = None


def _get() -> Transcriber:
    global _transcriber
    if _transcriber is None:
        settings = Settings()
        _transcriber = Transcriber(settings.transcribe_model, fake=settings.tts_mode == "fake")
    return _transcriber


class TranscribeRequest(BaseModel):
    audio_path: str = Field(..., description="Absolute path to the take's audio.")
    language: str = Field(..., description="An ISO 639-1 code (it) or a language name (Italian).")


class HeardWord(BaseModel):
    text: str
    start: float
    end: float
    probability: float


class TranscribeResponse(BaseModel):
    text: str
    words: list[HeardWord]
    model: str
    language: str


@router.get("/transcribe")
async def transcriber_status() -> dict:
    transcriber = _get()
    return {"model": transcriber.model_id, "loaded": transcriber.loaded, "maxSeconds": TRANSCRIBE_MAX_SECONDS}


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    try:
        result = await run_in_threadpool(_get().transcribe, request.audio_path, request.language)
    except TranscribeError as error:
        status = 503 if error.code == "transcriber-failed" else 422
        raise HTTPException(status_code=status, detail=[{"msg": error.message, "type": error.code}]) from None
    return TranscribeResponse(**result)
