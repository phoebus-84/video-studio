"""``POST /align`` and ``GET /align``: forced alignment of a take (avg-8hs.2)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from qwen_tts_worker.alignment import ALIGN_MAX_SECONDS, AlignError, Aligner
from qwen_tts_worker.config import Settings

router = APIRouter()

_aligner: Aligner | None = None


def reset() -> None:
    """Forget the aligner (tests: each application gets its own)."""
    global _aligner
    _aligner = None


def _get() -> Aligner:
    global _aligner
    if _aligner is None:
        settings = Settings()
        _aligner = Aligner(settings.align_model, fake=settings.tts_mode == "fake")
    return _aligner


class AlignRequest(BaseModel):
    audio_path: str = Field(..., description="Absolute path to the take's audio.")
    text: str = Field(..., description="The text the audio says.")
    language: str = Field(..., description="An ISO 639-1 code (it) or a language name (Italian).")


class AlignedWord(BaseModel):
    text: str
    start: float
    end: float


class AlignResponse(BaseModel):
    words: list[AlignedWord]
    model: str
    language: str


@router.get("/align")
async def aligner_status() -> dict:
    aligner = _get()
    return {"model": aligner.model_id, "loaded": aligner.loaded, "maxSeconds": ALIGN_MAX_SECONDS}


@router.post("/align", response_model=AlignResponse)
async def align(request: AlignRequest) -> AlignResponse:
    try:
        result = await run_in_threadpool(_get().align, request.audio_path, request.text, request.language)
    except AlignError as error:
        status = 503 if error.code == "model-unavailable" else 422
        raise HTTPException(status_code=status, detail=[{"msg": error.message, "type": error.code}]) from None
    except Exception as error:  # the model itself failed: say so, in the envelope callers read
        raise HTTPException(status_code=500, detail=[{"msg": f"the aligner failed: {error}", "type": "aligner-failed"}]) from None
    return AlignResponse(**result)
