"""Tests for the error model and redaction guarantees.

Covers:
- ErrorEnvelope construction.
- Redaction of internal details from exception messages.
- JSON serialisation of error responses.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from qwen_tts_worker.models.errors import ErrorDetail, ErrorEnvelope, _safe_message


class TestErrorEnvelope:
    """Unit tests for the ErrorEnvelope model."""

    def test_basic_envelope(self) -> None:
        env = ErrorEnvelope(error="Something went wrong.")
        assert env.error == "Something went wrong."
        assert env.detail == []
        assert env.request_id is None

    def test_envelope_with_detail(self) -> None:
        env = ErrorEnvelope(
            error="Validation failed.",
            detail=[
                ErrorDetail(loc=["body", "text"], msg="Field required", type="missing"),
            ],
            request_id="req-123",
        )
        assert len(env.detail) == 1
        assert env.detail[0].loc == ["body", "text"]
        assert env.request_id == "req-123"

    def test_json_serialisation(self) -> None:
        env = ErrorEnvelope(error="Test", request_id="abc")
        data = env.model_dump(mode="json")
        assert data == {"error": "Test", "detail": [], "request_id": "abc"}

    def test_from_exception_redacts(self) -> None:
        """Internal exception messages must not leak to callers."""
        try:
            raise ValueError("Sensitive: /secret/path")
        except ValueError as exc:
            env = ErrorEnvelope.from_exception(exc, request_id="r1")

        assert "Sensitive" not in env.error
        assert "/secret/path" not in env.error
        assert env.request_id == "r1"

    def test_safe_message_http_exception(self) -> None:
        """HTTPException detail must be preserved."""

        class FakeHTTPException(Exception):
            def __init__(self) -> None:
                self.status_code = 404
                self.detail = "Not found"

        msg = _safe_message(FakeHTTPException())
        assert msg == "Not found"

    def test_safe_message_generic_exception(self) -> None:
        """Generic exceptions must return a sanitised message."""
        msg = _safe_message(RuntimeError("internal crash"))
        assert "RuntimeError" in msg
        assert "internal crash" not in msg


class TestErrorResponses:
    """Integration tests for error responses from the application."""

    def test_404_returns_error_envelope(self, client: TestClient) -> None:
        """Unknown routes must return an error envelope, not raw HTML."""
        response = client.get("/nonexistent")
        assert response.status_code == 404
        data = response.json()
        assert "error" in data

    def test_405_returns_error_envelope(self, client: TestClient) -> None:
        """Wrong method must return an error envelope."""
        response = client.patch("/health")
        assert response.status_code == 405
        data = response.json()
        assert "error" in data

    def test_error_has_request_id_header(self, client: TestClient) -> None:
        """Every response must include an X-Request-ID header."""
        response = client.get("/nonexistent")
        assert "X-Request-ID" in response.headers
        assert len(response.headers["X-Request-ID"]) > 0

    def test_validation_error_returns_envelope(self, client: TestClient) -> None:
        """Validation errors must return an error envelope with detail."""
        # Create a voice with missing required field
        response = client.post("/voices", json={"mode": "preset"})
        assert response.status_code == 422
        data = response.json()
        assert "error" in data
        # FastAPI wraps the envelope in its own detail; either way we
        # get structured output.
        assert isinstance(data, dict)

    def test_unhandled_exception_returns_500_envelope(self, client: TestClient) -> None:
        """Unhandled exceptions must return a redacted 500 envelope."""
        # There's no endpoint that throws on purpose yet, but the
        # middleware must be registered. We verify by checking that
        # the 500 handler is wired — FastAPI's default 500 handler
        # returns plain text, but ours returns JSON.
        # We test this indirectly by confirming the exception handler
        # is in the app's exception_handlers.
        from qwen_tts_worker.app import create_app
        app = create_app()
        assert Exception in app.exception_handlers
