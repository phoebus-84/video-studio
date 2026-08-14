"""Health-check models distinguishing service, dependency, and model readiness.

The three-tier health model allows operators and upstream consumers to
determine whether the worker is reachable (service), whether its
dependencies are available (dependency), and whether a synthesis model
is loaded and ready for jobs (model).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class ServiceStatus(str, Enum):
    """Overall service liveness."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class DependencyStatus(str, Enum):
    """Status of a checked external dependency."""

    OK = "ok"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


class ModelStatus(str, Enum):
    """Synthesis model readiness."""

    NONE = "none"
    """No model is loaded."""
    LOADING = "loading"
    """A model is currently being loaded."""
    READY = "ready"
    """A model is loaded and accepting synthesis jobs."""
    ERROR = "error"
    """Model loading failed with an error."""


class DependencyCheck(BaseModel):
    """Result of a single dependency probe."""

    name: str = Field(..., description="Human-readable dependency name.")
    status: DependencyStatus = Field(..., description="Current dependency status.")
    detail: str | None = Field(
        default=None,
        description="Additional diagnostic information when status is not ok.",
    )
    latency_ms: float | None = Field(
        default=None,
        description="Round-trip latency of the probe in milliseconds.",
    )


class HealthResponse(BaseModel):
    """Aggregated health report returned by ``GET /health``."""

    service: ServiceStatus = Field(..., description="Overall service health.")

    model: ModelStatus = Field(
        default=ModelStatus.NONE,
        description="Current synthesis model readiness.",
    )

    dependencies: list[DependencyCheck] = Field(
        default_factory=list,
        description="Results of individual dependency probes.",
    )

    uptime_seconds: float = Field(
        ...,
        ge=0.0,
        description="Seconds since the worker process started.",
    )

    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp when this health report was generated.",
    )

    version: str = Field(
        ...,
        description="Running worker version string.",
    )
