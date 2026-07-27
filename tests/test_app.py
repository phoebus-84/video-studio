"""Integration tests for the full application.

Covers:
- Application startup without model loading.
- Route registration.
- OpenAPI schema generation.
- Request ID header injection.
- Voice profile CRUD operations.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


class TestAppStartup:
    """The application must start without loading a TTS model."""

    def test_app_creates_without_error(self, client: TestClient) -> None:
        """Creating the app and a TestClient must succeed without any imports
        of MLX or hardware-dependent modules."""
        assert client is not None

    def test_health_endpoint_registered(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.status_code == 200

    def test_model_not_loaded_on_startup(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.json()["model"] == "none"


class TestRouteRegistration:
    """Expected API routes must be registered."""

    def test_openapi_schema_available(self, client: TestClient) -> None:
        response = client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert schema["info"]["title"] == "Qwen TTS Worker"
        assert "/health" in schema["paths"]
        assert "/voices" in schema["paths"]
        assert "/voices/{voice_id}" in schema["paths"]

    def test_openapi_schema_has_version(self, client: TestClient) -> None:
        response = client.get("/openapi.json")
        assert response.json()["info"]["version"] == "0.1.0"

    def test_docs_endpoint_available(self, client: TestClient) -> None:
        response = client.get("/docs")
        assert response.status_code == 200


class TestRequestID:
    """Every response must carry an X-Request-ID header."""

    def test_health_has_request_id(self, client: TestClient) -> None:
        response = client.get("/health")
        assert "X-Request-ID" in response.headers

    def test_404_has_request_id(self, client: TestClient) -> None:
        response = client.get("/nope")
        assert "X-Request-ID" in response.headers

    def test_request_ids_are_unique(self, client: TestClient) -> None:
        ids = set()
        for _ in range(20):
            r = client.get("/health")
            ids.add(r.headers["X-Request-ID"])
        assert len(ids) == 20  # all unique UUIDs


class TestVoiceCRUD:
    """Full CRUD lifecycle for voice profiles."""

    def test_create_and_get_voice(self, client: TestClient) -> None:
        payload = {
            "name": "Narrator One",
            "mode": "preset",
            "preset_name": "en-female-1",
            "language": "en",
        }
        create = client.post("/voices", json=payload)
        assert create.status_code == 201
        created = create.json()
        voice_id = created["id"]

        get = client.get(f"/voices/{voice_id}")
        assert get.status_code == 200
        assert get.json()["name"] == "Narrator One"

    def test_list_voices(self, client: TestClient) -> None:
        # Create two voices
        client.post("/voices", json={"name": "A", "mode": "preset", "preset_name": "p1"})
        client.post("/voices", json={"name": "B", "mode": "clone", "reference_audio_path": "/tmp/x.wav"})
        response = client.get("/voices")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_update_voice(self, client: TestClient) -> None:
        create = client.post("/voices", json={"name": "Old", "mode": "preset", "preset_name": "p1"})
        voice_id = create.json()["id"]

        update = client.patch(f"/voices/{voice_id}", json={"name": "New Name"})
        assert update.status_code == 200
        assert update.json()["name"] == "New Name"

    def test_update_nonexistent_voice(self, client: TestClient) -> None:
        fake_id = str(uuid.uuid4())
        response = client.patch(f"/voices/{fake_id}", json={"name": "X"})
        assert response.status_code == 404

    def test_delete_voice(self, client: TestClient) -> None:
        create = client.post("/voices", json={"name": "DeleteMe", "mode": "preset", "preset_name": "p1"})
        voice_id = create.json()["id"]

        delete = client.delete(f"/voices/{voice_id}")
        assert delete.status_code == 204

        get = client.get(f"/voices/{voice_id}")
        assert get.status_code == 404

    def test_delete_nonexistent_voice(self, client: TestClient) -> None:
        fake_id = str(uuid.uuid4())
        response = client.delete(f"/voices/{fake_id}")
        assert response.status_code == 404

    def test_get_nonexistent_voice(self, client: TestClient) -> None:
        fake_id = str(uuid.uuid4())
        response = client.get(f"/voices/{fake_id}")
        assert response.status_code == 404
