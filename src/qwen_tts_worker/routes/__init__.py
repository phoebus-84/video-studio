"""Route registration — imported by the FastAPI application factory.

Routes are organised by domain (health, voices, jobs) so that each
module encapsulates its own path operations and dependencies.
"""

from __future__ import annotations

from fastapi import APIRouter

from qwen_tts_worker.routes.health import router as health_router
from qwen_tts_worker.routes.voices import router as voices_router
from qwen_tts_worker.routes.models import router as models_router
from qwen_tts_worker.routes.synthesis import router as synthesis_router
from qwen_tts_worker.routes.attempts import router as attempts_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(voices_router, tags=["voices"])
api_router.include_router(models_router, tags=["models"])
api_router.include_router(synthesis_router, tags=["synthesis"])
api_router.include_router(attempts_router, tags=["attempts"])
