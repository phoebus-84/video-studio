"""Tests for structured logging configuration.

Covers:
- JSON format configuration.
- Console format configuration.
- Log level filtering.
- No exceptions during configuration.
"""

from __future__ import annotations

import logging

from qwen_tts_worker.logging_config import configure_logging


class TestLoggingConfiguration:
    def test_configure_json_logging(self) -> None:
        """Configuring JSON logging must not raise."""
        configure_logging("info", "json")
        logger = logging.getLogger("qwen-tts-worker.test")
        logger.info("json test message")
        # No assertion needed — the test passes if no exception is raised.

    def test_configure_console_logging(self) -> None:
        """Configuring console logging must not raise."""
        configure_logging("debug", "console")
        logger = logging.getLogger("qwen-tts-worker.test")
        logger.debug("console test message")

    def test_configure_warning_level(self) -> None:
        """Configuring at warning level must not raise."""
        configure_logging("warning", "json")
        logger = logging.getLogger("qwen-tts-worker.test")
        logger.info("this should be filtered")
        logger.warning("this should appear")

    def test_configure_error_level(self) -> None:
        """Configuring at error level must not raise."""
        configure_logging("error", "console")

    def test_reconfigure_does_not_duplicate_handlers(self) -> None:
        """Repeated configuration must not result in duplicate log lines."""
        configure_logging("info", "json")
        initial_count = len(logging.root.handlers)
        configure_logging("info", "json")
        configure_logging("info", "json")
        # Handlers are cleared and re-added, so count should match.
        assert len(logging.root.handlers) == initial_count
