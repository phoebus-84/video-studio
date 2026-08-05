"""Typed configuration for the TTS worker service.

Settings are resolved from environment variables and .env files,
with sensible defaults for local development.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
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

    model_idle_timeout_seconds: float | None = Field(
        default=None,
        ge=1.0,
        description="Unload an idle warm model after this many seconds; disabled when unset.",
    )

    # --- Concurrency -------------------------------------------------------

    workers: Literal[1] = Field(
        default=1,
        description="Exactly one process owns the warm MLX lifecycle.",
    )

    max_concurrent_attempt_jobs: int = Field(
        default=1,
        ge=1,
        le=4,
        description="Maximum durable synthesis jobs allowed in running state.",
    )

    minimum_free_disk_bytes: int = Field(
        default=536_870_912,
        ge=0,
        description="Block job submission/execution when attempt storage has less free space.",
    )

    max_request_body_bytes: int = Field(
        default=2_000_000,
        ge=1024,
        le=100_000_000,
        description="Reject declared HTTP request bodies larger than this local safety limit.",
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

    attempt_store_dir: Path | None = Field(
        default=None,
        description="Durable attempt/job root; defaults to outputs_dir/attempt-store.",
    )

    attempt_max_retries: int = Field(
        default=2,
        ge=0,
        le=10,
        description="Maximum reason-coded retries after the initial synthesis attempt.",
    )

    attempt_retry_seed_step: int = Field(
        default=1,
        ge=1,
        le=1_000_000,
        description="Deterministic seed increment for each retry.",
    )

    # --- Validation --------------------------------------------------------

    @field_validator("host")
    @classmethod
    def _loopback_only(cls, value: str) -> str:
        """Refuse remote exposure because the local API has no authentication."""
        import ipaddress

        normalized = value.strip().lower()
        if normalized == "localhost":
            return value
        try:
            if ipaddress.ip_address(normalized).is_loopback:
                return value
        except ValueError:
            pass
        raise ValueError("QTW_HOST must be an explicit loopback address; remote binding is unsupported")

    @model_validator(mode="after")
    def _ensure_directories(self) -> Settings:
        """Create runtime directories if they do not exist."""
        directories = [self.models_dir, self.voices_dir, self.outputs_dir]
        if self.attempt_store_dir is not None:
            directories.append(self.attempt_store_dir)
        private_directories = {self.voices_dir, self.outputs_dir}
        if self.attempt_store_dir is not None:
            private_directories.add(self.attempt_store_dir)
        for directory in directories:
            existed = directory.exists()
            directory.mkdir(parents=True, exist_ok=True)
            if not existed and directory in private_directories:
                directory.chmod(0o700)
        return self
