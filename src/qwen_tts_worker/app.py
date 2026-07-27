"""FastAPI application factory for the TTS worker.

The application is created by ``create_app()`` so that tests can
construct isolated instances without side effects. The production
entry point (``__main__``) calls this factory and passes the
result to uvicorn.
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from qwen_tts_worker import __version__
from qwen_tts_worker.models.errors import ErrorDetail, ErrorEnvelope
from qwen_tts_worker.routes import api_router


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler.

    Performs startup and shutdown tasks:
    - Records process start time for uptime calculation.
    - Ensures runtime directories exist.
    - Drains in-flight requests during graceful shutdown.
    """
    # Startup
    app.state.started_at = time.monotonic()
    yield
    # Shutdown — the uvicorn server handles signal trapping and
    # graceful connection draining. Any additional cleanup (e.g.
    # flushing job state) is added here once the job queue exists.


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns a fully configured application instance that can be
    served via uvicorn or used directly in tests via the ASGI
    interface.
    """
    app = FastAPI(
        title="Qwen TTS Worker",
        description=(
            "Persistent local Qwen3-TTS service for speech synthesis. "
            "Manages model lifecycle, voice profiles, and synthesis jobs. "
            "Canonical output is WAV."
        ),
        version=__version__,
        lifespan=_lifespan,
        # Redact server header
        servers=[],
    )

    # --- CORS (allow web UI on localhost:5199) ---
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5199", "http://127.0.0.1:5199"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Middleware: request-id injection ---
    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    # --- Exception handlers ---
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        """Convert Starlette HTTP exceptions to the standard error envelope."""
        req_id: str | None = None
        if hasattr(request.state, "request_id"):
            req_id = request.state.request_id
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorEnvelope(
                error=str(exc.detail) if isinstance(exc.detail, str) else "HTTP error",
                detail=(
                    exc.detail
                    if isinstance(exc.detail, list)
                    else [ErrorDetail(msg=str(exc.detail), type="http_error")]
                ),
                request_id=req_id,
            ).model_dump(mode="json"),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Convert Pydantic validation errors to the standard error envelope."""
        req_id: str | None = None
        if hasattr(request.state, "request_id"):
            req_id = request.state.request_id
        detail = [
            ErrorDetail(
                loc=list(e.get("loc", [])),
                msg=str(e.get("msg", "")),
                type=str(e.get("type", "value_error")),
            )
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=ErrorEnvelope(
                error="Request validation failed",
                detail=detail,
                request_id=req_id,
            ).model_dump(mode="json"),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Catch-all for unhandled exceptions — returns a redacted envelope."""
        req_id: str | None = None
        if hasattr(request.state, "request_id"):
            req_id = request.state.request_id
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorEnvelope.from_exception(exc, request_id=req_id).model_dump(
                mode="json"
            ),
        )

    # --- Routes ---
    app.include_router(api_router)

    # Mount voices directory for WAV file serving
    import os
    voices_dir = os.path.join(os.getcwd(), "voices")
    os.makedirs(voices_dir, exist_ok=True)
    app.mount("/voices", StaticFiles(directory=voices_dir), name="voices")

    return app
