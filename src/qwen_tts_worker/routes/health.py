"""Health-check endpoint distinguishing service, dependency, and model readiness.

``GET /health`` returns a three-tier report:

* **service** — is the HTTP server reachable?
* **dependencies** — are required backing services available?
* **model** — is a synthesis model loaded and ready for jobs?
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request

from qwen_tts_worker import __version__
from qwen_tts_worker.models.health import (
    DependencyCheck,
    DependencyStatus,
    HealthResponse,
    ModelStatus,
    ServiceStatus,
)

router = APIRouter()

# Module-level record of process start time for uptime calculation.
_process_started_at: float = time.monotonic()

# Module-level model status — mutated by the model lifecycle manager
# once implemented (qtw-2af.3). Starts as NONE because this issue
# deliberately does not load a model.
_current_model_status: ModelStatus = ModelStatus.NONE


def set_model_status(status: ModelStatus) -> None:
    """Update the model readiness reported by the health endpoint.

    Called by the model lifecycle manager when the model transitions
    between states. Thread-safe as long as the caller ensures it.

    Args:
        status: The new model status to report.
    """
    global _current_model_status
    _current_model_status = status


def _probe_dependencies() -> list[DependencyCheck]:
    """Run dependency probes and return their results.

    Each probe is a lightweight check that a required external service
    or resource is accessible. Probes must not throw — failures are
    recorded as ``UNAVAILABLE`` statuses.
    """
    deps: list[DependencyCheck] = []

    # --- Filesystem dependency ---
    try:
        probe_start = time.monotonic()
        # Check that the current working directory is readable/writable.
        import tempfile, os
        with tempfile.TemporaryDirectory() as td:
            test_file = os.path.join(td, ".healthcheck")
            with open(test_file, "w") as f:
                f.write("ok")
        latency = (time.monotonic() - probe_start) * 1000
        deps.append(
            DependencyCheck(
                name="filesystem",
                status=DependencyStatus.OK,
                latency_ms=round(latency, 2),
            )
        )
    except Exception:
        deps.append(
            DependencyCheck(
                name="filesystem",
                status=DependencyStatus.UNAVAILABLE,
                detail="Cannot write to filesystem.",
            )
        )

    return deps


def _compute_service_status(
    deps: list[DependencyCheck],
) -> ServiceStatus:
    """Derive the aggregate service status from dependency checks.

    * All OK → HEALTHY
    * At least one UNAVAILABLE → DEGRADED
    * All UNAVAILABLE → UNHEALTHY
    """
    if not deps:
        return ServiceStatus.HEALTHY
    unavailable = sum(1 for d in deps if d.status == DependencyStatus.UNAVAILABLE)
    if unavailable == 0:
        return ServiceStatus.HEALTHY
    if unavailable == len(deps):
        return ServiceStatus.UNHEALTHY
    return ServiceStatus.DEGRADED


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """Return a three-tier health report.

    The response distinguishes the HTTP service (always reachable when
    this handler executes), external dependencies, and model readiness.
    The service starts without a model loaded — model_ready will be
    ``none`` until the model lifecycle manager loads one.
    """
    deps = _probe_dependencies()
    service_status = _compute_service_status(deps)
    uptime = time.monotonic() - _process_started_at

    return HealthResponse(
        service=service_status,
        model=_current_model_status,
        dependencies=deps,
        uptime_seconds=round(uptime, 3),
        version=__version__,
    )
