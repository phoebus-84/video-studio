"""Structured logging configuration for the TTS worker.

Emits machine-readable JSON logs by default, with optional console output
for development. All log records include a timestamp, service name,
and log level for ingestion into monitoring systems.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def configure_logging(log_level: str, log_format: str) -> None:
    """Configure structlog for the worker process.

    Args:
        log_level: Minimum log level (debug, info, warning, error, critical).
        log_format: Output format — ``"json"`` for machine-readable logs
            or ``"console"`` for human-readable coloured output.
    """
    level = getattr(logging, log_level.upper(), logging.INFO)

    # Clear any pre-existing handlers from the root logger.
    root = logging.getLogger()
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    # Shared set of structlog processors for all formats.
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if log_format == "json":
        processors = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    else:
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(
                colors=True,
                exception_formatter=structlog.dev.rich_traceback,
            ),
        ]

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Also configure the standard library logging to match.
    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(level)
    # Use a minimal formatter — structlog handles structured output.
    handler.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(handler)
    root.setLevel(level)

    # Silence noisy third-party loggers.
    for noisy in ("uvicorn.access", "uvicorn.error"):
        logging.getLogger(noisy).handlers = [handler]
