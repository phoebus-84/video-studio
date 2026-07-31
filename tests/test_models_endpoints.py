"""Integration tests for the model registry endpoints.

Covers:
- GET /models lists all known combinations.
- GET /models/{size}/{profile} returns status for one entry.
- 404 for unsupported combinations.
- GET /models/diagnostics returns dependency probes.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


class TestModelsEndpoint:
    """Tests for GET /models."""

    def test_list_models_returns_200(self, client: TestClient) -> None:
        response = client.get("/models")
        assert response.status_code == 200

    def test_list_models_returns_six_entries(self, client: TestClient) -> None:
        """There must be exactly 6 known model entries (2 sizes × 3 profiles)."""
        response = client.get("/models")
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 6

    def test_each_entry_has_required_fields(self, client: TestClient) -> None:
        response = client.get("/models")
        for entry in response.json():
            assert "size" in entry
            assert "profile" in entry
            assert "status" in entry
            assert "path" in entry
            # status must be a known value
            assert entry["status"] in {"not_installed", "partial", "complete", "corrupt"}

    def test_all_starts_not_installed(self, client: TestClient) -> None:
        """Without actual model files, every entry must report NOT_INSTALLED."""
        response = client.get("/models")
        for entry in response.json():
            assert entry["status"] == "not_installed", \
                f"{entry['size']}/{entry['profile']} should be not_installed"

    def test_no_unsupported_combinations_listed(self, client: TestClient) -> None:
        """The registry must not list any unsupported size/profile."""
        response = client.get("/models")
        seen = {(e["size"], e["profile"]) for e in response.json()}
        # Every seen combination must be in the known set
        from qwen_tts_worker.models.registry import ModelSize, ModelProfile

        for size_str, profile_str in seen:
            assert ModelSize(size_str) in ModelSize
            assert ModelProfile(profile_str) in ModelProfile

    def test_all_sizes_and_profiles_present(self, client: TestClient) -> None:
        """Every known size/profile must appear in the list."""
        response = client.get("/models")
        entries = response.json()
        sizes = sorted({e["size"] for e in entries})
        profiles = sorted({e["profile"] for e in entries})
        assert sizes == sorted(["0.6B", "1.7B"])
        assert profiles == sorted(["custom_voice", "voice_design", "base"])


class TestGetModelBySizeProfile:
    """Tests for GET /models/{size}/{profile}."""

    def test_valid_combination_returns_200(self, client: TestClient) -> None:
        response = client.get("/models/0.6B/base")
        assert response.status_code == 200
        data = response.json()
        assert data["size"] == "0.6B"
        assert data["profile"] == "base"

    def test_all_valid_combinations_return_200(self, client: TestClient) -> None:
        """All 6 combinations must return 200."""
        combinations = [
            ("0.6B", "custom_voice"),
            ("0.6B", "voice_design"),
            ("0.6B", "base"),
            ("1.7B", "custom_voice"),
            ("1.7B", "voice_design"),
            ("1.7B", "base"),
        ]
        for size, profile in combinations:
            response = client.get(f"/models/{size}/{profile}")
            assert response.status_code == 200, f"{size}/{profile} returned {response.status_code}"
            data = response.json()
            assert data["size"] == size
            assert data["profile"] == profile

    def test_unknown_size_returns_404(self, client: TestClient) -> None:
        response = client.get("/models/999B/base")
        assert response.status_code == 404
        data = response.json()
        assert "Unknown model size" in data.get("error", "")

    def test_unknown_profile_returns_404(self, client: TestClient) -> None:
        response = client.get("/models/0.6B/singing")
        assert response.status_code == 404
        data = response.json()
        assert "Unknown model profile" in data.get("error", "")

    def test_both_unknown_returns_404(self, client: TestClient) -> None:
        response = client.get("/models/999B/singing")
        assert response.status_code == 404
        # Should fail on size first
        data = response.json()
        assert "Unknown model size" in data.get("error", "")

    def test_error_includes_request_id(self, client: TestClient) -> None:
        response = client.get("/models/0.6B/singing")
        assert "X-Request-ID" in response.headers
        data = response.json()
        assert "request_id" in data


class TestModelDiagnosticsEndpoint:
    """Tests for GET /models/diagnostics."""

    def test_diagnostics_returns_200(self, client: TestClient) -> None:
        response = client.get("/models/diagnostics")
        assert response.status_code == 200

    def test_diagnostics_has_dependencies_list(self, client: TestClient) -> None:
        response = client.get("/models/diagnostics")
        data = response.json()
        assert "dependencies" in data
        assert isinstance(data["dependencies"], list)

    def test_diagnostics_include_ffmpeg_and_mlx_audio(self, client: TestClient) -> None:
        response = client.get("/models/diagnostics")
        deps = response.json()["dependencies"]
        names = {d["name"] for d in deps}
        assert "ffmpeg" in names
        assert "mlx-audio" in names

    def test_each_dep_has_status(self, client: TestClient) -> None:
        response = client.get("/models/diagnostics")
        for dep in response.json()["dependencies"]:
            assert "name" in dep
            assert "status" in dep
            assert dep["status"] in {"ok", "missing", "error"}


class TestModelRuntimeEndpoint:
    def test_runtime_reports_lifecycle_and_resource_fields(self, client: TestClient) -> None:
        response = client.get("/models/runtime")
        assert response.status_code == 200
        data = response.json()
        assert data["state"] in {"unloaded", "loading", "ready", "unloading", "error"}
        assert "load_count" in data
        assert "active_references" in data
        assert "load_latency_seconds" in data
        assert "active_memory_bytes" in data
        assert "peak_memory_bytes" in data

    def test_idle_runtime_can_be_unloaded(self, client: TestClient) -> None:
        response = client.delete("/models/runtime")
        assert response.status_code == 200
        assert response.json()["unloaded"] is True
        assert response.json()["runtime"]["state"] == "unloaded"

    def test_active_runtime_rejects_unload(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from qwen_tts_worker.model_lifecycle import model_lifecycle

        monkeypatch.setattr(model_lifecycle, "unload", lambda **kwargs: False)
        response = client.delete("/models/runtime")
        assert response.status_code == 409
        assert "active" in response.json()["error"]


class TestOpenApiSchema:
    """The OpenAPI schema must include the new /models paths."""

    def test_models_paths_in_openapi(self, client: TestClient) -> None:
        response = client.get("/openapi.json")
        schema = response.json()
        paths = schema["paths"]
        assert "/models" in paths
        assert "/models/{size}/{profile}" in paths
        assert "/models/diagnostics" in paths
        assert "/models/runtime" in paths
