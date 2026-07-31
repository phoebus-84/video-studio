"""Typed configuration for the TTS worker service.

Settings are resolved from environment variables and .env files,
with sensible defaults for local development.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """TTS worker settings loaded from environment.

    Supports localhost TCP binding and optional Unix-domain socket binding.
    """

    model_config = SettingsConfigDict(
        env_prefix="QTW_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Network binding ---------------------------------------------------

    host: str = Field(
        default="127.0.0.1",
        description="IP address to bind the HTTP server to.",
    )

    port: int = Field(
        default=8000,
        ge=1,
        le=65535,
        description="TCP port to bind the HTTP server to.",
    )

    unix_socket: str | None = Field(
        default=None,
        description="Optional path to a Unix-domain socket for local-only binding. "
        "When set, the server binds to this socket instead of host:port.",
    )

    # --- Logging -----------------------------------------------------------

    log_level: Literal["debug", "info", "warning", "error", "critical"] = Field(
        default="info",
        description="Minimum log level for structured output.",
    )

    log_format: Literal["json", "console"] = Field(
        default="json",
        description="Output format for log records. 'json' emits newline-delimited "
        "JSON for machine consumption; 'console' emits coloured text for humans.",
    )

    # --- Synthesis provider -----------------------------------------------

    tts_mode: Literal["live", "fake"] = Field(
        default="live",
        description="Synthesis provider mode. 'fake' is an explicit CI-only mode; live failures never fall back to it.",
    )

    # --- Concurrency -------------------------------------------------------

    workers: int = Field(
        default=1,
        ge=1,
        description="Number of uvicorn worker processes. Use 1 for a single-worker "
        "service; increase only when the synthesis job queue supports concurrent work.",
    )

    # --- Shutdown ----------------------------------------------------------

    graceful_timeout: float = Field(
        default=30.0,
        ge=1.0,
        description="Maximum seconds to wait for in-flight requests to drain "
        "during graceful shutdown before forcing exit.",
    )

    # --- Paths -------------------------------------------------------------

    models_dir: Path = Field(
        default=Path("models"),
        description="Directory for downloaded TTS model files.",
    )

    model_path: Path | None = Field(
        default=None,
        description="Optional exact CustomVoice model directory; otherwise the installed profile under models_dir is used.",
    )

    voices_dir: Path = Field(
        default=Path("voices"),
        description="Directory for persisted voice profiles and embeddings.",
    )

    outputs_dir: Path = Field(
        default=Path("outputs"),
        description="Directory for synthesized WAV segment outputs.",
    )

    # --- Validation --------------------------------------------------------

    @model_validator(mode="after")
    def _ensure_directories(self) -> Settings:
        """Create runtime directories if they do not exist."""
        for d in (self.models_dir, self.voices_dir, self.outputs_dir):
            d.mkdir(parents=True, exist_ok=True)
        return self
