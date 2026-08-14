"""Entry point for the TTS worker service.

Usage::

    python -m qwen_tts_worker
    qwen-tts-worker           # after pip install
"""

from __future__ import annotations

import signal
import sys

import uvicorn

from qwen_tts_worker.config import Settings
from qwen_tts_worker.logging_config import configure_logging


def main() -> None:
    """Parse settings, configure logging, and start the uvicorn server.

    Handles SIGTERM and SIGINT for graceful shutdown. The server
    starts without loading a TTS model — model readiness is a
    separate lifecycle phase managed by the model registry.
    """
    settings = Settings()

    # Configure structured logging before anything else.
    configure_logging(settings.log_level, settings.log_format)

    # Build uvicorn config from typed settings.
    config_kwargs: dict = {
        "host": settings.host,
        "port": settings.port,
        "log_level": settings.log_level,
        "workers": settings.workers,
        "timeout_graceful_shutdown": int(settings.graceful_timeout),
        "access_log": settings.log_level == "debug",
    }

    if settings.unix_socket:
        config_kwargs["uds"] = settings.unix_socket
        # When using a Unix socket, host/port are irrelevant.
        del config_kwargs["host"]
        del config_kwargs["port"]

    config = uvicorn.Config(
        "qwen_tts_worker.app:create_app",
        factory=True,
        **config_kwargs,
    )
    server = uvicorn.Server(config)

    # Wire signal handlers for graceful shutdown.
    _setup_signal_handlers(server)

    server.run()


def _setup_signal_handlers(server: uvicorn.Server) -> None:
    """Install signal handlers that trigger graceful shutdown.

    On SIGTERM or SIGINT, uvicorn closes the listening socket and
    waits for in-flight requests to drain (up to ``graceful_timeout``).
    """

    def handle_exit(signum: int, frame: object) -> None:
        signame = signal.Signals(signum).name
        sys.stderr.write(f"\n[{signame}] Initiating graceful shutdown...\n")
        server.should_exit = True

    signal.signal(signal.SIGTERM, handle_exit)
    signal.signal(signal.SIGINT, handle_exit)


if __name__ == "__main__":
    main()
