"""Tests for the health endpoint.

Covers:
- Service health (always reachable).
- Dependency health (filesystem probe).
- Model readiness (starts as NONE — no model loaded).
- Response shape matches the HealthResponse model.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from qwen_tts_worker.models.health import ModelStatus, ServiceStatus


class TestHealthEndpoint:
    """Tests for GET /health."""

    def test_health_returns_200(self, client: TestClient) -> None:
        """The health endpoint must respond with 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_service_field(self, client: TestClient) -> None:
        """The health response must include a 'service' field with a known status."""
        response = client.get("/health")
        data = response.json()
        assert "service" in data
        assert data["service"] in {s.value for s in ServiceStatus}

    def test_health_model_starts_none(self, client: TestClient) -> None:
        """Model readiness must be 'none' because the service starts without a model."""
        response = client.get("/health")
        data = response.json()
        assert data["model"] == ModelStatus.NONE.value

    def test_health_includes_dependencies(self, client: TestClient) -> None:
        """The health response must include dependency checks."""
        response = client.get("/health")
        data = response.json()
        assert "dependencies" in data
        assert isinstance(data["dependencies"], list)
        for dep in data["dependencies"]:
            assert "name" in dep
            assert "status" in dep

    def test_health_includes_uptime(self, client: TestClient) -> None:
        """Uptime must be a non-negative float."""
        response = client.get("/health")
        data = response.json()
        assert "uptime_seconds" in data
        assert isinstance(data["uptime_seconds"], float)
        assert data["uptime_seconds"] >= 0.0

    def test_health_includes_version(self, client: TestClient) -> None:
        """The health response must include the running version."""
        response = client.get("/health")
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0

    def test_health_includes_timestamp(self, client: TestClient) -> None:
        """The health response must include a UTC timestamp."""
        response = client.get("/health")
        data = response.json()
        assert "timestamp" in data
        # Should be an ISO-formatted datetime string
        assert "T" in data["timestamp"] or " " in data["timestamp"]

    def test_health_service_determines_overall_status(self, client: TestClient) -> None:
        """Service status must be one of the known enum values."""
        response = client.get("/health")
        data = response.json()
        assert data["service"] in {"healthy", "degraded", "unhealthy"}

    def test_multiple_health_requests_consistent(self, client: TestClient) -> None:
        """Successive health requests must not fail or drift."""
        for _ in range(5):
            response = client.get("/health")
            assert response.status_code == 200
            assert response.json()["model"] == "none"
