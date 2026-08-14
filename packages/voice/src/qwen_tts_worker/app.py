"""FastAPI application factory for the TTS worker.

The application is created by ``create_app()`` so that tests can
construct isolated instances without side effects. The production
entry point (``__main__``) calls this factory and passes the
result to uvicorn.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from qwen_tts_worker import __version__
from qwen_tts_worker.models.errors import ErrorDetail, ErrorEnvelope
from qwen_tts_worker.routes import api_router


class RequestBodyLimitMiddleware:
    """Buffer bounded JSON requests so chunked bodies cannot evade the limit."""

    def __init__(self, app: ASGIApp, maximum_bytes: int) -> None:
        self.app = app
        self.maximum_bytes = maximum_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers", [])).get(b"content-length")
        if declared is not None:
            try: declared_size = int(declared)
            except ValueError:
                await JSONResponse(status_code=400, content={"error": "Invalid Content-Length", "detail": []})(scope, receive, send)
                return
            if declared_size < 0:
                await JSONResponse(status_code=400, content={"error": "Invalid Content-Length", "detail": []})(scope, receive, send)
                return
            if declared_size > self.maximum_bytes:
                await self._reject(scope, receive, send, declared_size)
                return
        messages: list[Message] = []
        received = 0
        while True:
            message = await receive(); messages.append(message)
            if message["type"] == "http.disconnect": break
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.maximum_bytes:
                    await self._reject(scope, receive, send, received)
                    return
                if not message.get("more_body", False): break
        iterator = iter(messages)
        async def replay() -> Message:
            try: return next(iterator)
            except StopIteration: return {"type": "http.disconnect"}
        await self.app(scope, replay, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send, size: int) -> None:
        await JSONResponse(status_code=413, content={
            "error": "Request body exceeds local safety limit",
            "detail": [{"msg": f"received={size}, maximum={self.maximum_bytes}", "type": "request_too_large"}],
        })(scope, receive, send)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler.

    Performs startup and shutdown tasks:
    - Records process start time for uptime calculation.
    - Ensures runtime directories exist.
    - Drains in-flight requests during graceful shutdown.
    """
    from qwen_tts_worker.config import Settings
    from qwen_tts_worker.model_lifecycle import model_lifecycle

    app.state.started_at = time.monotonic()
    idle_task: asyncio.Task[None] | None = None
    settings = Settings()
    if settings.tts_mode == "fake":
        logging.getLogger("qwen-tts-worker").warning(
            "FAKE TTS MODE ENABLED: generated audio is a silent CI fixture and must not be published"
        )
    idle_timeout = settings.model_idle_timeout_seconds
    if idle_timeout is not None:
        async def unload_idle_model() -> None:
            interval = min(60.0, max(1.0, idle_timeout / 2.0))
            while True:
                await asyncio.sleep(interval)
                model_lifecycle.unload_if_idle(idle_timeout)

        idle_task = asyncio.create_task(unload_idle_model())
    try:
        yield
    finally:
        if idle_task is not None:
            idle_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await idle_task
        model_lifecycle.unload(wait=True)


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

    # --- Middleware: local request/body limits and request-id injection ---
    from qwen_tts_worker.config import Settings
    app.add_middleware(RequestBodyLimitMiddleware, maximum_bytes=Settings().max_request_body_bytes)

    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
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

    # Voice references, exact transcripts, consent records, and outputs are never
    # mounted as static files. Local clients receive explicit immutable paths.
    return app
